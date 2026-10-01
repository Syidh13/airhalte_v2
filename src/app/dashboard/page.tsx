"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import BidsPage from "@/components/dashboard/BidsPage";
import OverviewPage from "@/components/dashboard/OverviewPage";
import ReportsPage from "@/components/dashboard/ReportsPage";
import SettingsPage from "@/components/dashboard/SettingsPage";
import SubscriptionsPage from "@/components/dashboard/SubscriptionsPage";
import Sidebar, {
  type DashView,
  type SponsoredHalte,
} from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import { useAuthResolved, useAuthSync } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Phase 6e: parent now owns the my-bids + my-subscriptions fetch so both
// the Sidebar (halte switcher dropdown) and OverviewPage share the same
// data without double-fetching. The deprecated DeliveryPage / HaltesPage
// / EngagementPage routes are unreachable from the nav (kept on disk so
// reverting is one nav re-add) — switch case below only handles the
// tabs that have real data.
// ---------------------------------------------------------------------------

type BidStatus =
  | "pending"
  | "winning"
  | "outbid"
  | "rejected"
  | "won"
  | "lost";

interface MyBidHalte {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  is_available: boolean;
  current_bid: number;
}
export interface MyBid {
  id: string;
  amount: number;
  duration_months: number;
  status: BidStatus;
  created_at: string;
  halte: MyBidHalte | null;
}

type SubStatus = "active" | "expired" | "cancelled" | "pending";

interface MySubHalte {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  is_available: boolean;
}
export interface MySub {
  id: string;
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  status: SubStatus;
  halte: MySubHalte | null;
}

const subscribeMounted = () => () => {};

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthSync();
  const authResolved = useAuthResolved();
  const mounted = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false
  );
  const [currentView, setCurrentView] = useState<DashView>("overview");
  const [currentHalte, setCurrentHalte] = useState<string>("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Portfolio fetch — single source for Sidebar dropdown + Overview stats.
  const [bids, setBids] = useState<MyBid[] | null>(null);
  const [subs, setSubs] = useState<MySub[] | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Auth guard — redirect ke /login hanya setelah sesi awal selesai dicek
  // (cache sessionStorage kosong di tab baru ≠ belum login).
  useEffect(() => {
    if (mounted && authResolved && !user) {
      router.replace("/login");
    }
  }, [mounted, authResolved, user, router]);

  useEffect(() => {
    document.documentElement.classList.add("allow-scroll");
    document.body.classList.add("allow-scroll");
    return () => {
      document.documentElement.classList.remove("allow-scroll");
      document.body.classList.remove("allow-scroll");
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentView]);

  // Fetch portfolio (bids + subs) once after mount + auth resolves. Dikunci
  // ke id user (bukan objeknya) supaya refresh token per jam tidak memicu
  // fetch ulang.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!mounted || !userId) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/dashboard/my-bids", { cache: "no-store" }).then((r) =>
        r.json()
      ),
      fetch("/api/dashboard/my-subscriptions", { cache: "no-store" }).then(
        (r) => r.json()
      ),
    ])
      .then(([bidsJson, subsJson]) => {
        if (cancelled) return;
        if ("error" in bidsJson) {
          setPortfolioError(bidsJson.error as string);
          setBids([]);
        } else {
          setBids(bidsJson.bids as MyBid[]);
        }
        if ("error" in subsJson) {
          setPortfolioError((prev) => prev ?? (subsJson.error as string));
          setSubs([]);
        } else {
          setSubs(subsJson.subscriptions as MySub[]);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setPortfolioError(
          e instanceof Error ? e.message : "Gagal memuat portfolio."
        );
        setBids([]);
        setSubs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, userId]);

  // Sponsored haltes — distinct list of halte IDs the user has a stake
  // in. Same priority rule the Overview page uses (active sub > won bid).
  const sponsoredHaltes: SponsoredHalte[] = useMemo(() => {
    if (!bids || !subs) return [];
    const todayDateOnly = new Date().toISOString().slice(0, 10);
    const seen = new Map<string, SponsoredHalte>();
    for (const s of subs) {
      if (s.status !== "active" || !s.halte) continue;
      // Belt-and-braces — server already filters but double-check.
      if (s.ends_at !== null && s.ends_at < todayDateOnly) continue;
      seen.set(s.halte.id, {
        id: s.halte.id,
        name: s.halte.name,
        tier: s.halte.tier,
        corridor: s.halte.corridor,
        kind: "subscription",
      });
    }
    for (const b of bids) {
      if (b.status !== "won" || !b.halte) continue;
      if (seen.has(b.halte.id)) continue;
      seen.set(b.halte.id, {
        id: b.halte.id,
        name: b.halte.name,
        tier: b.halte.tier,
        corridor: b.halte.corridor,
        kind: "auction",
      });
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "id-ID")
    );
  }, [bids, subs]);

  if (!mounted || !user) return null;

  const portfolioLoading = bids === null || subs === null;

  const renderView = () => {
    switch (currentView) {
      case "overview":
        return (
          <OverviewPage
            bids={bids ?? []}
            subs={subs ?? []}
            sponsoredHaltes={sponsoredHaltes}
            portfolioLoading={portfolioLoading}
            portfolioError={portfolioError}
            currentHalte={currentHalte}
            onSwitchView={setCurrentView}
          />
        );
      case "bids":
        return <BidsPage />;
      case "subscriptions":
        return <SubscriptionsPage />;
      case "reports":
        return <ReportsPage />;
      case "settings":
        return (
          <SettingsPage
            bids={bids ?? []}
            subs={subs ?? []}
            portfolioLoading={portfolioLoading}
          />
        );
    }
  };

  return (
    <div className="dash-app">
      <Sidebar
        currentView={currentView}
        onChangeView={setCurrentView}
        currentHalte={currentHalte}
        onChangeHalte={setCurrentHalte}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sponsoredHaltes={sponsoredHaltes}
        portfolioLoading={portfolioLoading}
      />
      <main className="dash-main">
        <Topbar
          currentView={currentView}
          user={user}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        {renderView()}
      </main>
    </div>
  );
}
