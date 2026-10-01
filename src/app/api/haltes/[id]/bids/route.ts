/**
 * /api/haltes/[id]/bids
 *
 * Lelang Halte BRT (segmen Premium).
 *
 *   GET  (public)            : ringkasan lelang satu halte. Blind: tidak
 *                              pernah mengembalikan company_id / nama.
 *                              Angka harga dihitung dengan fungsi yang sama
 *                              dengan POST (lib/pricing.ts), jadi client tidak
 *                              perlu mem-parse teks tampilan.
 *   POST (auth + active co.) : ajukan penawaran. Server menegakkan:
 *                              - hanya Halte BRT (type='brt'), bukan data uji
 *                              - lelang sudah dijadwalkan dan sedang berjalan
 *                              - nominal bilangan bulat, 0 < x <= BID_MAX_AMOUNT
 *                              - nominal >= minNextBid(base_price, current_bid)
 *                              - kontrak selalu PREMIUM_CONTRACT_MONTHS (12);
 *                                duration_months dari client diabaikan
 *
 * Konkurensi: haltes.current_bid dipakai sebagai token compare-and-set.
 * Penawaran hanya diterima bila current_bid masih sama dengan nilai yang
 * divalidasi, jadi dua penawaran simultan tidak bisa sama-sama diterima
 * sebagai tertinggi. Yang kalah mendapat 409 dan diminta memuat ulang.
 *
 * Semua baca/tulis memakai service-role client (supabaseAdmin), bukan client
 * milik user, sehingga tetap jalan setelah policy INSERT client dicabut.
 *
 * Response (GET 200):
 *   { base_price, current_bid, min_next_bid, min_increment, period_months,
 *     is_available, auction_starts_at, auction_ends_at, auction_state,
 *     auction_open, contract_ends_at, total_bidders, total_bids, bid_count,
 *     history: [{ amount, created_at }] }
 *   base_price = harga dasar efektif (effectiveBasePrice). Hitungan penawar
 *   dan riwayat hanya untuk jendela lelang saat ini (created_at >= mulai).
 *
 * Response (POST):
 *   200 { ok: true, current_bid, min_next_bid }
 *   400 { ok: false, error, min_next_bid? }  — validasi
 *   401 / 403                                — belum login / perusahaan belum aktif
 *   404                                      — halte tidak ditemukan
 *   409 { ok: false, error, min_next_bid? }  — penawaran tertinggi berubah
 *   500                                      — supabase / tak terduga
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";
import {
  BID_MAX_AMOUNT,
  PREMIUM_CONTRACT_MONTHS,
  effectiveBasePrice,
  minBidIncrement,
  minNextBid,
} from "@/lib/pricing";

const HISTORY_LIMIT = 10;

const HALTE_COLUMNS =
  "id, type, base_price, current_bid, is_available, auction_starts_at, auction_ends_at, contract_ends_at";

interface HalteRow {
  id: string;
  type: string;
  base_price: number | string | null;
  current_bid: number | string | null;
  is_available: boolean;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  contract_ends_at: string | null;
}

type AuctionState = "unscheduled" | "not_started" | "open" | "ended";

function auctionState(h: HalteRow, nowMs: number): AuctionState {
  if (!h.auction_starts_at || !h.auction_ends_at) return "unscheduled";
  const startsMs = Date.parse(h.auction_starts_at);
  const endsMs = Date.parse(h.auction_ends_at);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return "unscheduled";
  if (nowMs < startsMs) return "not_started";
  if (nowMs >= endsMs) return "ended";
  return "open";
}

/** bigint / numeric dari PostgREST → angka Rupiah >= 0. */
function toAmount(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

// ---------------------------------------------------------------------------
// Auth helper — returns the caller's company id when their account is
// `status='active'` (NPWP sudah diverifikasi superadmin TJ).
// ---------------------------------------------------------------------------
type ActiveCompany = { userId: string; companyId: string };

async function requireActiveCompany(): Promise<NextResponse | ActiveCompany> {
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {/* read-only */},
      },
    }
  );
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Tidak terautentikasi. Silakan login dulu." },
      { status: 401 }
    );
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (companyError) {
    return NextResponse.json(
      { ok: false, error: `Gagal membaca company: ${companyError.message}` },
      { status: 500 }
    );
  }
  if (!company) {
    return NextResponse.json(
      { ok: false, error: "Akun Anda belum terhubung ke perusahaan." },
      { status: 403 }
    );
  }
  if (company.status !== "active") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Akun perusahaan belum aktif. Penawaran bisa diajukan setelah NPWP perusahaan diverifikasi.",
      },
      { status: 403 }
    );
  }

  return { userId: user.id, companyId: company.id };
}

