// ============================================================================
// HALTES MAP DATA ACCESS — hybrid pipeline
//
// Three layers, each sized for its own update cadence:
//
//   1. STABLE  — /haltes-map.geojson (static, public/ folder)
//      Contains the fields that rarely change: id, name, mode, corridor,
//      coords. The browser caches this aggressively; it only changes when
//      superadmin hits "Sync Map Data".
//
//   2. REALTIME — /api/haltes/availability (poll every 10s)
//      { id, available, is_listed } for every titik, plus harga dasar,
//      penawaran tertinggi and the auction window for Halte BRT. Merged over
//      the stable layer so marker state and price labels follow the DB
//      without re-downloading the fleet.
//
//   3. DETAIL — /api/haltes/[id] (lazy, on halte click)
//      Full DB row for the clicked halte, projected into HalteData.
//
// Semua state komersial (harga dasar, penawaran, jadwal/status lelang) hanya
// berasal dari DB lewat layer 2 dan 3. Fixture template di data/haltes.ts
// (HALTES) sengaja TIDAK digabung lagi: angkanya karangan.
// ============================================================================

import { useEffect, useState } from "react";
import {
  isExcludedHalteId,
  type HalteData,
  type MassHalte,
  type MassStatus,
  type PremiumHalte,
  type Tier,
} from "@/data/haltes";
import {
  NON_BRT_MONTHLY_PRICE,
  PREMIUM_MIN_BASE_PRICE,
  effectiveBasePrice,
  subscriptionTotal,
} from "@/lib/pricing";
import { fmtRupiahShort } from "@/lib/format";

// ---------------------------------------------------------------------------
// Price copy — satu sumber untuk ticker, mode switch, legend, dan kartu.
// ---------------------------------------------------------------------------

/** Rupiah untuk kalimat: 100_000_000 → "Rp 100 jt", 2_000_000_000 → "Rp 2 M". */
export function fmtRupiahCopy(n: number): string {
  return fmtRupiahShort(n).replace(/(\d)(M|jt|rb)$/, "$1 $2");
}

export const PRICE_COPY = {
  /** "mulai Rp 100 jt/tahun" — harga dasar minimum Halte BRT. */
  premiumFrom: `mulai ${fmtRupiahCopy(PREMIUM_MIN_BASE_PRICE)}/tahun`,
  /** "Rp 3 jt/bulan" — tarif tetap bus stop Non-BRT. */
  nonBrtMonthly: `${fmtRupiahCopy(NON_BRT_MONTHLY_PRICE)}/bulan`,
  /** "Rp 36 jt/tahun" — langganan tahunan Non-BRT (12 bulan, tanpa diskon). */
  nonBrtYearly: `${fmtRupiahCopy(subscriptionTotal(12))}/tahun`,
} as const;

/**
 * Nominal yang ditampilkan untuk satu Halte BRT: penawaran tertinggi bila
 * sudah ada, selain itu harga dasar (dibulatkan ke minimum Rp 100 jt).
 */
export function premiumDisplayPrice(
  basePrice: number | null | undefined,
  currentBid: number | null | undefined
): { amount: number; hasBid: boolean } {
  const bid = Number(currentBid ?? 0);
  if (Number.isFinite(bid) && bid > 0) {
    return { amount: Math.round(bid), hasBid: true };
  }
  return { amount: effectiveBasePrice(basePrice), hasBid: false };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lean record for the map layer — the minimum a marker needs to render. */
export interface MapRecord {
  id: string;
  name: string;
  mode: "premium" | "mass";
  /** Kode internal (A = Halte BRT, D = Non-BRT) untuk kompatibilitas tipe.
      Bukan kelas harga — jangan ditampilkan ke pengguna. */
  tier: Tier;
  lat: number;
  lng: number;
  available: boolean;
  /** Listing flag, derived server-side in /api/haltes/availability.
      `false` = hide from map + sidebar. Defaults to `false` until the
      first availability snapshot lands, so a failed fetch never floods
      the map with every titik. The detail panel still works for direct
      links because page.tsx resolves halteId from the *unfiltered* list. */
  is_listed: boolean;
  /** TJ corridor / route code (e.g. "1", "13", "JAK.46"). May be null. */
  corridor: string | null;
  /** Halte BRT: harga dasar mentah dari DB (null = belum termuat).
      Selalu tampilkan lewat effectiveBasePrice() / premiumDisplayPrice(). */
  basePrice: number | null;
  /** Halte BRT: penawaran tertinggi dari DB (0 = belum ada penawaran). */
  currentBidAmount: number;
  /** Halte BRT: jadwal lelang dari DB (null = belum dijadwalkan). */
  auctionStartsAt: string | null;
  auctionEndsAt: string | null;
}

interface GeoJsonFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    mode: "premium" | "mass";
    /** Legacy baked code; ignored by the loader (tier is derived from mode). */
    tier?: Tier;
    available: boolean;
    /** Optional so older GeoJSONs generated before the corridor field
        was baked don't break parsing. */
    corridor?: string | null;
  };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  generatedAt?: string;
  features: GeoJsonFeature[];
}

