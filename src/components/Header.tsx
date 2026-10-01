"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Logo from "@/components/brand/Logo";
import { LOGO_ASPECT } from "@/components/brand/logo-path";
import type { InfoPage } from "@/components/modals/InfoModals";
import { useCurrentUser, logout, getInitials } from "@/lib/auth";
import { NETWORK_TOTAL, fmtCount } from "@/lib/network";

interface HeaderProps {
  onOpenInfo?: (page: InfoPage) => void;
  hideNav?: boolean;
}

const navLinks: { label: string; page?: InfoPage; active?: boolean }[] = [
  { label: "Peta", active: true },
  { label: "Harga & Paket", page: "tier" },
  { label: "Cara Kerja", page: "cara-kerja" },
  { label: "Riwayat", page: "riwayat" },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  korporasi: "Korporasi",
  umkm: "UMKM",
};

const DAYS_ID = [
  "MINGGU",
  "SENIN",
  "SELASA",
  "RABU",
  "KAMIS",
  "JUMAT",
  "SABTU",
];
const MONTHS_ID = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
];
const ROMAN_QUARTERS = ["I", "II", "III", "IV"];

// Tanggal & edisi hanya dihitung di client. Server snapshot selalu kosong
// supaya tidak ada hydration mismatch (tanggal SSR bisa beda dengan client).
type DateInfo = { day: string; date: string; edition: string };
const EMPTY_DATE_INFO: DateInfo = { day: "", date: "", edition: "" };
let dateInfoCache: { key: string; value: DateInfo } | null = null;

function getDateInfo(): DateInfo {
  const now = new Date();
  const key = now.toDateString();
  // Snapshot harus stabil (objek yang sama) selama harinya sama.
  if (dateInfoCache?.key === key) return dateInfoCache.value;
  // Edisi = kuartal berjalan dalam angka Romawi (I/II/III/IV) + tahun.
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const value: DateInfo = {
    day: DAYS_ID[now.getDay()],
    date: `${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`,
    edition: `${ROMAN_QUARTERS[quarter - 1]} / ${now.getFullYear()}`,
  };
  dateInfoCache = { key, value };
  return value;
}

const subscribeNoop = () => () => {};

export default function Header({ onOpenInfo, hideNav = false }: HeaderProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dateInfo = useSyncExternalStore(
    subscribeNoop,
    getDateInfo,
    () => EMPTY_DATE_INFO
  );
  const user = useCurrentUser();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const handleNavClick = (page?: InfoPage) => {
    setNavOpen(false);
    if (page) onOpenInfo?.(page);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    // Await so the Supabase signOut request is in-flight before we navigate
    // (otherwise the cookie clear can race with the next page's auth read).
    // Wrapped in try/finally so a network/auth error never strands the user
    // on the dashboard — we always redirect, the cookie clear can happen
    // again on the /login render.
    try {
      await logout();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <header className="masthead">
      <div className="masthead-row">
        <div className="pre-logo">
          <span>
            <span className="dot">●</span> PT TRANSPORTASI JAKARTA
          </span>
          <span>AIRHALTE · PENAMAAN HALTE UNTUK SEMUA</span>
        </div>
        <div className="masthead-meta">
          <span>
            EDISI · <span className="edition">{dateInfo.edition}</span>
          </span>
          <span>
            {dateInfo.day && dateInfo.date
              ? `${dateInfo.day} · ${dateInfo.date}`
              : ""}
          </span>
        </div>
      </div>

      <div className="masthead-main">
        <div className="logo-wrap">
          {/* Tinggi logo diatur lewat --masthead-logo-h di portal.css
              (30px desktop, 24px mobile); lebar mengikuti rasio wordmark. */}
          <Logo
            className="masthead-logo"
            style={{
              height: "var(--masthead-logo-h, 30px)",
              width: `calc(var(--masthead-logo-h, 30px) * ${LOGO_ASPECT})`,
            }}
          />
          <div className="logo-sub">
            <strong>by Transjakarta</strong>
            Marketplace penamaan resmi {fmtCount(NETWORK_TOTAL)} titik
            Transjakarta: peta, lelang, dan langganan.
          </div>
        </div>

        <button
          className="hamburger"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Buka menu navigasi"
          aria-expanded={navOpen}
        >
          <span />
          <span />
          <span />
        </button>

        <nav
          className={`masthead-nav${navOpen ? " open" : ""}`}
          id="mastheadNav"
        >
          {!hideNav &&
            navLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                className={`nav-link${link.active ? " active" : ""}`}
                onClick={() => handleNavClick(link.page)}
              >
                {link.label}
              </button>
            ))}

          {user && user.role === "admin" && (
            <Link
              href="/superadmin"
              className="nav-link"
              style={{ color: "var(--color-accent)", fontWeight: 600 }}
              onClick={() => setNavOpen(false)}
            >
              Superadmin
            </Link>
          )}

          {user && (
            <Link
              href="/dashboard"
              className="nav-link dashboard-cta"
              onClick={() => setNavOpen(false)}
            >
              Dashboard
            </Link>
          )}

          {user ? (
            <div
              className={`user-menu${menuOpen ? " open" : ""}`}
              ref={menuRef}
            >
              <button
                type="button"
                className="user-trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="user-avatar">{getInitials(user.name)}</span>
                <span className="user-name" title={user.name}>
                  {user.name.length > 14
                    ? `${user.name.slice(0, 13)}…`
                    : user.name}
                </span>
                <svg
                  className="user-chevron"
                  viewBox="0 0 14 14"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path
                    d="M3 5.5l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {menuOpen && (
                <div className="user-dropdown" role="menu">
                  <div className="user-dropdown-head">
                    <div className="user-dropdown-name">{user.name}</div>
                    <div className="user-dropdown-email">{user.email}</div>
                    <div className="user-dropdown-role">
                      {ROLE_LABEL[user.role] ?? user.role}
                    </div>
                  </div>
                  <div className="user-dropdown-divider" />
                  <Link
                    href="/favorit"
                    className="user-dropdown-item"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 21s-8-5.4-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.6-8 11-8 11z" />
                    </svg>
                    Favorit Saya
                  </Link>
                  <Link
                    href="/settings"
                    className="user-dropdown-item"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Pengaturan
                  </Link>
                  <button
                    type="button"
                    className="user-dropdown-item danger"
                    role="menuitem"
                    onClick={handleLogout}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                    Keluar
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {!hideNav && (
                <Link
                  href="/favorit"
                  className="nav-link"
                  onClick={() => setNavOpen(false)}
                >
                  Favorit
                </Link>
              )}
              <Link
                href="/login"
                className="nav-link cta"
                onClick={() => setNavOpen(false)}
              >
                Masuk →
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
