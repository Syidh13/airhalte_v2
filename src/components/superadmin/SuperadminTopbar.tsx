"use client";

import { usePathname } from "next/navigation";
import { getInitials, logout, useCurrentUser } from "@/lib/auth";

const TITLES: Record<string, string> = {
  "/superadmin/dashboard": "Dashboard",
  "/superadmin/companies": "Verifikasi Perusahaan",
  "/superadmin/haltes": "Manajemen Halte",
  "/superadmin/auctions": "Lelang Halte BRT",
  "/superadmin/subscriptions": "Langganan Non-BRT",
  "/superadmin/bids": "Bid & Langganan",
};

export default function SuperadminTopbar() {
  const pathname = usePathname() ?? "";
  const user = useCurrentUser();

  const title =
    Object.entries(TITLES).find(([href]) => pathname.startsWith(href))?.[1] ??
    "Superadmin";

  const handleLogout = async () => {
    // try/finally — guarantees the redirect runs even if logout() throws
    // or the underlying signOut() hangs past its 1.5s race timeout.
    try {
      await logout();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <header className="sa-topbar">
      <h1 className="sa-topbar-title">{title}</h1>
      <div className="sa-topbar-user">
        {user && (
          <>
            <div className="sa-user-info">
              <div className="sa-user-name">{user.name}</div>
              <div className="sa-user-email">{user.email}</div>
            </div>
            <span className="sa-user-avatar">{getInitials(user.name)}</span>
          </>
        )}
        <button
          type="button"
          className="sa-logout-btn"
          onClick={handleLogout}
        >
          Keluar
        </button>
      </div>
    </header>
  );
}
