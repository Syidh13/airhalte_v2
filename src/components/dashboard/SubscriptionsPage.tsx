"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { periodLabel } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types — match GET /api/dashboard/my-subscriptions response shape.
// ---------------------------------------------------------------------------
type SubStatus = "active" | "expired" | "cancelled" | "pending";

interface MySubHalte {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  lat: number;
  lng: number;
  base_price: number;
  is_available: boolean;
}

interface MySubscription {
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

type FilterKey = "all" | "active" | "expired" | "cancelled";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "active", label: "Aktif" },
  { key: "expired", label: "Berakhir" },
  { key: "cancelled", label: "Dibatalkan" },
];

// ---------------------------------------------------------------------------
// Helpers
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

function daysUntil(toIso: string | null, nowMs: number): number | null {
  if (!toIso) return null;
  const d = new Date(toIso);
  if (Number.isNaN(d.getTime())) return null;
  // ends_at is a DATE — treat as end-of-day for "days remaining" UX.
  d.setHours(23, 59, 59, 999);
  const diff = d.getTime() - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}

const STATUS_BADGE: Record<
  SubStatus,
  { label: string; bg: string; color: string }
> = {
  active: { label: "Aktif", bg: "#dcfce7", color: "#166534" },
  expired: { label: "Berakhir", bg: "#f1f5f9", color: "var(--text-3)" },
  cancelled: { label: "Dibatalkan", bg: "#fef2f2", color: "#991b1b" },
  pending: { label: "Menunggu", bg: "var(--surface-2)", color: "var(--text-2)" },
};

const TIER_BADGE: Record<
  "premium" | "mass",
  { label: string; bg: string; color: string }
> = {
  premium: { label: "Premium", bg: "var(--brand)", color: "#fff" },
  mass: { label: "Non-BRT", bg: "var(--surface-2)", color: "var(--text-2)" },
};

// ===========================================================================
// PAGE
// ===========================================================================
export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<MySubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/my-subscriptions", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as
          | { subscriptions: MySubscription[] }
          | { error: string };
        if (cancelled) return;
        if ("error" in json) {
          setError(json.error);
          setSubs([]);
          return;
        }
        setSubs(json.subscriptions);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "unknown");
        setSubs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const result = { all: 0, active: 0, expired: 0, cancelled: 0 };
    if (!subs) return result;
    for (const s of subs) {
      result.all += 1;
      if (s.status === "active") result.active += 1;
      else if (s.status === "expired") result.expired += 1;
      else if (s.status === "cancelled") result.cancelled += 1;
    }
    return result;
  }, [subs]);

  const visible = useMemo(() => {
    if (!subs) return [];
    if (filter === "all") return subs;
    return subs.filter((s) => s.status === filter);
  }, [subs, filter]);

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Langganan Saya</div>
          <h1 className="dash-page-title">Bus stop Non-BRT yang Anda sewa.</h1>
          <p className="dash-page-subtitle">
            Pantau status setiap langganan, sisa masa aktif, dan riwayatnya.
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

      {subs === null && (
        <div
          className="dash-card"
          style={{ padding: 24, color: "var(--text-3)", textAlign: "center" }}
        >
          Memuat langganan Anda…
        </div>
      )}

      {subs !== null && visible.length === 0 && (
        <div
          className="dash-card"
          style={{ padding: 32, textAlign: "center" }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {filter === "all"
              ? "Belum ada langganan"
              : "Tidak ada langganan di kategori ini"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            {filter === "all"
              ? "Buka peta untuk berlangganan bus stop Non-BRT."
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

      {subs !== null && visible.length > 0 && (
        <div style={{ display: "grid", gap: 14 }}>
          {visible.map((s) => (
            <SubscriptionCard key={s.id} sub={s} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function SubscriptionCard({
  sub,
  nowMs,
}: {
  sub: MySubscription;
  nowMs: number;
}) {
  const halte = sub.halte;
  const sb = STATUS_BADGE[sub.status];
  const tb = halte ? TIER_BADGE[halte.tier] : null;
  const days = daysUntil(sub.ends_at, nowMs);

  let timeBlock: { label: string; value: string; tone: "active" | "muted" };
  if (sub.status === "active") {
    if (days === null) {
      timeBlock = { label: "Status", value: "Aktif", tone: "active" };
    } else {
      timeBlock = {
        label: "Sisa waktu",
        value: `${days} hari`,
        tone: "active",
      };
    }
  } else if (sub.status === "expired") {
    timeBlock = { label: "Status", value: "Sudah berakhir", tone: "muted" };
  } else if (sub.status === "cancelled") {
    timeBlock = { label: "Status", value: "Dibatalkan", tone: "muted" };
  } else {
    timeBlock = { label: "Status", value: "Menunggu", tone: "muted" };
  }

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
        {/* Header: halte name + tier badge + status badge */}
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
          {tb && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 4,
                background: tb.bg,
                color: tb.color,
              }}
            >
              {tb.label}
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
              background: sb.bg,
              color: sb.color,
            }}
          >
            {sb.label}
          </span>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginBottom: 10,
          }}
        >
          {halte?.corridor ? `Koridor ${halte.corridor} · ` : ""}
          Dibuat {formatBidAt(sub.created_at)}
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Stat
            label="Nilai langganan"
            value={formatRupiahShort(sub.total_price)}
            emphasis
          />
          <Stat
            label="Paket"
            value={periodLabel(sub.duration_months)}
          />
          <Stat
            label="Periode"
            value={`${formatDate(sub.starts_at)} → ${formatDate(sub.ends_at)}`}
          />
        </div>
      </div>

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
