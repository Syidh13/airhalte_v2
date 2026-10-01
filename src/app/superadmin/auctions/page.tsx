"use client";

/**
 * /superadmin/auctions — Phase 4 auction management.
 *
 * Sits next to /superadmin/haltes (master CRUD) and /superadmin/bids
 * (audit log of every bid + subscription). This page is the *control
 * plane*: schedule, monitor, and close auctions for premium haltes.
 *
 * Backed by:
 *   GET  /api/admin/auctions              — list + status filter
 *   POST /api/admin/auctions              — schedule new auction
 *   GET  /api/admin/auctions/[halteId]    — un-blind detail
 *   PATCH /api/admin/auctions/[halteId]   — reschedule window
 *   POST /api/admin/haltes/[id]/close-auction — finalize / pick winner
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast, { type ToastData } from "@/components/Toast";
import {
  BID_MAX_AMOUNT,
  PREMIUM_CONTRACT_MONTHS,
  PREMIUM_MIN_BASE_PRICE,
  periodLabel,
} from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Types — match the JSON the API returns. Keep these private to this page.
// ---------------------------------------------------------------------------
type AuctionStatus = "active" | "upcoming" | "done" | "unscheduled";
type AuctionFilter = "all" | AuctionStatus;

interface AuctionRow {
  id: string;
  name: string;
  tier: "premium" | "mass";
  corridor: string | null;
  /** Harga dasar di DB (Rupiah/tahun). */
  base_price: number;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  /** Akhir kontrak pemenang lelang terakhir, bila ada. */
  contract_ends_at: string | null;
  is_available: boolean;
  current_bid: number;
  total_bidders: number;
  status: AuctionStatus;
}

type BidStatus =
  | "pending"
  | "winning"
  | "outbid"
  | "rejected"
  | "won"
  | "lost";

interface DetailBid {
  id: string;
  amount: number;
  duration_months: number;
  status: BidStatus | string;
  created_at: string;
  company: { id: string; company_name: string } | null;
  pic: { name: string; email: string } | null;
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
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  contract_ends_at: string | null;
  status: AuctionStatus;
}

interface DetailPayload {
  halte: DetailHalte;
  bids: DetailBid[];
  total_bidders: number;
  total_bids: number;
}

interface CreatablePremiumHalte {
  id: string;
  name: string;
  corridor: string | null;
  base_price: number;
  status: AuctionStatus;
}

// ---------------------------------------------------------------------------
// Format helpers — small set, inline keeps the file self-contained.
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

/** Nominal penuh untuk penawaran, mis. "Rp 105.000.000". */
function formatRupiahFull(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** "Rp 100 jt" — minimum harga dasar dari lib/pricing.ts. */
const MIN_BASE_LABEL = `Rp ${PREMIUM_MIN_BASE_PRICE / 1_000_000} jt`;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Berakhir";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days >= 1) return `${days}hr ${hours}j`;
  if (hours >= 1) return `${hours}j ${String(minutes).padStart(2, "0")}m`;
  if (minutes >= 1) return `${minutes} menit`;
  return `${totalSec} detik`;
}

/** Convert ISO → datetime-local input value ("YYYY-MM-DDTHH:mm" in
 *  the browser's local time). Empty/null → "". */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Visual tokens — status pill & filter tabs.
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<AuctionStatus, string> = {
  active: "Aktif",
  upcoming: "Akan Datang",
  done: "Selesai",
  unscheduled: "Belum Dijadwalkan",
};
const STATUS_BADGE: Record<
  AuctionStatus,
  { bg: string; color: string; border: string }
> = {
  active: { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  upcoming: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  done: { bg: "#f1f5f9", color: "var(--text-3)", border: "var(--border)" },
  unscheduled: { bg: "var(--surface-2)", color: "var(--text-2)", border: "var(--border)" },
};

const BID_BADGE: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  winning: { label: "Tertinggi", bg: "#dbeafe", color: "#1e40af" },
  outbid: { label: "Terlampaui", bg: "#f1f5f9", color: "var(--text-3)" },
  won: { label: "Menang", bg: "#dcfce7", color: "#166534" },
  lost: { label: "Kalah", bg: "#fee2e2", color: "#991b1b" },
  pending: { label: "Menunggu", bg: "var(--surface-2)", color: "var(--text-2)" },
  rejected: { label: "Ditolak", bg: "#fef2f2", color: "#991b1b" },
};

