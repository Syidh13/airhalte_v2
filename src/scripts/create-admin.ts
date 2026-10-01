 
/**
 * Create / update login superadmin.
 *
 * Run:   npx tsx src/scripts/create-admin.ts
 *
 * Baca .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Keys tidak pernah keluar dari mesin ini.
 *
 * Yang dilakukan:
 *   1. Sanity-check .env.local (guard placeholder) + ping Supabase.
 *      Kalau gagal connect, print penyebab aslinya (DNS/timeout/refused).
 *   2. Bikin auth user ADMIN_EMAIL dengan app_metadata.role='superadmin'
 *      (dibaca proxy.ts + lib/auth.ts), email langsung confirmed.
 *   3. Kalau user sudah ada → update password + role saja.
 *
 * ⚠ ADMIN_PASSWORD ini lemah — cuma buat testing. WAJIB ganti sebelum
 *   production (DB yang sama dipakai deploy Netlify).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "adminadmin";

// ---------------------------------------------------------------------------
// .env.local loader — pola sama dengan seed-haltes.ts
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

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function die(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!SUPA_URL || !SERVICE_KEY) {
  die("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum ada di .env.local");
}
if (/xyzcompany|GANTI-INI|your-project|example/i.test(SUPA_URL) || /GANTI-INI/i.test(SERVICE_KEY)) {
  die(
    ".env.local masih berisi placeholder, bukan value asli.\n" +
      "  Ambil dari: Supabase Dashboard → Settings → API\n" +
      "  (atau copy dari Netlify → Environment variables), lalu jalankan lagi."
  );
}

// ---------------------------------------------------------------------------
// Connectivity check — biar error jaringan/env kelihatan jelas, bukan misteri
// ---------------------------------------------------------------------------
async function pingSupabase(): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/health`, {
      headers: { apikey: SERVICE_KEY },
      signal: AbortSignal.timeout(15_000),
    });
    const host = new globalThis.URL(SUPA_URL).host;
    console.log(`✓ Supabase reachable: ${host} → HTTP ${res.status} (${Date.now() - t0}ms)`);
    if (res.status === 401 || res.status === 403) {
      die("Project-nya kejangkau tapi key ditolak — SUPABASE_SERVICE_ROLE_KEY kemungkinan salah / bukan dari project ini.");
    }
  } catch (err) {
    console.error(`✗ Tidak bisa connect ke ${SUPA_URL} (${Date.now() - t0}ms). Penyebab:`);
    let cause: unknown = err;
    while (cause instanceof Error) {
      console.error(`   ↳ ${cause.name}: ${cause.message}`);
      cause = (cause as Error & { cause?: unknown }).cause;
    }
    die("Cek: URL project bener? Project tidak paused di dashboard? VPN/DNS bermasalah?");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await pingSupabase();

  const admin = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[create-admin] Membuat user ${ADMIN_EMAIL}…`);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "superadmin" },
  });

  if (!createErr) {
    console.log(`✓ Superadmin dibuat: ${ADMIN_EMAIL} (id: ${created.user?.id})`);
  } else {
    const code = (createErr as { code?: string }).code;
    const exists = code === "email_exists" || /already|exist|registered/i.test(createErr.message);
    if (!exists) die(`Gagal membuat user: ${createErr.message}`);

    console.log("[create-admin] User sudah ada — update password + role…");
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) die(`Gagal listing users: ${error.message}`);
      const hit = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase()
      );
      if (hit) userId = hit.id;
      if (data.users.length < 200) break;
    }
    if (!userId) {
      die(`User ${ADMIN_EMAIL} tidak ketemu padahal terdaftar — cek manual di Dashboard → Authentication.`);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      app_metadata: { role: "superadmin" },
    });
    if (updErr) die(`Gagal update user: ${updErr.message}`);
    console.log(`✓ Password + role superadmin di-update: ${ADMIN_EMAIL} (id: ${userId})`);
  }

  console.log("\nLogin di http://localhost:3000/login");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log("\n⚠ Ganti kredensial ini sebelum production — gampang ditebak dan DB ini juga dipakai Netlify.");
}

main().catch((err) => {
  console.error("[create-admin] Unexpected error:", err);
  process.exit(1);
});
