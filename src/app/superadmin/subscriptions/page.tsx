"use client";

/**
 * /superadmin/subscriptions — Phase 6 Non-BRT subscription management.
 *
 * Mirror of /superadmin/auctions but for bus stop Non-BRT (internal mode
 * "mass"). List view shows every Non-BRT point bucketed by rental state;
 * detail modal exposes the full subscription history un-blind
 * (company + PIC). Tarif & periode dari lib/pricing.ts.
 *
 * Out of scope (other phases):
 *   - Subscribe purchase flow / sponsor-side checkout (Phase 8)
 *   - Cancel an active subscription mid-term (Phase 7)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast, { type ToastData } from "@/components/Toast";
import {
  NON_BRT_MONTHLY_PRICE,
  isSubscriptionPeriod,
  periodLabel,
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types — mirror the GET /api/admin/subscriptions response.
// ---------------------------------------------------------------------------
type SubStatus = "available" | "active" | "delisted";
type SubFilter = "all" | SubStatus;

interface CurrentSubscription {
  id: string;
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct?: number;
  starts_at: string | null;
  ends_at: string | null;
  company: { id: string; company_name: string } | null;
  pic: { name: string; email: string } | null;
}

interface SubscriptionRow {
  halte_id: string;
  halte_name: string;
  corridor: string | null;
  base_price: number;
  is_available: boolean;
  current_subscription: CurrentSubscription | null;
  status: SubStatus;
}

interface DetailHalte {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  lat: number;
  lng: number;
  base_price: number;
  current_bid: number;
  is_available: boolean;
  status: SubStatus;
}

interface HistoryRow {
  id: string;
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct?: number;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  company: { id: string; company_name: string } | null;
  pic: { name: string; email: string } | null;
}

interface DetailPayload {
  halte: DetailHalte;
  subscriptions: HistoryRow[];
  current_subscription: HistoryRow | null;
}

// ---------------------------------------------------------------------------
// Format helpers
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.ceil((toMs - fromMs) / 86_400_000));
}

/** Baris data lama (periode 3/6 bulan, diskon, atau tarif lain) — tetap
    ditampilkan apa adanya, ditandai "skema lama". */
function isLegacySubscription(s: {
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct?: number;
}): boolean {
  return (
    !isSubscriptionPeriod(s.duration_months) ||
    (s.discount_pct ?? 0) > 0 ||
    s.monthly_price !== NON_BRT_MONTHLY_PRICE ||
    s.total_price !== s.monthly_price * s.duration_months
  );
}

// ---------------------------------------------------------------------------
// Visual tokens
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<SubStatus, string> = {
  available: "Tersedia",
  active: "Sedang Disewa",
  delisted: "Tidak Aktif",
};
const STATUS_BADGE: Record<
  SubStatus,
  { bg: string; color: string; border: string }
> = {
  available: { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  active: { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
  delisted: { bg: "#f1f5f9", color: "var(--text-3)", border: "var(--border)" },
};

const HISTORY_BADGE: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  pending: { label: "Menunggu", bg: "var(--surface-2)", color: "var(--text-2)" },
  active: { label: "Aktif", bg: "#dcfce7", color: "#166534" },
  expired: { label: "Berakhir", bg: "#f1f5f9", color: "var(--text-3)" },
  cancelled: { label: "Dibatalkan", bg: "#fef2f2", color: "#991b1b" },
};

const FILTERS: { key: SubFilter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "available", label: "Tersedia" },
  { key: "active", label: "Sedang Disewa" },
  { key: "delisted", label: "Tidak Aktif" },
];

