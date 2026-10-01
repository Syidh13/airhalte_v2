// ============================================================================
// OVERPASS — fetch nearby POIs from OpenStreetMap (no API key, free).
// Used by DetailPanel to enrich the "Perusahaan sekitar" row with real
// businesses around a halte. Falls back silently to [] on any failure so
// callers can show their hardcoded backup string instead of an error.
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
}

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

/**
 * Returns up to 30 unique POIs within an 800 m radius of (lat, lng) using
 * Overpass QL. Each entry includes a `kind` derived from OSM tags so the
 * UI can show a category icon. Network can take 2–5s; callers should
 * render a loading state and not block the panel.
 *
 * Returns [] on network error, timeout, parse error, or no matches —
 * never throws. The empty result is the signal to use a hardcoded fallback.
 */
export async function getNearbyPlaces(
  lat: number,
  lng: number
): Promise<NearbyPlace[]> {
  const radius = 800;
  const query = `
    [out:json][timeout:10];
    (
      node["name"]["shop"](around:${radius},${lat},${lng});
      node["name"]["amenity"]["amenity"!="bench"]["amenity"!="waste_basket"]
          (around:${radius},${lat},${lng});
      node["name"]["office"](around:${radius},${lat},${lng});
      node["name"]["brand"](around:${radius},${lat},${lng});
      way["name"]["building"="commercial"](around:${radius},${lat},${lng});
      way["name"]["office"](around:${radius},${lat},${lng});
    );
    out body 30;
  `;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    // Dedupe by name, filter trivial / overly short noise.
    const seen = new Set<string>();
    const places: NearbyPlace[] = [];
    for (const el of data.elements ?? []) {
      const name = el?.tags?.name;
      if (typeof name !== "string" || name.length <= 2) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      places.push({ name, kind: classify(el.tags) });
    }

    return places.slice(0, 30);
  } catch {
    return [];
  }
}
