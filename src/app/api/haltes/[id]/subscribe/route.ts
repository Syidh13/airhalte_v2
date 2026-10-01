/**
 * /api/haltes/[id]/subscribe
 *
 * Langganan bus stop Non-BRT (mode internal: "mass").
 *
 *   GET  (public)            : riwayat langganan (anonim, tanpa nama
 *                              perusahaan) + status sewa saat ini, untuk
 *                              DetailPanel.
 *   POST (auth + active co.) : buat langganan. Server memegang aturan harga
 *                              (lib/pricing.ts): tarif tetap
 *                              NON_BRT_MONTHLY_PRICE, periode hanya bulanan (1)
 *                              atau tahunan (12), tanpa diskon. Client hanya
 *                              mengirim `duration_months`.
 *
 * Semua baca/tulis memakai service-role client (supabaseAdmin), bukan client
 * milik user, sehingga tetap jalan setelah policy INSERT client dicabut.
 *
 * Double booking: overlap dicek tepat sebelum insert, pelanggaran constraint
 * DB (23505 unique / 23P01 exclusion, bila migrasi menambahkannya) dipetakan
 * ke 409, dan setelah insert dicek ulang. Bila dua permintaan lolos
 * bersamaan, yang tercatat lebih dulu dipertahankan dan baris milik
 * permintaan ini dihapus lagi.
 *
 * Belum termasuk (fase lain): pembayaran (Phase 8). Langganan langsung
 * `status='active'`.
 *
 * Response (GET 200):
 *   { history: [{ duration_months, starts_at, ends_at, created_at }],
 *     is_available: boolean, active_until: string | null }
 *
 * Response (POST):
 *   200 { ok: true, subscription_id, duration_months, total_price, ends_at }
 *   400 validasi · 401 belum login · 403 perusahaan belum aktif
 *   404 halte tidak ditemukan · 409 titik sudah disewa · 500 lainnya
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";
import {
  NON_BRT_MONTHLY_PRICE,
  isSubscriptionPeriod,
  subscriptionTotal,
} from "@/lib/pricing";

const HISTORY_LIMIT = 5;

const ALREADY_RENTED_MSG =
  "Titik ini sudah disewa pihak lain. Silakan pilih titik lain atau tunggu langganan berakhir.";

// ---------------------------------------------------------------------------
// Auth helper — same shape as POST /api/haltes/[id]/bids.
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
          "Akun perusahaan belum aktif. Langganan bisa dibuat setelah NPWP perusahaan diverifikasi.",
      },
      { status: 403 }
    );
  }

  return { userId: user.id, companyId: company.id };
}

/** Tanggal hari ini (YYYY-MM-DD, UTC) — batas "masih aktif" yang sama
    dengan rute admin dan availability. */
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Langganan aktif (status='active', ends_at >= hari ini) untuk satu titik,
    urut dari yang tercatat paling awal. */
async function activeSubscriptions(halteId: string) {
  return supabaseAdmin
    .from("subscriptions")
    .select("id, ends_at")
    .eq("halte_id", halteId)
    .eq("status", "active")
    .gte("ends_at", todayDateOnly())
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
}

