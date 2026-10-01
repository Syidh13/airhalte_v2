/**
 * GET /api/admin/subscriptions?status=available|active|delisted
 *
 * Phase 6 — sibling to /api/admin/auctions but for bus stop Non-BRT
 * (internal mode "mass"). The subscription itself is still represented by
 * rows in `subscriptions` keyed to a halte; this endpoint returns Non-BRT
 * points paired with whichever subscription is currently active (if any).
 * Record uji (id 'test') tidak ikut.
 *
 *   active    — there's a subscription currently in status='active' with
 *               ends_at >= today (regardless of is_available — a halte that
 *               was delisted mid-tenancy still counts as actively rented).
 *   available — is_available=true AND no active subscription. Free to rent.
 *   delisted  — is_available=false AND no active subscription
 *               (toggled off by superadmin, not currently tenanted).
 *
 * (No "expired" bucket — once a subscription's ends_at falls in the past
 *  the halte automatically reappears in "available". The history is still
 *  visible from the detail modal.)
 *
 * Auth: superadmin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isExcludedHalteId } from "@/data/haltes";

const PAGE_SIZE = 1000;

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

export type SubscriptionListStatus = "available" | "active" | "delisted";

interface HalteRow {
  id: string;
  name: string;
  corridor: string | null;
  base_price: number;
  is_available: boolean;
}

/** Subscription row joined with the company that owns it. The first
    PIC contact is flattened by the route into a `pic` field. */
interface SubRow {
  id: string;
  halte_id: string;
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
}

interface CurrentSub {
  id: string;
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct: number;
  starts_at: string | null;
  ends_at: string | null;
  company: { id: string; company_name: string } | null;
  pic: { name: string; email: string } | null;
}

export async function GET(req: NextRequest) {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  const statusFilter = req.nextUrl.searchParams.get(
    "status"
  ) as SubscriptionListStatus | null;
  const validFilters = new Set<SubscriptionListStatus>([
    "available",
    "active",
    "delisted",
  ]);

  // 1. Pull every Non-BRT point. Paginated to handle the ~7.3k fleet.
  const haltes: HalteRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("haltes")
      .select("id, name, corridor, base_price, is_available")
      .eq("type", "non-brt")
      .order("name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as HalteRow[];
    haltes.push(...page.filter((h) => !isExcludedHalteId(h.id)));
    if (page.length < PAGE_SIZE) break;
  }

  // 2. Pull every CURRENTLY-ACTIVE subscription joined with company + PIC.
  // We don't filter by halte_id because (a) we want the index lookup to
  // be quick, (b) at most 1 active sub per halte (UI assumption), and
  // (c) the un-blind join is cheap at the active-sub volume. Paginated so
  // the PostgREST 1000-row cap can't silently drop tenants.
  const todayDateOnly = new Date().toISOString().slice(0, 10);
  const activeRaw: SubRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error: subsError } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, halte_id, duration_months, monthly_price, total_price, discount_pct, status, starts_at, ends_at, created_at, " +
          "company:companies(id, company_name, contacts(name, email))"
      )
      .eq("status", "active")
      .gte("ends_at", todayDateOnly)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (subsError) {
      return NextResponse.json({ error: subsError.message }, { status: 500 });
    }
    const page = (data ?? []) as unknown as SubRow[];
    activeRaw.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const activeByHalteId = new Map<string, CurrentSub>();
  for (const s of activeRaw) {
    activeByHalteId.set(s.halte_id, {
      id: s.id,
      duration_months: s.duration_months,
      monthly_price: s.monthly_price,
      total_price: s.total_price,
      discount_pct: s.discount_pct ?? 0,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      company: s.company
        ? { id: s.company.id, company_name: s.company.company_name }
        : null,
      pic: s.company?.contacts?.[0]
        ? {
            name: s.company.contacts[0].name,
            email: s.company.contacts[0].email,
          }
        : null,
    });
  }

  // 3. Project + filter.
  const subscriptions = haltes
    .map((h) => {
      const active = activeByHalteId.get(h.id) ?? null;
      // Active subscription takes priority — a halte that's been delisted
      // by superadmin while a tenant is still in the contract should still
      // surface in the "Sedang Disewa" bucket, not "Tidak Aktif".
      const status: SubscriptionListStatus = active
        ? "active"
        : !h.is_available
          ? "delisted"
          : "available";
      return {
        halte_id: h.id,
        halte_name: h.name,
        corridor: h.corridor,
        base_price: h.base_price ?? 0,
        is_available: h.is_available,
        current_subscription: active,
        status,
      };
    })
    .filter((row) => {
      if (!statusFilter) return true;
      if (!validFilters.has(statusFilter)) return true;
      return row.status === statusFilter;
    });

  return NextResponse.json(
    { subscriptions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
