/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Superadmin tool to reset a user's password AND force-confirm their email
 * in one shot. Two real-world use cases:
 *
 *   1. PIC forgot their password → superadmin sets a new one, hands it
 *      back via secure channel.
 *   2. PIC signed up while email confirmations were ON, then the toggle
 *      was flipped OFF in the dashboard. Their email_confirmed_at is
 *      stuck at NULL forever and they can't log in. `email_confirm: true`
 *      on the admin update sets it to NOW() if previously null; no-op if
 *      already confirmed.
 *
 * Path param:
 *   [id] = auth.users.id (UUID)
 *
 * Body:
 *   { password: string } — must be ≥ 8 chars
 *
 * Auth gate: same pattern as /api/admin/haltes — caller's JWT must carry
 * app_metadata.role === "superadmin". 401 if no session, 403 if wrong role.
 *
 * Response:
 *   200 { ok: true, emailWasConfirmed: boolean }
 *        — emailWasConfirmed is `true` if THIS call flipped the email from
 *          unconfirmed to confirmed (lets the UI show a secondary toast).
 *   400 { ok: false, error: "..." }   — bad body / weak password
 *   401 / 403                          — not authenticated / not superadmin
 *   404 { ok: false, error: "..." }   — user id unknown
 *   500 { ok: false, error: "..." }   — supabase / unexpected
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ---------------------------------------------------------------------------
// Auth guard — mirrors /api/admin/haltes. getUser() validates the JWT
// against Supabase (vs getSession() which just reads the cookie).
// ---------------------------------------------------------------------------
async function requireSuperadmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Simpan cookie hasil refresh (kalau ada) supaya sesi browser tetap sah.
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* abaikan */
          }
        },
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Hanya terima JSON. Menutup celah CSRF lewat <form enctype="text/plain">
  // yang body-nya bisa dibentuk menyerupai JSON (fetch dari UI selalu JSON).
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { ok: false, error: "Content-Type harus application/json." },
      { status: 415 }
    );
  }

  const authError = await requireSuperadmin();
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "User id wajib ada di path." },
      { status: 400 }
    );
  }

  // Parse + validate body
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body permintaan tidak valid." },
      { status: 400 }
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Password minimal 8 karakter." },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // 1. Look up the user FIRST so we can tell whether email_confirmed_at was
  //    null before this call. The UI uses this to decide whether to show the
  //    "Email terverifikasi" secondary message.
  // -------------------------------------------------------------------------
  const { data: before, error: beforeError } =
    await supabaseAdmin.auth.admin.getUserById(id);

  if (beforeError) {
    // The Supabase client returns a 404-ish error when the id doesn't exist
    // (status 404 on the underlying response). Surface it as a 404.
    const status = (beforeError as { status?: number }).status === 404 ? 404 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 404
            ? "User tidak ditemukan."
            : `Gagal membaca user: ${beforeError.message}`,
      },
      { status }
    );
  }
  if (!before?.user) {
    return NextResponse.json(
      { ok: false, error: "User tidak ditemukan." },
      { status: 404 }
    );
  }

  const wasUnconfirmed = !before.user.email_confirmed_at;

  // -------------------------------------------------------------------------
  // 2. Apply the password + email confirmation in one admin call.
  //    `email_confirm: true` flips email_confirmed_at to NOW() if previously
  //    null; harmless no-op if the email is already confirmed.
  // -------------------------------------------------------------------------
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    id,
    { password, email_confirm: true }
  );

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: `Gagal reset password: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, emailWasConfirmed: wasUnconfirmed });
}