const FILTERS: { key: AuctionFilter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "active", label: "Aktif" },
  { key: "upcoming", label: "Akan Datang" },
  { key: "unscheduled", label: "Belum Dijadwalkan" },
  { key: "done", label: "Selesai" },
];

// ===========================================================================
// PAGE
// ===========================================================================
export default function AuctionsPage() {
  const [rows, setRows] = useState<AuctionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuctionFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [busyHalteId, setBusyHalteId] = useState<string | null>(null);

  // Tick the clock once a minute so the table's "Sisa waktu" column
  // updates without a full refetch.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const fireToast = useCallback((data: ToastData) => {
    setToast(data);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auctions", { cache: "no-store" });
      const json = (await res.json()) as
        | { auctions: AuctionRow[] }
        | { error: string };
      if ("error" in json) {
        setError(json.error);
        setRows([]);
        return;
      }
      setRows(json.auctions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat lelang.");
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
    const c: Record<AuctionFilter, number> = {
      all: 0,
      active: 0,
      upcoming: 0,
      done: 0,
      unscheduled: 0,
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
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  // Close auction handler — wired both from the row's inline button and
  // the detail modal's footer.
  const handleCloseAuction = useCallback(
    async (halte: { id: string; name: string }) => {
      const ok = window.confirm(
        `Tutup lelang untuk "${halte.name}"?\n\n` +
          `Pemenang ditetapkan otomatis dari penawaran tertinggi di jendela ` +
          `lelang ini. Halte ditutup dari lelang dan kontrak tahunan ` +
          `(${PREMIUM_CONTRACT_MONTHS} bulan) pemenang dimulai hari ini.`
      );
      if (!ok) return;
      setBusyHalteId(halte.id);
      try {
        const res = await fetch(
          `/api/admin/haltes/${encodeURIComponent(halte.id)}/close-auction`,
          { method: "POST" }
        );
        const json = (await res.json()) as
          | { ok: true; winner_bid_id: string | null; winner_amount: number | null }
          | { ok: false; error: string };
        if (!json.ok) {
          setError(`Gagal tutup lelang: ${json.error}`);
          return;
        }
        fireToast({
          label: "LELANG DITUTUP",
          msg:
            json.winner_amount !== null
              ? `${halte.name} · pemenang ${formatRupiahFull(json.winner_amount)}`
              : `${halte.name} · tanpa penawaran`,
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
            Manajemen Lelang
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--text-3)",
              fontSize: 14,
              maxWidth: 640,
            }}
          >
            Daftar Halte BRT (Premium) dengan jadwal lelang dan penawaran
            yang masuk. Pemenang mendapat kontrak tahunan (
            {PREMIUM_CONTRACT_MONTHS} bulan).
          </p>
        </div>
        <button
          type="button"
          className="sa-btn-primary"
          onClick={() => setCreateOpen(true)}
        >
          + Buat Lelang Baru
        </button>
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
              <th>Mulai</th>
              <th>Berakhir</th>
              <th className="num">Penawar</th>
              <th className="num">Penawaran Tertinggi</th>
              <th>Status</th>
              <th className="sa-th-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={8} className="sa-empty">
                  Memuat data lelang…
                </td>
              </tr>
            )}
            {rows !== null && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="sa-empty">
                  Tidak ada lelang dengan status ini.
                </td>
              </tr>
            )}
            {rows !== null &&
              visible.map((r) => {
                const badge = STATUS_BADGE[r.status];
                const remaining =
                  r.auction_ends_at && r.status === "active"
                    ? new Date(r.auction_ends_at).getTime() - nowMs
                    : null;
                const startsRemaining =
                  r.auction_starts_at && r.status === "upcoming"
                    ? new Date(r.auction_starts_at).getTime() - nowMs
                    : null;
                return (
                  <tr
                    key={r.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDetailFor(r.id)}
                  >
                    <td>
                      <div className="sa-company-name">{r.name}</div>
                      <div
                        className="sa-muted"
                        style={{ fontSize: 11, marginTop: 2 }}
                      >
                        Harga dasar {formatRupiahShort(r.base_price)}/tahun
                      </div>
                      {r.base_price < PREMIUM_MIN_BASE_PRICE && (
                        <div className="sa-field-warn" style={{ fontSize: 11 }}>
                          Di bawah minimum {MIN_BASE_LABEL}
                        </div>
                      )}
                    </td>
                    <td>{r.corridor ?? "—"}</td>
                    <td>
                      {formatDateTime(r.auction_starts_at)}
                      {startsRemaining !== null && startsRemaining > 0 && (
                        <div className="sa-muted">
                          Mulai dalam {formatCountdown(startsRemaining)}
                        </div>
                      )}
                    </td>
                    <td>
                      {formatDateTime(r.auction_ends_at)}
                      {remaining !== null && remaining > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color:
                              remaining < 60 * 60 * 1000
                                ? "#dc2626"
                                : "var(--text-3)",
                            fontWeight: remaining < 60 * 60 * 1000 ? 600 : 400,
                          }}
                        >
                          Sisa {formatCountdown(remaining)}
                        </div>
                      )}
                      {remaining !== null && remaining <= 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#dc2626",
                            fontWeight: 600,
                          }}
                        >
                          Window lewat — tutup manual
                        </div>
                      )}
                    </td>
                    <td className="num">{r.total_bidders}</td>
                    <td className="num">
                      {r.current_bid > 0 ? formatRupiahShort(r.current_bid) : "—"}
                    </td>
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
                      {r.contract_ends_at &&
                        new Date(r.contract_ends_at).getTime() > nowMs && (
                          <div className="sa-muted" style={{ fontSize: 11, marginTop: 2 }}>
                            Kontrak hingga {formatDate(r.contract_ends_at)}
                          </div>
                        )}
                    </td>
                    <td
                      className="sa-td-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="sa-btn-ghost"
                        onClick={() => setDetailFor(r.id)}
                      >
                        Detail
                      </button>
                      {r.status === "active" && (
                        <button
                          type="button"
                          className="sa-btn-reject"
                          onClick={() =>
                            handleCloseAuction({ id: r.id, name: r.name })
                          }
                          disabled={busyHalteId === r.id}
                        >
                          {busyHalteId === r.id ? "Memproses…" : "Tutup Lelang"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateAuctionModal
          existingRows={rows ?? []}
          nowMs={nowMs}
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            setCreateOpen(false);
            fireToast({
              label: "LELANG DIBUAT",
              msg: `Lelang dibuat untuk ${name}`,
              variant: "ok",
            });
            fetchAll();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {detailFor && (
        <AuctionDetailModal
          halteId={detailFor}
          nowMs={nowMs}
          busyHalteId={busyHalteId}
          onClose={() => setDetailFor(null)}
          onCloseAuction={handleCloseAuction}
          onRescheduled={() => {
            fetchAll();
            fireToast({
              label: "WINDOW DIPERBARUI",
              msg: "Jadwal lelang berhasil diubah",
              variant: "ok",
            });
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

// ===========================================================================
// CREATE MODAL
// ===========================================================================
function CreateAuctionModal({
  existingRows,
  nowMs,
  onClose,
  onCreated,
  onError,
}: {
  existingRows: AuctionRow[];
  nowMs: number;
  onClose: () => void;
  onCreated: (halteName: string) => void;
  onError: (msg: string) => void;
}) {
  const [halteId, setHalteId] = useState("");
  const [search, setSearch] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // Harga dasar untuk lelang ini (digit saja). Diisi dari halte terpilih.
  const [basePrice, setBasePrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Eligible haltes for a brand-new auction = Halte BRT without an active
  // schedule and without a running winner contract. We allow re-scheduling
  // closed haltes (status='done') and unscheduled ones; active/upcoming
  // should be edited via Detail → Edit Window instead.
  const candidates: CreatablePremiumHalte[] = useMemo(() => {
    return existingRows
      .filter(
        (r) =>
          (r.status === "unscheduled" || r.status === "done") &&
          !(r.contract_ends_at && new Date(r.contract_ends_at).getTime() > nowMs)
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        corridor: r.corridor,
        base_price: r.base_price,
        status: r.status,
      }));
  }, [existingRows, nowMs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.corridor ?? "").toLowerCase().includes(q)
    );
  }, [candidates, search]);

  const selected = candidates.find((c) => c.id === halteId);

  const handleSubmit = async () => {
    setLocalError(null);
    if (!halteId) {
      setLocalError("Pilih halte dulu.");
      return;
    }
    if (!startsAt || !endsAt) {
      setLocalError("Set tanggal mulai dan berakhir.");
      return;
    }
    const startsIso = localInputToIso(startsAt);
    const endsIso = localInputToIso(endsAt);
    if (!startsIso || !endsIso) {
      setLocalError("Format datetime tidak valid.");
      return;
    }
    if (new Date(endsIso).getTime() <= new Date(startsIso).getTime()) {
      setLocalError("Berakhir harus setelah dimulai.");
      return;
    }
    const basePriceNum = Number(basePrice);
    if (!basePrice || basePriceNum < PREMIUM_MIN_BASE_PRICE) {
      setLocalError(`Harga dasar minimal ${MIN_BASE_LABEL}/tahun.`);
      return;
    }
    if (basePriceNum > BID_MAX_AMOUNT) {
      setLocalError("Harga dasar terlalu besar.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          halte_id: halteId,
          auction_starts_at: startsIso,
          auction_ends_at: endsIso,
          base_price: basePriceNum,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; halte_id: string }
        | { ok: false; error: string };
      if (!json.ok) {
        setLocalError(json.error);
        return;
      }
      onCreated(selected?.name ?? halteId);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Tidak bisa menghubungi server.";
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="sa-modal-title">Buat Lelang Baru</h3>
        <p className="sa-modal-body">
          Halte akan otomatis aktif untuk penawaran setelah lelang dibuat.
          Berakhir minimal 5 menit setelah dimulai. Pemenang mendapat kontrak
          tahunan ({PREMIUM_CONTRACT_MONTHS} bulan).
        </p>

        <label className="sa-modal-label">
          Halte BRT tanpa lelang aktif:
          <input
            type="text"
            className="sa-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHalteId("");
            }}
            placeholder="Ketik nama halte atau koridor…"
            autoFocus
          />
        </label>
        <div
          style={{
            maxHeight: 180,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            marginTop: -4,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 13,
                color: "var(--text-3)",
              }}
            >
              {candidates.length === 0
                ? "Tidak ada Halte BRT yang bisa dibuatkan lelang baru."
                : "Tidak ada hasil. Coba kata kunci lain."}
            </div>
          ) : (
            filtered.map((c) => {
              const active = c.id === halteId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setHalteId(c.id);
                    setSearch(c.name);
                    setBasePrice(
                      String(Math.max(c.base_price || 0, PREMIUM_MIN_BASE_PRICE))
                    );
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    background: active ? "var(--surface-2)" : "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginTop: 2,
                    }}
                  >
                    {c.corridor ? `Koridor ${c.corridor}` : "—"} ·{" "}
                    {c.status === "done" ? "Jadwalkan ulang" : "Belum dijadwalkan"} ·
                    Harga dasar {formatRupiahShort(c.base_price)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <label className="sa-form-field" style={{ marginTop: 14 }}>
          <span className="sa-form-label">Harga dasar (Rp/tahun)</span>
          <input
            type="text"
            inputMode="numeric"
            className="sa-input"
            value={basePrice ? Number(basePrice).toLocaleString("id-ID") : ""}
            onChange={(e) =>
              setBasePrice(e.target.value.replace(/\D/g, "").slice(0, 13))
            }
            placeholder={PREMIUM_MIN_BASE_PRICE.toLocaleString("id-ID")}
            disabled={!halteId}
          />
          <span
            className={
              basePrice && Number(basePrice) < PREMIUM_MIN_BASE_PRICE
                ? "sa-field-warn"
                : "sa-field-hint"
            }
          >
            Minimal {MIN_BASE_LABEL}/tahun
          </span>
        </label>

        <div className="sa-form-row" style={{ marginTop: 14 }}>
          <label className="sa-form-field">
            <span className="sa-form-label">Lelang Dimulai</span>
            <input
              type="datetime-local"
              className="sa-input"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label className="sa-form-field">
            <span className="sa-form-label">Lelang Berakhir</span>
            <input
              type="datetime-local"
              className="sa-input"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
        </div>

        {localError && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 6,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 13,
            }}
          >
            {localError}
          </div>
        )}

        <div className="sa-modal-actions">
          <button
            type="button"
            className="sa-btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Batal
          </button>
          <button
            type="button"
            className="sa-btn-primary"
            onClick={handleSubmit}
            disabled={busy || !halteId || !startsAt || !endsAt || !basePrice}
          >
            {busy ? "Memproses…" : "Buat Lelang"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// DETAIL MODAL
// ===========================================================================
function AuctionDetailModal({
  halteId,
  nowMs,
  busyHalteId,
  onClose,
  onCloseAuction,
  onRescheduled,
  onError,
}: {
  halteId: string;
  nowMs: number;
  busyHalteId: string | null;
  onClose: () => void;
  onCloseAuction: (halte: { id: string; name: string }) => void;
  onRescheduled: () => void;
  onError: (msg: string) => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editStarts, setEditStarts] = useState("");
  const [editEnds, setEditEnds] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/auctions/${encodeURIComponent(halteId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as
        | DetailPayload
        | { error: string };
      if ("error" in json) {
        setLoadingErr(json.error);
        return;
      }
      setData(json);
      setEditStarts(isoToLocalInput(json.halte.auction_starts_at));
      setEditEnds(isoToLocalInput(json.halte.auction_ends_at));
    } catch (e) {
      setLoadingErr(e instanceof Error ? e.message : "Gagal memuat detail.");
    }
  }, [halteId]);

  useEffect(() => {
    // Initial load. fetchDetail only sets state after awaiting the network
    // (never synchronously), so this cannot cause a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

  const handleSaveWindow = async () => {
    setEditError(null);
    const startsIso = localInputToIso(editStarts);
    const endsIso = localInputToIso(editEnds);
    if (!startsIso || !endsIso) {
      setEditError("Set tanggal mulai dan berakhir.");
      return;
    }
    if (new Date(endsIso).getTime() <= new Date(startsIso).getTime()) {
      setEditError("Berakhir harus setelah dimulai.");
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch(
        `/api/admin/auctions/${encodeURIComponent(halteId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auction_starts_at: startsIso,
            auction_ends_at: endsIso,
          }),
        }
      );
      const json = (await res.json()) as
        | { ok: true }
        | { ok: false; error: string };
      if (!json.ok) {
        setEditError(json.error);
        return;
      }
      setEditing(false);
      await fetchDetail();
      onRescheduled();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Tidak bisa menghubungi server.";
      setEditError(msg);
      onError(msg);
    } finally {
      setEditBusy(false);
    }
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
          <p className="sa-modal-body">Memuat detail lelang…</p>
        </div>
      </div>
    );
  }

  const { halte, bids, total_bidders, total_bids } = data;
  const badge = STATUS_BADGE[halte.status];
  const startsMs = halte.auction_starts_at
    ? new Date(halte.auction_starts_at).getTime()
    : null;
  const endsMs = halte.auction_ends_at
    ? new Date(halte.auction_ends_at).getTime()
    : null;
  const startsRemaining =
    startsMs !== null && halte.status === "upcoming" ? startsMs - nowMs : null;
  const endsRemaining =
    endsMs !== null && halte.status === "active" ? endsMs - nowMs : null;
  // Jendela sudah lewat tapi belum ditutup: menyimpan jadwal baru berarti
  // lelang baru (penawaran lama tidak dihitung).
  const windowPassed = endsMs !== null && endsMs <= nowMs;
  const contractRunning =
    !!halte.contract_ends_at &&
    new Date(halte.contract_ends_at).getTime() > nowMs;

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <h3 className="sa-modal-title">
          {halte.name} — Detail Lelang
        </h3>

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
                background: "var(--brand)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              Premium
            </span>
          </Field>
          <Field label="Koridor">{halte.corridor ?? "—"}</Field>
          <Field label="Koordinat">
            {halte.lat.toFixed(4)}, {halte.lng.toFixed(4)}
          </Field>
          <Field label="Harga dasar">
            {formatRupiahFull(halte.base_price)}/tahun
            {halte.base_price < PREMIUM_MIN_BASE_PRICE && (
              <div className="sa-field-warn">Di bawah minimum {MIN_BASE_LABEL}</div>
            )}
          </Field>
          {contractRunning && (
            <Field label="Kontrak hingga">
              {formatDate(halte.contract_ends_at)}
            </Field>
          )}
        </div>

        {/* Section 2 — Window + status + edit */}
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
              Window Lelang
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

          {!editing ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label="Mulai">
                {formatDateTime(halte.auction_starts_at)}
                {startsRemaining !== null && startsRemaining > 0 && (
                  <div className="sa-muted" style={{ fontSize: 11 }}>
                    Mulai dalam {formatCountdown(startsRemaining)}
                  </div>
                )}
              </Field>
              <Field label="Berakhir">
                {formatDateTime(halte.auction_ends_at)}
                {endsRemaining !== null && endsRemaining > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color:
                        endsRemaining < 60 * 60 * 1000
                          ? "#dc2626"
                          : "var(--text-3)",
                      fontWeight: endsRemaining < 60 * 60 * 1000 ? 600 : 400,
                    }}
                  >
                    Sisa {formatCountdown(endsRemaining)}
                  </div>
                )}
              </Field>
            </div>
          ) : (
            <>
              <div className="sa-form-row">
                <label className="sa-form-field">
                  <span className="sa-form-label">Lelang Dimulai</span>
                  <input
                    type="datetime-local"
                    className="sa-input"
                    value={editStarts}
                    onChange={(e) => setEditStarts(e.target.value)}
                  />
                </label>
                <label className="sa-form-field">
                  <span className="sa-form-label">Lelang Berakhir</span>
                  <input
                    type="datetime-local"
                    className="sa-input"
                    value={editEnds}
                    onChange={(e) => setEditEnds(e.target.value)}
                  />
                </label>
              </div>
              {windowPassed && (
                <div className="sa-field-hint" style={{ marginTop: 8 }}>
                  Jadwal sebelumnya sudah lewat. Menyimpan jadwal baru memulai
                  lelang baru: penawaran lama tidak dihitung. Untuk menetapkan
                  pemenang, gunakan Tutup Lelang.
                </div>
              )}
              {editError && (
                <div
                  role="alert"
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                    fontSize: 12,
                  }}
                >
                  {editError}
                </div>
              )}
            </>
          )}

          {halte.status !== "done" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {!editing ? (
                <button
                  type="button"
                  className="sa-btn-ghost"
                  onClick={() => setEditing(true)}
                >
                  Edit Window
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="sa-btn-ghost"
                    onClick={() => {
                      setEditing(false);
                      setEditError(null);
                      setEditStarts(isoToLocalInput(halte.auction_starts_at));
                      setEditEnds(isoToLocalInput(halte.auction_ends_at));
                    }}
                    disabled={editBusy}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    className="sa-btn-primary"
                    onClick={handleSaveWindow}
                    disabled={editBusy}
                  >
                    {editBusy ? "Menyimpan…" : "Simpan Window"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Section 3 — Bid summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            padding: "12px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Field label="Penawaran tertinggi">
            <strong style={{ fontSize: 16 }}>
              {halte.current_bid > 0
                ? formatRupiahFull(halte.current_bid)
                : "Belum ada"}
            </strong>
          </Field>
          <Field label="Penawar">{total_bidders}</Field>
          <Field label="Total penawaran">{total_bids}</Field>
        </div>

        {/* Section 4 — Un-blind bidder list */}
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
            Penawaran ({bids.length})
          </div>
          {bids.length === 0 ? (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              Belum ada penawaran masuk.
            </div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table className="sa-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>PIC</th>
                    <th className="num">Penawaran</th>
                    <th className="num">Periode</th>
                    <th>Status</th>
                    <th>Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {bids.map((b, idx) => {
                    const isWinner =
                      b.status === "winning" || b.status === "won";
                    const winnerHighlight =
                      idx === 0 && isWinner ? "var(--surface-2)" : undefined;
                    const sb = BID_BADGE[b.status] ?? BID_BADGE.pending;
                    return (
                      <tr key={b.id} style={{ background: winnerHighlight }}>
                        <td>
                          <div className="sa-company-name">
                            {b.company?.company_name ?? "—"}
                          </div>
                        </td>
                        <td>
                          {b.pic ? (
                            <>
                              <div>{b.pic.name}</div>
                              <div className="sa-muted">{b.pic.email}</div>
                            </>
                          ) : (
                            <span className="sa-muted">—</span>
                          )}
                        </td>
                        <td className="num">
                          <strong>{formatRupiahFull(b.amount)}</strong>
                        </td>
                        <td className="num">{periodLabel(b.duration_months)}</td>
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
                            {formatDateTime(b.created_at)}
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

        {/* Footer actions */}
        <div className="sa-modal-actions">
          {(halte.status === "active" || halte.status === "upcoming") && (
            <button
              type="button"
              className="sa-btn-reject"
              onClick={() =>
                onCloseAuction({ id: halte.id, name: halte.name })
              }
              disabled={busyHalteId === halte.id}
              style={{ marginRight: "auto" }}
            >
              {busyHalteId === halte.id ? "Memproses…" : "Tutup Lelang"}
            </button>
          )}
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
