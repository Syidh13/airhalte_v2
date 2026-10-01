/**
 * /api/admin/subscriptions/[halteId]
 *
 *   GET   — un-blind detail for one Non-BRT point's subscription history.
 *           Returns halte info + every subscription (any status) joined
 *           with company + PIC. Status priority mirrors the list route:
 *           active > delisted > available (a point delisted mid-tenancy
 *           still reads "Sedang Disewa").
 *   PATCH — toggle is_available (list / delist). Body: { is_available }.
 *
 * Auth: superadmin only.
 *
 * Out of scope (other phases):
 *   - Cancelling an active subscription mid-term (Phase 7)
 *   - Creating a subscription on behalf of a company (subscribe purchase
 *     flow, Phase 8)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";

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

type SubStatus = "available" | "active" | "delisted";

/** Sama dengan list route: langganan aktif menang atas status delist. */
function deriveStatus(args: {
  is_available: boolean;
  hasActive: boolean;
}): SubStatus {
  if (args.hasActive) return "active";
  if (!args.is_available) return "delisted";
  return "available";
}

// ===========================================================================
// GET — un-blind detail with full subscription history
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
      "id, name, type, tier, corridor, lat, lng, base_price, current_bid, is_available"
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
  if (halte.type !== "non-brt") {
    return NextResponse.json(
      { error: "Titik ini bukan bus stop Non-BRT." },
      { status: 400 }
    );
  }

  // Full subscription history joined with company + PIC. Newest first.
  const { data: rawSubs, error: subsError } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, duration_months, monthly_price, total_price, discount_pct, status, starts_at, ends_at, created_at, " +
        "company:companies(id, company_name, contacts(name, email))"
    )
    .eq("halte_id", halteId)
    .order("created_at", { ascending: false });

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  type RawSub = {
    id: string;
    duration_months: number;
    monthly_price: number;
    total_price: number;
    discount_pct: number | null;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string;
    company:
      | {
          id: string;
          company_name: string;
          contacts: { name: string; email: string }[] | null;
        }
      | null;
  };

  const subscriptions = ((rawSubs ?? []) as unknown as RawSub[]).map((s) => ({
    id: s.id,
    duration_months: s.duration_months,
    monthly_price: s.monthly_price,
    total_price: s.total_price,
    discount_pct: s.discount_pct ?? 0,
    status: s.status,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    created_at: s.created_at,
    company: s.company
      ? { id: s.company.id, company_name: s.company.company_name }
      : null,
    pic: s.company?.contacts?.[0]
      ? {
          name: s.company.contacts[0].name,
          email: s.company.contacts[0].email,
        }
      : null,
  }));

  // Find the currently-active subscription (status='active' AND ends_at
  // hasn't passed). The list endpoint uses today-date for the gte cutoff;
  // we mirror that here for consistency.
  const todayDateOnly = new Date().toISOString().slice(0, 10);
  const current =
    subscriptions.find(
      (s) =>
        s.status === "active" &&
        s.ends_at !== null &&
        s.ends_at >= todayDateOnly
    ) ?? null;

  return NextResponse.json(
    {
      halte: {
        id: halte.id,
        name: halte.name,
        tier: halte.tier,
        corridor: halte.corridor,
        lat: halte.lat,
        lng: halte.lng,
        base_price: halte.base_price ?? 0,
        current_bid: halte.current_bid ?? 0,
        is_available: halte.is_available,
        status: deriveStatus({
          is_available: halte.is_available,
          hasActive: current !== null,
        }),
      },
      subscriptions,
      current_subscription: current,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ===========================================================================
// PATCH — toggle is_available (list / delist)
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

  let body: { is_available?: unknown };
  try {
    body = (await req.json()) as { is_available?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }

  if (typeof body.is_available !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "is_available harus boolean." },
      { status: 400 }
    );
  }

  // Confirm halte exists + type='non-brt'. We don't want this endpoint to
  // accidentally toggle a Halte BRT's is_available (which would close an
  // auction silently).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("haltes")
    .select("id, type")
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
  if (existing.type !== "non-brt") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Titik ini bukan bus stop Non-BRT. Halte BRT dikelola lewat modul Lelang.",
      },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("haltes")
    .update({ is_available: body.is_available })
    .eq("id", halteId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
