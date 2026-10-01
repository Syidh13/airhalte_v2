"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, fetchWithRetry, kickSupabase } from "@/lib/supabase";
import RevenueChart, {
  type RevenueSeriesPoint,
} from "@/components/superadmin/RevenueChart";
import {
  fmtDateShortId,
  fmtRelativeId,
  fmtRupiahShort,
} from "@/lib/format";
import { EXCLUDED_HALTE_IDS } from "@/data/haltes";

/** PostgREST filter value for `.not(col, "in", …)` — record uji tidak
    pernah dihitung. */
const HIDDEN_HALTE_FILTER = `(${[...EXCLUDED_HALTE_IDS].join(",")})`;

// ---------------------------------------------------------------------------
// Types — minimal projection of the Supabase rows we actually consume.
// ---------------------------------------------------------------------------
interface Kpis {
  haltesActive: number;
  companiesActive: number;
  bidsTotal: number;
  subsActive: number;
  /** Nilai kontrak lelang yang sudah dimenangkan (bids.status='won'). */
  wonContractValue: number;
  /** Nilai langganan Non-BRT yang masih aktif. */
  activeSubsValue: number;
}

interface ActivePropertyRow {
  id: string;
  source: "bid" | "sub";
  halteName: string;
  halteType: "brt" | "non-brt";
  sponsor: string;
  amount: number;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
}

interface ActivityRow {
  id: string;
  kind: "company" | "bid" | "sub";
  text: string;
  createdAt: string;
}

