/**
 * /api/admin/auctions
 *
 * Phase 4 — superadmin auction management module. The auction itself is
 * still represented by columns on `haltes` (auction_starts_at,
 * auction_ends_at, is_available, current_bid, contract_ends_at); this
 * endpoint is the typed, status-bucketed view for /superadmin/auctions.
 *
 *   GET  ?status=active|upcoming|done|unscheduled
 *        — list Halte BRT plus a derived `status` + bidder count
 *   POST { halte_id, auction_starts_at, auction_ends_at, base_price? }
 *        — jadwalkan lelang baru (atau buka ulang lelang yang sudah
 *          selesai). Aturan:
 *          - hanya Halte BRT (type='brt'), bukan data uji
 *          - harga dasar >= PREMIUM_MIN_BASE_PRICE (bisa diperbarui lewat
 *            `base_price` di body)
 *          - ditolak selama kontrak pemenang masih berjalan
 *            (contract_ends_at > now)
 *          - ditolak bila jadwal lelang masih berjalan / akan datang
 *            (ubah lewat PATCH /api/admin/auctions/[halteId])
 *          - lelang baru mulai bersih: current_bid = 0 dan penawaran lama
 *            yang masih 'winning'/'outbid' ditandai 'lost'
 *
 * Auth: superadmin only (mirror /api/admin/haltes/[id]/close-auction).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";
import { BID_MAX_AMOUNT, PREMIUM_MIN_BASE_PRICE } from "@/lib/pricing";

const PAGE_SIZE = 1000; // bypass PostgREST 1k cap

// ---------------------------------------------------------------------------
// Auth helper — same shape as elsewhere: null on success, NextResponse on fail.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Status derivation — single source of truth used both here (list view) and
// in the detail route. Keep the rules in sync if you change one.
// ---------------------------------------------------------------------------
export type AuctionStatus = "active" | "upcoming" | "done" | "unscheduled";

interface HalteRow {
  id: string;
  name: string;
  type: "brt" | "non-brt";
  tier: "premium" | "mass";
  corridor: string | null;
  base_price: number | null;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  contract_ends_at: string | null;
  is_available: boolean;
  current_bid: number;
}

function deriveStatus(row: HalteRow, nowMs: number): AuctionStatus {
  if (!row.is_available) return "done";
  const startsMs = row.auction_starts_at
    ? new Date(row.auction_starts_at).getTime()
    : null;
  const endsMs = row.auction_ends_at
    ? new Date(row.auction_ends_at).getTime()
    : null;
  if (startsMs === null && endsMs === null) return "unscheduled";
  if (startsMs !== null && Number.isFinite(startsMs) && nowMs < startsMs)
    return "upcoming";
  // Anything with timing that's already started (or has no start) and still
  // marked available — including past-end-but-not-closed — counts as
  // "active" so the superadmin sees it on the actionable list.
  return "active";
}

// ===========================================================================
// GET — list view
// ===========================================================================
export async function GET(req: NextRequest) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  const statusFilter = req.nextUrl.searchParams.get("status");
  const validFilters = new Set<AuctionStatus>([
    "active",
    "upcoming",
    "done",
    "unscheduled",
  ]);

  // 1. Pull every Halte BRT (paginated to dodge the PostgREST 1000-row cap).
  const haltes: HalteRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("haltes")
      .select(
        "id, name, type, tier, corridor, base_price, auction_starts_at, auction_ends_at, contract_ends_at, is_available, current_bid"
      )
      .eq("type", "brt")
      .order("name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as HalteRow[];
    haltes.push(...page.filter((h) => !isExcludedHalteId(h.id)));
    if (page.length < PAGE_SIZE) break;
  }

  // 2. Bids for these haltes (paginated) — grouped client-side into
  //    halte_id → distinct company_id set. Only bids inside the current
  //    window count, so a new auction starts at 0 bidders.
  const halteIds = haltes.map((h) => h.id);
  const startsById = new Map(haltes.map((h) => [h.id, h.auction_starts_at]));
  const biddersByHalte = new Map<string, Set<string>>();
  if (halteIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: bidRows, error: bidsError } = await supabaseAdmin
        .from("bids")
        .select("halte_id, company_id, created_at")
        .in("halte_id", halteIds)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (bidsError) {
        return NextResponse.json({ error: bidsError.message }, { status: 500 });
      }
      for (const b of bidRows ?? []) {
        const startsAt = startsById.get(b.halte_id);
        if (startsAt && Date.parse(b.created_at) < Date.parse(startsAt)) continue;
        const set = biddersByHalte.get(b.halte_id) ?? new Set<string>();
        set.add(b.company_id);
        biddersByHalte.set(b.halte_id, set);
      }
      if ((bidRows ?? []).length < PAGE_SIZE) break;
    }
  }

  // 3. Project + filter
  const nowMs = Date.now();
  const auctions = haltes
    .map((h) => ({
      id: h.id,
      name: h.name,
      tier: h.tier,
      corridor: h.corridor,
      base_price: Number(h.base_price ?? 0),
      auction_starts_at: h.auction_starts_at,
      auction_ends_at: h.auction_ends_at,
      contract_ends_at: h.contract_ends_at ?? null,
      is_available: h.is_available,
      current_bid: h.current_bid ?? 0,
      total_bidders: biddersByHalte.get(h.id)?.size ?? 0,
      status: deriveStatus(h, nowMs),
    }))
    .filter((row) => {
      if (!statusFilter) return true;
      if (!validFilters.has(statusFilter as AuctionStatus)) return true;
      return row.status === statusFilter;
    });

  return NextResponse.json(
    { auctions },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ===========================================================================
// POST — create / schedule a new auction
// ===========================================================================
const MIN_WINDOW_MS = 5 * 60 * 1000; // 5 menit (mirror frontend helper text)

export async function POST(req: NextRequest) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  let body: {
    halte_id?: unknown;
    auction_starts_at?: unknown;
    auction_ends_at?: unknown;
    base_price?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }

  const halteId =
    typeof body.halte_id === "string" && body.halte_id.trim()
      ? body.halte_id.trim()
      : null;
  const startsRaw =
    typeof body.auction_starts_at === "string" ? body.auction_starts_at : null;
  const endsRaw =
    typeof body.auction_ends_at === "string" ? body.auction_ends_at : null;

  if (!halteId) {
    return NextResponse.json(
      { ok: false, error: "halte_id wajib ada." },
      { status: 400 }
    );
  }
  if (isExcludedHalteId(halteId)) {
    return NextResponse.json(
      { ok: false, error: "Halte tidak ditemukan." },
      { status: 404 }
    );
  }
  if (!startsRaw || !endsRaw) {
    return NextResponse.json(
      { ok: false, error: "auction_starts_at dan auction_ends_at wajib diisi." },
      { status: 400 }
    );
  }

  // Harga dasar opsional — bila dikirim, ikut diperbarui bersama jadwal.
  let newBasePrice: number | null = null;
  if (body.base_price !== undefined && body.base_price !== null) {
    const n = body.base_price;
    if (typeof n !== "number" || !Number.isSafeInteger(n)) {
      return NextResponse.json(
        { ok: false, error: "Harga dasar harus angka Rupiah tanpa desimal." },
        { status: 400 }
      );
    }
    if (n < PREMIUM_MIN_BASE_PRICE) {
      return NextResponse.json(
        {
          ok: false,
          error: `Harga dasar Halte BRT minimal ${rupiah(PREMIUM_MIN_BASE_PRICE)}/tahun.`,
        },
        { status: 400 }
      );
    }
    if (n > BID_MAX_AMOUNT) {
      return NextResponse.json(
        { ok: false, error: `Harga dasar maksimal ${rupiah(BID_MAX_AMOUNT)}.` },
        { status: 400 }
      );
    }
    newBasePrice = n;
  }

  const startsMs = new Date(startsRaw).getTime();
  const endsMs = new Date(endsRaw).getTime();
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
  const nowMs = Date.now();
  if (endsMs <= nowMs) {
    return NextResponse.json(
      { ok: false, error: "auction_ends_at tidak boleh di masa lalu." },
      { status: 400 }
    );
  }

  // Halte must exist + be a Halte BRT.
  const { data: halte, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select(
      "id, type, base_price, is_available, auction_ends_at, contract_ends_at"
    )
    .eq("id", halteId)
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
      { ok: false, error: "Lelang hanya untuk Halte BRT." },
      { status: 400 }
    );
  }

  const basePrice = newBasePrice ?? Number(halte.base_price ?? 0);
  if (!(basePrice >= PREMIUM_MIN_BASE_PRICE)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Harga dasar halte ini ${rupiah(basePrice)}, di bawah minimum ${rupiah(PREMIUM_MIN_BASE_PRICE)}/tahun. Isi harga dasar baru sebelum menjadwalkan lelang.`,
      },
      { status: 400 }
    );
  }

  const contractEndsMs = halte.contract_ends_at
    ? new Date(halte.contract_ends_at).getTime()
    : null;
  if (contractEndsMs !== null && Number.isFinite(contractEndsMs) && contractEndsMs > nowMs) {
    return NextResponse.json(
      {
        ok: false,
        error: `Kontrak pemenang lelang sebelumnya masih berjalan hingga ${dateId(halte.contract_ends_at)}. Lelang baru bisa dijadwalkan setelah kontrak berakhir.`,
      },
      { status: 409 }
    );
  }

  // Jangan pernah menimpa lelang yang masih berjalan / akan datang.
  const prevEndsMs = halte.auction_ends_at
    ? new Date(halte.auction_ends_at).getTime()
    : null;
  if (
    halte.is_available &&
    prevEndsMs !== null &&
    Number.isFinite(prevEndsMs) &&
    prevEndsMs > nowMs
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Halte ini masih punya jadwal lelang yang berjalan atau akan datang. Ubah jadwalnya lewat Detail → Edit Window.",
      },
      { status: 409 }
    );
  }

  // Lelang baru: jadwal baru, dibuka lagi, dan current_bid mulai dari 0.
  const { error: updateError } = await supabaseAdmin
    .from("haltes")
    .update({
      auction_starts_at: new Date(startsMs).toISOString(),
      auction_ends_at: new Date(endsMs).toISOString(),
      is_available: true,
      current_bid: 0,
      ...(newBasePrice !== null ? { base_price: newBasePrice } : {}),
    })
    .eq("id", halteId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: updateError.message },
      { status: 500 }
    );
  }

  // Penawaran dari jendela sebelumnya yang belum ditetapkan tidak ikut ke
  // lelang baru.
  const { error: retireError } = await supabaseAdmin
    .from("bids")
    .update({ status: "lost" })
    .eq("halte_id", halteId)
    .in("status", ["winning", "outbid"]);
  if (retireError) {
    return NextResponse.json(
      {
        ok: false,
        error: `Lelang terjadwal, tetapi status penawaran lama gagal diperbarui: ${retireError.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, halte_id: halteId });
}
