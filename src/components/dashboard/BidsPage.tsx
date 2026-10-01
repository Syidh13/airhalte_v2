"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { periodLabel } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types — match the GET /api/dashboard/my-bids response shape.
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

interface MyBid {
  id: string;
  amount: number;
  duration_months: number;
  status: BidStatus;
  created_at: string;
  /** Supabase `:haltes(...)` join. The endpoint always selects this; null
      only happens for orphaned bids whose halte was deleted. */
  halte: MyBidHalte | null;
}

type FilterKey = "all" | "active" | "won" | "lost";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "active", label: "Aktif" },
  { key: "won", label: "Dimenangkan" },
  { key: "lost", label: "Kalah" },
];

// ---------------------------------------------------------------------------
// Helpers (kept private to this page — small set, no need to export).
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

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Berakhir";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days >= 1) return `${days}hr ${hours}j`;
  if (hours >= 1) return `${hours}j ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function formatBidAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const STATUS_BADGE: Record<
  BidStatus,
  { label: string; bg: string; color: string }
> = {
  pending: { label: "Menunggu", bg: "var(--surface-2)", color: "var(--text-2)" },
  winning: { label: "Tertinggi", bg: "#dbeafe", color: "#1e40af" },
  outbid: { label: "Terlampaui", bg: "#f1f5f9", color: "var(--text-3)" },
  rejected: { label: "Ditolak", bg: "#fef2f2", color: "#991b1b" },
  won: { label: "Menang", bg: "#dcfce7", color: "#166534" },
  lost: { label: "Kalah", bg: "#fee2e2", color: "#991b1b" },
};

const TIER_BADGE: Record<
  "premium" | "mass",
  { label: string; bg: string; color: string }
> = {
  premium: { label: "Premium", bg: "var(--brand)", color: "#fff" },
  mass: { label: "Non-BRT", bg: "var(--surface-2)", color: "var(--text-2)" },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function BidsPage() {
  const [bids, setBids] = useState<MyBid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Tick the clock once a minute for any open countdowns. Cheap, and
  // the UI only needs minute-level precision in the list view.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/my-bids", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as
          | { bids: MyBid[] }
          | { error: string };
        if (cancelled) return;
        if ("error" in json) {
          setError(json.error);
          setBids([]);
          return;
        }
        setBids(json.bids);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "unknown");
        setBids([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const result = { all: 0, active: 0, won: 0, lost: 0 };
    if (!bids) return result;
    for (const b of bids) {
      result.all += 1;
      if (b.status === "winning" || b.status === "outbid") result.active += 1;
      else if (b.status === "won") result.won += 1;
      else if (b.status === "lost") result.lost += 1;
    }
    return result;
  }, [bids]);

  const visible = useMemo(() => {
    if (!bids) return [];
    if (filter === "all") return bids;
    if (filter === "active") {
      return bids.filter(
        (b) => b.status === "winning" || b.status === "outbid"
      );
    }
    return bids.filter((b) => b.status === filter);
  }, [bids, filter]);

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Lelang Saya</div>
          <h1 className="dash-page-title">Penawaran lelang Anda.</h1>
          <p className="dash-page-subtitle">
            Pantau status setiap penawaran, sisa waktu lelang, dan hasil akhir.
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
        role="tablist"
      >
        {FILTERS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            onClick={() => setFilter(t.key)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border:
                filter === t.key
                  ? "1px solid var(--text)"
                  : "1px solid var(--border)",
              background: filter === t.key ? "var(--text)" : "var(--surface)",
              color: filter === t.key ? "var(--surface)" : "var(--text-2)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span>{t.label}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                opacity: 0.7,
              }}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {error && (
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
          {error}
        </div>
      )}

      {bids === null && (
        <div
          className="dash-card"
          style={{ padding: 24, color: "var(--text-3)", textAlign: "center" }}
        >
          Memuat penawaran Anda…
        </div>
      )}

      {bids !== null && visible.length === 0 && (
        <div
          className="dash-card"
          style={{ padding: 32, textAlign: "center" }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {filter === "all"
              ? "Belum ada penawaran"
              : "Tidak ada penawaran di kategori ini"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            {filter === "all"
              ? "Buka peta untuk ikut lelang Halte BRT yang sedang dibuka."
              : "Coba ganti filter."}
          </div>
          {filter === "all" && (
            <Link
              href="/"
              style={{
                display: "inline-block",
                marginTop: 14,
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
          )}
        </div>
      )}

      {bids !== null && visible.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: 14,
          }}
        >
          {visible.map((b) => (
            <BidCard key={b.id} bid={b} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BidCard — single bid row. Kept local to this page; no other consumer.
// ---------------------------------------------------------------------------
function BidCard({ bid, nowMs }: { bid: MyBid; nowMs: number }) {
  const halte = bid.halte;
  const statusBadge = STATUS_BADGE[bid.status];
  const isActive = bid.status === "winning" || bid.status === "outbid";

  // Countdown / closed indicator for the right-side meta column.
  let timeBlock: { label: string; value: string; tone: "active" | "muted" };
  if (!halte) {
    timeBlock = { label: "Halte", value: "—", tone: "muted" };
  } else if (!halte.is_available) {
    timeBlock = { label: "Status lelang", value: "Sudah ditutup", tone: "muted" };
  } else if (halte.auction_ends_at) {
    const endMs = new Date(halte.auction_ends_at).getTime();
    const remaining = endMs - nowMs;
    if (remaining <= 0) {
      timeBlock = { label: "Status lelang", value: "Menunggu hasil", tone: "muted" };
    } else {
      timeBlock = {
        label: "Sisa waktu",
        value: formatCountdown(remaining),
        tone: "active",
      };
    }
  } else {
    timeBlock = {
      label: "Status lelang",
      value: isActive ? "Tidak terjadwal" : "—",
      tone: "muted",
    };
  }

  const tierBadge = halte ? TIER_BADGE[halte.tier] : null;

  return (
    <div
      className="dash-card"
      style={{
        padding: 16,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 14,
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {/* Header row: halte name + tier badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 16,
              color: "var(--text)",
            }}
          >
            {halte?.name ?? "(halte tidak ditemukan)"}
          </div>
          {tierBadge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 4,
                background: tierBadge.bg,
                color: tierBadge.color,
              }}
            >
              {tierBadge.label}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 4,
              background: statusBadge.bg,
              color: statusBadge.color,
            }}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Sub: corridor + bid timestamp */}
        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginBottom: 10,
          }}
        >
          {halte?.corridor ? `Koridor ${halte.corridor} · ` : ""}Diajukan{" "}
          {formatBidAt(bid.created_at)}
        </div>

        {/* Amount */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Stat
            label="Penawaran Anda"
            value={formatRupiahShort(bid.amount)}
            emphasis
          />
          {halte && halte.current_bid > 0 && halte.current_bid !== bid.amount && (
            <Stat
              label="Penawaran tertinggi"
              value={formatRupiahShort(halte.current_bid)}
            />
          )}
          <Stat
            label="Kontrak"
            value={periodLabel(bid.duration_months)}
          />
        </div>
      </div>

      {/* Right column: countdown + detail link */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "flex-end",
          minWidth: 120,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {timeBlock.label}
        </div>
        <div
          style={{
            fontSize: timeBlock.tone === "active" ? 18 : 13,
            fontWeight: 600,
            color:
              timeBlock.tone === "active" ? "var(--text)" : "var(--text-3)",
          }}
        >
          {timeBlock.value}
        </div>
        {halte && (
          <Link
            href={`/?halteId=${encodeURIComponent(halte.id)}`}
            style={{
              fontSize: 12,
              color: "var(--brand)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Detail →
          </Link>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--text-3)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: emphasis ? 18 : 14,
          fontWeight: emphasis ? 700 : 500,
          color: "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
