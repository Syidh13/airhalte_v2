// ============================================================================
// OVERPASS — nearby POIs from OpenStreetMap (no API key, free).
// Used by DetailPanel for the "Tempat sekitar" row.
//
// Kenapa lewat server: overpass-api.de menolak (HTTP 406) request tanpa
// User-Agent yang mengidentifikasi aplikasi, dan browser tidak boleh
// mengubah User-Agent. Jadi browser memanggil /api/nearby, server yang
// memanggil Overpass (lihat fetchNearbyFromOverpass).
// ============================================================================

export type NearbyKind =
  | "shop"
  | "bank"
  | "cafe"
  | "clinic"
  | "office"
  | "other";

export interface NearbyPlace {
  name: string;
  kind: NearbyKind;
  /** Titik POI (node) atau titik tengah (way/relation) — untuk marker peta. */
  lat: number;
  lng: number;
}

export const NEARBY_RADIUS_M = 800;
const MAX_PLACES = 30;

// Server publik Overpass sering 504/antre; kita balapan ke beberapa mirror
// dan ambil jawaban sukses pertama.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const OVERPASS_USER_AGENT =
  "AirHalte/1.0 (+https://github.com/Syidh13/airhalte)";
// < batas 10 dtk function Netlify (sisakan waktu untuk cold start).
const OVERPASS_TIMEOUT_MS = 8000;

/**
 * Map an OSM tag bag (amenity / shop / office) to one of our 6 display
 * buckets. Order of checks matters — a bank is also an "amenity" so we
 * check the most specific buckets first.
 */
function classify(tags: Record<string, string> | undefined): NearbyKind {
  const amenity = tags?.amenity;
  const shop = tags?.shop;
  const office = tags?.office;

  if (amenity === "bank" || amenity === "atm") return "bank";
  if (amenity === "cafe" || amenity === "restaurant" || amenity === "fast_food" || amenity === "food_court") return "cafe";
  if (amenity === "clinic" || amenity === "hospital" || amenity === "doctors" || amenity === "pharmacy") return "clinic";
  if (office) return "office";
  if (shop) return "shop";
  return "other";
}

function buildQuery(lat: number, lng: number): string {
  const around = `(around:${NEARBY_RADIUS_M},${lat},${lng})`;
  return `
    [out:json][timeout:8];
    (
      nwr["name"]["shop"]${around};
      nwr["name"]["amenity"]["amenity"!~"^(bench|waste_basket|parking|toilets|bicycle_parking)$"]${around};
      nwr["name"]["office"]${around};
      way["name"]["building"="commercial"]${around};
    );
    out center tags 60;
  `;
}

async function queryEndpoint(
  endpoint: string,
  query: string,
  signal: AbortSignal
): Promise<NearbyPlace[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OVERPASS_USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} (${endpoint})`);
  const data = await res.json();

  // Dedupe by name, filter trivial / overly short noise.
  const seen = new Set<string>();
  const places: NearbyPlace[] = [];
  for (const el of data.elements ?? []) {
    const name = el?.tags?.name;
    if (typeof name !== "string" || name.length <= 2) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    places.push({ name, kind: classify(el.tags), lat, lng });
  }
  return places.slice(0, MAX_PLACES);
}

/**
 * SERVER ONLY. Returns up to 30 unique POIs within 800 m of (lat, lng).
 * Races all mirrors; first success wins, the rest are aborted.
 * Throws if every mirror fails or times out (caller decides the response).
 */
export async function fetchNearbyFromOverpass(
  lat: number,
  lng: number
): Promise<NearbyPlace[]> {
  const query = buildQuery(lat, lng);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    return await Promise.any(
      OVERPASS_ENDPOINTS.map((ep) => queryEndpoint(ep, query, controller.signal))
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Versi format response — naikkan kalau bentuk NearbyPlace berubah supaya
// cache browser/CDN lama (tanpa koordinat) tidak terpakai.
export const NEARBY_API_VERSION = 2;

// Satu request per koordinat dibagi bersama DetailPanel dan MapView
// (keduanya meminta data yang sama saat halte diklik).
const clientCache = new Map<string, Promise<NearbyPlace[]>>();

/**
 * CLIENT. Fetches nearby POIs via /api/nearby. Network can take 2–8 s;
 * callers should render a loading state and not block the panel.
 *
 * Returns [] on network error, timeout, parse error, or no matches —
 * never throws. Failed / empty results are not memoised, so opening the
 * halte again retries.
 */
export function getNearbyPlaces(
  lat: number,
  lng: number
): Promise<NearbyPlace[]> {
  const key = `${lat},${lng}`;
  const cached = clientCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    // 502 = semua mirror Overpass timeout/sibuk — sering lolos di percobaan
    // kedua, jadi coba sekali lagi sebelum menyerah.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `/api/nearby?lat=${lat}&lng=${lng}&v=${NEARBY_API_VERSION}`
        );
        if (res.status === 502) continue;
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.places) ? (data.places as NearbyPlace[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
  clientCache.set(key, promise);
  promise.then((places) => {
    if (places.length === 0) clientCache.delete(key);
  });
  return promise;
}
