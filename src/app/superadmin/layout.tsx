import type { ReactNode } from "react";
import SuperadminSidebar from "@/components/superadmin/SuperadminSidebar";
import SuperadminTopbar from "@/components/superadmin/SuperadminTopbar";

/**
 * Layout for /superadmin/*. Auth/role gating happens in src/proxy.ts (Next 16
 * pengganti middleware.ts) — by the time we render here, the user is a
 * superadmin. Data tetap dilindungi RLS + requireSuperadmin() di API.
 */
export default function SuperadminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sa-shell">
      <SuperadminSidebar />
      <div className="sa-main">
        <SuperadminTopbar />
        <main className="sa-content">{children}</main>
      </div>
    </div>
  );
}
