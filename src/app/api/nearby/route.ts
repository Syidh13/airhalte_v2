/**
 * GET /api/nearby?lat=<lat>&lng=<lng>
 *
 * Public proxy ke Overpass (OpenStreetMap) untuk baris "Tempat sekitar"
 * di DetailPanel. Harus server-side: overpass-api.de menolak (406) request
 * browser karena tidak ada User-Agent yang mengidentifikasi aplikasi.
 *
 * - Koordinat dibatasi ke area Jabodetabek supaya endpoint ini tidak jadi
 *   proxy Overpass terbuka.
 * - POI jarang berubah → hasil sukses di-cache di memori instance (24 jam)
 *   dan di CDN (s-maxage 1 hari + SWR 7 hari). Gagal → 502 no-store,
 *   jadi tidak ada hasil kosong palsu yang ter-cache.
 *
 * Response:
 *   200 { places: NearbyPlace[] }
 *   400 { error }  — lat/lng tidak valid / di luar area
 *   502 { error }  — semua server Overpass gagal / timeout
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  fetchNearbyFromOverpass,
  NEARBY_API_VERSION,
  type NearbyPlace,
} from "@/lib/overpass";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const cache = new Map<string, { at: number; places: NearbyPlace[] }>();

// Jabodetabek bounding box (longgar).
const BOUNDS = { minLat: -6.9, maxLat: -5.9, minLng: 106.3, maxLng: 107.3 };

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < BOUNDS.minLat || lat > BOUNDS.maxLat ||
    lng < BOUNDS.minLng || lng > BOUNDS.maxLng
  ) {
    return NextResponse.json({ error: "Koordinat tidak valid" }, { status: 400 });
  }

  // ~11 m precision — cukup untuk radius 800 m, dan menyatukan cache key.
  const rLat = Math.round(lat * 1e4) / 1e4;
  const rLng = Math.round(lng * 1e4) / 1e4;
  const key = `v${NEARBY_API_VERSION}:${rLat},${rLng}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return ok(hit.places);
  }

  try {
    const places = await fetchNearbyFromOverpass(rLat, rLng);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), places });
    return ok(places);
  } catch (err) {
    console.warn("[api/nearby] Overpass gagal:", err);
    return NextResponse.json(
      { error: "Data OpenStreetMap sedang tidak tersedia" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function ok(places: NearbyPlace[]) {
  return NextResponse.json(
    { places },
    {
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
