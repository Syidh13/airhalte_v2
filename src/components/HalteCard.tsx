"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  type HalteData,
  type PremiumHalte,
  type MassHalte,
  getHaltePhoto,
} from "@/data/haltes";
import { fmtRupiahShort } from "@/lib/format";
import { NON_BRT_MONTHLY_PRICE, PREMIUM_CONTRACT_MONTHS } from "@/lib/pricing";
import { PRICE_COPY } from "@/lib/haltes-map";
import { useFavorites, isLoggedIn } from "@/lib/favorites";
import { emitFavoriteToast } from "@/components/FavoriteToaster";

type LooseHalte = Omit<PremiumHalte, "mode"> & Omit<MassHalte, "mode"> & { mode: string };

interface HalteCardProps {
  halte: HalteData;
  active: boolean;
  onClick: (halte: HalteData) => void;
}

// ---------------------------------------------------------------------------
// Coarse shared clock for auction countdowns: one interval for every card,
// ticking every 30 s. Server snapshot is 0 → no countdown is rendered.
// ---------------------------------------------------------------------------
const CLOCK_MS = 30_000;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      for (const l of clockListeners) l();
    }, CLOCK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const getClock = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS;
const getServerClock = () => 0;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "3 hari" / "5 jam" / "12 menit" — deliberately coarse (30 s clock). */
function fmtRemaining(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "kurang dari 1 menit";
  if (min < 60) return `${min} menit`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

/** "Rp 2M" → "2M" (the "Rp" is rendered in its own span). */
function amountNoRp(n: number): string {
  return fmtRupiahShort(n).replace(/^Rp\s*/, "");
}

type AuctionPhase = "closed" | "open" | "upcoming" | "ended" | "unscheduled";

/** Auction state from DB fields only (closed flag + auction window). */
function auctionPhase(
  h: LooseHalte,
  now: number
): { phase: AuctionPhase; msLeft: number | null } {
  if (h.closed) return { phase: "closed", msLeft: null };
  const start = h.auctionStartsAt ? Date.parse(h.auctionStartsAt) : NaN;
  const end = h.auctionEndsAt ? Date.parse(h.auctionEndsAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { phase: "unscheduled", msLeft: null };
  }
  if (!now) return { phase: "open", msLeft: null }; // server render: no clock
  if (now < start) return { phase: "upcoming", msLeft: start - now };
  if (now >= end) return { phase: "ended", msLeft: null };
  return { phase: "open", msLeft: end - now };
}

export default function HalteCard({ halte, active, onClick }: HalteCardProps) {
  const router = useRouter();
  const { has, toggle } = useFavorites();
  const saved = has(halte.id);
  const [bump, setBump] = useState(false);
  const [imgError, setImgError] = useState(false);
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    const isNowSaved = toggle(halte.id);
    emitFavoriteToast({ name: halte.name, saved: isNowSaved });
    setBump(true);
    window.setTimeout(() => setBump(false), 220);
  };

  const isMass = halte.mode === "mass";
  const h = halte as unknown as LooseHalte;
  const photoUrl = getHaltePhoto(halte);
  const { phase, msLeft } = isMass
    ? { phase: "unscheduled" as AuctionPhase, msLeft: null }
    : auctionPhase(h, now);
  const isTaken = isMass
    ? h.status === "taken"
    : phase === "closed" || phase === "ended";

  // Status pill content
  let statusLabel = "";
  let statusClass = "";
  if (isMass) {
    statusLabel = isTaken ? "Tidak tersedia" : "Tersedia";
    statusClass = isTaken ? "taken" : "live";
  } else if (phase === "closed") {
    statusLabel = "Lelang ditutup";
    statusClass = "taken";
  } else if (phase === "ended") {
    statusLabel = "Lelang berakhir";
    statusClass = "taken";
  } else if (phase === "open") {
    const endsSoon = msLeft !== null && msLeft < DAY_MS;
    statusLabel = endsSoon ? "Berakhir segera" : "Lelang berjalan";
    statusClass = endsSoon ? "live" : "";
  } else if (phase === "upcoming") {
    statusLabel = "Lelang belum dibuka";
  } else {
    statusLabel = "Belum dijadwalkan";
  }

  // Price block — live DB values only.
  let bidLabel = "";
  let bidValue: React.ReactNode = null;
  let metaLeft: React.ReactNode = null;
  if (isMass) {
    bidLabel = "Tarif tetap";
    bidValue = (
      <>
        <span className="currency">Rp</span> {amountNoRp(NON_BRT_MONTHLY_PRICE)}
        <span className="per"> /bulan</span>
      </>
    );
    metaLeft = (
      <>
        Langganan bulanan / tahunan
        <br />
        <span style={{ color: "var(--text-3)" }}>{PRICE_COPY.nonBrtYearly}</span>
      </>
    );
  } else {
    const bid = h.currentBidAmount ?? 0;
    const base = h.basePrice;
    const finished = phase === "closed" || phase === "ended";
    const shown = bid > 0 ? bid : base;
    bidLabel =
      bid > 0 ? (finished ? "Penawaran akhir" : "Penawaran tertinggi") : "Harga dasar";
    bidValue =
      shown !== undefined ? (
        <>
          <span className="currency">Rp</span> {amountNoRp(shown)}
          <span className="per"> /tahun</span>
        </>
      ) : (
        "—"
      );
    let metaSub: string | null = null;
    if (bid > 0 && base !== undefined) metaSub = `Harga dasar ${fmtRupiahShort(base)}`;
    else if (bid === 0 && phase === "open") metaSub = "Belum ada penawaran";
    metaLeft = (
      <>
        Lelang · kontrak {PREMIUM_CONTRACT_MONTHS} bulan
        {metaSub && (
          <>
            <br />
            <span style={{ color: "var(--text-3)" }}>{metaSub}</span>
          </>
        )}
      </>
    );
  }

  // Countdown pill — only when the DB auction window gives a real time.
  let timerText: string | null = null;
  let timerUrgent = false;
  if (!isMass && msLeft !== null) {
    if (phase === "open") {
      timerText = `Berakhir dalam ${fmtRemaining(msLeft)}`;
      timerUrgent = msLeft < HOUR_MS;
    } else if (phase === "upcoming") {
      timerText = `Dibuka dalam ${fmtRemaining(msLeft)}`;
    }
  }

  return (
    <div
      className={`listing-item ${isMass ? "mass" : "premium"} ${isTaken ? "is-taken" : ""} ${active ? "active" : ""}`}
      onClick={() => onClick(halte)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick(halte)}
    >
      {/* Photo */}
      <div className="listing-photo">
        {imgError || !photoUrl ? (
          <div className="listing-photo-fallback" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10z" />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
          </div>
        ) : (
          <Image
            className="listing-photo-img"
            src={photoUrl}
            alt={halte.name}
            fill
            sizes="420px"
            style={{ objectFit: "cover" }}
            onError={() => setImgError(true)}
            unoptimized
          />
        )}

        {/* Segment badge (Halte BRT / bus stop Non-BRT) */}
        <div className="listing-tier-badge">
          <span className="dot" style={{ background: "var(--brand)" }} />
          {isMass ? "Bus stop Non-BRT" : "Halte BRT"}
        </div>

        {/* Save heart */}
        <button
          className={`listing-save${saved ? " saved" : ""}${bump ? " bump" : ""}`}
          onClick={handleToggleFavorite}
          aria-label={saved ? "Hapus dari favorit" : "Simpan ke favorit"}
          aria-pressed={saved}
        >
          {saved ? (
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

        {/* Status pill */}
        <div className={`listing-photo-status ${statusClass}`}>
          {statusClass === "live" && <span className="live-dot" />}
          {statusLabel}
        </div>
      </div>

      {/* Body */}
      <div className="listing-body">
        <div className="listing-koridor-row">
          <span>{halte.koridor}</span>
        </div>
        <div className="listing-name">{halte.name}</div>
        {halte.addr && halte.addr !== "—" && (
          <div className="listing-addr">{halte.addr}</div>
        )}

        <div className="listing-meta-row">
          <div className="listing-meta-left">{metaLeft}</div>
          <div className="listing-bid-block">
            <div className="listing-bid-lbl">{bidLabel}</div>
            <div className="listing-bid-val">{bidValue}</div>
          </div>
        </div>

        {/* Countdown pill — premium, only with a real auction window */}
        {timerText && (
          <div className={`listing-timer-pill ${timerUrgent ? "urgent" : ""}`}>
            <span className="live-dot" />
            {timerText}
          </div>
        )}
      </div>
    </div>
  );
}
