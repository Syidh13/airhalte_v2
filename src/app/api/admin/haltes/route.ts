/**
 * /api/admin/haltes
 *
 * Server-side route that uses the SERVICE ROLE key to bypass RLS for
 * superadmin mutations (insert / update / delete) on the haltes table.
 *
 * The service role key is NEVER exposed to the browser — it only lives
 * in .env.local and is only accessible here (server runtime).
 *
 * All requests are gated behind a two-step auth check:
 *   1. The caller's JWT must be valid (getUser, not getSession).
 *   2. That JWT must carry app_metadata.role === "superadmin".
 * Same pattern as src/middleware.ts for /superadmin/*. Without the role
 * check, any authenticated user could mutate the haltes table because
 * this route uses the service role key that bypasses RLS.
 *
 * Aturan harga (lib/pricing.ts) ditegakkan di POST/PUT:
 *   - Halte BRT: base_price = harga dasar per tahun, minimal
 *     PREMIUM_MIN_BASE_PRICE (Rp 100 jt).
 *   - Bus stop Non-BRT: tarif tetap NON_BRT_MONTHLY_PRICE; nilai lain ditolak.
 *   - tier selalu diturunkan dari type (brt → premium, non-brt → mass).
 *   - Hanya kolom master halte yang bisa ditulis lewat route ini; status
 *     lelang (current_bid, jadwal, kontrak) dikelola modul Lelang.
 * Record uji (id 'test') tidak ditampilkan dan tidak bisa dibuat/diubah.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isExcludedHalteId } from "@/data/haltes";
import {
  BID_MAX_AMOUNT,
  NON_BRT_MONTHLY_PRICE,
  PREMIUM_MIN_BASE_PRICE,
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Server client — reads the caller's session from cookies (auth check only)
// ---------------------------------------------------------------------------
async function getSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {/* read-only — no need to set cookies here */},
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Admin client — service role, bypasses RLS
// ---------------------------------------------------------------------------
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ---------------------------------------------------------------------------
// Auth guard — returns null if caller is a superadmin, or an error response.
// 401 when there's no valid session; 403 when the session lacks the role.
// ---------------------------------------------------------------------------
async function requireAuth(): Promise<NextResponse | null> {
  const sessionClient = await getSessionClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Tidak terautentikasi. Silakan login ulang." },
      { status: 401 }
    );
  }
  const role =
    (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  if (role !== "superadmin") {
    return NextResponse.json(
      { error: "Akses ditolak. Hanya superadmin yang diizinkan." },
      { status: 403 }
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payload validation — whitelist kolom master + aturan harga per tipe.
// ---------------------------------------------------------------------------
const WRITABLE_COLUMNS = [
  "id",
  "name",
  "corridor",
  "lat",
  "lng",
  "type",
  "base_price",
  "street_view_url",
  "is_available",
] as const;

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

type Validated =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Saring body ke kolom yang boleh ditulis dan tegakkan aturan harga.
 * `currentType` = tipe baris yang sudah ada (PUT tanpa `type` di body).
 */
function validateHaltePayload(
  body: Record<string, unknown>,
  currentType: string | null
): Validated {
  const payload: Record<string, unknown> = {};
  for (const key of WRITABLE_COLUMNS) {
    if (key in body) payload[key] = body[key];
  }

  const type = (payload.type ?? currentType) as unknown;
  if (type !== "brt" && type !== "non-brt") {
    return { ok: false, error: "Tipe halte harus BRT atau Non-BRT." };
  }
  payload.tier = type === "brt" ? "premium" : "mass";

  if (type === "brt") {
    if ("base_price" in payload || currentType !== "brt") {
      const n = payload.base_price;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < PREMIUM_MIN_BASE_PRICE) {
        return {
          ok: false,
          error: `Harga dasar Halte BRT minimal ${rupiah(PREMIUM_MIN_BASE_PRICE)}/tahun.`,
        };
      }
      if (n > BID_MAX_AMOUNT) {
        return { ok: false, error: `Harga dasar maksimal ${rupiah(BID_MAX_AMOUNT)}.` };
      }
    }
  } else {
    if (
      "base_price" in payload &&
      payload.base_price !== null &&
      Number(payload.base_price) !== NON_BRT_MONTHLY_PRICE
    ) {
      return {
        ok: false,
        error: `Tarif bus stop Non-BRT tetap ${rupiah(NON_BRT_MONTHLY_PRICE)}/bulan dan tidak bisa diubah per titik.`,
      };
    }
    payload.base_price = NON_BRT_MONTHLY_PRICE;
  }

  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// GET — fetch ALL haltes (paginated internally, no PostgREST row cap)
// ---------------------------------------------------------------------------
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const admin = getAdminClient();
  const PAGE = 1000;
  const all: unknown[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("haltes")
      .select("*")
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    all.push(
      ...(data ?? []).filter(
        (row: { id?: string }) => !isExcludedHalteId(row.id)
      )
    );
    if ((data ?? []).length < PAGE) break;
  }

  return NextResponse.json({ data: all });
}

// ---------------------------------------------------------------------------
// POST — insert new halte
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return NextResponse.json({ error: "id wajib ada." }, { status: 400 });
  }
  if (isExcludedHalteId(body.id.trim())) {
    return NextResponse.json({ error: "ID ini dicadangkan." }, { status: 400 });
  }
  const checked = validateHaltePayload(body, null);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("haltes")
    .insert(checked.payload)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update existing halte (id in body)
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400 });
  }
  const { id, ...rest } = body;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id wajib ada." }, { status: 400 });
  }
  if (isExcludedHalteId(id)) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }
  const admin = getAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("haltes")
    .select("id, type")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Halte tidak ditemukan." }, { status: 404 });
  }
  const checked = validateHaltePayload(rest, existing.type as string);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const { data, error } = await admin
    .from("haltes")
    .update(checked.payload)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

// ---------------------------------------------------------------------------
// DELETE — delete halte by id (?id=xxx)
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id wajib ada." }, { status: 400 });
  }
  const admin = getAdminClient();
  const { error } = await admin.from("haltes").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
