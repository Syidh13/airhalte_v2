/**
 * GET /api/dashboard/my-bids
 *
 * Returns every bid placed by the caller's company, joined with the
 * halte info the dashboard needs to render the list (name, tier,
 * corridor, auction window, current_bid).
 *
 * Auth: caller must be logged in. The company doesn't need to be
 * `status='active'` — pending/rejected sponsors can still view their
 * past bids (read-only). Service-role client bypasses the
 * `bids_select_own` RLS policy because we already authorize at the
 * route level via the company id we resolve from the session.
 *
 * Response:
 *   200 { bids: [{
 *           id, amount, duration_months, status, created_at,
 *           halte: { id, name, tier, corridor,
 *                    auction_starts_at, auction_ends_at,
 *                    is_available, current_bid }
 *         }] }
 *   401 / 403 / 500 { error: "..." }
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  // Resolve caller → company
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Proxy sudah me-refresh sesi sebelum handler ini jalan. Kalau token
        // tetap di-refresh di sini, simpan cookie barunya (route handler boleh
        // menulis cookie) supaya refresh token browser tidak basi.
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* abaikan: response sudah terkirim */
          }
        },
      },
    }
  );
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Tidak terautentikasi. Silakan login ulang." },
      { status: 401 }
    );
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (companyError) {
    console.error("[dashboard] gagal membaca company:", companyError.message);
    return NextResponse.json(
      { error: "Gagal membaca data perusahaan. Coba muat ulang halaman." },
      { status: 500 }
    );
  }
  if (!company) {
    return NextResponse.json(
      { error: "Akun Anda belum terhubung ke perusahaan." },
      { status: 403 }
    );
  }

  // Pull every bid for this company, joined with the halte fields the
  // dashboard list needs. Order newest-first so the active card is on top.
  const { data: bids, error: bidsError } = await supabaseAdmin
    .from("bids")
    .select(
      "id, amount, duration_months, status, created_at, " +
        "halte:haltes(id, name, tier, corridor, auction_starts_at, auction_ends_at, is_available, current_bid)"
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  if (bidsError) {
    console.error("[dashboard] gagal memuat bids:", bidsError.message);
    return NextResponse.json(
      { error: "Gagal memuat penawaran lelang. Coba muat ulang halaman." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { bids: bids ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
