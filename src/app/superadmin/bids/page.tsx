"use client";

/**
 * /superadmin/bids — log baca-saja semua penawaran lelang (Halte BRT) dan
 * langganan (Non-BRT). Status tidak diubah dari sini: pemenang lelang
 * ditetapkan lewat Tutup Lelang di /superadmin/auctions, dan semua tulis
 * bids/subscriptions lewat API server (service role), bukan client browser.
 * Baris lama (kontrak 36 bulan, langganan 3 bulan berdiskon) tetap tampil
 * apa adanya lewat periodLabel().
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EXCLUDED_HALTE_IDS } from "@/data/haltes";
import {
  NON_BRT_MONTHLY_PRICE,
  isSubscriptionPeriod,
  periodLabel,
} from "@/lib/pricing";

type BidStatus = "pending" | "winning" | "outbid" | "rejected" | "won" | "lost";
type SubStatus = "pending" | "active" | "expired" | "cancelled";
type Tab = "bids" | "subs";

/** PostgREST filter value for `.not(col, "in", …)` — record uji tidak
    pernah ditampilkan. */
const HIDDEN_HALTE_FILTER = `(${[...EXCLUDED_HALTE_IDS].join(",")})`;

interface CompanyRef {
  id: string;
  company_name: string;
}
interface HalteRef {
  id: string;
  name: string;
  corridor: string | null;
  tier: "premium" | "mass";
  type: "brt" | "non-brt";
}

interface BidRow {
  id: string;
  amount: number;
  duration_months: number;
  status: BidStatus;
  created_at: string;
  companies: CompanyRef | null;
  haltes: HalteRef | null;
}

interface SubRow {
  id: string;
  duration_months: number;
  monthly_price: number;
  total_price: number;
  discount_pct: number;
  status: SubStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  companies: CompanyRef | null;
  haltes: HalteRef | null;
}

const BID_STATUS_LABEL: Record<BidStatus, string> = {
  pending: "Menunggu",
  winning: "Tertinggi",
  outbid: "Terlampaui",
  rejected: "Ditolak",
  won: "Menang",
  lost: "Kalah",
};

const SUB_STATUS_LABEL: Record<SubStatus, string> = {
  pending: "Menunggu",
  active: "Aktif",
  expired: "Berakhir",
  cancelled: "Dibatalkan",
};

export default function BidsPage() {
  const [tab, setTab] = useState<Tab>("bids");
  const [bids, setBids] = useState<BidRow[]>([]);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial load + realtime. We refetch on any change to either table —
  // cheap given expected superadmin volume.
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      const [bidsRes, subsRes] = await Promise.all([
        supabase
          .from("bids")
          .select(
            "id, amount, duration_months, status, created_at, companies(id, company_name), haltes(id, name, corridor, tier, type)"
          )
          .not("halte_id", "in", HIDDEN_HALTE_FILTER)
          .order("created_at", { ascending: false }),
        supabase
          .from("subscriptions")
          .select(
            "id, duration_months, monthly_price, total_price, discount_pct, status, starts_at, ends_at, created_at, companies(id, company_name), haltes(id, name, corridor, tier, type)"
          )
          .not("halte_id", "in", HIDDEN_HALTE_FILTER)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (bidsRes.error || subsRes.error) {
        setError("Gagal memuat data bid/langganan.");
        setLoading(false);
        return;
      }
      setBids((bidsRes.data as unknown as BidRow[]) ?? []);
      setSubs((subsRes.data as unknown as SubRow[]) ?? []);
      setLoading(false);
    };

    fetchAll();

    const ch = supabase
      .channel("superadmin-bids-subs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bids" },
        () => fetchAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions" },
        () => fetchAll()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  const counts = useMemo(
    () => ({
      bids: bids.length,
      subs: subs.length,
    }),
    [bids, subs]
  );

  return (
    <div className="sa-page">
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

      <div className="sa-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bids"}
          className={`sa-tab${tab === "bids" ? " active" : ""}`}
          onClick={() => setTab("bids")}
        >
          Penawaran (Halte BRT)
          <span className="sa-tab-count">{counts.bids}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "subs"}
          className={`sa-tab${tab === "subs" ? " active" : ""}`}
          onClick={() => setTab("subs")}
        >
          Langganan (Non-BRT)
          <span className="sa-tab-count">{counts.subs}</span>
        </button>
      </div>

      {tab === "bids" ? (
        <BidsTable rows={bids} loading={loading} />
      ) : (
        <SubsTable rows={subs} loading={loading} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bids table
// ---------------------------------------------------------------------------
function BidsTable({
  rows,
  loading,
}: {
  rows: BidRow[];
  loading: boolean;
}) {
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>
            <th>Perusahaan</th>
            <th>Halte</th>
            <th>Nominal Penawaran</th>
            <th>Periode</th>
            <th>Tanggal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={6} className="sa-empty">
                Memuat data…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="sa-empty">
                Belum ada penawaran.
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="sa-company-name">
                    {row.companies?.company_name ?? "—"}
                  </div>
                </td>
                <td>
                  <div>{row.haltes?.name ?? "—"}</div>
                  {row.haltes?.corridor && (
                    <div className="sa-muted">Koridor {row.haltes.corridor}</div>
                  )}
                </td>
                <td>{formatRupiah(row.amount)}</td>
                <td>
                  {periodLabel(row.duration_months)}
                  {row.duration_months !== 12 && (
                    <span className="sa-legacy-note"> · skema lama</span>
                  )}
                </td>
                <td>{formatDate(row.created_at)}</td>
                <td>
                  <span className={`sa-status-badge ${row.status}`}>
                    {BID_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions table
// ---------------------------------------------------------------------------
function SubsTable({
  rows,
  loading,
}: {
  rows: SubRow[];
  loading: boolean;
}) {
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>
            <th>Perusahaan</th>
            <th>Titik</th>
            <th>Harga / bln</th>
            <th>Periode</th>
            <th>Total</th>
            <th>Masa aktif</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} className="sa-empty">
                Memuat data…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="sa-empty">
                Belum ada langganan.
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="sa-company-name">
                    {row.companies?.company_name ?? "—"}
                  </div>
                </td>
                <td>
                  <div>{row.haltes?.name ?? "—"}</div>
                  {row.haltes?.corridor && (
                    <div className="sa-muted">Koridor {row.haltes.corridor}</div>
                  )}
                </td>
                <td>{formatRupiah(row.monthly_price)}</td>
                <td>
                  {periodLabel(row.duration_months)}
                  {isLegacySubscription(row) && (
                    <div className="sa-muted">skema lama</div>
                  )}
                </td>
                <td>{formatRupiah(row.total_price)}</td>
                <td>
                  {row.starts_at && row.ends_at ? (
                    <>
                      <div>{formatDate(row.starts_at)}</div>
                      <div className="sa-muted">→ {formatDate(row.ends_at)}</div>
                    </>
                  ) : (
                    <span className="sa-muted">—</span>
                  )}
                </td>
                <td>
                  <span className={`sa-status-badge ${row.status}`}>
                    {SUB_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/** Baris lama (periode 3/6 bulan, diskon, atau tarif lain) — ditandai saja,
    angkanya tetap apa adanya. */
function isLegacySubscription(row: SubRow): boolean {
  return (
    !isSubscriptionPeriod(row.duration_months) ||
    (row.discount_pct ?? 0) > 0 ||
    row.monthly_price !== NON_BRT_MONTHLY_PRICE
  );
}

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
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
