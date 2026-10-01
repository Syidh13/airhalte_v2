"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuthSync } from "@/lib/auth";
import { periodLabel } from "@/lib/pricing";
import type { DashView, SponsoredHalte } from "./Sidebar";
import type { MyBid, MySub } from "@/app/dashboard/page";

// ---------------------------------------------------------------------------
// Phase 6e: data is now lifted to dashboard/page.tsx and passed in via
// props — this component no longer fetches. Card click opens an inline
// modal with that halte's portfolio detail (subscription, won bid,
// recent activity), instead of redirecting to the portal map.
// ---------------------------------------------------------------------------

interface OverviewPageProps {
  bids: MyBid[];
  subs: MySub[];
  sponsoredHaltes: SponsoredHalte[];
  portfolioLoading: boolean;
  portfolioError: string | null;
  /** Sidebar dropdown selection. "all" (default) shows the full portfolio
      summary. A halte id narrows the Sponsored grid + activity feed to
      that one halte. */
  currentHalte: string;
  onSwitchView: (view: DashView) => void;
}

// ---------------------------------------------------------------------------
// Helpers — local, not exported.
// ---------------------------------------------------------------------------
function formatRupiahShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "Rp 0";
  if (n >= 1_000_000_000) {
    const v = (n / 1_000_000_000).toFixed(1).replace(".0", "").replace(".", ",");
    return `Rp ${v} M`;
  }
  if (n >= 1_000_000) return `Rp ${Math.round(n / 1_000_000)} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)} rb`;
  return `Rp ${n}`;
}