// ===========================================================================
// PAGE
// ===========================================================================
export default function SubscriptionsPage() {
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SubFilter>("available");
  const [search, setSearch] = useState("");
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [busyHalteId, setBusyHalteId] = useState<string | null>(null);

  const fireToast = useCallback((data: ToastData) => {
    setToast(data);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/subscriptions", { cache: "no-store" });
      const json = (await res.json()) as
        | { subscriptions: SubscriptionRow[] }
        | { error: string };
      if ("error" in json) {
        setError(json.error);
        setRows([]);
        return;
      }
      setRows(json.subscriptions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // Initial load. fetchAll only sets state after awaiting the network
    // (never synchronously), so this cannot cause a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [fetchAll]);

  const counts = useMemo(() => {
    const c: Record<SubFilter, number> = {
      all: 0,
      available: 0,
      active: 0,
      delisted: 0,
    };
    if (!rows) return c;
    for (const r of rows) {
      c.all += 1;
      c[r.status] += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.halte_name.toLowerCase().includes(q) ||
        (r.corridor ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  // Toggle list / delist via PATCH. Used by both the inline button and
  // the detail modal footer.
  const handleToggleAvailability = useCallback(
    async (halte: { id: string; name: string; nextValue: boolean }) => {
      setBusyHalteId(halte.id);
      try {
        const res = await fetch(
          `/api/admin/subscriptions/${encodeURIComponent(halte.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_available: halte.nextValue }),
          }
        );
        const json = (await res.json()) as
          | { ok: true }
          | { ok: false; error: string };
        if (!json.ok) {
          setError(json.error);
          return;
        }
        fireToast({
          label: halte.nextValue ? "DIAKTIFKAN" : "DINONAKTIFKAN",
          msg: halte.name,
          variant: "ok",
        });
        await fetchAll();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Tidak bisa menghubungi server."
        );
      } finally {
        setBusyHalteId(null);
      }
    },
    [fetchAll, fireToast]
  );

  return (
    <div className="sa-page">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              margin: 0,
              color: "var(--text)",
            }}
          >
            Manajemen Langganan Non-BRT
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--text-3)",
              fontSize: 14,
              maxWidth: 640,
            }}
          >
            Daftar bus stop Non-BRT untuk langganan bulanan atau tahunan
            (tarif tetap {formatRupiahShort(NON_BRT_MONTHLY_PRICE)}/bulan).
          </p>
        </div>
        <input
          type="search"
          placeholder="Cari nama halte atau koridor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sa-input"
          style={{ minWidth: 240, maxWidth: 360 }}
        />
      </div>

      {error && (
        <div className="sa-error" role="alert">
          {error}
          <button
            type="button"
            className="sa-error-close"
            onClick={() => setError(null)}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="sa-tabs" role="tablist">
        {FILTERS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            className={`sa-tab${filter === t.key ? " active" : ""}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
            <span className="sa-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Halte</th>
              <th>Koridor</th>
              <th className="num">Harga / bulan</th>
              <th>Pelanggan</th>
              <th>Berakhir</th>
              <th>Status</th>
              <th className="sa-th-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={7} className="sa-empty">
                  Memuat data langganan…
                </td>
              </tr>
            )}
            {rows !== null && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="sa-empty">
                  {search.trim()
                    ? "Tidak ada hasil pencarian."
                    : "Tidak ada halte dengan status ini."}
                </td>
              </tr>
            )}
            {rows !== null &&
              visible.map((r) => {
                const badge = STATUS_BADGE[r.status];
                const sub = r.current_subscription;
                return (
                  <tr
                    key={r.halte_id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDetailFor(r.halte_id)}
                  >
                    <td>
                      <div className="sa-company-name">{r.halte_name}</div>
                    </td>
                    <td>{r.corridor ?? "—"}</td>
                    <td className="num">{formatRupiahShort(NON_BRT_MONTHLY_PRICE)}</td>
                    <td>
                      {sub?.company ? (
                        <>
                          <div>{sub.company.company_name}</div>
                          {sub.pic && (
                            <div className="sa-muted">{sub.pic.email}</div>
                          )}
                        </>
                      ) : (
                        <span className="sa-muted">—</span>
                      )}
                    </td>
                    <td>{sub?.ends_at ? formatDate(sub.ends_at) : "—"}</td>
                    <td>
                      <span
                        className={`sa-status-badge ${r.status}`}
                        style={{
                          background: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`,
                        }}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td
                      className="sa-td-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="sa-btn-ghost"
                        onClick={() => setDetailFor(r.halte_id)}
                      >
                        Detail
                      </button>
                      {/* Toggle button only when not currently rented out.
                          Active subscriptions need explicit cancel flow
                          (Phase 7) before the halte can be delisted. */}
                      {r.status === "available" && (
                        <button
                          type="button"
                          className="sa-btn-reject"
                          onClick={() =>
                            handleToggleAvailability({
                              id: r.halte_id,
                              name: r.halte_name,
                              nextValue: false,
                            })
                          }
                          disabled={busyHalteId === r.halte_id}
                        >
                          {busyHalteId === r.halte_id
                            ? "Memproses…"
                            : "Nonaktifkan"}
                        </button>
                      )}
                      {r.status === "delisted" && (
                        <button
                          type="button"
                          className="sa-btn-approve"
                          onClick={() =>
                            handleToggleAvailability({
                              id: r.halte_id,
                              name: r.halte_name,
                              nextValue: true,
                            })
                          }
                          disabled={busyHalteId === r.halte_id}
                        >
                          {busyHalteId === r.halte_id
                            ? "Memproses…"
                            : "Aktifkan"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {detailFor && (
        <SubscriptionDetailModal
          halteId={detailFor}
          busyHalteId={busyHalteId}
          onClose={() => setDetailFor(null)}
          onToggle={handleToggleAvailability}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

// ===========================================================================
// DETAIL MODAL
// ===========================================================================
function SubscriptionDetailModal({
  halteId,
  busyHalteId,
  onClose,
  onToggle,
}: {
  halteId: string;
  busyHalteId: string | null;
  onClose: () => void;
  onToggle: (halte: {
    id: string;
    name: string;
    nextValue: boolean;
  }) => Promise<void>;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  // Naikkan untuk memuat ulang detail (mis. setelah aktif/nonaktifkan).
  const [reloadKey, setReloadKey] = useState(0);
  // Waktu modal dibuka — dasar hitungan "Sisa N hari".
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/subscriptions/${encodeURIComponent(halteId)}`, {
      cache: "no-store",
    })
      .then(async (res) => (await res.json()) as DetailPayload | { error: string })
      .then((json) => {
        if (cancelled) return;
        if ("error" in json) {
          setLoadingErr(json.error);
          return;
        }
        setLoadingErr(null);
        setData(json);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadingErr(e instanceof Error ? e.message : "Gagal memuat detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [halteId, reloadKey]);

  const toggleAndReload = (next: { id: string; name: string; nextValue: boolean }) => {
    void onToggle(next).then(() => setReloadKey((k) => k + 1));
  };

  if (loadingErr) {
    return (
      <div className="sa-modal-backdrop" onClick={onClose}>
        <div
          className="sa-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="sa-modal-title">Gagal memuat</h3>
          <p className="sa-modal-body">{loadingErr}</p>
          <div className="sa-modal-actions">
            <button type="button" className="sa-btn-ghost" onClick={onClose}>
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sa-modal-backdrop" onClick={onClose}>
        <div
          className="sa-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="sa-modal-body">Memuat detail…</p>
        </div>
      </div>
    );
  }

  const { halte, subscriptions, current_subscription } = data;
  const badge = STATUS_BADGE[halte.status];
  const endsMs = current_subscription?.ends_at
    ? new Date(current_subscription.ends_at).getTime()
    : null;
  const daysLeft =
    endsMs !== null && Number.isFinite(endsMs) && endsMs > nowMs
      ? daysBetween(nowMs, endsMs)
      : null;

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <h3 className="sa-modal-title">{halte.name} — Detail Langganan</h3>

        {/* Section 1 — Halte info */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            padding: "12px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Field label="Segmen">
            <span
              style={{
                background: "var(--surface-2)",
                color: "var(--text-2)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              Non-BRT
            </span>
          </Field>
          <Field label="Koridor">{halte.corridor ?? "—"}</Field>
          <Field label="Koordinat">
            {halte.lat.toFixed(4)}, {halte.lng.toFixed(4)}
          </Field>
          <Field label="Tarif / bulan">
            {formatRupiahShort(NON_BRT_MONTHLY_PRICE)}
          </Field>
        </div>

        {/* Section 2 — Status sewa */}
        <div
          style={{
            padding: "12px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--text-2)",
              }}
            >
              Status Sewa
            </div>
            <span
              className={`sa-status-badge ${halte.status}`}
              style={{
                background: badge.bg,
                color: badge.color,
                border: `1px solid ${badge.border}`,
              }}
            >
              {STATUS_LABEL[halte.status]}
            </span>
          </div>

          {halte.status === "available" && (
            <button
              type="button"
              className="sa-btn-reject"
              onClick={() =>
                toggleAndReload({
                  id: halte.id,
                  name: halte.name,
                  nextValue: false,
                })
              }
              disabled={busyHalteId === halte.id}
            >
              {busyHalteId === halte.id ? "Memproses…" : "Nonaktifkan Halte"}
            </button>
          )}
          {halte.status === "delisted" && (
            <button
              type="button"
              className="sa-btn-approve"
              onClick={() =>
                toggleAndReload({
                  id: halte.id,
                  name: halte.name,
                  nextValue: true,
                })
              }
              disabled={busyHalteId === halte.id}
            >
              {busyHalteId === halte.id ? "Memproses…" : "Aktifkan Halte"}
            </button>
          )}
          {halte.status === "active" && (
            <p
              className="sa-muted"
              style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}
            >
              Titik ini sedang disewa oleh{" "}
              <strong>{current_subscription?.company?.company_name}</strong>.
              Titik bisa dinonaktifkan setelah langganan berakhir.
            </p>
          )}
        </div>

        {/* Section 3 — Current subscription */}
        {current_subscription && (
          <div
            style={{
              padding: "12px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--text-2)",
                marginBottom: 10,
              }}
            >
              Langganan Aktif
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
              }}
            >
              <Field label="Pelanggan">
                {current_subscription.company?.company_name ?? "—"}
              </Field>
              <Field label="PIC">
                {current_subscription.pic ? (
                  <>
                    <div>{current_subscription.pic.name}</div>
                    <div className="sa-muted" style={{ fontSize: 12 }}>
                      {current_subscription.pic.email}
                    </div>
                  </>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Periode">
                {formatDate(current_subscription.starts_at)} →{" "}
                {formatDate(current_subscription.ends_at)}
                {daysLeft !== null && (
                  <div
                    style={{
                      fontSize: 11,
                      color: daysLeft < 7 ? "#dc2626" : "var(--text-3)",
                      fontWeight: daysLeft < 7 ? 600 : 400,
                      marginTop: 2,
                    }}
                  >
                    Sisa {daysLeft} hari
                  </div>
                )}
              </Field>
              <Field label="Total nilai">
                {formatRupiahShort(current_subscription.total_price)}
                <div className="sa-muted" style={{ fontSize: 12 }}>
                  {periodLabel(current_subscription.duration_months)} ·{" "}
                  {formatRupiahShort(current_subscription.monthly_price)}/bulan
                  {isLegacySubscription(current_subscription) && " · skema lama"}
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* Section 4 — Subscription history */}
        <div style={{ padding: "12px 0" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--text-2)",
              marginBottom: 8,
            }}
          >
            Riwayat Langganan ({subscriptions.length})
          </div>
          {subscriptions.length === 0 ? (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              Belum ada riwayat langganan.
            </div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table className="sa-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>PIC</th>
                    <th>Periode</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s) => {
                    const sb = HISTORY_BADGE[s.status] ?? HISTORY_BADGE.pending;
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="sa-company-name">
                            {s.company?.company_name ?? "—"}
                          </div>
                        </td>
                        <td>
                          {s.pic ? (
                            <>
                              <div>{s.pic.name}</div>
                              <div className="sa-muted">{s.pic.email}</div>
                            </>
                          ) : (
                            <span className="sa-muted">—</span>
                          )}
                        </td>
                        <td>
                          {formatDate(s.starts_at)} → {formatDate(s.ends_at)}
                          <div className="sa-muted" style={{ fontSize: 11 }}>
                            {periodLabel(s.duration_months)}
                            {isLegacySubscription(s) && " · skema lama"}
                          </div>
                        </td>
                        <td className="num">
                          <strong>{formatRupiahShort(s.total_price)}</strong>
                          <div className="sa-muted" style={{ fontSize: 11 }}>
                            {formatRupiahShort(s.monthly_price)} / bln
                          </div>
                        </td>
                        <td>
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
                        </td>
                        <td>
                          <span className="sa-muted">
                            {formatDateTime(s.created_at)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="sa-modal-actions">
          <button type="button" className="sa-btn-ghost" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "var(--text)" }}>{children}</div>
    </div>
  );
}
