/**
 * GET /api/dashboard/my-subscriptions
 *
 * Returns every subscription created by the caller's company, joined
 * with the halte info the dashboard needs to render the list. Mirror
 * of /api/dashboard/my-bids, but for the Mass tier.
 *
 * Status derivation server-side per row:
 *   - active   : DB status='active' AND ends_at >= today
 *   - expired  : DB status='active' AND ends_at < today (auto-flips,
 *                we don't write back to the row), OR DB status='expired'
 *   - cancelled: DB status='cancelled'
 *   - pending  : DB status='pending' (Phase 8 territory)
 *
 * Auth: caller must be logged in. Like /my-bids, we don't gate on
 * `status='active'` so a pending/rejected sponsor can still view their
 * past subscriptions read-only.
 *
 * Response:
 *   200 { subscriptions: [{
 *           id, duration_months, monthly_price, total_price, discount_pct,
 *           starts_at, ends_at, created_at, status,
 *           halte: { id, name, tier, corridor, lat, lng, base_price,
 *                    is_available }
 *         }] }
 *   401 / 403 / 500 { error: "..." }
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

type DerivedStatus = "active" | "expired" | "cancelled" | "pending";

export async function GET() {
  // Resolve caller → company (no active-status gate; read-only is OK).
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

  const { data: rawSubs, error: subsError } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, duration_months, monthly_price, total_price, discount_pct, " +
        "starts_at, ends_at, status, created_at, " +
        "halte:haltes(id, name, tier, corridor, lat, lng, base_price, is_available)"
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  if (subsError) {
    console.error("[dashboard] gagal memuat subscriptions:", subsError.message);
    return NextResponse.json(
      { error: "Gagal memuat langganan. Coba muat ulang halaman." },
      { status: 500 }
    );
  }

  const todayDateOnly = new Date().toISOString().slice(0, 10);

  type RawSub = {
    id: string;
    duration_months: number;
    monthly_price: number;
    total_price: number;
    discount_pct: number;
    starts_at: string | null;
    ends_at: string | null;
    status: string;
    created_at: string;
    halte: {
      id: string;
      name: string;
      tier: "premium" | "mass";
      corridor: string | null;
      lat: number;
      lng: number;
      base_price: number;
      is_available: boolean;
    } | null;
  };

  const subscriptions = ((rawSubs ?? []) as unknown as RawSub[]).map((s) => {
    let derivedStatus: DerivedStatus;
    if (s.status === "cancelled") derivedStatus = "cancelled";
    else if (s.status === "pending") derivedStatus = "pending";
    else if (s.status === "expired") derivedStatus = "expired";
    else if (s.status === "active") {
      // Active in DB but ends_at already in the past → treat as expired
      // for the dashboard (we don't write back the status flip; that's
      // a future scheduled-job concern).
      derivedStatus =
        s.ends_at && s.ends_at >= todayDateOnly ? "active" : "expired";
    } else {
      // Defensive: unknown DB status → bucket into pending so the user
      // can see something instead of the row dropping out.
      derivedStatus = "pending";
    }

    return {
      id: s.id,
      duration_months: s.duration_months,
      monthly_price: s.monthly_price,
      total_price: s.total_price,
      discount_pct: s.discount_pct,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      created_at: s.created_at,
      status: derivedStatus,
      halte: s.halte,
    };
  });

  return NextResponse.json(
    { subscriptions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
