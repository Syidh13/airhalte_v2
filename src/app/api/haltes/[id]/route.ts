/**
 * GET /api/haltes/[id]
 *
 * Public endpoint: fetch a single halte row by id. Used by the portal's
 * DetailPanel lazy-load flow — when a user clicks a halte, the panel
 * opens with skeleton UI and this endpoint fills in the rich fields.
 *
 * Data is public-readable via RLS policy `haltes_select_all`, so we use
 * the anon client (no service role) — no auth gate.
 *
 * Cache: sengaja pendek (10 s + SWR 20 s). Status lelang / sewa berubah
 * saat superadmin menutup atau menjadwalkan ulang lelang; cache lama
 * (60 s + SWR 300 s) membuat CTA panel basi beberapa menit. DetailPanel
 * juga membaca endpoint live /bids dan /subscribe (no-store) dan
 * mendahulukan data itu.
 *
 * Record uji (id 'test') tidak pernah dikembalikan (404).
 *
 * Response:
 *   200 { data: <row> }         — found
 *   404 { error: "not found" }  — id unknown
 *   500 { error: <message> }    — supabase / unexpected
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isExcludedHalteId } from "@/data/haltes";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (isExcludedHalteId(id)) {
    return NextResponse.json({ error: "Halte tidak ditemukan" }, { status: 404 });
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("haltes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Halte tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(
    { data },
    {
      headers: {
        "Cache-Control": "public, max-age=10, stale-while-revalidate=20",
      },
    }
  );
}
