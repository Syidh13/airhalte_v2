"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Ticker from "@/components/Ticker";
import InfoModals, { type InfoPage } from "@/components/modals/InfoModals";
import PreferencePills from "@/components/settings/PreferencePills";
import PasswordChangeForm from "@/components/settings/PasswordChangeForm";
import {
  CompanyProfileGroups,
  useCompanyProfile,
} from "@/components/settings/CompanyProfile";
import { emitInfoToast } from "@/components/FavoriteToaster";
import { useAuthResolved, useAuthSync, logout, type User } from "@/lib/auth";

const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

export default function SettingsPortalPage() {
  const router = useRouter();
  const user = useAuthSync();
  const authResolved = useAuthResolved();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer
  );
  const [infoPage, setInfoPage] = useState<InfoPage | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("allow-scroll");
    document.body.classList.add("allow-scroll");
    return () => {
      document.documentElement.classList.remove("allow-scroll");
      document.body.classList.remove("allow-scroll");
    };
  }, []);

  // Redirect hanya setelah sesi awal selesai dicek (cache sessionStorage bisa
  // kosong di tab baru atau saat kembali dari link reset password).
  useEffect(() => {
    if (mounted && authResolved && !user) router.replace("/login");
  }, [mounted, authResolved, user, router]);

  return (
    <div className="app-root scrollable set-page">
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
        }}
      >
        <Ticker />
        <Header onOpenInfo={setInfoPage} hideNav />
      </div>

      <div style={{ paddingTop: 180 }}>
        {mounted && user && <SettingsBody user={user} router={router} />}
      </div>

      <InfoModals open={infoPage} onClose={() => setInfoPage(null)} />
    </div>
  );
}

interface SettingsBodyProps {
  user: User;
  router: ReturnType<typeof useRouter>;
}

function SettingsBody({ user, router }: SettingsBodyProps) {
  const profile = useCompanyProfile(user.id);
  // Datang dari link reset password (/auth/callback → /settings?reset=1):
  // form ganti password langsung terbuka. Komponen ini hanya dirender di
  // client (lihat `mounted`), jadi aman membaca window di sini.
  const [fromReset] = useState(
    () => new URLSearchParams(window.location.search).get("reset") === "1"
  );
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogoutAll = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    emitInfoToast("Semua sesi telah dikeluarkan");
    setTimeout(() => {
      window.location.href = "/login";
    }, 1200);
  };

  return (
    <div className="set-shell">
      <button
        type="button"
        className="set-back"
        onClick={() => router.push("/")}
      >
        ← Kembali ke Peta
      </button>

      <header className="set-head">
        <div className="set-head-kicker">Pengaturan</div>
        <h1 className="set-head-title">
          Atur akun &amp; <em>preferensi</em>.
        </h1>
      </header>

      {/* DATA PERUSAHAAN + PERSON IN CHARGE (read-only, dari database) */}
      <CompanyProfileGroups profile={profile} email={user.email} />

      {/* KEAMANAN AKUN */}
      <div className="set-group">
        <div className="set-group-label">Keamanan Akun</div>
        <div className="set-card">
          <PasswordChangeForm initiallyOpen={fromReset} />

          <hr className="set-divider" />

          <div>
            <div className="set-row-title">Sesi aktif</div>
            <p className="set-row-sub">
              Keluar dari semua perangkat yang sedang memakai akun ini.
            </p>
            <div className="set-danger-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="set-btn set-btn-danger"
                onClick={handleLogoutAll}
                disabled={loggingOut}
              >
                {loggingOut ? "Memproses…" : "Keluar semua sesi"}
              </button>
            </div>
            <p className="set-readonly-note">
              Penghapusan akun diajukan ke admin TJ.
            </p>
          </div>
        </div>
      </div>

      {/* PREFERENSI */}
      <div className="set-group">
        <div className="set-group-label">Preferensi</div>
        <div className="set-card">
          <PreferencePills />
        </div>
      </div>
    </div>
  );
}