/** Snapshot value the polling hook stores per halte id. `available` drives
    marker state, `is_listed` the show/hide gate. The Premium-only fields
    are omitted by the API for Non-BRT rows and for empty values. */
export interface AvailabilitySnapshot {
  available: boolean;
  is_listed: boolean;
  base_price?: number;
  current_bid?: number;
  auction_starts_at?: string;
  auction_ends_at?: string;
}

interface AvailabilityItem extends AvailabilitySnapshot {
  id: string;
}

interface DbRow {
  id: string;
  name: string;
  corridor: string | null;
  lat: number;
  lng: number;
  type: "brt" | "non-brt";
  tier: "premium" | "mass";
  base_price: number | null;
  current_bid: number | null;
  street_view_url: string | null;
  is_available: boolean;
  /** Auction lifecycle. Null on legacy rows / unscheduled. */
  auction_starts_at: string | null;
  auction_ends_at: string | null;
}

// ---------------------------------------------------------------------------
// Endpoints — relative so this works in SSR + browser without env gymnastics.
// ---------------------------------------------------------------------------
const GEOJSON_URL = "/haltes-map.geojson";
const AVAILABILITY_URL = "/api/haltes/availability";
const DETAIL_URL = (id: string) => `/api/haltes/${encodeURIComponent(id)}`;

export const AVAILABILITY_POLL_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Availability merge helpers
// ---------------------------------------------------------------------------

function toSnapshot(it: AvailabilityItem): AvailabilitySnapshot {
  const snap: AvailabilitySnapshot = {
    available: it.available === true,
    is_listed: it.is_listed === true,
  };
  if (typeof it.base_price === "number") snap.base_price = it.base_price;
  if (typeof it.current_bid === "number") snap.current_bid = it.current_bid;
  if (typeof it.auction_starts_at === "string") snap.auction_starts_at = it.auction_starts_at;
  if (typeof it.auction_ends_at === "string") snap.auction_ends_at = it.auction_ends_at;
  return snap;
}

function sameSnapshotValue(a: AvailabilitySnapshot, b: AvailabilitySnapshot): boolean {
  return (
    a.available === b.available &&
    a.is_listed === b.is_listed &&
    a.base_price === b.base_price &&
    a.current_bid === b.current_bid &&
    a.auction_starts_at === b.auction_starts_at &&
    a.auction_ends_at === b.auction_ends_at
  );
}

function sameSnapshot(
  a: Map<string, AvailabilitySnapshot>,
  b: Map<string, AvailabilitySnapshot>
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, next] of b) {
    const prev = a.get(id);
    if (!prev || !sameSnapshotValue(prev, next)) return false;
  }
  return true;
}

/**
 * Merge one availability snapshot into a record. Returns the SAME object
 * when nothing changed, so downstream useMemo / MapView setData effects
 * don't re-run on every 10 s poll. Premium fields the API leaves out mean
 * "empty" (0 / null), not "keep the old value".
 */
export function applyAvailability(
  r: MapRecord,
  s: AvailabilitySnapshot
): MapRecord {
  const premium = r.mode === "premium";
  const basePrice = premium ? s.base_price ?? null : null;
  const currentBidAmount = premium ? s.current_bid ?? 0 : 0;
  const auctionStartsAt = premium ? s.auction_starts_at ?? null : null;
  const auctionEndsAt = premium ? s.auction_ends_at ?? null : null;
  if (
    r.available === s.available &&
    r.is_listed === s.is_listed &&
    r.basePrice === basePrice &&
    r.currentBidAmount === currentBidAmount &&
    r.auctionStartsAt === auctionStartsAt &&
    r.auctionEndsAt === auctionEndsAt
  ) {
    return r;
  }
  return {
    ...r,
    available: s.available,
    is_listed: s.is_listed,
    basePrice,
    currentBidAmount,
    auctionStartsAt,
    auctionEndsAt,
  };
}

// ---------------------------------------------------------------------------
// 1. Stable + realtime: loadMapData()
// ---------------------------------------------------------------------------

/**
 * Fetch the static GeoJSON + a fresh availability snapshot, then merge.
 * The returned array is everything MapView needs to render all markers
 * across both modes; filtering (mode, search) happens in the page.
 *
 * Both fetches run in parallel. If the availability fetch fails, records
 * stay unlisted (hidden) until the polling hook lands its first snapshot —
 * an empty map is honest, a map full of stale "available" titik is not.
 */
