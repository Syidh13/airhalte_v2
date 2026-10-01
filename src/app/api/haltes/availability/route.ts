/**
 * GET /api/haltes/availability
 *
 * Public endpoint: returns availability + listing state for every titik in
 * the DB. The portal polls this every ~10s to keep the map fresh without
 * re-downloading the stable dataset (name/lat/lng live in the static
 * GeoJSON).
 *
 * Per item:
 *   `id`, `available`, `is_listed`  — every titik (backward compatible).
 *   `base_price`                    — Halte BRT only: harga dasar (DB).
 *   `current_bid`                   — Halte BRT only, omitted when 0.
 *   `auction_starts_at` / `auction_ends_at`
 *                                   — Halte BRT only, omitted when null.
 * Non-BRT rows stay lean ({ id, available, is_listed }) — the tariff is a
 * fixed constant in lib/pricing.ts.
 *
 * `available`  — `is_available` flag from DB.
 * `is_listed`  — show/hide signal for the map + sidebar:
 *                  Premium: is_available=true AND
 *                           auction_starts_at <= now < auction_ends_at.
 *                  Non-BRT: is_available=true AND no active subscription
 *                           (status='active' with ends_at >= today).
 *
 * The bogus DB record id 'test' is never returned.
 *
 * Load: the result is memoized in-process for MEMO_TTL_MS and concurrent
 * requests share one in-flight build, so many clients polling every 10 s
 * don't each trigger ~9 Supabase queries. The response itself stays
 * `no-store` (no CDN/browser caching — see history below).
 *
 * Response:
 *   200 { items: Array<{ id, available, is_listed, base_price?, current_bid?,
 *                        auction_starts_at?, auction_ends_at? }> }
 *   500 { error: <message> }  — supabase / unexpected
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const PAGE_SIZE = 1000;
const SAFETY_LIMIT = 50_000;
/** Server-side memo. Short enough that admin edits show up within one poll. */
const MEMO_TTL_MS = 4_000;

interface Row {
  id: string;
  tier: "premium" | "mass";
  is_available: boolean;
  base_price: number | null;
  current_bid: number | null;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
}

interface Item {
  id: string;
  available: boolean;
  is_listed: boolean;
  base_price?: number;
  current_bid?: number;
  auction_starts_at?: string;
  auction_ends_at?: string;
}

interface Payload {
  items: Item[];
}

/** Listing rule. Lives server-side only — the client never re-derives it;
    it just consumes the boolean. */
function deriveIsListed(
  row: Row,
  nowMs: number,
  rentedHalteIds: Set<string>
): boolean {
  if (!row.is_available) return false;
  if (row.tier === "premium") {
    if (!row.auction_starts_at || !row.auction_ends_at) return false;
    const startMs = new Date(row.auction_starts_at).getTime();
    const endMs = new Date(row.auction_ends_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    return startMs <= nowMs && nowMs < endMs;
  }
  // Non-BRT: hidden while a subscription is running.
  return !rentedHalteIds.has(row.id);
}

function toItem(row: Row, nowMs: number, rentedHalteIds: Set<string>): Item {
  const item: Item = {
    id: row.id,
    available: row.is_available,
    is_listed: deriveIsListed(row, nowMs, rentedHalteIds),
  };
  if (row.tier === "premium") {
    const base = Number(row.base_price ?? 0);
    item.base_price = Number.isFinite(base) ? base : 0;
    const bid = Number(row.current_bid ?? 0);
    if (Number.isFinite(bid) && bid > 0) item.current_bid = bid;
    if (row.auction_starts_at) item.auction_starts_at = row.auction_starts_at;
    if (row.auction_ends_at) item.auction_ends_at = row.auction_ends_at;
  }
  return item;
}

/**
 * Every halte_id with a subscription running right now. Paginated (the
 * PostgREST 1000-row cap would otherwise silently drop rentals) and
 * filtered server-side to active, unexpired rows.
 *
 * Service-role client, NOT anon: the `subs_select_own` RLS policy limits
 * subscription reads to the owner + superadmin, so anon would return zero
 * rows and every rented titik would stay listed.
 */
async function fetchRentedHalteIds(todayDateOnly: string): Promise<Set<string>> {
  const rented = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id, halte_id")
      .eq("status", "active")
      .gte("ends_at", todayDateOnly)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { id: string; halte_id: unknown }[];
    for (const sub of page) {
      if (typeof sub.halte_id === "string") rented.add(sub.halte_id);
    }
    if (page.length < PAGE_SIZE) break;
    if (from + PAGE_SIZE >= SAFETY_LIMIT) break;
  }
  return rented;
}

async function buildPayload(): Promise<Payload> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nowMs = Date.now();
  const todayDateOnly = new Date(nowMs).toISOString().slice(0, 10);

  let rentedHalteIds = new Set<string>();
  try {
    rentedHalteIds = await fetchRentedHalteIds(todayDateOnly);
  } catch (err) {
    // Non-fatal — a transient subscriptions issue must not blank the map.
    console.warn(
      "[availability] subs lookup failed, Non-BRT listing will not gate on rentals:",
      err instanceof Error ? err.message : err
    );
  }

  const items: Item[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("haltes")
      .select(
        "id, tier, is_available, base_price, current_bid, auction_starts_at, auction_ends_at"
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as Row[];
    for (const row of page) {
      if (isExcludedHalteId(row.id)) continue;
      items.push(toItem(row, nowMs, rentedHalteIds));
    }

    if (page.length < PAGE_SIZE) break;
    if (items.length > SAFETY_LIMIT) {
      throw new Error(`Safety limit hit at ${items.length} rows`);
    }
  }

  return { items };
}

// In-process memo + in-flight de-duplication (per server instance).
let memo: { at: number; payload: Payload } | null = null;
let inflight: Promise<Payload> | null = null;

function getPayload(): Promise<Payload> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) {
    return Promise.resolve(memo.payload);
  }
  if (!inflight) {
    inflight = buildPayload()
      .then((payload) => {
        memo = { at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET() {
  try {
    const payload = await getPayload();
    return NextResponse.json(payload, {
      headers: {
        // Keep no-store: an earlier `public, max-age=5` let an edge/browser
        // cache serve stale `is_listed` right after the superadmin scheduled
        // an auction. Collapsing now happens in the server memo above.
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
