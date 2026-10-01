"use client";

import Link from "next/link";
import Logo from "@/components/brand/Logo";
import { useAuthSync, type User } from "@/lib/auth";

/**
 * Phase 6e: tightened DashView union — removed `delivery`, `haltes`,
 * `engagement` because their pages are still mock Kopi Kenangan data
 * and not relevant to the Direksi demo. The components remain on disk
 * but are unreachable from the nav. Reports & Invoices stays as a
 * "Coming soon" placeholder until tracking + payment integration land.
 */
export type DashView =
  | "overview"
  | "bids"
  | "subscriptions"
  | "reports"
  | "settings";

/** Halte the user has a real stake in — derived in dashboard/page.tsx
    from /api/dashboard/my-bids + /api/dashboard/my-subscriptions and
    passed down so the Sidebar dropdown reflects real portfolio. */
export interface SponsoredHalte {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  /** "subscription" wins over "auction" when the same halte appears in
      both — same priority rule the Overview page uses. */
  kind: "subscription" | "auction";
}

interface SidebarProps {
  currentView: DashView;
  onChangeView: (view: DashView) => void;
  currentHalte: string;
  onChangeHalte: (id: string) => void;
  open: boolean;
  onClose: () => void;
  sponsoredHaltes: SponsoredHalte[];
  /** True while the parent fetches my-bids + my-subscriptions for the
      first time — disables the dropdown so the user doesn't see a
      flash of "Belum ada halte" before the real list lands. */
  portfolioLoading: boolean;
}

const NAV_ITEMS: {
  section: string;
  items: { key: DashView; label: string; icon: React.ReactNode }[];
}[] = [
  {
    section: "Portofolio",
    items: [
      {
        key: "overview",
        label: "Ringkasan",
        icon: (
          <svg className="dash-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />
          </svg>
        ),
      },
      {
        key: "bids",
        label: "Lelang Saya",
        icon: (
          <svg className="dash-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h18M3 12h18M3 17h12" />
            <path d="M17 17l3 3 3-3" />
          </svg>
        ),
      },
      {
        key: "subscriptions",
        label: "Langganan Saya",
        icon: (
          <svg className="dash-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18" />
            <path d="M8 3v4M16 3v4" />
            <path d="M9 15l2 2 4-4" />
          </svg>
        ),
      },
    ],
  },
  {
    section: "Akun",
    items: [
      {
        key: "reports",
        label: "Laporan & Tagihan",
        icon: (
          <svg className="dash-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
        ),
      },
      {
        key: "settings",
        label: "Pengaturan",
        icon: (
          <svg className="dash-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
    ],
  },
];

const STATUS_LABEL: Record<NonNullable<User["status"]>, string> = {
  active: "terverifikasi",
  pending: "menunggu verifikasi",
  rejected: "ditolak",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({
  currentView,
  onChangeView,
  currentHalte,
  onChangeHalte,
  open,
  onClose,
  sponsoredHaltes,
  portfolioLoading,
}: SidebarProps) {
  const user = useAuthSync();
  const sponsorName = user?.name ?? "Sponsor";
  const haltesCount = sponsoredHaltes.length;
  // Status string lives next to the halte count — pulls from the company
  // status (`active` / `pending` / `rejected`) when known, falls back to
  // the role for legacy users. Keeps the chrome from saying "0 halte"
  // when the dashboard first mounts, before fetch resolves.
  const accountTier = user?.status
    ? STATUS_LABEL[user.status]
    : user?.role ?? "—";

  return (
    <>
      <aside
        className={`dash-sidebar${open ? " open" : ""}`}
        id="dashSidebar"
      >
        <div className="dash-sidebar-header">
          <div className="dash-sidebar-logo">
            <Logo tone="white" height={22} />
          </div>
          <div className="dash-sidebar-sub">Dashboard</div>
        </div>

        <div className="dash-sponsor-block">
          <div className="dash-sponsor-label">Akun Aktif</div>
          <div className="dash-sponsor-identity">
            <div className="dash-sponsor-avatar">{getInitials(sponsorName)}</div>
            <div>
              <div className="dash-sponsor-name">{sponsorName}</div>
              <div className="dash-sponsor-meta">
                {portfolioLoading
                  ? "Memuat halte…"
                  : `${haltesCount} halte disponsori · ${accountTier}`}
              </div>
            </div>
          </div>
          <select
            className="dash-halte-switcher"
            value={currentHalte}
            onChange={(e) => onChangeHalte(e.target.value)}
            aria-label="Pilih halte"
            disabled={portfolioLoading || haltesCount === 0}
          >
            <option value="all">
              {haltesCount === 0
                ? "Belum ada halte disponsori"
                : `Semua halte (${haltesCount})`}
            </option>
            {sponsoredHaltes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.kind === "subscription" ? "langganan" : "lelang"}
              </option>
            ))}
          </select>
        </div>

        <nav className="dash-nav">
          {NAV_ITEMS.map((sec) => (
            <div key={sec.section}>
              <div className="dash-nav-section">{sec.section}</div>
              {sec.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={`dash-nav-item${
                    currentView === it.key ? " active" : ""
                  }`}
                  onClick={() => {
                    onChangeView(it.key);
                    onClose();
                  }}
                >
                  {it.icon}
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <Link href="/" className="dash-back-btn">
          ← Kembali ke Peta
        </Link>

        <div className="dash-sidebar-footer">
          <div className="dash-contract-status">
            <span className="dot" />
            <span className="lbl">
              {haltesCount > 0 ? "Portfolio Aktif" : "Belum ada portfolio"}
            </span>
          </div>
          <div className="dash-contract-info">
            {haltesCount > 0
              ? `${haltesCount} halte di-sponsor`
              : "Buka peta untuk ikut lelang atau berlangganan."}
          </div>
        </div>
      </aside>

      <div
        className={`dash-sidebar-backdrop${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
    </>
  );
}
