 
/**
 * Seed the public.haltes table from the official Transjakarta API.
 *
 * Run:          npm run seed:haltes
 * Dry-run:      npm run seed:haltes -- --dry-run
 *               (fetches first page, logs raw shape, does NOT write to DB)
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TRANSJAKARTA_EMAIL
 *   TRANSJAKARTA_PASSWORD
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NON_BRT_MONTHLY_PRICE, PREMIUM_MIN_BASE_PRICE } from "../lib/pricing";

// ---------------------------------------------------------------------------
// .env.local loader
// ---------------------------------------------------------------------------
function loadEnvLocal(): void {
  try {
    const path = resolve(process.cwd(), ".env.local");
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // fine if already exported
  }
}

loadEnvLocal();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TJ_EMAIL     = process.env.TRANSJAKARTA_EMAIL!;
const TJ_PASSWORD  = process.env.TRANSJAKARTA_PASSWORD!;
const DRY_RUN      = process.argv.includes("--dry-run");

const TJ_BASE      = "https://smpobapi.transjakarta.co.id/api/v1";
const STOPS_PATH   = "/stops";   // GET /api/v1/stops — returns all stops in one shot
const FETCH_LIMIT  = 500;   // kept for pagination fallback, ignored when API returns all
const BATCH_SIZE   = 100;   // rows per Supabase upsert batch
// Harga default mengikuti lib/pricing.ts (deck v6.1): Halte BRT mulai dari
// harga dasar minimum per tahun (TJ bisa menaikkan per halte di superadmin),
// bus stop Non-BRT tarif tetap per bulan.
const PRICE_HALTE  = PREMIUM_MIN_BASE_PRICE;
const PRICE_BUS_STOP = NON_BRT_MONTHLY_PRICE;

for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, TJ_EMAIL, TJ_PASSWORD })) {
  if (!v) { console.error(`[seed-haltes] Missing env var: ${k}`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Transjakarta API auth
// ---------------------------------------------------------------------------
interface TjTokens { accessToken: string; refreshToken: string; }

async function tjLogin(): Promise<TjTokens> {
  const res = await fetch(`${TJ_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email: TJ_EMAIL, password: TJ_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  // Shape: { data: { access_token, refresh_token } }
  const d = json?.data ?? json;
  const accessToken  = d?.access_token  ?? d?.accessToken;
  const refreshToken = d?.refresh_token ?? d?.refreshToken;
  if (!accessToken) throw new Error(`No access_token in login response: ${JSON.stringify(json)}`);
  return { accessToken, refreshToken };
}

async function tjRefresh(refreshToken: string): Promise<TjTokens> {
  const res = await fetch(`${TJ_BASE}/auth/refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const d = json?.data ?? json;
  return {
    accessToken:  d?.access_token  ?? d?.accessToken,
    refreshToken: d?.refresh_token ?? d?.refreshToken ?? refreshToken,
  };
}

// ---------------------------------------------------------------------------
// Fetch one page from the API
// ---------------------------------------------------------------------------
interface RawStop { [key: string]: unknown }

async function fetchPage(
  tokens: TjTokens,
  offset: number,
): Promise<{ rows: RawStop[]; tokens: TjTokens }> {
  const url = `${TJ_BASE}${STOPS_PATH}?limit=${FETCH_LIMIT}&offset=${offset}`;
  let res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${tokens.accessToken}`,
      "Origin": "https://syntra.tj.co.id",
      "Referer": "https://syntra.tj.co.id/",
    },
  });

  // Auto-refresh on 401
  if (res.status === 401) {
    console.log("[seed-haltes] Token expired, refreshing…");
    tokens = await tjRefresh(tokens.refreshToken);
    res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${tokens.accessToken}`,
      },
    });
  }

  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const json = await res.json();

  // Unwrap common response shapes:
  //   { data: { rows: [...] } }  /  { data: [...] }  /  { rows: [...] }  /  [...]
  let rows: RawStop[];
  const payload = json?.data ?? json;
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (Array.isArray(payload?.rows)) {
    rows = payload.rows;
  } else if (Array.isArray(payload?.data)) {
    rows = payload.data;
  } else if (Array.isArray(payload?.items)) {
    rows = payload.items;
  } else {
    // Unknown shape — log and bail so user can investigate
    console.error("[seed-haltes] Unexpected response shape:", JSON.stringify(json).slice(0, 500));
    rows = [];
  }

  return { rows, tokens };
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeSlug(slug: string, seen: Map<string, number>): string {
  const count = seen.get(slug) ?? 0;
  seen.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count + 1}`;
}

// ---------------------------------------------------------------------------
// Map a raw API row → HalteRow
//
// /api/v1/stops response shape (confirmed via dry-run):
// {
//   uid: "B00001P",
//   label: "18 Office Park",
//   type: "bus_stop" | "halte",
//   coordinate: { latitude: -6.299, longitude: 106.832 },
//   served_routes: [{ label: "JAK.46", ... }],
//   stop_orientations: [{ stop_id: "B00001P", ... }]
// }
//
// Type convention: uid prefix G = BRT halte (premium), B = non-BRT (mass).
// The `type` field ("halte" / "bus_stop") is used as primary discriminator;
// uid prefix is the fallback.
// ---------------------------------------------------------------------------

interface HalteRow {
  id: string;
  name: string;
  corridor: string | null;
  lat: number;
  lng: number;
  type: "brt" | "non-brt";
  tier: "premium" | "mass";
  base_price: number;
  street_view_url: string | null;
  is_available: boolean;
}

function mapRow(raw: RawStop): HalteRow | { skip: string } {
  const uid   = raw.uid as string | undefined;
  const label = raw.label as string | undefined;
  const coord = raw.coordinate as { latitude?: number; longitude?: number } | undefined;
  const type  = raw.type as string | undefined;
  const routes = raw.served_routes as Array<{ label?: string }> | undefined;

  if (!uid)   return { skip: `missing uid in: ${JSON.stringify(raw).slice(0, 120)}` };
  if (!label) return { skip: `missing label for uid="${uid}"` };

  const lat = coord?.latitude;
  const lng = coord?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return { skip: `bad/missing coords for "${label}" (${uid})` };

  // Primary: check type field. Fallback: uid prefix (G = BRT, B = non-BRT).
  const isBrt = type === "halte" || uid.toUpperCase().startsWith("G");

  // First served route label as corridor (e.g. "JAK.46"), null if none.
  const corridor = routes?.[0]?.label ?? null;

  return {
    id:    uid.toLowerCase(),   // e.g. "b00001p" / "g00307"
    name:  label,
    corridor,
    lat:   lat!,
    lng:   lng!,
    type:       isBrt ? "brt" : "non-brt",
    tier:       isBrt ? "premium" : "mass",
    base_price: isBrt ? PRICE_HALTE : PRICE_BUS_STOP,
    street_view_url: null,
    is_available: true,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("[seed-haltes] Logging in to Transjakarta API…");
  let tokens = await tjLogin();
  console.log("[seed-haltes] ✓ Authenticated.");

  // ── DRY RUN: inspect first page, exit without writing ──
  if (DRY_RUN) {
    console.log("\n[seed-haltes] DRY RUN — fetching stops to inspect shape…");
    const { rows } = await fetchPage(tokens, 0);
    console.log(`\nTotal rows returned: ${rows.length}`);
    if (rows.length > 0) {
      console.log("\nFirst row (raw):");
      console.log(JSON.stringify(rows[0], null, 2));
      console.log("\nMapped result:");
      const mapped = mapRow(rows[0]);
      console.log(JSON.stringify(mapped, null, 2));
    }
    console.log("\n[seed-haltes] Dry run done. If mapping looks correct, run without --dry-run.");
    return;
  }

  // ── FULL RUN: paginate + upsert ──
  const allRows: HalteRow[] = [];
  const skipped: { offset: number; reason: string }[] = [];

  console.log("[seed-haltes] Fetching all pages from API…");
  for (let offset = 0; ; offset += FETCH_LIMIT) {
    const { rows, tokens: refreshed } = await fetchPage(tokens, offset);
    tokens = refreshed; // keep potentially refreshed token

    for (const raw of rows) {
      const result = mapRow(raw);
      if ("skip" in result) {
        skipped.push({ offset, reason: result.skip });
      } else {
        allRows.push(result);
      }
    }

    console.log(`[seed-haltes] Fetched offset=${offset} → ${rows.length} rows (total so far: ${allRows.length})`);
    // /stops returns all rows in one shot (7576 rows despite limit=500).
    // Break after first page if rows returned ≥ FETCH_LIMIT to avoid
    // fetching empty subsequent pages unnecessarily.
    if (rows.length < FETCH_LIMIT || rows.length > FETCH_LIMIT) break;
    if (allRows.length > 50_000) {
      console.error("[seed-haltes] Safety limit hit — aborting fetch loop.");
      break;
    }
  }

  if (skipped.length > 0) {
    console.warn(`[seed-haltes] Skipped ${skipped.length} malformed rows. First 5:`,
      skipped.slice(0, 5));
  }

  // Deduplicate by id — the API occasionally returns the same stop_id on
  // multiple pages. PostgreSQL upsert fails if two rows in the same batch
  // share a conflict key, so we must dedup client-side first.
  const seenIds = new Map<string, HalteRow>();
  for (const row of allRows) seenIds.set(row.id, row); // last wins
  const uniqueRows = Array.from(seenIds.values());
  const dupeCount = allRows.length - uniqueRows.length;
  if (dupeCount > 0) console.warn(`[seed-haltes] Removed ${dupeCount} duplicate stop_ids.`);

  const brtCount    = uniqueRows.filter(r => r.type === "brt").length;
  const nonBrtCount = uniqueRows.filter(r => r.type === "non-brt").length;
  console.log(`\n[seed-haltes] Prepared ${uniqueRows.length} unique rows (${brtCount} BRT, ${nonBrtCount} non-BRT).`);
  console.log("[seed-haltes] Upserting to Supabase…\n");

  const totalBatches = Math.ceil(uniqueRows.length / BATCH_SIZE);
  let success = 0, failures = 0;

  for (let b = 0; b < totalBatches; b++) {
    const slice = uniqueRows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const { error } = await supabase.from("haltes").upsert(slice, { onConflict: "id" });
    if (error) {
      failures += slice.length;
      console.error(`[seed-haltes] Batch ${b + 1}/${totalBatches} FAILED: ${error.message}`);
    } else {
      success += slice.length;
      process.stdout.write(`\r[seed-haltes] Batch ${b + 1}/${totalBatches} (${success}/${allRows.length} rows)   `);
    }
  }

  console.log("\n");
  console.log("[seed-haltes] ===== SUMMARY =====");
  console.log(`[seed-haltes] Fetched:   ${allRows.length + skipped.length}`);
  console.log(`[seed-haltes] Dupes:     ${dupeCount}`);
  console.log(`[seed-haltes] Skipped:   ${skipped.length}`);
  console.log(`[seed-haltes] Upserted:  ${success}`);
  console.log(`[seed-haltes] Failed:    ${failures}`);
  if (failures > 0) {
    console.error("[seed-haltes] Some batches failed — re-run to retry.");
    process.exit(1);
  }
  console.log("[seed-haltes] ✓ Done.");
}

main().catch((err) => {
  console.error("[seed-haltes] Unexpected error:", err);
  process.exit(1);
});
