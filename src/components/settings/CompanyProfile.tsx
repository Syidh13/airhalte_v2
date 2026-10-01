"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fetchWithRetry, supabase } from "@/lib/supabase";
import { formatNpwp } from "@/lib/registrations";

// ============================================================================
// Data perusahaan & PIC milik user yang login, dibaca dari tabel `companies`
// (+ relasi `contacts`) lewat RLS "select own". Dipakai /settings dan tab
// Pengaturan di dashboard.
//
// Sengaja READ-ONLY: nama perusahaan dan NPWP sudah diverifikasi admin TJ,
// jadi perubahan diajukan ke admin TJ, bukan disimpan sendiri dari sini.
// Kolom `status` tidak pernah dikirim dari client.
// ============================================================================

export interface CompanyContact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface CompanyProfile {
  company_name: string;
  bidang_usaha: string;
  npwp: string;
  website: string | null;
  status: "pending" | "active" | "rejected";
  contacts: CompanyContact[] | null;
}

export type CompanyProfileState =
  | { status: "loading" }
  | { status: "ready"; company: CompanyProfile | null }
  | { status: "error" };

type SettledState = Exclude<CompanyProfileState, { status: "loading" }>;

/** Muat data perusahaan milik `userId` (auth.users.id). */
export function useCompanyProfile(
  userId: string | null | undefined
): CompanyProfileState {
  // Hasil disimpan bersama id pemiliknya, jadi saat userId berganti state
  // otomatis kembali "loading" tanpa setState sinkron di dalam effect.
  const [result, setResult] = useState<{
    forId: string;
    state: SettledState;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchWithRetry(
      () =>
        supabase
          .from("companies")
          .select(
            "company_name, bidang_usaha, npwp, website, status, contacts(name, role, email, phone)"
          )
          .eq("auth_user_id", userId)
          .maybeSingle(),
      8_000,
      "load company profile"
    ).then(
      ({ data, error }) => {
        if (cancelled) return;
        setResult({
          forId: userId,
          state: error
            ? { status: "error" }
            : {
                status: "ready",
                company: (data as CompanyProfile | null) ?? null,
              },
        });
      },
      () => {
        if (!cancelled) setResult({ forId: userId, state: { status: "error" } });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || !result || result.forId !== userId) return { status: "loading" };
  return result.state;
}

const STATUS_TEXT: Record<CompanyProfile["status"], string> = {
  active: "Terverifikasi",
  pending: "Menunggu verifikasi admin TJ",
  rejected: "Ditolak",
};

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="set-info-row">
      <span className="set-info-label">{label}</span>
      <span className="set-info-value">{value}</span>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-group">
      <div className="set-group-label">{label}</div>
      <div className="set-card">{children}</div>
    </div>
  );
}

/**
 * Dua kartu read-only: "Data Perusahaan" dan "Person in Charge".
 * `email` = email akun (login), yang juga dipakai sebagai email PIC saat daftar.
 */
export function CompanyProfileGroups({
  profile,
  email,
}: {
  profile: CompanyProfileState;
  email: string;
}) {
  if (profile.status !== "ready" || !profile.company) {
    const message =
      profile.status === "loading"
        ? "Memuat data perusahaan…"
        : profile.status === "error"
          ? "Data perusahaan belum dapat dimuat. Coba muat ulang halaman."
          : "Akun ini belum terhubung ke data perusahaan.";
    return (
      <Group label="Data Perusahaan">
        <p className="set-row-sub">{message}</p>
      </Group>
    );
  }

  const company = profile.company;
  const pic = company.contacts?.[0];
  return (
    <>
      <Group label="Data Perusahaan">
        <InfoRow label="Nama perusahaan" value={company.company_name} />
        <InfoRow label="Bidang usaha" value={company.bidang_usaha || "—"} />
        <InfoRow label="NPWP" value={company.npwp ? formatNpwp(company.npwp) : "—"} />
        <InfoRow label="Website" value={company.website || "—"} />
        <InfoRow
          label="Status verifikasi"
          value={STATUS_TEXT[company.status] ?? company.status}
        />
        <p className="set-readonly-note">
          Perubahan data perusahaan diajukan ke admin TJ.
        </p>
      </Group>

      <Group label="Person in Charge">
        <InfoRow label="Nama PIC" value={pic?.name || "—"} />
        <InfoRow label="Jabatan" value={pic?.role || "—"} />
        <InfoRow label="Email akun" value={email || "—"} />
        <InfoRow label="No. telepon kantor" value={pic?.phone || "—"} />
        <p className="set-readonly-note">
          Perubahan data PIC dan email akun diajukan ke admin TJ.
        </p>
      </Group>
    </>
  );
}