function formatRupiahFull(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "Rp 0";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diffMs = nowMs - t;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo} bulan lalu`;
}

const STATUS_BADGE: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  winning: { label: "Tertinggi", bg: "#dbeafe", color: "#1e40af" },
  outbid: { label: "Terlampaui", bg: "#f1f5f9", color: "var(--text-3)" },
  won: { label: "Menang lelang", bg: "#dcfce7", color: "#166534" },
  lost: { label: "Kalah lelang", bg: "#fee2e2", color: "#991b1b" },
  active: { label: "Langganan aktif", bg: "#dcfce7", color: "#166534" },
  expired: { label: "Berakhir", bg: "#f1f5f9", color: "var(--text-3)" },
  cancelled: { label: "Dibatalkan", bg: "#fef2f2", color: "#991b1b" },
  pending: { label: "Menunggu", bg: "var(--surface-2)", color: "var(--text-2)" },
};

const TIER_LABEL: Record<"premium" | "mass", string> = {
  premium: "Premium",
  mass: "Non-BRT",
};

const ACCOUNT_STATUS: Record<
  "active" | "pending" | "rejected",
  { label: string; bg: string; color: string }
> = {
  active: { label: "Terverifikasi", bg: "#dcfce7", color: "#166534" },
  pending: { label: "Menunggu verifikasi", bg: "#fef3c7", color: "#92400e" },
  rejected: { label: "Ditolak", bg: "#fee2e2", color: "#991b1b" },
};

// ===========================================================================
// PAGE
// ===========================================================================
export default function OverviewPage({
  bids,
  subs,
  sponsoredHaltes,
  portfolioLoading,
  portfolioError,
  currentHalte,
  onSwitchView,
}: OverviewPageProps) {
  const user = useAuthSync();
  const [selectedHalteId, setSelectedHalteId] = useState<string | null>(null);

  // 1-minute tick for the activity feed's relative time strings.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Aggregations — same shape as Phase 6d, but now reading from props.
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const result = {
      activeBidCount: 0,
      /** Hanya bid berstatus `winning` (yang masih bisa jadi kontrak). Bid
          `outbid` tidak dijumlahkan supaya tidak menggelembungkan angka. */
      winningBidTotal: 0,
      wonBidCount: 0,
      wonBidTotal: 0,
      activeSubCount: 0,
      activeSubMonthly: 0,
      activeSubTotalCommit: 0,
      sponsoredHalteIds: new Set<string>(),
      totalCommitment: 0,
    };
    for (const b of bids) {
      if (b.status === "winning" || b.status === "outbid") {
        result.activeBidCount += 1;
        if (b.status === "winning") result.winningBidTotal += b.amount;
      } else if (b.status === "won") {
        result.wonBidCount += 1;
        result.wonBidTotal += b.amount;
        if (b.halte) result.sponsoredHalteIds.add(b.halte.id);
      }
    }
    for (const s of subs) {
      if (s.status === "active") {
        result.activeSubCount += 1;
        result.activeSubMonthly += s.monthly_price;
        result.activeSubTotalCommit += s.total_price;
        if (s.halte) result.sponsoredHalteIds.add(s.halte.id);
      }
    }
    result.totalCommitment =
      result.winningBidTotal + result.wonBidTotal + result.activeSubTotalCommit;
    return result;
  }, [bids, subs]);

  // Sponsored halte cards — narrow when sidebar dropdown picks one halte.
  const visibleSponsored = useMemo(() => {
    if (currentHalte === "all") return sponsoredHaltes;
    return sponsoredHaltes.filter((h) => h.id === currentHalte);
  }, [sponsoredHaltes, currentHalte]);

  // Activity feed — merged + sorted; narrow by currentHalte too.
  type ActivityRow = {
    key: string;
    kind: "bid" | "sub";
    status: string;
    title: string;
    halteId: string | null;
    halteName: string;
    sub: string;
    createdAt: string;
  };
  const activity = useMemo<ActivityRow[]>(() => {
    const rows: ActivityRow[] = [];
    for (const b of bids) {
      rows.push({
        key: `bid-${b.id}`,
        kind: "bid",
        status: b.status,
        title: "Penawaran lelang",
        halteId: b.halte?.id ?? null,
        halteName: b.halte?.name ?? "(halte dihapus)",
        sub: `${formatRupiahShort(b.amount)} · kontrak ${periodLabel(b.duration_months).toLowerCase()}`,
        createdAt: b.created_at,
      });
    }
    for (const s of subs) {
      rows.push({
        key: `sub-${s.id}`,
        kind: "sub",
        status: s.status,
        title: "Langganan",
        halteId: s.halte?.id ?? null,
        halteName: s.halte?.name ?? "(halte dihapus)",
        sub: `${formatRupiahShort(s.total_price)} · ${periodLabel(s.duration_months).toLowerCase()}`,
        createdAt: s.created_at,
      });
    }
    rows.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    if (currentHalte !== "all") {
      return rows.filter((r) => r.halteId === currentHalte).slice(0, 10);
    }
    return rows.slice(0, 10);
  }, [bids, subs, currentHalte]);

  const empty =
    !portfolioLoading && bids.length === 0 && subs.length === 0;

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Ringkasan</div>
          <h1 className="dash-page-title">
            Halo, <em>{user?.name ?? "Sponsor"}</em>.
          </h1>
          <p className="dash-page-subtitle">
            Penawaran lelang dan langganan Anda.
            {currentHalte !== "all" && " (filter: 1 halte)"}
          </p>
        </div>
        {user?.status && (
          <div className="dash-page-header-right">
            <span
              className="dash-trust-badge"
              style={{
                background: ACCOUNT_STATUS[user.status].bg,
                color: ACCOUNT_STATUS[user.status].color,
              }}
            >
              <span className="dot" />
              {ACCOUNT_STATUS[user.status].label}
            </span>
          </div>
        )}
      </div>

      {portfolioError && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {portfolioError}
        </div>
      )}

      {portfolioLoading && (
        <div
          className="dash-card"
          style={{ padding: 24, color: "var(--text-3)", textAlign: "center" }}
        >
          Memuat ringkasan portofolio…
        </div>
      )}

      {empty && (
        <div className="dash-card" style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🚌</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Belum ada penawaran atau langganan
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 14 }}>
            Buka peta untuk ikut lelang Halte BRT atau berlangganan bus stop
            Non-BRT.
          </div>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "8px 18px",
              background: "var(--text)",
              color: "var(--surface)",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Buka Peta →
          </Link>
        </div>
      )}

      {!portfolioLoading && !empty && (
        <>
          {/* 4 summary stat cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <SummaryCard
              kicker="Penawaran Aktif"
              value={String(stats.activeBidCount)}
              hint={
                stats.winningBidTotal > 0
                  ? `${formatRupiahShort(stats.winningBidTotal)} sebagai penawaran tertinggi`
                  : stats.activeBidCount > 0
                    ? "Belum ada penawaran tertinggi"
                    : "Belum ada lelang yang diikuti"
              }
              onClick={() => onSwitchView("bids")}
            />
            <SummaryCard
              kicker="Langganan Aktif"
              value={String(stats.activeSubCount)}
              hint={
                stats.activeSubMonthly > 0
                  ? `${formatRupiahShort(stats.activeSubMonthly)} / bulan`
                  : "Belum ada langganan aktif"
              }
              onClick={() => onSwitchView("subscriptions")}
            />
            <SummaryCard
              kicker="Halte Disponsori"
              value={String(stats.sponsoredHalteIds.size)}
              hint={
                stats.sponsoredHalteIds.size > 0
                  ? "Langganan aktif + lelang dimenangkan"
                  : "—"
              }
            />
            <SummaryCard
              kicker="Total Komitmen"
              value={formatRupiahShort(stats.totalCommitment)}
              hint="Penawaran tertinggi, lelang dimenangkan, dan langganan aktif"
              emphasis
            />
          </div>

          {/* Halte Disponsori grid */}
          {visibleSponsored.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div>
                  <div className="dash-card-title" style={{ marginBottom: 2 }}>
                    Halte Disponsori
                  </div>
                  <div className="dash-card-subtitle">
                    Klik halte untuk melihat detail langganan atau lelang Anda.
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                {visibleSponsored.map((h) => {
                  const sub = subs.find(
                    (s) => s.halte?.id === h.id && s.status === "active"
                  );
                  const wonBid = bids.find(
                    (b) => b.halte?.id === h.id && b.status === "won"
                  );
                  const detail = sub
                    ? sub.ends_at
                      ? `Aktif sampai ${formatDate(sub.ends_at)}`
                      : `Langganan ${periodLabel(sub.duration_months).toLowerCase()}`
                    : wonBid
                      ? `Menang lelang · ${formatRupiahShort(wonBid.amount)}`
                      : "—";
                  return (
                    <SponsoredHalteCard
                      key={h.id}
                      halte={h}
                      detail={detail}
                      onClick={() => setSelectedHalteId(h.id)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {activity.length > 0 && (
            <div className="dash-card" style={{ padding: 16, marginBottom: 24 }}>
              <div className="dash-card-header" style={{ marginBottom: 8 }}>
                <div>
                  <div className="dash-card-title">Aktivitas Terbaru</div>
                  <div className="dash-card-subtitle">
                    {activity.length} aktivitas terakhir
                    {currentHalte !== "all" ? " · halte terpilih" : " di portofolio Anda"}
                    .
                  </div>
                </div>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {activity.map((row) => {
                  const sb =
                    STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
                  return (
                    <li
                      key={row.key}
                      style={{
                        display: "flex",
                        gap: 12,
                        padding: "10px 0",
                        borderTop: "1px solid var(--border)",
                        fontSize: 13,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: sb.bg,
                          color: sb.color,
                          flexShrink: 0,
                        }}
                      >
                        {sb.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--text)", fontWeight: 500 }}>
                          {row.title} · {row.halteName}
                        </div>
                        <div
                          style={{
                            color: "var(--text-3)",
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          {row.sub}
                        </div>
                      </div>
                      <span
                        style={{
                          color: "var(--text-3)",
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        {formatRelativeTime(row.createdAt, nowMs)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Belum ada data performa (pemutaran pengumuman, dsb.): cukup satu
              baris jujur, tanpa angka atau janji saluran tertentu. */}
          <p className="dash-empty-line">
            Data performa penayangan belum tersedia.
          </p>
        </>
      )}

      {selectedHalteId && (
        <HaltePortfolioModal
          halteId={selectedHalteId}
          bids={bids}
          subs={subs}
          sponsoredHaltes={sponsoredHaltes}
          nowMs={nowMs}
          onClose={() => setSelectedHalteId(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Subcomponents
// ===========================================================================
function SummaryCard({
  kicker,
  value,
  hint,
  emphasis = false,
  onClick,
}: {
  kicker: string;
  value: string;
  hint: string;
  emphasis?: boolean;
  onClick?: () => void;
}) {
  const cursor = onClick ? "pointer" : "default";
  return (
    <button
      type="button"
      className="dash-card"
      onClick={onClick}
      disabled={!onClick}
      style={{
        padding: 16,
        textAlign: "left",
        cursor,
        border: "1px solid var(--border)",
        background: emphasis ? "var(--brand)" : "var(--surface)",
        color: emphasis ? "#fff" : "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: emphasis ? "rgba(255,255,255,0.8)" : "var(--text-3)",
        }}
      >
        {kicker}
      </span>
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: emphasis ? "#fff" : "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 12,
          color: emphasis ? "rgba(255,255,255,0.85)" : "var(--text-3)",
          lineHeight: 1.4,
        }}
      >
        {hint}
      </span>
    </button>
  );
}

function SponsoredHalteCard({
  halte,
  detail,
  onClick,
}: {
  halte: SponsoredHalte;
  detail: string;
  onClick: () => void;
}) {
  const tierBg = halte.tier === "premium" ? "var(--brand)" : "var(--surface-2)";
  const tierColor = halte.tier === "premium" ? "#fff" : "var(--text-2)";
  const kindColor = halte.kind === "subscription" ? "#166534" : "#1e40af";
  const kindBg = halte.kind === "subscription" ? "#dcfce7" : "#dbeafe";
  const kindLabel =
    halte.kind === "subscription" ? "Langganan aktif" : "Menang lelang";
  return (
    <button
      type="button"
      onClick={onClick}
      className="dash-card"
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "left",
        cursor: "pointer",
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 3,
            background: tierBg,
            color: tierColor,
          }}
        >
          {TIER_LABEL[halte.tier]}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 3,
            background: kindBg,
            color: kindColor,
          }}
        >
          {kindLabel}
        </span>
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text)",
          lineHeight: 1.3,
        }}
      >
        {halte.name}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        {halte.corridor ? `Koridor ${halte.corridor}` : "—"}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-2)",
          marginTop: 2,
          fontWeight: 500,
        }}
      >
        {detail}
      </div>
    </button>
  );
}

// ===========================================================================
// HaltePortfolioModal — inline detail, opens via card click. Stays inside
// the dashboard route (no portal redirect) so the user keeps context.
// ===========================================================================
function HaltePortfolioModal({
  halteId,
  bids,
  subs,
  sponsoredHaltes,
  nowMs,
  onClose,
}: {
  halteId: string;
  bids: MyBid[];
  subs: MySub[];
  sponsoredHaltes: SponsoredHalte[];
  nowMs: number;
  onClose: () => void;
}) {
  // Resolve the halte basics from the sponsored list (which feeds the
  // dropdown + card grid). Activity rows give a fuller picture.
  const halte = sponsoredHaltes.find((h) => h.id === halteId);
  const activeSub = subs.find(
    (s) => s.halte?.id === halteId && s.status === "active"
  );
  const wonBid = bids.find(
    (b) => b.halte?.id === halteId && b.status === "won"
  );
  // History for THIS halte across both tables, newest first.
  const history = useMemo(() => {
    type Row = {
      key: string;
      status: string;
      title: string;
      sub: string;
      createdAt: string;
    };
    const rows: Row[] = [];
    for (const b of bids) {
      if (b.halte?.id !== halteId) continue;
      rows.push({
        key: `bid-${b.id}`,
        status: b.status,
        title: "Penawaran lelang",
        sub: `${formatRupiahShort(b.amount)} · kontrak ${periodLabel(b.duration_months).toLowerCase()}`,
        createdAt: b.created_at,
      });
    }
    for (const s of subs) {
      if (s.halte?.id !== halteId) continue;
      rows.push({
        key: `sub-${s.id}`,
        status: s.status,
        title: "Langganan",
        sub: `${formatRupiahShort(s.total_price)} · ${periodLabel(s.duration_months).toLowerCase()}`,
        createdAt: s.created_at,
      });
    }
    return rows.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }, [bids, subs, halteId]);

  const halteName = halte?.name ?? "(halte tidak ditemukan)";
  const halteCorridor = halte?.corridor ?? null;
  const halteTier = halte?.tier ?? "mass";

  // Days remaining for active sub.
  const subDaysLeft =
    activeSub?.ends_at !== undefined && activeSub.ends_at !== null
      ? Math.max(
          0,
          Math.ceil(
            (new Date(activeSub.ends_at).setHours(23, 59, 59, 999) - nowMs) /
              86_400_000
          )
        )
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Detail portofolio ${halteName}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          maxWidth: 560,
          width: "100%",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "2px 8px",
                  borderRadius: 3,
                  background:
                    halteTier === "premium"
                      ? "var(--brand)"
                      : "var(--surface-2)",
                  color:
                    halteTier === "premium" ? "#fff" : "var(--text-2)",
                }}
              >
                {TIER_LABEL[halteTier]}
              </span>
              {halteCorridor && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                  }}
                >
                  Koridor {halteCorridor}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {halteName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-3)",
              fontSize: 22,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Section — Status di portfolio */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--text-2)",
            }}
          >
            Status di Portofolio Anda
          </div>

          {activeSub && (
            <div
              style={{
                background: "#dcfce7",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#166534",
                }}
              >
                Langganan Aktif
              </div>
              <div style={{ fontSize: 14, color: "var(--text)" }}>
                <strong>{formatRupiahFull(activeSub.total_price)}</strong> ·{" "}
                {periodLabel(activeSub.duration_months)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                {formatDate(activeSub.starts_at)} →{" "}
                {formatDate(activeSub.ends_at)}
                {subDaysLeft !== null && ` · sisa ${subDaysLeft} hari`}
              </div>
            </div>
          )}

          {wonBid && (
            <div
              style={{
                background: "#dbeafe",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#1e40af",
                }}
              >
                Lelang Dimenangkan
              </div>
              <div style={{ fontSize: 14, color: "var(--text)" }}>
                <strong>{formatRupiahFull(wonBid.amount)}</strong> · kontrak{" "}
                {periodLabel(wonBid.duration_months).toLowerCase()}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                Penawaran diajukan {formatDate(wonBid.created_at)}
              </div>
            </div>
          )}

          {!activeSub && !wonBid && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-3)",
                fontStyle: "italic",
              }}
            >
              Belum ada langganan aktif atau lelang yang dimenangkan untuk
              halte ini.
            </div>
          )}
        </div>

        {/* Section — Riwayat aktivitas user untuk halte ini */}
        {history.length > 0 && (
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--text-2)",
                marginBottom: 8,
              }}
            >
              Riwayat Aktivitas Anda ({history.length})
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {history.map((row) => {
                const sb =
                  STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
                return (
                  <li
                    key={row.key}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "8px 0",
                      borderTop: "1px solid var(--border)",
                      fontSize: 13,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: sb.bg,
                        color: sb.color,
                        flexShrink: 0,
                      }}
                    >
                      {sb.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ color: "var(--text)", fontWeight: 500 }}
                      >
                        {row.title}
                      </div>
                      <div
                        style={{
                          color: "var(--text-3)",
                          fontSize: 11,
                          marginTop: 2,
                        }}
                      >
                        {row.sub}
                      </div>
                    </div>
                    <span
                      style={{
                        color: "var(--text-3)",
                        fontSize: 11,
                        flexShrink: 0,
                      }}
                    >
                      {formatRelativeTime(row.createdAt, nowMs)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Link
            href={`/?halteId=${encodeURIComponent(halteId)}`}
            style={{
              padding: "8px 14px",
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Lihat di Peta →
          </Link>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              background: "var(--text)",
              color: "var(--surface)",
              border: 0,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
