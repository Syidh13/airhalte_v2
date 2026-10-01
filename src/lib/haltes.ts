// ============================================================================
// HALTES DATA ACCESS
//
// Reads halte rows from Supabase (paginated; ~7.6k rows total) and projects
// them into the HalteData shape the portal UI expects.
//
// LEGACY — the portal now uses lib/haltes-map.ts. Kept as a fallback loader
// (do not delete), but it no longer touches the template fixtures:
//
//   1) Fetch ALL haltes from Supabase in 1k-row pages (PostgREST default
//      cap) and synthesize a HalteData for every row from DB values only
//      (harga dasar via effectiveBasePrice, penawaran = current_bid).
//      The editorial twins in src/data/haltes.ts are NOT merged: their
//      numbers (bids, winners, pax) are invented.
//
//   2) Cache the result in a process-level variable with a 5-minute TTL.
//
//   3) On any failure (no env, network error, RLS denial), return an EMPTY
//      list so the UI shows an honest empty state instead of demo data.
//
// The bogus DB record id 'test' is always skipped.
// ============================================================================

import { supabase } from "@/lib/supabase";
import {
  isExcludedHalteId,
  type HalteData,
  type Tier,
  type MassStatus,
} from "@/data/haltes";
import { NON_BRT_MONTHLY_PRICE, effectiveBasePrice } from "@/lib/pricing";

/** Fallback when Supabase is unreachable: nothing, never template data. */
const FALLBACK_HALTES: HalteData[] = [];

// ---------------------------------------------------------------------------
// Slug helper — matches scripts/seed-haltes.ts. Kept in lock-step by hand
// because the script must stay free of /lib imports (it runs in plain node).
// ---------------------------------------------------------------------------
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface HalteDbRow {
  id: string;
  name: string;
  corridor: string | null;
  lat: number;
  lng: number;
  type: "brt" | "non-brt";
  tier: "premium" | "mass";
  base_price: number;
  current_bid: number | null;
  street_view_url: string | null;
  is_available: boolean;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
}

const SUPABASE_AVAILABLE = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// PostgREST defaults to a 1000-row cap per request. Keeping this constant
// here (and not 999/1001) so the page math stays trivially auditable.
const PAGE_SIZE = 1000;

// L1: in-memory cache (lives as long as the JS module — cleared on hard refresh).
// L2: sessionStorage (survives soft refreshes within the same browser tab/session).
// L3: Supabase (the source of truth).
const CACHE_TTL_MS   = 5  * 60 * 1000;  // L1 TTL: 5 min
const STORAGE_TTL_MS = 30 * 60 * 1000;  // L2 TTL: 30 min
const STORAGE_KEY    = "airhalte:haltes:v2"; // bump version to bust old shapes

interface CacheEntry {
  value: HalteData[];
  expiresAt: number;
  // `complete` = we know this snapshot contains every row that existed at
  // save time (i.e. the load finished cleanly). Partial saves set this to
  // false so the next session knows it must keep fetching to fill the gap.
  complete: boolean;
}
let _cache: CacheEntry | null = null;
let _inflight: Promise<HalteData[]> | null = null;

// Debounce partial sessionStorage writes during a streaming load. Without
// this we'd serialize the entire array 8+ times per load — O(n) JSON.stringify
// on a 7.6k array is ~50ms, enough to jank the main thread.
let _partialSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePartialSave(value: HalteData[]): void {
  if (_partialSaveTimer) clearTimeout(_partialSaveTimer);
  _partialSaveTimer = setTimeout(() => {
    storageSave(value, false);
    _partialSaveTimer = null;
  }, 400);
}

// ---------------------------------------------------------------------------
// sessionStorage helpers (L2 cache) — browser-only, gracefully no-ops in SSR
// ---------------------------------------------------------------------------
function storageLoad(): { value: HalteData[]; complete: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.expiresAt < Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { value: entry.value, complete: entry.complete ?? true };
  } catch {
    return null;
  }
}

function storageSave(value: HalteData[], complete: boolean): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        value,
        expiresAt: Date.now() + STORAGE_TTL_MS,
        complete,
      })
    );
  } catch {
    // QuotaExceededError or storage unavailable — silently skip.
  }
}