type RangeKey = "7" | "30" | "90";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SuperadminDashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [revenueRows, setRevenueRows] = useState<{
    bids: { amount: number; created_at: string }[];
    subs: { total_price: number; created_at: string }[];
  }>({ bids: [], subs: [] });
  const [activeProps, setActiveProps] = useState<ActivePropertyRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30");

  // Request-id guard: every fetchAll bumps the counter, only the latest
  // call writes to state. Same pattern as the companies/haltes pages —
  // protects both unmount and tab-visibility refetch from overwriting
  // newer state with an older response.
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const myId = ++requestIdRef.current;
    // Langganan dihitung aktif selama ends_at >= hari ini (sama dengan
    // aturan server); status 'active' saja bisa sudah lewat masa berlakunya.
    const todayDateOnly = new Date().toISOString().slice(0, 10);
    try {
        // Parallel — small queries against tables that already have
        // RLS-allowed superadmin SELECT, so this is one round-trip's
        // worth of latency in practice. Record uji selalu dikecualikan.
        const [
          haltesRes,
          companiesRes,
          bidsCountRes,
          subsActiveCountRes,
          bidsWonRes,
          subsActiveRowsRes,
          activePropsBidRes,
          activePropsSubRes,
          actCompaniesRes,
          actBidsRes,
          actSubsRes,
        ] = await fetchWithRetry(
          () => Promise.all([
          supabase
            .from("haltes")
            .select("id", { count: "exact", head: true })
            .eq("is_available", true)
            .not("id", "in", HIDDEN_HALTE_FILTER),
          supabase
            .from("companies")
            .select("id", { count: "exact", head: true })
            .eq("status", "active"),
          // Bid 'rejected' = arsip (skema lama / dibatalkan), tidak dihitung.
          supabase
            .from("bids")
            .select("id", { count: "exact", head: true })
            .neq("status", "rejected")
            .not("halte_id", "in", HIDDEN_HALTE_FILTER),
          supabase
            .from("subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .gte("ends_at", todayDateOnly)
            .not("halte_id", "in", HIDDEN_HALTE_FILTER),
          // Kontrak lelang = penawaran yang dimenangkan ('won'), bukan
          // penawaran tertinggi di lelang yang masih berjalan ('winning').
          supabase
            .from("bids")
            .select("amount, created_at")
            .eq("status", "won")
            .not("halte_id", "in", HIDDEN_HALTE_FILTER),
          supabase
            .from("subscriptions")
            .select("total_price, created_at")
            .eq("status", "active")
            .gte("ends_at", todayDateOnly)
            .not("halte_id", "in", HIDDEN_HALTE_FILTER),
          // Active properties — Halte BRT side (kontrak lelang)
          supabase
            .from("bids")
            .select(
              "id, amount, created_at, status, companies(company_name), haltes(name, type, contract_ends_at)"
            )
            .eq("status", "won")
            .not("halte_id", "in", HIDDEN_HALTE_FILTER)
            .order("created_at", { ascending: false })
            .limit(20),
          // Active properties — Non-BRT side (langganan)
          supabase
            .from("subscriptions")
            .select(
              "id, total_price, starts_at, ends_at, created_at, status, companies(company_name), haltes(name, type)"
            )
            .eq("status", "active")
            .gte("ends_at", todayDateOnly)
            .not("halte_id", "in", HIDDEN_HALTE_FILTER)
            .order("created_at", { ascending: false })
            .limit(10),
          // Activity feed sources — pull last 10 of each, then merge+sort
          supabase
            .from("companies")
            .select("id, company_name, created_at")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("bids")
            .select(
              "id, amount, created_at, companies(company_name), haltes(name)"
            )
            .not("halte_id", "in", HIDDEN_HALTE_FILTER)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("subscriptions")
            .select(
              "id, total_price, created_at, companies(company_name), haltes(name)"
            )
            .not("halte_id", "in", HIDDEN_HALTE_FILTER)
            .order("created_at", { ascending: false })
            .limit(10),
          ]),
          10_000,
          "load dashboard"
        );

        if (myId !== requestIdRef.current) return;

        // Bubble first error we hit. Most of these are HEAD requests so a
        // single message is enough to surface the failure.
        const firstError =
          haltesRes.error ||
          companiesRes.error ||
          bidsCountRes.error ||
          subsActiveCountRes.error ||
          bidsWonRes.error ||
          subsActiveRowsRes.error ||
          activePropsBidRes.error ||
          activePropsSubRes.error ||
          actCompaniesRes.error ||
          actBidsRes.error ||
          actSubsRes.error;
        if (firstError) {
          throw new Error(firstError.message);
        }

        const wonContractValue = (bidsWonRes.data ?? []).reduce(
          (s, r) => s + Number(r.amount ?? 0),
          0
        );
        const activeSubsValue = (subsActiveRowsRes.data ?? []).reduce(
          (s, r) => s + Number(r.total_price ?? 0),
          0
        );

        setKpis({
          haltesActive: haltesRes.count ?? 0,
          companiesActive: companiesRes.count ?? 0,
          bidsTotal: bidsCountRes.count ?? 0,
          subsActive: subsActiveCountRes.count ?? 0,
          wonContractValue,
          activeSubsValue,
        });

        setRevenueRows({
          bids:
            (bidsWonRes.data as {
              amount: number;
              created_at: string;
            }[]) ?? [],
          subs:
            (subsActiveRowsRes.data as {
              total_price: number;
              created_at: string;
            }[]) ?? [],
        });

        // ----- Active properties merge -----
        // Kontrak lelang dihitung aktif selama contract_ends_at belum lewat
        // (baris lama tanpa contract_ends_at tetap ditampilkan).
        const nowMs = Date.now();
        const props: ActivePropertyRow[] = [];
        for (const r of (activePropsBidRes.data ?? []) as unknown as Array<{
          id: string;
          amount: number;
          created_at: string;
          status: string;
          companies: { company_name: string } | null;
          haltes: {
            name: string;
            type: "brt" | "non-brt";
            contract_ends_at: string | null;
          } | null;
        }>) {
          const contractEnds = r.haltes?.contract_ends_at ?? null;
          if (contractEnds && Date.parse(contractEnds) <= nowMs) continue;
          props.push({
            id: `bid-${r.id}`,
            source: "bid",
            halteName: r.haltes?.name ?? "—",
            halteType: r.haltes?.type ?? "brt",
            sponsor: r.companies?.company_name ?? "—",
            amount: r.amount,
            startsAt: r.created_at,
            endsAt: contractEnds,
            status: r.status,
          });
        }
        for (const r of (activePropsSubRes.data ?? []) as unknown as Array<{
          id: string;
          total_price: number;
          starts_at: string | null;
          ends_at: string | null;
          created_at: string;
          status: string;
          companies: { company_name: string } | null;
          haltes: { name: string; type: "brt" | "non-brt" } | null;
        }>) {
          props.push({
            id: `sub-${r.id}`,
            source: "sub",
            halteName: r.haltes?.name ?? "—",
            halteType: r.haltes?.type ?? "non-brt",
            sponsor: r.companies?.company_name ?? "—",
            amount: r.total_price,
            startsAt: r.starts_at ?? r.created_at,
            endsAt: r.ends_at,
            status: r.status,
          });
        }
        // Newest contracts first; tie-break by amount desc.
        props.sort((a, b) => {
          const t = (b.startsAt ?? "").localeCompare(a.startsAt ?? "");
          return t !== 0 ? t : b.amount - a.amount;
        });
        setActiveProps(props.slice(0, 10));

        // ----- Activity feed merge -----
        const acts: ActivityRow[] = [];
        for (const r of (actCompaniesRes.data ?? []) as Array<{
          id: string;
          company_name: string;
          created_at: string;
        }>) {
          acts.push({
            id: `c-${r.id}`,
            kind: "company",
            text: `Pendaftar baru: ${r.company_name}`,
            createdAt: r.created_at,
          });
        }
        for (const r of (actBidsRes.data ?? []) as unknown as Array<{
          id: string;
          amount: number;
          created_at: string;
          companies: { company_name: string } | null;
          haltes: { name: string } | null;
        }>) {
          acts.push({
            id: `b-${r.id}`,
            kind: "bid",
            text: `${r.companies?.company_name ?? "Perusahaan"} bid ${fmtRupiahShort(r.amount)} untuk ${r.haltes?.name ?? "halte"}`,
            createdAt: r.created_at,
          });
        }
        for (const r of (actSubsRes.data ?? []) as unknown as Array<{
          id: string;
          total_price: number;
          created_at: string;
          companies: { company_name: string } | null;
          haltes: { name: string } | null;
        }>) {
          acts.push({
            id: `s-${r.id}`,
            kind: "sub",
            text: `${r.companies?.company_name ?? "Perusahaan"} berlangganan ${r.haltes?.name ?? "halte"} (${fmtRupiahShort(r.total_price)})`,
            createdAt: r.created_at,
          });
        }
        acts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setActivity(acts.slice(0, 10));

        setLoading(false);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        setError(
          err instanceof Error
            ? `Gagal memuat dashboard: ${err.message}`
            : "Gagal memuat dashboard."
        );
        setLoading(false);
      }
  }, []);

  useEffect(() => {
    // Initial load. fetchAll only sets state after awaiting the network
    // (never synchronously), so this cannot cause a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
    // Tab-visibility recovery — Supabase realtime isn't used here (this
    // page is read-only aggregates), but a long-hidden tab still has
    // stale numbers when the user comes back. Refetch on visibility-on
    // gives them fresh KPIs without needing a manual reload.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      kickSupabase();
      fetchAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchAll]);

  // -------------------------------------------------------------------------
  // Revenue series — bin bids+subs into per-day buckets for the chart.
  // Recomputed when range or revenueRows change.
  // -------------------------------------------------------------------------
  const series: RevenueSeriesPoint[] = useMemo(() => {
    const days = parseInt(range, 10);
    const buckets = new Map<string, { bid: number; sub: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      buckets.set(toIsoDay(d), { bid: 0, sub: 0 });
    }
    for (const b of revenueRows.bids) {
      const k = toIsoDay(new Date(b.created_at));
      const slot = buckets.get(k);
      if (slot) slot.bid += b.amount ?? 0;
    }
    for (const s of revenueRows.subs) {
      const k = toIsoDay(new Date(s.created_at));
      const slot = buckets.get(k);
      if (slot) slot.sub += s.total_price ?? 0;
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      bidIdr: v.bid,
      subIdr: v.sub,
    }));
  }, [range, revenueRows]);

  return (
    <div className="sa-page">
      {error && (
        <div className="sa-error" role="alert">
          {error}
          <button
            type="button"
            className="sa-btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={() => {
              setError(null);
              setLoading(true);
              kickSupabase();
              fetchAll();
            }}
          >
            Coba lagi
          </button>
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

      {/* ===== Section 1 — KPI Cards ===== */}
      <div className="sa-dash-kpi-grid">
        <KpiCard
          label="Titik Aktif"
          value={kpis ? String(kpis.haltesActive) : null}
          accent="brand"
        />
        <KpiCard
          label="Perusahaan Aktif"
          value={kpis ? String(kpis.companiesActive) : null}
          accent="brand"
        />
        <KpiCard
          label="Total Bid Masuk"
          value={kpis ? String(kpis.bidsTotal) : null}
          accent="neutral"
        />
        <KpiCard
          label="Langganan Aktif"
          value={kpis ? String(kpis.subsActive) : null}
          accent="success"
        />
        <KpiCard
          label="Nilai kontrak lelang (dimenangkan)"
          value={kpis ? fmtRupiahShort(kpis.wonContractValue) : null}
          accent="brand"
        />
        <KpiCard
          label="Nilai langganan aktif"
          value={kpis ? fmtRupiahShort(kpis.activeSubsValue) : null}
          accent="success"
        />
      </div>

      {/* ===== Section 2 — Revenue chart ===== */}
      <section className="sa-dash-card">
        <div className="sa-dash-card-head">
          <div>
            <h2 className="sa-dash-card-title">Tren Nilai Kontrak</h2>
            <p className="sa-dash-card-sub">
              Kontrak lelang (dimenangkan) &amp; langganan Non-BRT aktif —{" "}
              {range} hari terakhir
            </p>
          </div>
          <div className="sa-dash-range-toggle" role="tablist">
            {(["7", "30", "90"] as RangeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={range === k}
                className={`sa-dash-range-btn${range === k ? " active" : ""}`}
                onClick={() => setRange(k)}
              >
                {k}h
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="sa-dash-skeleton" style={{ height: 280 }} />
        ) : (
          <RevenueChart series={series} />
        )}
      </section>

      {/* ===== Section 3 — Active properties ===== */}
      <section className="sa-dash-card">
        <div className="sa-dash-card-head">
          <div>
            <h2 className="sa-dash-card-title">Properti Aktif Disponsori</h2>
            <p className="sa-dash-card-sub">
              Kontrak lelang yang dimenangkan dan langganan Non-BRT yang
              masih berjalan
            </p>
          </div>
          <Link href="/superadmin/haltes" className="sa-dash-link">
            Lihat semua →
          </Link>
        </div>
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Nama Halte</th>
                <th>Tipe</th>
                <th>Sponsor</th>
                <th>Nilai Kontrak</th>
                <th>Mulai – Selesai</th>
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
              {!loading && activeProps.length === 0 && (
                <tr>
                  <td colSpan={6} className="sa-empty">
                    Belum ada properti aktif.
                  </td>
                </tr>
              )}
              {!loading &&
                activeProps.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="sa-company-name">{p.halteName}</div>
                    </td>
                    <td>
                      <span className="sa-pill">
                        {p.halteType === "brt" ? "BRT" : "Non-BRT"}
                      </span>
                    </td>
                    <td>{p.sponsor}</td>
                    <td>{fmtRupiahShort(p.amount)}</td>
                    <td>
                      {p.startsAt ? (
                        <>
                          <div>{fmtDateShortId(p.startsAt)}</div>
                          {p.endsAt && (
                            <div className="sa-muted">
                              → {fmtDateShortId(p.endsAt)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="sa-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`sa-status-badge ${p.source === "bid" ? "won" : "active"}`}
                      >
                        {p.source === "bid" ? "Dimenangkan" : "Aktif"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== Section 4 — Activity feed ===== */}
      <section className="sa-dash-card">
        <div className="sa-dash-card-head">
          <div>
            <h2 className="sa-dash-card-title">Aktivitas Terbaru</h2>
            <p className="sa-dash-card-sub">
              Pendaftar, bid, dan langganan terkini
            </p>
          </div>
        </div>
        <ul className="sa-dash-activity">
          {loading && (
            <li className="sa-empty" style={{ padding: "20px 14px" }}>
              Memuat aktivitas…
            </li>
          )}
          {!loading && activity.length === 0 && (
            <li className="sa-empty" style={{ padding: "20px 14px" }}>
              Belum ada aktivitas.
            </li>
          )}
          {!loading &&
            activity.map((a) => (
              <li key={a.id} className="sa-dash-activity-item">
                <span
                  className={`sa-dash-activity-icon ${a.kind}`}
                  aria-hidden="true"
                >
                  {ACTIVITY_ICON[a.kind]}
                </span>
                <div className="sa-dash-activity-body">
                  <div className="sa-dash-activity-text">{a.text}</div>
                  <div className="sa-dash-activity-time">
                    {fmtRelativeId(a.createdAt)}
                  </div>
                </div>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null;
  accent: "brand" | "success" | "neutral";
}) {
  return (
    <div className={`sa-dash-kpi sa-dash-kpi-${accent}`}>
      <div className="sa-dash-kpi-label">{label}</div>
      <div className="sa-dash-kpi-value">
        {value === null ? <span className="sa-dash-skeleton-text" /> : value}
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityRow["kind"], React.ReactNode> = {
  company: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
    </svg>
  ),
  bid: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  sub: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M20 7L9 18l-5-5" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function toIsoDay(d: Date): string {
  // Local-day key (YYYY-MM-DD) so bucketing matches what a user would see
  // on the calendar in their timezone, not UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
