/**
 * POST /api/register
 *
 * Atomic server-side registration. Replaces the old client-side chain
 * (browser signUp → browser insert) which was broken by RLS + email
 * confirmation: the inserts ran before the JWT's `email_verified` was
 * true, so `companies_insert_self` rejected them with a 400.
 *
 * Flow:
 *   1. Validate payload.
 *   2. Create the auth user via a server-side anon client `auth.signUp()`.
 *      We use signUp (not admin.createUser) because Supabase only sends
 *      the confirmation email from the /signup endpoint — admin.createUser
 *      creates the row but never emails the user.
 *   3. Insert into `companies` and `contacts` using the service-role
 *      admin client, which bypasses RLS. Rolls back (delete company +
 *      auth user) if a step fails mid-flight.
 *
 * Email confirmation: kalau fitur konfirmasi email di Supabase aktif, user
 * harus klik link dulu (→ /auth/callback → /login?status=pending). Saat ini
 * fitur itu OFF, jadi signUp langsung mengembalikan sesi dan hanya verifikasi
 * admin TJ (status perusahaan) yang tersisa. Response memberi tahu UI mana
 * yang berlaku lewat `needsEmailConfirmation`.
 *
 * Response: 200 { ok: true, needsEmailConfirmation: boolean }
 *           4xx/5xx { ok: false, error }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  isValidNpwp,
  normalizeWebsite,
  NPWP_ERROR_MESSAGE,
} from "@/lib/registrations";

interface RegisterPayload {
  email: string;
  password: string;
  companyName: string;
  bidangUsaha: string;
  npwp: string;
  website: string;
  picName: string;
  picRole: string;
  picPhone: string;
}

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Parse + validate
  // -------------------------------------------------------------------------
  let body: Partial<RegisterPayload>;
  try {
    body = (await req.json()) as Partial<RegisterPayload>;
  } catch {
    return err(400, "Body permintaan tidak valid.");
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const companyName = (body.companyName ?? "").trim();
  const bidangUsaha = (body.bidangUsaha ?? "").trim();
  const npwp = (body.npwp ?? "").trim();
  const website = normalizeWebsite(body.website ?? "");
  const picName = (body.picName ?? "").trim();
  const picRole = (body.picRole ?? "").trim();
  const picPhone = (body.picPhone ?? "").trim();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return err(400, "Format email tidak valid.");
  }
  if (password.length < 8) {
    return err(400, "Password minimal 8 karakter.");
  }
  if (companyName.length < 3) {
    return err(400, "Nama perusahaan minimal 3 karakter.");
  }
  if (!bidangUsaha) {
    return err(400, "Bidang usaha wajib dipilih.");
  }
  if (!isValidNpwp(npwp)) {
    return err(400, NPWP_ERROR_MESSAGE);
  }
  if (website === null) {
    return err(400, "Alamat website tidak valid (gunakan http:// atau https://).");
  }
  if (picName.length < 3 || !picRole || !picPhone) {
    return err(400, "Data PIC belum lengkap.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return err(500, "Konfigurasi server belum lengkap.");
  }

  // -------------------------------------------------------------------------
  // 2. Create the auth user (signUp triggers the confirmation email)
  // -------------------------------------------------------------------------
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await anonClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${req.nextUrl.origin}/auth/callback?next=/login?verified=1`,
    },
  });

  if (authError) {
    if (/already|registered|exists/i.test(authError.message)) {
      return err(409, "Email sudah terdaftar. Silakan login atau gunakan email lain.");
    }
    if (/password/i.test(authError.message)) {
      return err(400, "Password tidak memenuhi syarat.");
    }
    if (/email/i.test(authError.message)) {
      return err(400, "Format email tidak valid.");
    }
    return err(400, `Gagal membuat akun: ${authError.message}`);
  }

  if (!authData.user) {
    return err(500, "Gagal membuat akun. Silakan coba lagi.");
  }

  // Supabase's email-enumeration guard: when the address already belongs to
  // a confirmed user, signUp succeeds "softly" with an empty identities[].
  // Treat that as a duplicate so we don't create a dangling companies row.
  if (authData.user.identities && authData.user.identities.length === 0) {
    return err(409, "Email sudah terdaftar. Silakan login atau gunakan email lain.");
  }

  const userId = authData.user.id;

  // -------------------------------------------------------------------------
  // 3. Insert company + contact via service-role client (bypasses RLS)
  // -------------------------------------------------------------------------
  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .insert({
      auth_user_id: userId,
      company_name: companyName,
      bidang_usaha: bidangUsaha,
      npwp,
      website: website || null,
      status: "pending",
    })
    .select("id")
    .single();

  if (companyError || !company) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return err(
      500,
      "Gagal menyimpan data perusahaan. Silakan coba lagi."
    );
  }

  const { error: contactError } = await supabaseAdmin.from("contacts").insert({
    company_id: company.id,
    name: picName,
    role: picRole,
    email,
    phone: picPhone,
  });

  if (contactError) {
    await supabaseAdmin.from("companies").delete().eq("id", company.id);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return err(500, "Gagal menyimpan data PIC. Silakan coba lagi.");
  }

  // Tanpa sesi berarti Supabase menunggu konfirmasi email lebih dulu.
  return NextResponse.json({
    ok: true,
    needsEmailConfirmation: !authData.session,
  });
}