function storageClear(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Synthetic numeric ids for DB rows that don't have a hardcoded twin.
// Starts well above the highest hand-coded id (currently 112) so we never
// collide with the HALTES array's existing ids.
const SYNTHETIC_ID_BASE = 10_000;

/**
 * cyrb53 — fast 53-bit non-cryptographic string hash by bryc (public domain).
 * https://stackoverflow.com/a/52171480
 *
 * We use this instead of the naïve `(acc * 31 + c) & 0x7fffffff` hash because
 * a 31-bit space + the multiplier-31 hash had real collisions on the 7.6k
 * halte slug dataset (e.g. `17306` showing up twice). 53 bits is the largest
 * integer JS can represent exactly, and the cyrb53 mixer has avalanche
 * properties strong enough that birthday-collision probability for 7.6k
 * inputs is ~3e-9 — effectively zero.
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

/**
 * Synthesize a HalteData from a DB row (DB values only — every row takes
 * this path now). Fields without real data get a neutral "—" placeholder
 * so the UI still renders without runtime errors.
 *
 * The numeric `id` is a STABLE hash of the DB row's string id, plus
 * SYNTHETIC_ID_BASE so it never collides with the hardcoded HALTES
 * range. Stability matters because:
 *   - Pages arrive in non-deterministic order (Promise.all),
 *   - The L2 partial-cache resume path merges rows from two separate
 *     fetch sessions,
 *   - Anything counter-based would assign different ids to the same
 *     row across runs → React "duplicate key" errors.
 * Hash collision probability for 7.6k rows in 2^31 space ≈ 1.4e-5;
 * acceptable.
 */
function synthesizeFromDb(dbRow: HalteDbRow): HalteData {
  // HalteBase.id is now a string (DB slug). cyrb53 + SYNTHETIC_ID_BASE were
  // only needed when ids were numeric — keep them imported (dead now) until
  // this legacy loader is retired alongside page.tsx's refactor.
  const id = dbRow.id;
  // Internal code only (not a price class) — never shown to users.
  const tier: Tier = dbRow.tier === "premium" ? "A" : "D";
  const koridor = dbRow.corridor
    ? `Koridor ${dbRow.corridor}`
    : dbRow.type === "brt"
      ? "Koridor Transjakarta"
      : "Non-BRT";

  if (dbRow.tier === "premium") {
    // Premium / auction: harga dasar (floored to the Rp 100 jt minimum)
    // and the real current_bid from the DB. Bidder counts / timers are
    // not known here → neutral placeholders.
    const basePrice = effectiveBasePrice(dbRow.base_price);
    const bid = Number(dbRow.current_bid ?? 0);
    const currentBidAmount = Number.isFinite(bid) && bid > 0 ? bid : 0;
    const floor = formatRupiahShort(basePrice);
    return {
      id,
      mode: "premium",
      tier,
      name: dbRow.name,
      koridor,
      addr: dbRow.name, // best signal we have without a separate address column
      lat: dbRow.lat,
      lng: dbRow.lng,
      pax: "—",
      companies: "—",
      currentBid: currentBidAmount > 0 ? formatRupiahShort(currentBidAmount) : floor,
      floor,
      delta: "—",
      bidders: 0,
      bids: 0,
      timer: "—",
      urgent: false,
      closed: !dbRow.is_available,
      auctionStartsAt: dbRow.auction_starts_at,
      auctionEndsAt: dbRow.auction_ends_at,
      basePrice,
      currentBidAmount,
      streetViewUrl: dbRow.street_view_url ?? undefined,
    };
  }

  // Mass / subscription.
  const status: MassStatus = dbRow.is_available ? "available" : "taken";
  return {
    id,
    mode: "mass",
    tier,
    name: dbRow.name,
    koridor,
    addr: dbRow.name,
    lat: dbRow.lat,
    lng: dbRow.lng,
    pax: "—",
    companies: "—",
    // Non-BRT = fixed tariff for every titik (lib/pricing.ts).
    price: formatRupiahShort(NON_BRT_MONTHLY_PRICE),
    per: "/ bulan",
    brand: "—",
    status,
    streetViewUrl: dbRow.street_view_url ?? undefined,
  };
}

/** Compact Indonesian Rupiah for synthesized labels. Mirrors lib/format.ts
 *  but kept private here so this module has no cross-lib dep. */
function formatRupiahShort(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  if (n >= 1_000_000_000) {
    const v = (n / 1_000_000_000).toFixed(1).replace(".0", "").replace(".", ",");
    return `Rp ${v} M`;
  }
  if (n >= 1_000_000) return `Rp ${Math.round(n / 1_000_000)} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)} rb`;
  return `Rp ${n}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Project a raw DB page into HalteData[] (DB values only, no twins). */
function projectPage(rows: HalteDbRow[]): HalteData[] {
  return rows
    .filter((row) => !isExcludedHalteId(row.id))
    .map(synthesizeFromDb);
}

/**
 * Streaming load — fires all Supabase pages in PARALLEL after a fast
 * HEAD count probe, and calls `onBatch` after each page resolves so
 * the portal can render incrementally.
 *
 * `onBatch(batch, totalLoaded, totalKnown)` receives:
 *   - `batch`       the projected HalteData[] for this page only
 *                   (empty array on the initial count-only callback)
 *   - `totalLoaded` running total of rows loaded so far
 *   - `totalKnown`  the total row count from the count probe, or null
 *                   if the probe failed (caller should treat as unknown
 *                   and fall back to an indeterminate progress UI)
 *
 * Returns the full merged array when done (also writes to cache).
 * If the cache is warm it calls onBatch once with all cached data and
 * returns immediately — callers don't need a special path for that.
 *
 * Why parallel? With ~7.6k rows and 1k page size that's 8 pages. Sequential
 * = sum of all 8 RTTs (often 2-4s on real networks). Parallel = max of
 * the 8 RTTs (~300-500ms). The first batch lands in roughly the same time
 * but ALL batches finish within one round trip instead of eight.
 */
export async function getHaltesStreaming(
  onBatch: (
    batch: HalteData[],
    totalLoaded: number,
    totalKnown: number | null
  ) => void,
  // Internal flag: skip both cache layers and force a fresh Supabase fetch.
  // Used by the partial-cache resume path so the background fill doesn't
  // short-circuit on the same L2 entry it's trying to complete.
  options?: { bypassCache?: boolean }
): Promise<HalteData[]> {
  const now = Date.now();
  const bypass = options?.bypassCache === true;

  // L1: in-memory cache hit (same JS module lifetime — no fetch needed).
  if (!bypass && _cache && _cache.expiresAt > now && _cache.complete) {
    onBatch(_cache.value, _cache.value.length, _cache.value.length);
    return _cache.value;
  }

  // L2: sessionStorage hit (survives page refresh, including PARTIAL loads).
  // Deliver immediately so the portal renders the rows we already have,
  // then continue fetching the missing ones from Supabase in the background
  // (or do a freshness refresh if the snapshot was already complete).
  const stored = bypass ? null : storageLoad();
  if (stored && stored.value.length > 0) {
    // Warm L1 from L2 so subsequent calls in this module lifetime are free.
    _cache = {
      value: stored.value,
      expiresAt: now + CACHE_TTL_MS,
      complete: stored.complete,
    };
    // Show what we have RIGHT NOW. The third arg is the *current* batch
    // size as the "known total" so the progress bar starts at 100% — we'll
    // bump it up if the background fetch reveals more rows.
    onBatch(stored.value, stored.value.length, stored.value.length);

    if (!stored.complete) {
      // Partial cache — finish the load in the background and stream new
      // rows back through the same callback so the UI grows live.
      void (async () => {
        try {
          // Track which slugs we already had so we don't double-emit them.
          const have = new Set(
            stored.value.map((h) =>
              slugifyName(
                h.name.replace(/^(?:Halte|Bus\s+Stop)\s+/i, "").trim()
              )
            )
          );
          const merged = [...stored.value];
          await getHaltesStreaming((batch, _loaded, total) => {
            // Filter to only rows we don't already have; the streaming
            // loader doesn't know what's in our partial cache.
            const fresh = batch.filter((h) => {
              const slug = slugifyName(
                h.name.replace(/^(?:Halte|Bus\s+Stop)\s+/i, "").trim()
              );
              if (have.has(slug)) return false;
              have.add(slug);
              return true;
            });
            if (fresh.length > 0) {
              merged.push(...fresh);
              // Re-emit through the original caller's callback so the UI
              // actually paints the new rows. Use the bigger of (cache,
              // server total) so progress never reverses.
              onBatch(
                fresh,
                merged.length,
                Math.max(merged.length, total ?? 0)
              );
            }
          }, { bypassCache: true });
        } catch { /* ignore background errors */ }
      })();
    } else {
      // Complete snapshot — silent freshness refresh, no UI updates needed.
      void (async () => {
        try {
          const fresh = await getHaltesStreaming(
            () => { /* silent */ },
            { bypassCache: true }
          );
          if (fresh.length > 0) storageSave(fresh, true);
        } catch { /* ignore background errors */ }
      })();
    }
    return stored.value;
  }

  if (!SUPABASE_AVAILABLE) {
    const value = FALLBACK_HALTES;
    _cache = { value, expiresAt: now + CACHE_TTL_MS, complete: true };
    onBatch(value, value.length, value.length);
    return value;
  }

  // Deduplicate concurrent callers — only one Supabase fetch in-flight.
  // If a streaming fetch is already running, latecomers just await its
  // promise without their own batch callbacks (acceptable trade-off; the
  // alternative is a multi-subscriber broadcast pattern that adds state
  // for almost no real-world benefit).
  if (_inflight) return _inflight;

  const all: HalteData[] = [];

  _inflight = (async () => {
    try {
      // ---- Phase 1: HEAD count probe ----
      // Cheap (no rows transferred) and lets us fire all data pages in
      // parallel because we know exactly how many to issue. If it fails
      // we degrade gracefully to a sequential walk — slower but correct.
      let totalKnown: number | null = null;
      try {
        const { count, error: countErr } = await supabase
          .from("haltes")
          .select("id", { count: "exact", head: true });
        if (!countErr && typeof count === "number") {
          totalKnown = count;
        }
      } catch {
        // Network failure on the probe — fall through, totalKnown stays null.
      }

      // Emit a "we know the total now" tick so the UI can switch from
      // indeterminate to determinate progress immediately.
      onBatch([], 0, totalKnown);

      // ---- Phase 2: parallel page fetches (when count is known) ----
      if (totalKnown !== null && totalKnown > 0) {
        const pageCount = Math.ceil(totalKnown / PAGE_SIZE);
        const pageResults: HalteDbRow[][] = new Array(pageCount);

        await Promise.all(
          Array.from({ length: pageCount }, (_, page) => {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            return supabase
              .from("haltes")
              .select(
                "id, name, corridor, lat, lng, type, tier, base_price, current_bid, street_view_url, is_available, auction_starts_at, auction_ends_at"
              )
              .order("id", { ascending: true })
              .range(from, to)
              .then(({ data, error }) => {
                if (error) throw error;
                const rows = (data ?? []) as HalteDbRow[];
                pageResults[page] = rows;
                // Project + emit AS SOON AS this page lands, regardless
                // of arrival order. Synthetic ids are STABLE hashes of the
                // DB string id, so out-of-order arrivals (and partial-cache
                // resumes) never collide.
                const projected = projectPage(rows);
                all.push(...projected);
                onBatch(projected, all.length, totalKnown);
                // Persist progressively so a refresh mid-load resumes
                // from where we left off instead of restarting at zero.
                schedulePartialSave(all);
              });
          })
        );

        if (all.length === 0) {
          console.warn("[haltes] Supabase returned 0 rows; using empty fallback.");
          onBatch(FALLBACK_HALTES, 0, 0);
          return FALLBACK_HALTES;
        }
        return all;
      }

      // ---- Phase 2b: sequential fallback (count probe failed) ----
      for (let page = 0; ; page++) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from("haltes")
          .select(
            "id, name, corridor, lat, lng, type, tier, base_price, current_bid, street_view_url, is_available, auction_starts_at, auction_ends_at"
          )
          .order("id", { ascending: true })
          .range(from, to);

        if (error) throw error;
        const rows = (data ?? []) as HalteDbRow[];
        if (rows.length === 0 && page === 0) {
          console.warn("[haltes] Supabase returned 0 rows; using empty fallback.");
          onBatch(FALLBACK_HALTES, 0, 0);
          return FALLBACK_HALTES;
        }

        const projected = projectPage(rows);
        all.push(...projected);
        onBatch(projected, all.length, null);
        schedulePartialSave(all);

        if (rows.length < PAGE_SIZE) break;
        if (all.length > 50_000) {
          throw new Error(`getHaltesStreaming aborted at ${all.length} rows`);
        }
      }
      return all;
    } catch (err) {
      console.warn("[haltes] Fetch failed, using empty fallback:", err);
      onBatch(FALLBACK_HALTES, 0, 0);
      return FALLBACK_HALTES;
    } finally {
      _inflight = null;
    }
  })();

  const value = await _inflight;
  _cache = { value, expiresAt: Date.now() + CACHE_TTL_MS, complete: true };
  // Persist to sessionStorage (L2) so the next page refresh is instant.
  // Cancel any pending partial save and write the final complete snapshot.
  if (_partialSaveTimer) {
    clearTimeout(_partialSaveTimer);
    _partialSaveTimer = null;
  }
  storageSave(value, true);
  return value;
}

/**
 * Fetch all haltes (non-streaming). Returns merged + synthesized HalteData[]
 * suitable for any caller that doesn't need incremental updates.
 * Internally delegates to getHaltesStreaming with a no-op batch callback.
 */
export async function getHaltes(): Promise<HalteData[]> {
  return getHaltesStreaming(() => {/* no-op */});
}

/**
 * Fetch a single halte by its id (DB slug) OR by name-slug fallback.
 */
export async function getHalteById(
  id: string | number
): Promise<HalteData | null> {
  const all = await getHaltes();
  const idStr = String(id);
  const direct = all.find((h) => h.id === idStr);
  if (direct) return direct;
  const slugLower = idStr.toLowerCase();
  return (
    all.find((h) => {
      const cleaned = h.name.replace(/^(?:Halte|Bus\s+Stop)\s+/i, "").trim();
      return slugifyName(cleaned) === slugLower;
    }) ?? null
  );
}

/** Bust all cache layers — call after a superadmin mutation in the same session. */
export function invalidateHaltesCache(): void {
  _cache = null;
  _inflight = null;
  storageClear(); // also clear L2 so next load gets fresh data from Supabase
}