// ===========================================================================
// GET — public blind history + current rental state
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

  const { data: halte, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select("id, type, is_available")
    .eq("id", id)
    .maybeSingle();
  if (halteError) {
    return NextResponse.json({ error: halteError.message }, { status: 500 });
  }
  if (!halte) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }
  if (halte.type !== "non-brt") {
    return NextResponse.json(
      { error: "Titik ini bukan bus stop Non-BRT." },
      { status: 400 }
    );
  }

  // Riwayat: hanya status active / expired (pending / cancelled tidak
  // ditampilkan ke publik).
  const [historyRes, activeRes] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("duration_months, starts_at, ends_at, created_at")
      .eq("halte_id", id)
      .in("status", ["active", "expired"])
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    activeSubscriptions(id),
  ]);
  if (historyRes.error) {
    return NextResponse.json({ error: historyRes.error.message }, { status: 500 });
  }
  if (activeRes.error) {
    return NextResponse.json({ error: activeRes.error.message }, { status: 500 });
  }

  // Tanggal berakhir paling jauh di antara langganan aktif.
  const activeUntil =
    (activeRes.data ?? [])
      .map((s) => s.ends_at as string | null)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  return NextResponse.json(
    {
      history: historyRes.data ?? [],
      is_available: halte.is_available,
      active_until: activeUntil,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ===========================================================================
// POST — create subscription
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
  // Body — hanya periode 1 (bulanan) atau 12 (tahunan).
  // -------------------------------------------------------------------------
  let body: { duration_months?: unknown };
  try {
    body = (await req.json()) as { duration_months?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }
  const period = body.duration_months;
  if (!isSubscriptionPeriod(period)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Periode langganan hanya bulanan (1 bulan) atau tahunan (12 bulan).",
      },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // Halte guard — harus ada, bus stop Non-BRT, dan dibuka untuk langganan.
  // -------------------------------------------------------------------------
  const { data: halte, error: halteError } = await supabaseAdmin
    .from("haltes")
    .select("id, type, is_available")
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
  if (halte.type !== "non-brt") {
    return NextResponse.json(
      {
        ok: false,
        error: "Langganan hanya untuk bus stop Non-BRT. Halte BRT dipasarkan lewat lelang.",
      },
      { status: 400 }
    );
  }
  if (!halte.is_available) {
    return NextResponse.json(
      { ok: false, error: "Titik ini sedang tidak dibuka untuk langganan." },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // Harga — selalu dari lib/pricing.ts (tarif tetap, tanpa diskon). Kolom
  // base_price di DB tidak dipakai untuk Non-BRT.
  // -------------------------------------------------------------------------
  const monthlyPrice = NON_BRT_MONTHLY_PRICE;
  const totalPrice = subscriptionTotal(period);

  // Periode — mulai hari ini, berakhir hari ini + periode.
  const startsDate = new Date();
  const endsDate = new Date(startsDate);
  endsDate.setMonth(endsDate.getMonth() + period);
  const startsIso = startsDate.toISOString().slice(0, 10);
  const endsIso = endsDate.toISOString().slice(0, 10);

  // -------------------------------------------------------------------------
  // Cek overlap tepat sebelum insert.
  // -------------------------------------------------------------------------
  const before = await activeSubscriptions(halteId);
  if (before.error) {
    return NextResponse.json(
      { ok: false, error: before.error.message },
      { status: 500 }
    );
  }
  if ((before.data ?? []).length > 0) {
    return NextResponse.json(
      { ok: false, error: ALREADY_RENTED_MSG },
      { status: 409 }
    );
  }

  // -------------------------------------------------------------------------
  // Insert. Phase 8 akan memakai status='pending' sampai pembayaran masuk.
  // -------------------------------------------------------------------------
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      halte_id: halteId,
      company_id: companyId,
      duration_months: period,
      monthly_price: monthlyPrice,
      total_price: totalPrice,
      discount_pct: 0,
      status: "active",
      starts_at: startsIso,
      ends_at: endsIso,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    // 23505 = unique_violation, 23P01 = exclusion_violation: constraint
    // anti double booking di DB menolak baris kedua.
    if (insertError?.code === "23505" || insertError?.code === "23P01") {
      return NextResponse.json(
        { ok: false, error: ALREADY_RENTED_MSG },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: `Gagal membuat langganan: ${insertError?.message ?? "unknown"}`,
      },
      { status: 500 }
    );
  }

  // -------------------------------------------------------------------------
  // Cek ulang setelah insert. Tanpa constraint DB, dua permintaan yang
  // bersamaan bisa sama-sama lolos cek di atas. Yang tercatat lebih dulu
  // dipertahankan; baris milik permintaan ini dihapus lagi.
  // -------------------------------------------------------------------------
  const after = await activeSubscriptions(halteId);
  const first = after.data?.[0];
  if (!after.error && first && first.id !== inserted.id) {
    const { error: undoError } = await supabaseAdmin
      .from("subscriptions")
      .delete()
      .eq("id", inserted.id);
    if (undoError) {
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "cancelled" })
        .eq("id", inserted.id);
    }
    return NextResponse.json(
      { ok: false, error: ALREADY_RENTED_MSG },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    subscription_id: inserted.id,
    duration_months: period,
    total_price: totalPrice,
    ends_at: endsIso,
  });
}
