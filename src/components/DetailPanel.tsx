"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { HalteData } from "@/data/haltes";
import { useFavorites, isLoggedIn } from "@/lib/favorites";
import { normalizeStreetViewUrl } from "@/lib/streetView";
import { getNearbyPlaces, type NearbyPlace } from "@/lib/overpass";
import { fmtCount } from "@/lib/network";
import { RIDERSHIP_SOURCE, type RidershipEstimate } from "@/lib/ridership";
import {
  NON_BRT_MONTHLY_PRICE,
  PREMIUM_CONTRACT_MONTHS,
  effectiveBasePrice,
  minNextBid,
  periodLabel,
  subscriptionTotal,
} from "@/lib/pricing";
import NearbyModal from "@/components/NearbyModal";
import { emitFavoriteToast, emitInfoToast } from "@/components/FavoriteToaster";

/** Field yang dibaca panel dari HalteData. Selain identitas semuanya
    opsional, supaya panel tidak bergantung pada detail proyeksi di
    lib/haltes-map.ts. Harga dan status lelang/sewa diambil dari endpoint
    live (/bids, /subscribe); field di sini hanya cadangan saat memuat. */
interface PanelHalte {
  id: string;
  name: string;
  mode: string;
  koridor?: string;
  addr?: string;
  /** Halte BRT: harga dasar efektif & penawaran tertinggi (Rupiah). */
  basePrice?: number;
  currentBidAmount?: number;
  closed?: boolean;
  auctionStartsAt?: string | null;
  auctionEndsAt?: string | null;
  /** Non-BRT: 'available' | 'taken' (dari is_available). */
  status?: string;
}

interface DetailPanelProps {
  halte: HalteData | null;
  onClose: () => void;
  onBid?: (halte: HalteData) => void;
  onSubscribe?: (halte: HalteData) => void;
  /** @deprecated Waitlist belum punya backend, jadi panel tidak punya CTA
      "kabari saya". Prop ini diabaikan dan hanya dipertahankan supaya
      pemanggil lama tetap terkompilasi. */
  onNotify?: (halte: HalteData) => void;
  detailLoading?: boolean;
  detailError?: string | null;
  /** Bumped by the page when a bid is successfully placed via BidModal.
      Triggers a refetch of /api/haltes/[id]/bids so the live current bid,
      bidder count, and history reflect the new state immediately. */
  bidRefreshKey?: number;
  /** Same idea for Non-BRT subscriptions via SubscribeModal — drives the
      sub-history refetch so the CTA flips to "Sedang Disewa" without a
      reload. */
  subscribeRefreshKey?: number;
}

/** GET /api/haltes/[id]/bids — dihitung server dengan lib/pricing.ts. */
interface LiveBidInfo {
  base_price: number;
  current_bid: number;
  min_next_bid: number;
  total_bidders: number;
  total_bids: number;
  is_available: boolean;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  contract_ends_at?: string | null;
  history: { amount: number; created_at: string }[];
}

/** GET /api/haltes/[id]/subscribe — anonim, tanpa nama perusahaan. */
interface LiveSubInfo {
  is_available?: boolean;
  active_until?: string | null;
  history: {
    duration_months: number;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string;
  }[];
}

/** Data live per halte. `info: null` = gagal dimuat dan belum pernah ada. */
type Tagged<T> = { id: string; info: T | null };

/** Tombol aksi di footer panel. */
type Cta = {
  label: string;
  bg: string;
  color: string;
  /** Absent = disabled. */
  handler?: () => void;
  /** Bid + langganan butuh login. */
  requiresAuth: boolean;
};

/** Muat ulang data live selama panel terbuka (selaras polling peta 10 s). */
const LIVE_REFRESH_MS = 10_000;

/** 100_000_000 → "Rp 100 jt", 2_500_000_000 → "Rp 2,5 M". */
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

