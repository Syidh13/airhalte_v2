"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/brand/Logo";

const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/superadmin/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/superadmin/companies",
    label: "Perusahaan",
    icon: (
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
        <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
      </svg>
    ),
  },
  {
    href: "/superadmin/haltes",
    label: "Halte",
    icon: (
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 21s-8-7.58-8-13a8 8 0 0 1 16 0c0 5.42-8 13-8 13z" />
        <circle cx="12" cy="8" r="3" />
      </svg>
    ),
  },
  {
    href: "/superadmin/auctions",
    label: "Lelang",
    icon: (
      // Gavel — sits well next to "Halte" without crowding the next icon.
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4l6 6" />
        <path d="M9 9l4-4 6 6-4 4z" />
        <path d="M3 21h11" />
        <path d="M11 13l-5 5 2 2 5-5" />
      </svg>
    ),
  },
  {
    href: "/superadmin/subscriptions",
    label: "Langganan",
    icon: (
      // Calendar with check — recurring rental, distinct from gavel.
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 3v4M16 3v4" />
        <path d="M9 15l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/superadmin/bids",
    label: "Bid & Langganan",
    icon: (
      <svg className="sa-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
];

export default function SuperadminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sa-sidebar" aria-label="Navigasi superadmin">
      <div className="sa-sidebar-head">
        <div className="sa-logo">
          <Logo tone="white" height={22} />
        </div>
        <span className="sa-badge">SUPERADMIN</span>
      </div>

      <nav className="sa-nav">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sa-nav-item${active ? " active" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Link href="/" className="sa-back">
        ← Kembali ke Peta
      </Link>
    </aside>
  );
}
