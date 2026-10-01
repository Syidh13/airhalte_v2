 
/**
 * Demo seeding untuk deck planning 2027 — hidupkan lelang Halte BRT (window
 * aktif sekarang) + listing bus stop Non-BRT di Jakarta pusat.
 * Run: npx tsx src/scripts/seed-demo-2027.ts
 *
 * Mengikuti aturan lib/pricing.ts dan modul Lelang:
 *   - hanya type='brt', record uji ('test') tidak pernah disentuh
 *   - harga dasar di bawah minimum dinaikkan ke PREMIUM_MIN_BASE_PRICE
 *     (lewat effectiveBasePrice)
 *   - halte dengan kontrak pemenang yang masih berjalan dilewati
 *   - jadwal baru = lelang baru: current_bid 0, penawaran lama yang masih
 *     'winning'/'outbid' ditandai 'lost' (lelang yang masih berjalan dilewati)
 *   - Non-BRT memakai tarif tetap NON_BRT_MONTHLY_PRICE
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NON_BRT_MONTHLY_PRICE, effectiveBasePrice } from "../lib/pricing";

const EXCLUDED_IDS = ["test"];

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* ok */ }
}
loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const ICONIC = ["bundaran hi","dukuh atas","tosari","sarinah","harmoni","blok m","gelora","bendungan hilir","kuningan","senen","juanda","semanggi","monumen","kota","senayan"];

async function main() {
  const now = Date.now();
  const hidden = `(${EXCLUDED_IDS.join(",")})`;
  let premiumIds: string[] = [];
  for (const name of ICONIC) {
    const { data } = await supabase.from("haltes").select("id,name").eq("type","brt").not("id","in",hidden).ilike("name", `%${name}%`).limit(2);
    for (const d of data ?? []) premiumIds.push(d.id as string);
  }
  premiumIds = [...new Set(premiumIds)];
  if (premiumIds.length < 12) {
    const { data } = await supabase.from("haltes").select("id").eq("type","brt").not("id","in",hidden).order("id").limit(25);
    for (const d of data ?? []) { const id = d.id as string; if (!premiumIds.includes(id)) premiumIds.push(id); if (premiumIds.length >= 18) break; }
  }
  let i = 0, okP = 0;
  for (const id of premiumIds) {
    const { data: row, error: readErr } = await supabase
      .from("haltes")
      .select("base_price, is_available, auction_ends_at, contract_ends_at")
      .eq("id", id)
      .maybeSingle();
    if (readErr || !row) { console.warn("  !", id, readErr?.message ?? "tidak ditemukan"); i++; continue; }
    if (row.contract_ends_at && new Date(row.contract_ends_at).getTime() > now) {
      console.warn("  - lewati (kontrak berjalan)", id); i++; continue;
    }
    if (row.is_available && row.auction_ends_at && new Date(row.auction_ends_at).getTime() > now) {
      console.warn("  - lewati (lelang masih berjalan)", id); i++; continue;
    }
    const starts = new Date(now - 3600_000 * (2 + i)).toISOString();
    const ends = new Date(now + (3 + (i % 7) * 3) * 86400_000).toISOString();
    const { error } = await supabase.from("haltes").update({
      is_available: true,
      auction_starts_at: starts,
      auction_ends_at: ends,
      current_bid: 0,
      // Harga dasar di bawah minimum dinaikkan ke Rp 100 jt/tahun.
      base_price: effectiveBasePrice(row.base_price),
    }).eq("id", id);
    if (!error) {
      okP++;
      const { error: retireErr } = await supabase.from("bids").update({ status: "lost" }).eq("halte_id", id).in("status", ["winning", "outbid"]);
      if (retireErr) console.warn("  ! bid lama", id, retireErr.message);
    } else console.warn("  !", id, error.message);
    i++;
  }
  console.log(`✓ Halte BRT dengan lelang aktif: ${okP}`);

  const { data: massRows, error: massErr } = await supabase.from("haltes").select("id").eq("type","non-brt").not("id","in",hidden).gte("lat",-6.28).lte("lat",-6.10).gte("lng",106.75).lte("lng",106.92).limit(700);
  if (massErr) throw massErr;
  const ids = (massRows ?? []).map(r => r.id as string);
  let okM = 0;
  for (let b = 0; b < ids.length; b += 100) {
    const slice = ids.slice(b, b + 100);
    const { error } = await supabase.from("haltes").update({ is_available: true, base_price: NON_BRT_MONTHLY_PRICE }).in("id", slice);
    if (!error) okM += slice.length; else console.warn("  ! batch", b, error.message);
  }
  console.log(`✓ bus stop Non-BRT di Jakpus jadi tersedia: ${okM}`);

  const nowIso = new Date().toISOString();
  const { count } = await supabase.from("haltes").select("id", { count: "exact", head: true }).eq("type","brt").not("id","in",hidden).eq("is_available", true).lte("auction_starts_at", nowIso).gte("auction_ends_at", nowIso);
  console.log("verifikasi — Halte BRT dengan window aktif:", count);
}
main().catch((e) => { console.error(e); process.exit(1); });
