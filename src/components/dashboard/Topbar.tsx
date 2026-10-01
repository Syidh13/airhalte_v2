"use client";

import { getInitials, type User } from "@/lib/auth";
import type { DashView } from "./Sidebar";

interface TopbarProps {
  currentView: DashView;
  user: User | null;
  onOpenSidebar: () => void;
}

const VIEW_LABELS: Record<DashView, string> = {
  overview: "Ringkasan",
  bids: "Lelang Saya",
  subscriptions: "Langganan Saya",
  reports: "Laporan & Tagihan",
  settings: "Pengaturan",
};

export default function Topbar({ currentView, user, onOpenSidebar }: TopbarProps) {
  return (
    <div className="dash-topbar">
      <div className="dash-topbar-left">
        <button
          type="button"
          className="dash-hamburger"
          onClick={onOpenSidebar}
          aria-label="Buka menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div className="dash-breadcrumb">
          <span>Dashboard</span> ·{" "}
          <span className="current">{VIEW_LABELS[currentView]}</span>
        </div>
      </div>
      <div className="dash-topbar-right">
        {/* Filter periode & tombol Export disembunyikan: belum ada data
            performa maupun fitur ekspor di balik tombol itu. */}
        {user && (
          <div className="dash-topbar-user">
            <span className="dash-topbar-user-avatar">
              {getInitials(user.name)}
            </span>
            <span className="dash-topbar-user-name">{user.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}
