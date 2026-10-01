/**
 * /api/admin/auctions/[halteId]
 *
 *   GET   — un-blind detail for one auction. Includes every bid joined
 *           with company name + PIC contact (name/email). Superadmin
 *           context: privacy doesn't apply, the operator needs to see
 *           who's bidding to mediate disputes / manual award flow.
 *   PATCH — reschedule the window. Body accepts partial
 *           { auction_starts_at?, auction_ends_at? }. Same validation
 *           rules as POST /api/admin/auctions create, plus:
 *           - lelang yang sudah ditutup (is_available=false) tidak bisa
 *             diubah di sini; buat lelang baru lewat POST
 *           - ditolak selama kontrak pemenang masih berjalan
 *           - harga dasar halte harus >= PREMIUM_MIN_BASE_PRICE
 *           - jendela yang masih berjalan / akan datang: hanya jadwal yang
 *             berubah (penawaran & current_bid tetap)
 *           - jendela yang sudah lewat: dianggap lelang baru, current_bid
 *             kembali 0 dan penawaran lama 'winning'/'outbid' → 'lost'
 *
 * Record uji (id 'test') tidak pernah ditampilkan atau dijadwalkan.
 *
 * Auth: superadmin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";
import { PREMIUM_MIN_BASE_PRICE } from "@/lib/pricing";

const MIN_WINDOW_MS = 5 * 60 * 1000;

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function dateId(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

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
      { error: "Tidak terautentikasi. Silakan login ulang." },
      { status: 401 }
    );
  }
  const role = (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  if (role !== "superadmin") {
    return NextResponse.json(
      { error: "Akses ditolak. Hanya superadmin yang diizinkan." },
      { status: 403 }
    );
  }
  return null;
}

type AuctionStatus = "active" | "upcoming" | "done" | "unscheduled";

function deriveStatus(args: {
  is_available: boolean;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
}): AuctionStatus {
  const nowMs = Date.now();
  if (!args.is_available) return "done";
  const startsMs = args.auction_starts_at
    ? new Date(args.auction_starts_at).getTime()
    : null;
  const endsMs = args.auction_ends_at
    ? new Date(args.auction_ends_at).getTime()
    : null;
  if (startsMs === null && endsMs === null) return "unscheduled";
  if (startsMs !== null && Number.isFinite(startsMs) && nowMs < startsMs)
    return "upcoming";
  return "active";
}

// ===========================================================================
// GET — un-blind detail
// ===========================================================================
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ halteId: string }> }
) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  const { halteId } = await params;
  if (!halteId) {
    return NextResponse.json({ error: "Missing halteId" }, { status: 400 });
  }
  if (isExcludedHalteId(halteId)) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }

  const { data: halte, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select(
      "id, name, type, tier, corridor, lat, lng, base_price, current_bid, is_available, auction_starts_at, auction_ends_at, contract_ends_at"
    )
    .eq("id", halteId)
    .maybeSingle();

  if (halteError) {
    return NextResponse.json({ error: halteError.message }, { status: 500 });
  }
  if (!halte) {
    return NextResponse.json(
      { error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }

  // Un-blind bid join — companies + PIC contact. We use the foreign-table
  // embed syntax so PostgREST handles the join. The result types `company`
  // as an object (one company per bid) and `contacts` as an array since
  // a company *could* have multiple PIC rows; in practice it's exactly 1.
  const { data: bids, error: bidsError } = await supabaseAdmin
    .from("bids")
    .select(
      "id, amount, duration_months, status, created_at, " +
        "company:companies(id, company_name, contacts(name, email))"
    )
    .eq("halte_id", halteId)
    .order("amount", { ascending: false })
    .order("created_at", { ascending: true });

  if (bidsError) {
    return NextResponse.json({ error: bidsError.message }, { status: 500 });
  }

  // Flatten the contact array so the client gets a plain `pic` object —
  // saves the page from re-doing the same `[0]` dance everywhere.
  type RawCompany = {
    id: string;
    company_name: string;
    contacts: { name: string; email: string }[] | null;
  } | null;
  type RawBid = {
    id: string;
    amount: number;
    duration_months: number;
    status: string;
    created_at: string;
    company: RawCompany;
  };

  // Bid berstatus 'rejected' adalah arsip (skema lama / dibatalkan admin) —
  // tidak ikut ditampilkan dan tidak dihitung di detail lelang.
  const liveBids = ((bids ?? []) as unknown as RawBid[]).filter(
    (b) => b.status !== "rejected"
  );
  const flatBids = liveBids.map((b) => ({
    id: b.id,
    amount: b.amount,
    duration_months: b.duration_months,
    status: b.status,
    created_at: b.created_at,
    company: b.company
      ? { id: b.company.id, company_name: b.company.company_name }
      : null,
    pic: b.company?.contacts?.[0]
      ? {
          name: b.company.contacts[0].name,
          email: b.company.contacts[0].email,
        }
      : null,
  }));

  const totalBidders = new Set(
    flatBids.filter((b) => b.company).map((b) => b.company!.id)
  ).size;

  return NextResponse.json(
    {
      halte: {
        id: halte.id,
        name: halte.name,
        tier: halte.tier,
        corridor: halte.corridor,
        lat: halte.lat,
        lng: halte.lng,
        base_price: Number(halte.base_price ?? 0),
        current_bid: halte.current_bid ?? 0,
        is_available: halte.is_available,
        auction_starts_at: halte.auction_starts_at,
        auction_ends_at: halte.auction_ends_at,
        contract_ends_at: halte.contract_ends_at ?? null,
        status: deriveStatus(halte),
      },
      bids: flatBids,
      total_bidders: totalBidders,
      total_bids: flatBids.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ===========================================================================
// PATCH — reschedule the auction window
// ===========================================================================
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ halteId: string }> }
) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  const { halteId } = await params;
  if (!halteId) {
    return NextResponse.json(
      { ok: false, error: "Missing halteId" },
      { status: 400 }
    );
  }
  if (isExcludedHalteId(halteId)) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }

  let body: {
    auction_starts_at?: unknown;
    auction_ends_at?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }

  // Read existing row first so a partial PATCH can reuse the side that
  // wasn't sent. Also confirms the halte exists + is a Halte BRT.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("haltes")
    .select(
      "id, type, base_price, is_available, auction_starts_at, auction_ends_at, contract_ends_at"
    )
    .eq("id", halteId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      { ok: false, error: existingError.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }
  if (existing.type !== "brt") {
    return NextResponse.json(
      {
        ok: false,
        error: "Hanya Halte BRT yang bisa dijadwalkan ulang.",
      },
      { status: 400 }
    );
  }
  const nowMs = Date.now();
  const contractEndsMs = existing.contract_ends_at
    ? new Date(existing.contract_ends_at).getTime()
    : null;
  if (contractEndsMs !== null && Number.isFinite(contractEndsMs) && contractEndsMs > nowMs) {
    return NextResponse.json(
      {
        ok: false,
        error: `Kontrak pemenang lelang masih berjalan hingga ${dateId(existing.contract_ends_at)}. Jadwal lelang baru bisa dibuat setelah kontrak berakhir.`,
      },
      { status: 409 }
    );
  }
  if (!existing.is_available) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Lelang ini sudah ditutup. Jadwalkan lelang baru lewat tombol Buat Lelang Baru.",
      },
      { status: 409 }
    );
  }
  const basePrice = Number(existing.base_price ?? 0);
  if (!(basePrice >= PREMIUM_MIN_BASE_PRICE)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Harga dasar halte ini ${rupiah(basePrice)}, di bawah minimum ${rupiah(PREMIUM_MIN_BASE_PRICE)}/tahun. Perbarui harga dasar di menu Halte terlebih dahulu.`,
      },
      { status: 400 }
    );
  }

  const nextStarts =
    typeof body.auction_starts_at === "string"
      ? body.auction_starts_at
      : existing.auction_starts_at;
  const nextEnds =
    typeof body.auction_ends_at === "string"
      ? body.auction_ends_at
      : existing.auction_ends_at;

  if (!nextStarts || !nextEnds) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Window lengkap diperlukan — set baik auction_starts_at maupun auction_ends_at.",
      },
      { status: 400 }
    );
  }

  const startsMs = new Date(nextStarts).getTime();
  const endsMs = new Date(nextEnds).getTime();
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
    return NextResponse.json(
      { ok: false, error: "Format datetime tidak valid." },
      { status: 400 }
    );
  }
  if (endsMs <= startsMs) {
    return NextResponse.json(
      { ok: false, error: "auction_ends_at harus setelah auction_starts_at." },
      { status: 400 }
    );
  }
  if (endsMs - startsMs < MIN_WINDOW_MS) {
    return NextResponse.json(
      {
        ok: false,
        error: "Window lelang minimum 5 menit antara mulai dan berakhir.",
      },
      { status: 400 }
    );
  }
  if (endsMs <= nowMs) {
    return NextResponse.json(
      { ok: false, error: "auction_ends_at tidak boleh di masa lalu." },
      { status: 400 }
    );
  }

  // Jendela sebelumnya sudah lewat (atau belum pernah ada) → ini lelang
  // baru: current_bid mulai dari 0. Jendela yang masih berjalan / akan
  // datang hanya digeser, penawarannya tidak disentuh.
  const prevEndsMs = existing.auction_ends_at
    ? new Date(existing.auction_ends_at).getTime()
    : null;
  const isNewAuction =
    prevEndsMs === null || !Number.isFinite(prevEndsMs) || prevEndsMs <= nowMs;

  const { error: updateError } = await supabaseAdmin
    .from("haltes")
    .update({
      auction_starts_at: new Date(startsMs).toISOString(),
      auction_ends_at: new Date(endsMs).toISOString(),
      ...(isNewAuction ? { current_bid: 0 } : {}),
    })
    .eq("id", halteId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: updateError.message },
      { status: 500 }
    );
  }

  if (isNewAuction) {
    const { error: retireError } = await supabaseAdmin
      .from("bids")
      .update({ status: "lost" })
      .eq("halte_id", halteId)
      .in("status", ["winning", "outbid"]);
    if (retireError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Jadwal tersimpan, tetapi status penawaran lama gagal diperbarui: ${retireError.message}`,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, new_auction: isNewAuction });
}