function formatBidTimestamp(iso: string): string {
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

function formatDateId(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Format ms remaining into a compact countdown.
 *   < 0       → "Berakhir"
 *   < 1 jam   → "Berakhir dalam {N} menit"
 *   < 24 jam  → "Hh Mm Ss"   (e.g. "5j 14m 09d")
 *   ≥ 24 jam  → "Dh Hh"      (e.g. "2hr 5j") */
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Berakhir";
  const totalSec = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days >= 1) return `${days}hr ${hours}j`;
  if (hours >= 1) {
    return `${hours}j ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}d`;
  }
  if (minutes >= 1) {
    return `Berakhir dalam ${minutes} menit`;
  }
  return `Berakhir dalam ${seconds} detik`;
}

/** Tick the clock so any consumer that reads the current time stays fresh
    without manually wiring intervals. Returns the current epoch ms;
    consumers re-render when it changes. */
function useNowTick(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export default function DetailPanel({
  halte,
  onClose,
  onBid,
  onSubscribe,
  detailLoading = false,
  detailError = null,
  bidRefreshKey = 0,
  subscribeRefreshKey = 0,
}: DetailPanelProps) {
  const router = useRouter();
  const { has, toggle } = useFavorites();
  const [bump, setBump] = useState(false);
  const [streetExpanded, setStreetExpanded] = useState(false);
  // Single state object tagged with the halte id this data belongs to. We
  // derive `loadingNearby` from "stored id ≠ current halte id" so we never
  // need to call setState synchronously inside the effect (which would trip
  // react-hooks/set-state-in-effect).
  const [nearby, setNearby] = useState<{ id: string | null; places: NearbyPlace[] }>({
    id: null,
    places: [],
  });
  const [nearbyOpen, setNearbyOpen] = useState(false);
  // Estimasi potensi penumpang (data statis dari jadwal GTFS), di-tag id
  // halte seperti `nearby` — loading = tag ≠ halte yang sedang dibuka.
  const [ridership, setRidership] = useState<{
    id: string | null;
    data: RidershipEstimate | null;
  }>({ id: null, data: null });

  // Live data, each tagged with the halte id it belongs to. Render only
  // trusts a tag that matches the open halte, so switching haltes never
  // shows another halte's numbers and no synchronous reset is needed.
  const [liveBids, setLiveBids] = useState<Tagged<LiveBidInfo> | null>(null);
  const [bidHistoryOpen, setBidHistoryOpen] = useState(false);
  const [liveSubs, setLiveSubs] = useState<Tagged<LiveSubInfo> | null>(null);
  const [subHistoryOpen, setSubHistoryOpen] = useState(false);

  // Periodic refresh while a panel is open, so the CTA follows the DB when
  // TJ closes / reschedules an auction or a point gets rented.
  const openHalteId = halte?.id ?? null;
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!openHalteId) return;
    const t = window.setInterval(() => setLiveTick((v) => v + 1), LIVE_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [openHalteId]);

  // Countdown needs a 1 s tick on Halte BRT; Non-BRT only needs the date.
  const nowMs = useNowTick(!!halte, halte?.mode === "premium" ? 1000 : 30_000);

  useEffect(() => {
    if (!halte || halte.mode !== "premium") return;
    const id = halte.id;
    let cancelled = false;
    fetch(`/api/haltes/${encodeURIComponent(id)}/bids`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as LiveBidInfo) : null))
      .catch(() => null)
      .then((info) => {
        if (cancelled) return;
        // Keep the last good snapshot on a transient failure.
        setLiveBids((prev) =>
          info ? { id, info } : prev && prev.id === id && prev.info ? prev : { id, info: null }
        );
      });
    return () => {
      cancelled = true;
    };
    // Keyed on id/mode (the halte object is re-created by the detail
    // projection) plus the explicit refresh triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halte?.id, halte?.mode, bidRefreshKey, liveTick]);

  useEffect(() => {
    if (!halte || halte.mode !== "mass") return;
    const id = halte.id;
    let cancelled = false;
    fetch(`/api/haltes/${encodeURIComponent(id)}/subscribe`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as LiveSubInfo) : null))
      .catch(() => null)
      .then((info) => {
        if (cancelled) return;
        setLiveSubs((prev) =>
          info ? { id, info } : prev && prev.id === id && prev.info ? prev : { id, info: null }
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halte?.id, halte?.mode, subscribeRefreshKey, liveTick]);

  // Auto-fetch real POIs around the halte from OpenStreetMap (Overpass).
  // Race-guarded with a `cancelled` flag so a quickly-switched halte doesn't
  // overwrite the newer halte's results with stale ones from a slow request.
  useEffect(() => {
    if (!halte?.lat || !halte?.lng) return;
    const id = halte.id;
    let cancelled = false;
    getNearbyPlaces(halte.lat, halte.lng).then((places) => {
      if (cancelled) return;
      setNearby({ id, places });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halte?.id]);

  const halteId = halte?.id;
  useEffect(() => {
    if (!halteId) return;
    let cancelled = false;
    fetch(`/api/haltes/${encodeURIComponent(halteId)}/ridership`)
      .then((res) => (res.ok ? res.json() : { data: null }))
      .then((body: { data?: RidershipEstimate | null }) => {
        if (!cancelled) setRidership({ id: halteId, data: body.data ?? null });
      })
      .catch(() => {
        if (!cancelled) setRidership({ id: halteId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [halteId]);

  if (!halte) return null;

  const isFav = has(halte.id);
  const handleFav = () => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    const isNowSaved = toggle(halte.id);
    emitFavoriteToast({ name: halte.name, saved: isNowSaved });
    setBump(true);
    window.setTimeout(() => setBump(false), 220);
  };

  const h = halte as unknown as PanelHalte;
  const isMass = halte.mode === "mass";

  const bidsLoaded = liveBids !== null && liveBids.id === halte.id;
  const liveInfo: LiveBidInfo | null = bidsLoaded ? liveBids.info : null;
  const subsLoaded = liveSubs !== null && liveSubs.id === halte.id;
  const liveSubInfo: LiveSubInfo | null = subsLoaded ? liveSubs.info : null;

  // -------------------------------------------------------------------------
  // Halte BRT (lelang). Data live (no-store) didahulukan; proyeksi detail
  // (cache pendek) hanya cadangan selama data live dimuat.
  // -------------------------------------------------------------------------
  const rawBasePrice = liveInfo ? liveInfo.base_price : h.basePrice;
  const basePrice =
    rawBasePrice !== undefined && rawBasePrice !== null
      ? effectiveBasePrice(rawBasePrice)
      : null;
  const currentBid = liveInfo ? liveInfo.current_bid : (h.currentBidAmount ?? 0);
  const nextMinBid = liveInfo
    ? liveInfo.min_next_bid
    : basePrice !== null
      ? minNextBid(basePrice, currentBid)
      : null;
  const auctionAvailable = liveInfo ? liveInfo.is_available : !h.closed;
  const startsMs = parseMs(liveInfo ? liveInfo.auction_starts_at : h.auctionStartsAt);
  const endsMs = parseMs(liveInfo ? liveInfo.auction_ends_at : h.auctionEndsAt);
  const contractEndsIso = liveInfo?.contract_ends_at ?? null;
  const contractEndsMs = parseMs(contractEndsIso);
  const scheduled = startsMs !== null && endsMs !== null;
  const notStarted = startsMs !== null && endsMs !== null && nowMs < startsMs;
  const ended = startsMs !== null && endsMs !== null && nowMs >= endsMs;
  const auctionOpen = auctionAvailable && scheduled && !notStarted && !ended;
  const contractRunning = contractEndsMs !== null && contractEndsMs > nowMs;

  // -------------------------------------------------------------------------
  // Bus stop Non-BRT (langganan). "Disewa" = ada langganan aktif dengan
  // ends_at >= hari ini (sama dengan aturan server).
  // -------------------------------------------------------------------------
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const activeUntil: string | null = liveSubInfo
    ? (liveSubInfo.active_until ??
      liveSubInfo.history
        .map((s) => s.ends_at)
        .filter((d): d is string => !!d && d >= todayIso)
        .sort()
        .pop() ??
      null)
    : null;
  const rented = activeUntil !== null;
  const massAvailable = liveSubInfo?.is_available ?? h.status !== "taken";

  // -------------------------------------------------------------------------
  // Baris status di body
  // -------------------------------------------------------------------------
  let statusRows: React.ReactNode;
  if (isMass) {
    const statusText = rented
      ? `Sedang disewa hingga ${formatDateId(activeUntil)}`
      : massAvailable
        ? "Tersedia untuk langganan"
        : "Tidak dibuka untuk langganan";
    statusRows = (
      <>
        <div className="detail-row">
          <span className="detail-row-lbl">Status</span>
          <span
            className="detail-row-val"
            style={!rented && massAvailable ? { color: "var(--success)" } : undefined}
          >
            {statusText}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row-lbl">Periode</span>
          <span className="detail-row-val">Bulanan atau tahunan</span>
        </div>
      </>
    );
  } else {
    statusRows = (
      <>
        <div className="detail-row">
          <span className="detail-row-lbl">Penawar</span>
          <span className="detail-row-val">
            {liveInfo
              ? liveInfo.total_bids > 0
                ? `${liveInfo.total_bidders} perusahaan · ${liveInfo.total_bids} penawaran`
                : "Belum ada penawaran"
              : "—"}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row-lbl">Periode kontrak</span>
          <span className="detail-row-val">
            Tahunan ({PREMIUM_CONTRACT_MONTHS} bulan)
          </span>
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Angka besar + keterangan
  // -------------------------------------------------------------------------
  let bigLabel: string;
  let bidValueContent: React.ReactNode;
  let deltaContent: React.ReactNode;
  if (isMass) {
    bigLabel = "HARGA LANGGANAN";
    bidValueContent = (
      <>
        <span className="cur">Rp</span>
        {formatRupiahShort(NON_BRT_MONTHLY_PRICE).replace("Rp ", "")}
        <span className="per">/bulan</span>
      </>
    );
    deltaContent = rented ? (
      <span className="detail-delta-muted">
        Langganan berjalan hingga {formatDateId(activeUntil)}
      </span>
    ) : (
      <span className={massAvailable ? undefined : "detail-delta-muted"}>
        {formatRupiahShort(NON_BRT_MONTHLY_PRICE)}/bulan · langganan bulanan atau
        tahunan ({formatRupiahShort(subscriptionTotal(12))})
      </span>
    );
  } else {
    const hasBid = currentBid > 0;
    bigLabel = hasBid ? "PENAWARAN TERTINGGI" : "HARGA DASAR · BELUM ADA PENAWARAN";
    const shown = hasBid ? currentBid : basePrice;
    bidValueContent =
      shown !== null && shown > 0 ? (
        <>
          <span className="cur">Rp</span>
          {formatRupiahShort(shown).replace("Rp ", "")}
          <span className="per">/tahun</span>
        </>
      ) : bidsLoaded ? (
        "—"
      ) : (
        <span className="skeleton-inline" aria-label="Memuat harga" />
      );
    let deltaText: string;
    if (hasBid) {
      deltaText =
        basePrice !== null ? `Harga dasar ${formatRupiahShort(basePrice)}` : "";
      if (auctionOpen && nextMinBid !== null) {
        deltaText += `${deltaText ? " · " : ""}minimal berikutnya ${formatRupiahShort(nextMinBid)}`;
      }
    } else {
      deltaText = auctionOpen
        ? "Penawaran pertama minimal harga dasar"
        : "Harga dasar ditetapkan TJ";
    }
    deltaContent = <span className="detail-delta-muted">{deltaText}</span>;
  }

  // -------------------------------------------------------------------------
  // Countdown (BRT) / preview pengumuman (Non-BRT)
  // -------------------------------------------------------------------------
  let timerContent: React.ReactNode = null;
  if (isMass) {
    if (!rented && massAvailable) {
      timerContent = (
        <div className="channel-preview">
          <strong>Preview: </strong>
          &ldquo;Pemberhentian berikutnya. {halte.name},{" "}
          <span className="brand-hl">[Nama Brand Anda]</span>.&rdquo;
        </div>
      );
    }
  } else {
    // Semua dari kolom DB: is_available, jadwal lelang, contract_ends_at.
    let countdownLabel = "Sisa waktu";
    let countdownText: string;
    let countdownUrgent = false;
    let struck = false;
    if (!auctionAvailable) {
      countdownLabel = contractRunning ? "Kontrak hingga" : "Status";
      countdownText = contractRunning ? formatDateId(contractEndsIso) : "Ditutup";
      struck = !contractRunning;
    } else if (startsMs === null || endsMs === null) {
      countdownLabel = "Jadwal";
      countdownText = "Belum dijadwalkan";
    } else if (nowMs < startsMs) {
      countdownLabel = "Mulai dalam";
      countdownText = formatCountdown(startsMs - nowMs);
    } else if (nowMs >= endsMs) {
      countdownLabel = "Status";
      countdownText = "Berakhir";
      struck = true;
    } else {
      const remaining = endsMs - nowMs;
      countdownText = formatCountdown(remaining);
      // Last hour → urgent style.
      countdownUrgent = remaining < 60 * 60 * 1000;
    }
    timerContent = (
      <div className="detail-timer-large">
        <span className="detail-row-lbl" style={{ fontSize: "10px" }}>
          {countdownLabel}
        </span>
        <span
          className={`timer-val ${countdownUrgent ? "urgent" : ""}`}
          style={struck ? { textDecoration: "line-through", color: "var(--text-3)" } : {}}
        >
          {countdownText}
        </span>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // CTA label + style + handler
  // -------------------------------------------------------------------------
  const disabledCta = (
    label: string,
    bg = "var(--surface)",
    color = "var(--text-3)"
  ): Cta => ({ label, bg, color, requiresAuth: false });

  let cta: Cta;
  if (isMass) {
    if (rented) cta = disabledCta("Sedang Disewa");
    else if (!massAvailable) cta = disabledCta("Tidak Tersedia");
    else
      cta = {
        label: "Berlangganan →",
        bg: "var(--text)",
        color: "var(--surface)",
        handler: () => onSubscribe?.(halte),
        requiresAuth: true,
      };
  } else if (!auctionAvailable) {
    cta = contractRunning
      ? disabledCta("Pemenang Ditetapkan", "var(--success)", "var(--surface)")
      : disabledCta("Lelang Ditutup");
  } else if (!scheduled) {
    cta = disabledCta("Lelang Belum Dijadwalkan");
  } else if (notStarted) {
    cta = disabledCta("Lelang Belum Dimulai");
  } else if (ended) {
    // Window passed but TJ hasn't closed it yet — POST bids would 400.
    cta = disabledCta("Lelang Berakhir");
  } else {
    cta = {
      label: "Pasang Bid →",
      bg: "var(--text)",
      color: "var(--surface)",
      handler: () => onBid?.(halte),
      requiresAuth: true,
    };
  }

  const ctaLabel = cta.label;
  const ctaBg = cta.bg;
  const ctaColor = cta.color;
  const ctaDisabled = !cta.handler;
  // Wrap with auth gate: show toast + redirect to /login if user not logged in.
  // Modal stays closed in that case.
  const { handler, requiresAuth } = cta;
  const ctaHandler = handler
    ? () => {
        if (requiresAuth && !isLoggedIn()) {
          emitInfoToast("Silakan masuk dulu untuk melanjutkan");
          window.setTimeout(() => router.push("/login"), 1500);
          return;
        }
        handler();
      }
    : undefined;

  return (
    <div className="detail-panel open">
      {/* Head */}
      <div className="detail-head">
        <button className="detail-close" onClick={onClose} aria-label="Tutup panel">
          ✕
        </button>

        <div className="detail-tier">
          {isMass ? "Bus stop Non-BRT" : "Halte BRT · Premium"}
        </div>

        <div className="detail-label">{h.koridor}</div>
        <h3 className="detail-name">{halte.name}</h3>
        <div className="detail-addr">{h.addr}</div>
      </div>

      {/* Scrollable content */}
      <div className="detail-scroll">
        <div className="detail-body">
          {halte.streetViewUrl && (
            <div style={{ marginBottom: '16px' }}>
              <p style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-3)',
                marginBottom: '8px'
              }}>
                📍 Lihat Lokasi · Street View
              </p>
              {/*
                Google's Street View embed always renders a compass + zoom
                cluster on the right edge that no URL/CSS option can hide
                (it's cross-origin iframe content). Trick: wrap in a
                clipped, overflow:hidden box and make the iframe wider than
                the box so the compass + zoom are pushed past the visible
                edge. The 88px overshoot matches the typical control width.
              */}
              <div style={{
                position: 'relative',
                width: '100%',
                height: '200px',
                borderRadius: '12px',
                overflow: 'hidden',
              }}>
                <iframe
                  src={normalizeStreetViewUrl(halte.streetViewUrl)}
                  referrerPolicy="no-referrer-when-downgrade"
                  loading="lazy"
                  allowFullScreen
                  title={`Street View — ${halte.name}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 'calc(100% + 88px)',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                  }}
                />
                {/* Expand button — overlays bottom-right of preview, opens
                    a fullscreen modal so the user can pan/zoom comfortably. */}
                <button
                  type="button"
                  onClick={() => setStreetExpanded(true)}
                  aria-label="Perbesar Street View"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: 'rgba(15, 37, 64, 0.78)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    transition: 'background 0.15s, transform 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(15, 37, 64, 0.95)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(15, 37, 64, 0.78)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  title="Perbesar"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Fullscreen Street View modal — opens when the expand button is
              clicked. Click the backdrop or the close button to shrink back. */}
          {halte.streetViewUrl && streetExpanded && (
            <div
              onClick={() => setStreetExpanded(false)}
              role="dialog"
              aria-modal="true"
              aria-label={`Street View — ${halte.name}`}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 37, 64, 0.78)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 900,
                padding: 'clamp(12px, 3vw, 32px)',
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: '1200px',
                  height: '100%',
                  maxHeight: '80vh',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  background: '#000',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
                }}
              >
                <iframe
                  src={normalizeStreetViewUrl(halte.streetViewUrl)}
                  referrerPolicy="no-referrer-when-downgrade"
                  loading="lazy"
                  allowFullScreen
                  title={`Street View — ${halte.name}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setStreetExpanded(false)}
                  aria-label="Tutup Street View"
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'rgba(15, 37, 64, 0.85)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    transition: 'background 0.15s, transform 0.15s',
                    zIndex: 2,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(15, 37, 64, 1)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(15, 37, 64, 0.85)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  title="Tutup"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          {detailError && (
            <div
              className="detail-row"
              style={{
                color: "var(--danger, #c4403a)",
                fontSize: "12px",
                padding: "10px 12px",
                background: "rgba(196, 64, 58, 0.08)",
                borderRadius: "8px",
                marginBottom: "8px",
                display: "block",
              }}
              role="alert"
            >
              Gagal memuat detail halte: {detailError}
            </div>
          )}
          <div className="detail-row">
            <span className="detail-row-lbl">
              Tempat sekitar
              <span className="detail-row-src">(OpenStreetMap)</span>
            </span>
            <span
              className="detail-row-val"
              style={{ textAlign: "right", maxWidth: "60%" }}
            >
              {(() => {
                if (detailLoading) {
                  return <span className="skeleton-inline" aria-label="Memuat tempat sekitar" />;
                }
                // Loading: animated dots while Overpass responds.
                // Live data found: up to 3 OSM names + "Lihat semua" link
                //   (if there are more than 3) to open the full modal.
                // No live data (empty / error / timeout): "—".
                const loadingNearby = nearby.id !== halte.id;
                if (loadingNearby) {
                  return (
                    <span className="overpass-loading" aria-label="Memuat data sekitar">
                      <span /><span /><span />
                    </span>
                  );
                }
                if (nearby.places.length > 0) {
                  const preview = nearby.places.slice(0, 3).map((p) => p.name).join(" · ");
                  return (
                    <span className="nearby-cell">
                      <span className="nearby-preview">{preview}</span>
                      {nearby.places.length > 3 && (
                        <button
                          type="button"
                          className="nearby-see-all-btn"
                          onClick={() => setNearbyOpen(true)}
                        >
                          Lihat semua
                          <span aria-hidden="true" style={{ marginLeft: 6 }}>→</span>
                        </button>
                      )}
                    </span>
                  );
                }
                return "—";
              })()}
            </span>
          </div>
          {statusRows}
        </div>

        {/* Potensi penumpang — ESTIMASI rata-rata (jadwal GTFS × pelanggan
            TJ per jenis layanan), bukan data tap-in. Cara hitung:
            lib/ridership.ts. Label "Estimasi" + cara hitung wajib tampil. */}
        <div className="analytics-section">
          {(() => {
            if (ridership.id !== halte.id) {
              return (
                <div className="audience-card" aria-busy="true">
                  <span className="skeleton-inline" aria-label="Memuat estimasi penumpang" />
                </div>
              );
            }
            const r = ridership.data;
            if (!r) {
              return (
                <p className="audience-empty">
                  Estimasi penumpang belum tersedia — titik ini tidak ada di
                  jadwal resmi (GTFS) Transjakarta.
                </p>
              );
            }
            const shownRoutes = r.routes.slice(0, 6);
            const moreRoutes = r.routes.length - shownRoutes.length;
            const gtfsDate = new Date(r.gtfsDate).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
            return (
              <div className="audience-card">
                <div className="audience-head">
                  <span className="audience-kicker">Potensi penumpang</span>
                  <span className="audience-badge">Estimasi</span>
                </div>
                <div className="audience-value">
                  ±{fmtCount(r.passengersPerDay)}
                  <span className="audience-unit">/hari</span>
                </div>
                <p className="audience-desc">
                  penumpang diangkut bus yang berhenti di sini
                </p>
                <div className="audience-facts">
                  <span>{fmtCount(r.busesPerDay)} bus berhenti/hari</span>
                  {r.routes.length > 0 && (
                    <span>
                      {r.routes.length} rute: {shownRoutes.join(", ")}
                      {moreRoutes > 0 && ` +${moreRoutes}`}
                    </span>
                  )}
                </div>
                <details className="audience-method">
                  <summary>Cara hitung</summary>
                  <p>
                    {`Penumpang Transjakarta ${r.ridershipYear} per jenis layanan ` +
                      "(BRT & Non-BRT, Mikrotrans, Transjabodetabek) dibagi rata " +
                      "ke semua perjalanan bus terjadwal, lalu dikalikan jumlah bus " +
                      "yang berhenti di titik ini. Ini angka rata-rata, bukan jumlah " +
                      "orang yang naik di titik ini — data tap-in belum terhubung."}
                  </p>
                  <p className="audience-source">
                    Sumber: jadwal GTFS Transjakarta ({gtfsDate}) ·{" "}
                    <a href={RIDERSHIP_SOURCE.url} target="_blank" rel="noopener noreferrer">
                      {RIDERSHIP_SOURCE.label}
                    </a>
                  </p>
                </details>
              </div>
            );
          })()}
        </div>

        {/* Bid section */}
        <div className="detail-bid-section">
          <div className="detail-big-label">{bigLabel}</div>
          <div className="detail-big-val">{bidValueContent}</div>
          <div className="detail-delta">{deltaContent}</div>
          {timerContent}

          {/* Riwayat penawaran — BRT only, blind (tanpa nama perusahaan).
              Default collapsed; the button shows the count. */}
          {!isMass && liveInfo && liveInfo.history.length > 0 && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                onClick={() => setBidHistoryOpen((v) => !v)}
                aria-expanded={bidHistoryOpen}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "var(--text-2)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>
                  Riwayat penawaran ({liveInfo.history.length}
                  {liveInfo.total_bids > liveInfo.history.length
                    ? ` / ${liveInfo.total_bids}`
                    : ""}
                  )
                </span>
                <span aria-hidden="true">{bidHistoryOpen ? "▲" : "▼"}</span>
              </button>
              {bidHistoryOpen && (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {liveInfo.history.map((entry, idx) => (
                    <li
                      key={`${entry.created_at}-${idx}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "6px 0",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 13,
                        color: "var(--text-2)",
                      }}
                    >
                      <span style={{ color: "var(--text-3)" }}>
                        Penawaran · {formatBidTimestamp(entry.created_at)}
                      </span>
                      <strong style={{ color: "var(--text)", fontWeight: 600 }}>
                        {formatRupiahFull(entry.amount)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Riwayat langganan — Non-BRT only, blind (tanpa nama perusahaan). */}
          {isMass && liveSubInfo && liveSubInfo.history.length > 0 && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                onClick={() => setSubHistoryOpen((v) => !v)}
                aria-expanded={subHistoryOpen}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "var(--text-2)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>Riwayat Langganan ({liveSubInfo.history.length})</span>
                <span aria-hidden="true">{subHistoryOpen ? "▲" : "▼"}</span>
              </button>
              {subHistoryOpen && (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {liveSubInfo.history.map((entry, idx) => {
                    const startsLabel = entry.starts_at
                      ? new Date(entry.starts_at).toLocaleDateString(
                          "id-ID",
                          { day: "2-digit", month: "short" }
                        )
                      : "—";
                    const endsLabel = entry.ends_at
                      ? new Date(entry.ends_at).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—";
                    return (
                      <li
                        key={`${entry.created_at}-${idx}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "6px 0",
                          borderBottom: "1px solid var(--border)",
                          fontSize: 13,
                          color: "var(--text-2)",
                        }}
                      >
                        <span style={{ color: "var(--text-3)" }}>
                          Disewa · {startsLabel} → {endsLabel}
                        </span>
                        <strong
                          style={{ color: "var(--text)", fontWeight: 600 }}
                        >
                          {periodLabel(entry.duration_months)}
                        </strong>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer CTA — hidden while the Nearby modal is open so the modal
          reads as a focused overlay without the brand chrome competing. */}
      <div className="detail-footer" hidden={nearbyOpen} aria-hidden={nearbyOpen}>
        <button
          className={`detail-btn fav-btn${isFav ? " saved" : ""}${bump ? " bump" : ""}`}
          onClick={handleFav}
          aria-label={isFav ? "Hapus dari favorit" : "Simpan ke favorit"}
          aria-pressed={isFav}
          type="button"
        >
          {isFav ? (
            <svg viewBox="0 0 32 32" fill="currentColor" stroke="none">
              <path d="M16 28s-11-7.2-11-15a6 6 0 0 1 11-3.3A6 6 0 0 1 27 13c0 7.8-11 15-11 15z" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
            >
              <path d="M16 28s-11-7.2-11-15a6 6 0 0 1 11-3.3A6 6 0 0 1 27 13c0 7.8-11 15-11 15z" />
            </svg>
          )}
        </button>
        <button
          className="detail-btn"
          disabled={ctaDisabled}
          style={{ background: ctaBg, color: ctaColor, borderColor: ctaBg }}
          onClick={ctaHandler}
        >
          {ctaLabel}
        </button>
      </div>

      <NearbyModal
        open={nearbyOpen}
        onClose={() => setNearbyOpen(false)}
        halteName={halte.name}
        places={nearby.places}
      />
    </div>
  );
}
