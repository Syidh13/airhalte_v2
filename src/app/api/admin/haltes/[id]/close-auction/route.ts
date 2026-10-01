/**
 * POST /api/admin/haltes/[id]/close-auction
 *
 * Superadmin-only finalize action untuk lelang Halte BRT.
 *
 *   1. Pemenang = penawaran 'winning' tertinggi di jendela lelang saat ini
 *      (created_at >= auction_starts_at). Cadangan: bila tidak ada yang
 *      'winning' (mis. status sempat diturunkan manual), ambil 'outbid'
 *      tertinggi di jendela yang sama. Seri: yang lebih dulu masuk menang.
 *   2. Pemenang → 'won'; semua penawaran 'winning'/'outbid' lain untuk halte
 *      ini → 'lost'.
 *   3. Halte dibekukan: is_available=false. Bila ada pemenang,
 *      current_bid = nilai pemenang dan contract_ends_at = sekarang +
 *      PREMIUM_CONTRACT_MONTHS (12 bulan).
 *
 * Pengaman:
 *   - 409 bila lelang di jendela ini sudah punya pemenang ('won'), bila
 *     lelang sudah ditutup tanpa penawaran tersisa, atau bila penutupan lain
 *     berjalan bersamaan (update pemenang bersyarat status).
 *
 * Response shapes:
 *   200 { ok: true, winner_bid_id: string | null, winner_amount: number | null,
 *         contract_ends_at: string | null }
 *        — winner_bid_id null bila tidak ada penawaran (halte tetap dibekukan).
 *   400 / 401 / 403 / 404 / 409 / 500 { ok: false, error }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";
import { PREMIUM_CONTRACT_MONTHS } from "@/lib/pricing";

async function requireSuperadmin(): Promise<NextResponse | null> {
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
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Tidak terautentikasi. Silakan login ulang." },
      { status: 401 }
    );
  }
  const role = (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  if (role !== "superadmin") {
    return NextResponse.json(
      { ok: false, error: "Akses ditolak. Hanya superadmin yang diizinkan." },
      { status: 403 }
    );
  }
  return null;
}

interface CandidateBid {
  id: string;
  amount: number;
  created_at: string;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing halte id" },
      { status: 400 }
    );
  }
  if (isExcludedHalteId(id)) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }

  const { data: halte, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select("id, type, is_available, auction_starts_at")
    .eq("id", id)
    .maybeSingle();
  if (halteError) {
    return NextResponse.json(
      { ok: false, error: halteError.message },
      { status: 500 }
    );
  }
  if (!halte) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }
  if (halte.type !== "brt") {
    return NextResponse.json(
      { ok: false, error: "Tutup lelang hanya berlaku untuk Halte BRT." },
      { status: 400 }
    );
  }

  // Penawaran yang dihitung: jendela lelang saat ini. Halte lama tanpa
  // jadwal (data sebelum Phase 2) memakai semua penawarannya.
  const windowStart: string | null = halte.auction_starts_at ?? null;

  // -------------------------------------------------------------------------
  // Guard: jangan tetapkan pemenang dua kali.
  // -------------------------------------------------------------------------
  let wonQuery = supabaseAdmin
    .from("bids")
    .select("id", { count: "exact", head: true })
    .eq("halte_id", id)
    .eq("status", "won");
  if (windowStart) wonQuery = wonQuery.gte("created_at", windowStart);
  const { count: wonCount, error: wonError } = await wonQuery;
  if (wonError) {
    return NextResponse.json(
      { ok: false, error: wonError.message },
      { status: 500 }
    );
  }
  if ((wonCount ?? 0) > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Lelang ini sudah ditutup dan pemenangnya sudah ditetapkan.",
      },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------------
  // Pilih pemenang: 'winning' tertinggi, cadangan 'outbid' tertinggi.
  // -------------------------------------------------------------------------
  async function topBid(status: "winning" | "outbid") {
    let q = supabaseAdmin
      .from("bids")
      .select("id, amount, created_at")
      .eq("halte_id", id)
      .eq("status", status);
    if (windowStart) q = q.gte("created_at", windowStart);
    return q
      .order("amount", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
  }

  const winningRes = await topBid("winning");
  if (winningRes.error) {
    return NextResponse.json(
      { ok: false, error: winningRes.error.message },
      { status: 500 }
    );
  }
  let top = winningRes.data as CandidateBid | null;
  if (!top) {
    const outbidRes = await topBid("outbid");
    if (outbidRes.error) {
      return NextResponse.json(
        { ok: false, error: outbidRes.error.message },
        { status: 500 }
      );
    }
    top = outbidRes.data as CandidateBid | null;
  }

  if (!top && !halte.is_available) {
    return NextResponse.json(
      { ok: false, error: "Lelang ini sudah ditutup." },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------------
  // Sequential writes (best-effort atomic — same caveat as POST bids):
  //   1. Pemenang → 'won' (bersyarat status, jadi dua penutupan bersamaan
  //      tidak bisa sama-sama menetapkan pemenang)
  //   2. Penawaran aktif lain → 'lost'
  //   3. Bekukan halte + mulai kontrak tahunan
  // -------------------------------------------------------------------------
  if (top) {
    const { data: claimed, error: winError } = await supabaseAdmin
      .from("bids")
      .update({ status: "won" })
      .eq("id", top.id)
      .in("status", ["winning", "outbid"])
      .select("id");
    if (winError) {
      return NextResponse.json(
        { ok: false, error: `Gagal menetapkan pemenang: ${winError.message}` },
        { status: 500 }
      );
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Lelang ini baru saja ditutup dari sesi lain." },
        { status: 409 }
      );
    }
  }

  const demoteQuery = supabaseAdmin
    .from("bids")
    .update({ status: "lost" })
    .eq("halte_id", id)
    .in("status", ["winning", "outbid"]);
  const { error: demoteError } = top
    ? await demoteQuery.neq("id", top.id)
    : await demoteQuery;
  if (demoteError) {
    return NextResponse.json(
      { ok: false, error: `Gagal memperbarui penawaran lain: ${demoteError.message}` },
      { status: 500 }
    );
  }

  let contractEndsAt: string | null = null;
  if (top) {
    const end = new Date();
    end.setMonth(end.getMonth() + PREMIUM_CONTRACT_MONTHS);
    contractEndsAt = end.toISOString();
  }

  const { error: freezeError } = await supabaseAdmin
    .from("haltes")
    .update({
      is_available: false,
      ...(top ? { current_bid: top.amount, contract_ends_at: contractEndsAt } : {}),
    })
    .eq("id", id);
  if (freezeError) {
    return NextResponse.json(
      { ok: false, error: `Gagal menutup halte: ${freezeError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    winner_bid_id: top?.id ?? null,
    winner_amount: top?.amount ?? null,
    contract_ends_at: contractEndsAt,
  });
}