export async function loadMapData(): Promise<MapRecord[]> {
  const [geojson, availabilityMap] = await Promise.all([
    fetchGeoJson(),
    fetchAvailabilityMap().catch((err) => {
      console.warn("[availability] initial fetch failed:", err);
      return null;
    }),
  ]);

  const records: MapRecord[] = [];
  for (const f of geojson.features ?? []) {
    const p = f?.properties;
    const coords = f?.geometry?.coordinates;
    if (!p || isExcludedHalteId(p.id) || !Array.isArray(coords)) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const mode: MapRecord["mode"] = p.mode === "premium" ? "premium" : "mass";
    const base: MapRecord = {
      id: p.id,
      name: p.name,
      mode,
      tier: mode === "premium" ? "A" : "D",
      lat,
      lng,
      // Baked flag is stale but only matters until the first snapshot.
      available: p.available !== false,
      is_listed: false,
      corridor: p.corridor ?? null,
      basePrice: null,
      currentBidAmount: 0,
      auctionStartsAt: null,
      auctionEndsAt: null,
    };
    const fresh = availabilityMap?.get(p.id);
    records.push(fresh ? applyAvailability(base, fresh) : base);
  }
  return records;
}

async function fetchGeoJson(): Promise<GeoJsonFeatureCollection> {
  const res = await fetch(GEOJSON_URL, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`GeoJSON fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GeoJsonFeatureCollection;
}

async function fetchAvailabilityMap(): Promise<
  Map<string, AvailabilitySnapshot>
> {
  const items = await fetchAvailability();
  const map = new Map<string, AvailabilitySnapshot>();
  for (const it of items) {
    if (isExcludedHalteId(it.id)) continue;
    map.set(it.id, toSnapshot(it));
  }
  return map;
}

/** Exposed for the polling hook. */
export async function fetchAvailability(
  signal?: AbortSignal
): Promise<AvailabilityItem[]> {
  const res = await fetch(AVAILABILITY_URL, { cache: "no-store", signal });
  if (!res.ok) {
    throw new Error(`Availability fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { items?: AvailabilityItem[] };
  return Array.isArray(body.items) ? body.items : [];
}

// ---------------------------------------------------------------------------
// 2. Realtime polling hook
// ---------------------------------------------------------------------------

/**
 * useAvailabilityPolling — polls `/api/haltes/availability` every
 * `AVAILABILITY_POLL_INTERVAL_MS` and returns the latest snapshot as a
 * Map keyed by halte id (empty until the first successful poll).
 *
 * - Skips polling while the tab is hidden and catches up on
 *   visibilitychange.
 * - One request at a time: a tick is skipped while the previous one is
 *   still in flight (slow network never stacks requests).
 * - Each effect run owns its own cancel token + AbortController, so a
 *   Fast Refresh / re-mount can't be confused by a stale in-flight run.
 * - Errors keep the last known snapshot. An unchanged response keeps the
 *   previous Map reference, so the page doesn't re-render every 10 s.
 */
export function useAvailabilityPolling(
  enabled: boolean = true
): Map<string, AvailabilitySnapshot> {
  const [snapshot, setSnapshot] = useState<Map<string, AvailabilitySnapshot>>(
    () => new Map()
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    async function tick() {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight = true;
      try {
        const items = await fetchAvailability(controller.signal);
        if (cancelled) return;
        const next = new Map<string, AvailabilitySnapshot>();
        for (const it of items) {
          if (isExcludedHalteId(it.id)) continue;
          next.set(it.id, toSnapshot(it));
        }
        setSnapshot((prev) => (sameSnapshot(prev, next) ? prev : next));
      } catch (err) {
        if (cancelled) return;
        console.warn("[availability] poll failed:", err);
      } finally {
        inFlight = false;
      }
    }

    void tick();
    const id = window.setInterval(tick, AVAILABILITY_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return snapshot;
}

// ---------------------------------------------------------------------------
// 3. Detail: fetchHalteDetail()
// ---------------------------------------------------------------------------

/**
 * Fetch one halte by id and project it into the shape DetailPanel expects
 * (HalteData). Everything comes from the DB row — no editorial twin.
 *
 * Returns null on 404 (and for excluded test records) so the caller can
 * show a "not found" state. Throws on other errors (network, 5xx) so the
 * caller can show a retry UI.
 */
export async function fetchHalteDetail(id: string): Promise<HalteData | null> {
  if (isExcludedHalteId(id)) return null;
  const res = await fetch(DETAIL_URL(id), { cache: "default" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Detail fetch failed: ${res.status}`
    );
  }

  const body = (await res.json()) as { data?: DbRow | null };
  if (!body.data || isExcludedHalteId(body.data.id)) return null;
  return projectDetail(body.data);
}

// ---------------------------------------------------------------------------
// Projection — DB row / MapRecord → HalteData
// ---------------------------------------------------------------------------

interface ProjectionInput {
  id: string;
  name: string;
  koridor: string;
  addr: string;
  lat: number;
  lng: number;
  available: boolean;
  /** Raw DB base price; null/undefined = belum diketahui. */
  basePrice: number | null | undefined;
  currentBidAmount: number | null | undefined;
  auctionStartsAt: string | null;
  auctionEndsAt: string | null;
  streetViewUrl?: string | null;
}

/** "Koridor 1" for Halte BRT, "Rute JAK.46" for bus stop Non-BRT. */
function formatKoridor(
  corridor: string | null | undefined,
  mode: "premium" | "mass"
): string {
  const c = corridor?.trim();
  if (mode === "premium") return c ? `Koridor ${c}` : "Koridor Transjakarta";
  return c ? `Rute ${c}` : "Non-BRT";
}

function buildPremiumHalte(x: ProjectionInput): PremiumHalte {
  const known = x.basePrice !== null && x.basePrice !== undefined;
  const basePrice = known ? effectiveBasePrice(x.basePrice) : undefined;
  const bid = Number(x.currentBidAmount ?? 0);
  const currentBidAmount = Number.isFinite(bid) && bid > 0 ? Math.round(bid) : 0;
  const floor = basePrice !== undefined ? fmtRupiahShort(basePrice) : "—";
  return {
    id: x.id,
    mode: "premium",
    tier: "A",
    name: x.name,
    koridor: x.koridor,
    addr: x.addr,
    lat: x.lat,
    lng: x.lng,
    // Tidak ada data resmi penumpang / perusahaan sekitar → placeholder.
    pax: "—",
    companies: "—",
    currentBid: currentBidAmount > 0 ? fmtRupiahShort(currentBidAmount) : floor,
    floor,
    delta: "—",
    bidders: 0,
    bids: 0,
    timer: "—",
    urgent: false,
    // is_available=false on a Halte BRT = lelang ditutup / dibekukan admin.
    closed: !x.available,
    auctionStartsAt: x.auctionStartsAt,
    auctionEndsAt: x.auctionEndsAt,
    basePrice,
    currentBidAmount,
    streetViewUrl: x.streetViewUrl ?? undefined,
  };
}

function buildMassHalte(x: ProjectionInput): MassHalte {
  const status: MassStatus = x.available ? "available" : "taken";
  return {
    id: x.id,
    mode: "mass",
    tier: "D",
    name: x.name,
    koridor: x.koridor,
    addr: x.addr,
    lat: x.lat,
    lng: x.lng,
    pax: "—",
    companies: "—",
    // Non-BRT = tarif tetap, sama untuk semua titik.
    price: fmtRupiahCopy(NON_BRT_MONTHLY_PRICE),
    per: "/ bulan",
    brand: "—",
    status,
    streetViewUrl: x.streetViewUrl ?? undefined,
  };
}

function projectDetail(row: DbRow): HalteData {
  const mode: "premium" | "mass" = row.tier === "premium" ? "premium" : "mass";
  const input: ProjectionInput = {
    id: row.id,
    name: row.name,
    koridor: formatKoridor(row.corridor, mode),
    // No address column yet — the name is the best signal we have.
    addr: row.name,
    lat: row.lat,
    lng: row.lng,
    available: row.is_available,
    basePrice: row.base_price,
    currentBidAmount: row.current_bid,
    auctionStartsAt: row.auction_starts_at,
    auctionEndsAt: row.auction_ends_at,
    streetViewUrl: row.street_view_url,
  };
  return mode === "premium" ? buildPremiumHalte(input) : buildMassHalte(input);
}

/**
 * Project a lean MapRecord into a HalteData suitable for the sidebar card
 * (and the DetailPanel stub while the detail fetch is in flight). Only
 * live values from the stable + realtime layers; unknown values stay "—".
 */
export function projectSidebarCard(record: MapRecord): HalteData {
  const input: ProjectionInput = {
    id: record.id,
    name: record.name,
    koridor: formatKoridor(record.corridor, record.mode),
    addr: "—",
    lat: record.lat,
    lng: record.lng,
    available: record.available,
    basePrice: record.basePrice,
    currentBidAmount: record.currentBidAmount,
    auctionStartsAt: record.auctionStartsAt,
    auctionEndsAt: record.auctionEndsAt,
  };
  return record.mode === "premium"
    ? buildPremiumHalte(input)
    : buildMassHalte(input);
}