// ===========================================================================
// GET — public aggregate
// ===========================================================================
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing halte id" }, { status: 400 });
  }
  if (isExcludedHalteId(id)) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }

  const { data, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select(HALTE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (halteError) {
    return NextResponse.json({ error: halteError.message }, { status: 500 });
  }
  const halte = data as HalteRow | null;
  if (!halte) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }
  if (halte.type !== "brt") {
    return NextResponse.json(
      { error: "Halte ini bukan Halte BRT." },
      { status: 400 }
    );
  }

  // Penawar & riwayat hanya untuk jendela lelang saat ini, supaya penawaran
  // dari lelang sebelumnya tidak ikut terhitung.
  let bidderQuery = supabaseAdmin
    .from("bids")
    .select("company_id")
    .eq("halte_id", id);
  let historyQuery = supabaseAdmin
    .from("bids")
    .select("amount, created_at")
    .eq("halte_id", id);
  if (halte.auction_starts_at) {
    bidderQuery = bidderQuery.gte("created_at", halte.auction_starts_at);
    historyQuery = historyQuery.gte("created_at", halte.auction_starts_at);
  }

  const [biddersRes, historyRes] = await Promise.all([
    bidderQuery,
    historyQuery.order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  if (biddersRes.error) {
    return NextResponse.json({ error: biddersRes.error.message }, { status: 500 });
  }
  if (historyRes.error) {
    return NextResponse.json({ error: historyRes.error.message }, { status: 500 });
  }

  const bidderRows = biddersRes.data ?? [];
  const totalBidders = new Set(bidderRows.map((r) => r.company_id)).size;
  const totalBids = bidderRows.length;

  const nowMs = Date.now();
  const state = auctionState(halte, nowMs);
  const currentBid = toAmount(halte.current_bid);

  return NextResponse.json(
    {
      base_price: effectiveBasePrice(halte.base_price),
      current_bid: currentBid,
      min_next_bid: minNextBid(halte.base_price, currentBid),
      min_increment: minBidIncrement(currentBid),
      period_months: PREMIUM_CONTRACT_MONTHS,
      is_available: halte.is_available,
      auction_starts_at: halte.auction_starts_at ?? null,
      auction_ends_at: halte.auction_ends_at ?? null,
      auction_state: state,
      auction_open: halte.is_available && state === "open",
      contract_ends_at: halte.contract_ends_at ?? null,
      total_bidders: totalBidders,
      total_bids: totalBids,
      bid_count: totalBids,
      history: (historyRes.data ?? []).map((h) => ({
        amount: toAmount(h.amount),
        created_at: h.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ===========================================================================
// POST — place a bid (auth + active company required)
// ===========================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveCompany();
  if (guard instanceof NextResponse) return guard;
  const { companyId } = guard;

  const { id: halteId } = await params;
  if (!halteId) {
    return NextResponse.json(
      { ok: false, error: "Missing halte id" },
      { status: 400 }
    );
  }
  if (isExcludedHalteId(halteId)) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }

  // -------------------------------------------------------------------------
  // Body — hanya `amount` yang dipakai. Durasi kontrak ditetapkan server.
  // -------------------------------------------------------------------------
  let body: { amount?: unknown };
  try {
    body = (await req.json()) as { amount?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    return NextResponse.json(
      { ok: false, error: "Nominal penawaran harus angka Rupiah tanpa desimal." },
      { status: 400 }
    );
  }
  if (amount <= 0) {
    return NextResponse.json(
      { ok: false, error: "Nominal penawaran harus lebih dari 0." },
      { status: 400 }
    );
  }
  if (amount > BID_MAX_AMOUNT) {
    return NextResponse.json(
      { ok: false, error: `Nominal penawaran maksimal ${rupiah(BID_MAX_AMOUNT)}.` },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // Halte guard — harus ada, Halte BRT, tersedia, dan jendela lelang terbuka.
  // Lelang yang belum dijadwalkan tidak menerima penawaran.
  // -------------------------------------------------------------------------
  const { data, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select(HALTE_COLUMNS)
    .eq("id", halteId)
    .maybeSingle();

  if (halteError) {
    return NextResponse.json(
      { ok: false, error: halteError.message },
      { status: 500 }
    );
  }
  const halte = data as HalteRow | null;
  if (!halte) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }
  if (halte.type !== "brt") {
    return NextResponse.json(
      { ok: false, error: "Lelang hanya berlaku untuk Halte BRT." },
      { status: 400 }
    );
  }
  if (!halte.is_available) {
    return NextResponse.json(
      { ok: false, error: "Lelang halte ini sudah ditutup." },
      { status: 400 }
    );
  }

  const nowMs = Date.now();
  const state = auctionState(halte, nowMs);
  if (state !== "open") {
    const msg =
      state === "unscheduled"
        ? "Lelang untuk halte ini belum dijadwalkan."
        : state === "not_started"
          ? "Lelang belum dimulai."
          : "Lelang sudah berakhir.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const currentBid = toAmount(halte.current_bid);
  const minBid = minNextBid(halte.base_price, currentBid);
  if (amount < minBid) {
    return NextResponse.json(
      {
        ok: false,
        error: `Penawaran minimal ${rupiah(minBid)}.`,
        min_next_bid: minBid,
      },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // 1. Compare-and-set haltes.current_bid. Hanya berhasil bila current_bid
  //    belum berubah sejak divalidasi dan lelang masih terbuka.
  // -------------------------------------------------------------------------
  const nowIso = new Date(nowMs).toISOString();
  let claim = supabaseAdmin
    .from("haltes")
    .update({ current_bid: amount })
    .eq("id", halteId)
    .eq("is_available", true)
    .lte("auction_starts_at", nowIso)
    .gt("auction_ends_at", nowIso);
  claim =
    halte.current_bid === null
      ? claim.is("current_bid", null)
      : claim.eq("current_bid", halte.current_bid);
  const { data: claimed, error: claimError } = await claim.select("id");

  if (claimError) {
    return NextResponse.json(
      { ok: false, error: `Gagal memproses penawaran: ${claimError.message}` },
      { status: 500 }
    );
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Penawaran tertinggi baru saja berubah. Muat ulang angka terbaru lalu coba lagi.",
      },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------------
  // 2. Simpan penawaran sebagai 'winning'. Kalau gagal, kembalikan klaim.
  // -------------------------------------------------------------------------
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("bids")
    .insert({
      halte_id: halteId,
      company_id: companyId,
      amount,
      duration_months: PREMIUM_CONTRACT_MONTHS,
      status: "winning",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    await supabaseAdmin
      .from("haltes")
      .update({ current_bid: halte.current_bid ?? 0 })
      .eq("id", halteId)
      .eq("current_bid", amount);
    return NextResponse.json(
      {
        ok: false,
        error: `Gagal menyimpan penawaran: ${insertError?.message ?? "unknown"}`,
      },
      { status: 500 }
    );
  }

  // -------------------------------------------------------------------------
  // 3. Turunkan penawaran 'winning' lain yang lebih rendah ke 'outbid'.
  //    Hanya yang lebih rendah: penawaran lebih tinggi yang masuk bersamaan
  //    tidak boleh ikut diturunkan.
  // -------------------------------------------------------------------------
  const { error: demoteError } = await supabaseAdmin
    .from("bids")
    .update({ status: "outbid" })
    .eq("halte_id", halteId)
    .eq("status", "winning")
    .neq("id", inserted.id)
    .lt("amount", amount);

  if (demoteError) {
    // Penawaran tetap tersimpan; operator bisa merapikan status dari
    // /superadmin/auctions. Tampilkan error supaya UI tidak menganggap sukses.
    return NextResponse.json(
      {
        ok: false,
        error: `Penawaran tersimpan tetapi status penawaran lama gagal diperbarui: ${demoteError.message}`,
      },
      { status: 500 }
    );
  }

  // -------------------------------------------------------------------------
  // 4. Cek akhir: kalau penawaran lain yang lebih tinggi masuk di sela
  //    langkah di atas, tandai penawaran ini 'outbid'.
  // -------------------------------------------------------------------------
  const { data: latest } = await supabaseAdmin
    .from("haltes")
    .select("base_price, current_bid")
    .eq("id", halteId)
    .maybeSingle();
  const latestBid = toAmount(latest?.current_bid ?? amount);
  const nextMin = minNextBid(latest?.base_price ?? halte.base_price, latestBid);
  if (latestBid > amount) {
    await supabaseAdmin
      .from("bids")
      .update({ status: "outbid" })
      .eq("id", inserted.id)
      .eq("status", "winning");
    return NextResponse.json(
      {
        ok: false,
        error: `Penawaran Anda tercatat, tetapi sudah dilampaui penawaran lain yang masuk bersamaan. Minimal berikutnya ${rupiah(nextMin)}.`,
        min_next_bid: nextMin,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    current_bid: amount,
    min_next_bid: nextMin,
  });
}
