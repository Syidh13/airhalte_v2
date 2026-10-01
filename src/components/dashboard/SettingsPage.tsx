"use client";

import { useMemo } from "react";
import PreferencePills from "@/components/settings/PreferencePills";
import {
  CompanyProfileGroups,
  useCompanyProfile,
} from "@/components/settings/CompanyProfile";
import { useAuthSync } from "@/lib/auth";
import type { MyBid, MySub } from "@/app/dashboard/page";

interface SettingsPageProps {
  /** Portofolio yang sudah dimuat dashboard/page.tsx (my-bids + my-subscriptions). */
  bids: MyBid[];
  subs: MySub[];
  portfolioLoading: boolean;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function SettingsPage({
  bids,
  subs,
  portfolioLoading,
}: SettingsPageProps) {
  const user = useAuthSync();
  const profile = useCompanyProfile(user?.id);
  const brandName =
    profile.status === "ready" && profile.company
      ? profile.company.company_name
      : null;

  // Ringkasan kontrak dari data nyata (bukan angka contoh).
  const contract = useMemo(() => {
    const activeSubs = subs.filter((s) => s.status === "active");
    const nonBrtPoints = new Set(
      activeSubs.map((s) => s.halte?.id).filter(Boolean)
    ).size;
    const wonHaltes = new Set(
      bids.filter((b) => b.status === "won").map((b) => b.halte?.id).filter(Boolean)
    ).size;
    const nextEnd =
      activeSubs
        .map((s) => s.ends_at)
        .filter((d): d is string => Boolean(d))
        .sort()[0] ?? null;
    return { nonBrtPoints, wonHaltes, nextEnd };
  }, [bids, subs]);

  const contractRows: Array<{ label: string; value: string }> = portfolioLoading
    ? [{ label: "Kontrak", value: "Memuat…" }]
    : [
        {
          label: "Langganan Non-BRT aktif",
          value:
            contract.nonBrtPoints > 0
              ? `${contract.nonBrtPoints} titik`
              : "Belum ada",
        },
        {
          label: "Halte BRT (lelang dimenangkan)",
          value:
            contract.wonHaltes > 0 ? `${contract.wonHaltes} halte` : "Belum ada",
        },
        {
          label: "Langganan terdekat berakhir",
          value: contract.nextEnd ? formatDate(contract.nextEnd) : "—",
        },
      ];

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Pengaturan</div>
          <h1 className="dash-page-title">Pengaturan akun.</h1>
          <p className="dash-page-subtitle">
            Profil perusahaan, ringkasan kontrak, dan tampilan.
          </p>
        </div>
      </div>

      <div className="set-shell">
        {/* NAMA BRAND */}
        <div className="set-group">
          <div className="set-group-label">Nama Brand</div>
          <div className="set-card">
            <div className="set-brand-current">
              <span className="set-brand-current-label">Brand saat ini</span>
              <span className="set-brand-current-value">{brandName ?? "—"}</span>
            </div>
            <p
              className="set-row-sub"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              Diambil dari nama perusahaan terdaftar. Perubahan nama brand
              diajukan ke admin TJ.
            </p>
          </div>
        </div>

        {/* DATA PERUSAHAAN + PIC (read-only, dari database) */}
        <CompanyProfileGroups profile={profile} email={user?.email ?? ""} />

        {/* INFO KONTRAK (dari my-bids + my-subscriptions) */}
        <div className="set-group">
          <div className="set-group-label">Info Kontrak</div>
          <div className="set-card muted">
            {contractRows.map((row) => (
              <div key={row.label} className="set-info-row">
                <span className="set-info-label">{row.label}</span>
                <span className="set-info-value">{row.value}</span>
              </div>
            ))}
            <p className="set-readonly-note">
              Untuk perubahan kontrak, hubungi admin TJ.
            </p>
          </div>
        </div>

        {/* PREFERENSI TAMPILAN */}
        <div className="set-group">
          <div className="set-group-label">Preferensi Tampilan</div>
          <div className="set-card">
            <PreferencePills />
          </div>
        </div>
      </div>
    </div>
  );
}
