 
/**
 * Wipe ALL rows from public.haltes.
 *
 * Run:    npm run clear:haltes
 *
 * Why this exists: the seed script is upsert-keyed on `id`, so changing
 * the slug scheme (the historical "halte-halte-xxx" bug) leaves the old
 * rows orphaned. Running this first then `seed:haltes` gives a clean
 * table that matches the current src/data/haltes.ts exactly.
 *
 * Safety:
 *  - Requires SUPABASE_SERVICE_ROLE_KEY (bypasses RLS — superadmin only).
 *  - Cascades into bids / subscriptions / favorites that FK to haltes,
 *    so any of THOSE rows pointing at a deleted halte will also vanish.
 *    For a fresh dev DB this is what we want; do NOT run against prod
 *    with live customer data.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// .env.local loader — duplicated from seed-haltes.ts to keep this script
// self-contained (no shared infra module needed for two seed scripts).
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
    // .env.local missing is fine if env vars are already exported.
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "[clear-haltes] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Pre-count for the confirmation message — separate HEAD query because
  // delete().select() returning rows depends on RLS / Postgres versions.
  const { count: beforeCount, error: countErr } = await supabase
    .from("haltes")
    .select("id", { count: "exact", head: true });

  if (countErr) {
    console.error("[clear-haltes] Count failed:", countErr.message);
    process.exit(1);
  }

  const total = beforeCount ?? 0;
  if (total === 0) {
    console.log("[clear-haltes] Tabel haltes sudah kosong — nothing to do.");
    return;
  }
  console.log(`[clear-haltes] Menghapus semua ${total} halte…`);

  // PostgREST refuses an unfiltered DELETE, so we use an always-true
  // predicate (`id <> ''`) to match every row. The service-role key
  // bypasses RLS so the haltes_write_admin policy doesn't block this.
  const { error: delErr } = await supabase
    .from("haltes")
    .delete()
    .neq("id", "");

  if (delErr) {
    console.error("[clear-haltes] Delete failed:", delErr.message);
    process.exit(1);
  }

  // Verify the table is actually empty so a silent partial-delete doesn't
  // leave the operator thinking they have a clean slate.
  const { count: afterCount } = await supabase
    .from("haltes")
    .select("id", { count: "exact", head: true });

  console.log(
    `[clear-haltes] ✓ Done. Deleted ${
      (beforeCount ?? 0) - (afterCount ?? 0)
    } rows. ${afterCount ?? 0} rows remain.`
  );
}

main().catch((err) => {
  console.error("[clear-haltes] Unexpected error:", err);
  process.exit(1);
});
