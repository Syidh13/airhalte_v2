"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import VoicePreviewCard from "./VoicePreviewCard";
import type { ToastData } from "@/components/Toast";
import {
  BID_MAX_AMOUNT,
  BID_MIN_INCREMENT_FLOOR,
  BID_MIN_INCREMENT_PCT,
  PREMIUM_CONTRACT_MONTHS,
} from "@/lib/pricing";

/** Bagian halte yang dipakai modal. Angka lelang selalu dibaca dari
    GET /api/haltes/[id]/bids, bukan dari teks tampilan panel. */
interface BidModalHalte {
  id: string;
  name: string;
}

interface BidModalProps {
  open: boolean;
  halte: BidModalHalte | null;
  onClose: () => void;
  onToast: (t: ToastData) => void;
  /** Called once the server confirms the bid landed. DetailPanel uses
      this to refetch the live bid state so the panel reflects the new
      current_bid + bidder count + history. */
  onSubmitted?: (newAmount: number) => void;
}

/** Ringkasan lelang dari GET /api/haltes/[id]/bids. Semua angka dihitung
    server dengan lib/pricing.ts (sama dengan validasi POST). */
interface AuctionQuote {
  base_price: number;
  current_bid: number;
  min_next_bid: number;
  is_available: boolean;
  auction_open?: boolean;
}

const MAX_DIGITS = String(BID_MAX_AMOUNT).length;
const INCREMENT_PCT_LABEL = `${Math.round(BID_MIN_INCREMENT_PCT * 100)}%`;
const INCREMENT_FLOOR_LABEL = `Rp ${Math.round(BID_MIN_INCREMENT_FLOOR / 1_000_000)} jt`;

function formatIDR(num: number): string {
  return "Rp " + num.toLocaleString("id-ID");
}

/** Ambil digit saja (tanpa nol di depan), dibatasi panjang BID_MAX_AMOUNT. */
function toDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
}

/** "105000000" → "105.000.000" (pemisah ribuan id-ID). */
function groupDigits(digits: string): string {
  return digits ? Number(digits).toLocaleString("id-ID") : "";
}

export default function BidModal(props: BidModalProps) {
  if (!props.halte) return null;
  // Keyed per halte: state (input, hasil) otomatis bersih setiap modal
  // dibuka untuk halte lain, tanpa reset lewat effect.
  return <BidModalContent key={props.halte.id} {...props} halte={props.halte} />;
}

function BidModalContent({
  open,
  halte,
  onClose,
  onToast,
  onSubmitted,
}: BidModalProps & { halte: BidModalHalte }) {
  // Naikkan untuk memuat ulang angka lelang (setelah submit / gagal).
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quote, setQuote] = useState<{ version: number; data: AuctionQuote } | null>(
    null
  );
  const [quoteError, setQuoteError] = useState<{ version: number; msg: string } | null>(
    null
  );
  const [digits, setDigits] = useState("");
  // true setelah pengguna mengetik: prefill minimum tidak menimpa input.
  const touchedRef = useRef(false);
  const [brand, setBrand] = useState("");
  const [success, setSuccess] = useState<{ amount: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const version = quoteVersion;
    fetch(`/api/haltes/${encodeURIComponent(halte.id)}/bids`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as
          | (AuctionQuote & { error?: string })
          | null;
        if (!res.ok || !json || typeof json.min_next_bid !== "number") {
          throw new Error(json?.error ?? "Gagal memuat data lelang.");
        }
        return json;
      })
      .then((data) => {
        if (cancelled) return;
        setQuote({ version, data });
        setQuoteError(null);
        if (!touchedRef.current) setDigits(String(data.min_next_bid));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setQuoteError({
          version,
          msg: e instanceof Error ? e.message : "Gagal memuat data lelang.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [halte.id, quoteVersion]);

  const q = quote?.data ?? null;
  const quoteReady = quote !== null && quote.version === quoteVersion;
  const quoteFailed = quoteError !== null && quoteError.version === quoteVersion;

  const amount = digits ? Number(digits) : 0;
  let validation: string | null = null;
  if (q) {
    if (!digits) validation = "Masukkan nominal penawaran.";
    else if (amount < q.min_next_bid) validation = `Minimal ${formatIDR(q.min_next_bid)}.`;
    else if (amount > BID_MAX_AMOUNT) validation = `Maksimal ${formatIDR(BID_MAX_AMOUNT)}.`;
  }
  const auctionClosed = q !== null && q.auction_open === false;
  const canSubmit =
    quoteReady && !validation && !auctionClosed && !submitting && !success;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/haltes/${encodeURIComponent(halte.id)}/bids`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            duration_months: PREMIUM_CONTRACT_MONTHS,
          }),
        }
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; current_bid: number }
        | { ok: false; error: string }
        | null;

      if (!json || !json.ok) {
        const msg =
          json && !json.ok
            ? json.error
            : `Penawaran gagal dikirim (HTTP ${res.status}).`;
        setError(msg);
        onToast({ label: "BID GAGAL", msg, variant: "warn" });
        // Angka lelang mungkin sudah berubah (mis. ada penawaran lain).
        setQuoteVersion((v) => v + 1);
        return;
      }

      setSuccess({ amount: json.current_bid });
      onToast({
        label: "BID TERCATAT",
        msg: `${formatIDR(json.current_bid)} untuk ${halte.name}`,
        variant: "ok",
      });
      onSubmitted?.(json.current_bid);
      setQuoteVersion((v) => v + 1);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Tidak bisa terhubung ke server. Periksa koneksi internet Anda.";
      setError(msg);
      onToast({ label: "BID GAGAL", msg, variant: "warn" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoiceUnsupported = () => {
    onToast({
      label: "TIDAK DIDUKUNG",
      msg: "Browser Anda tidak mendukung voice preview. Coba di Chrome atau Safari.",
      variant: "warn",
    });
  };

  const footer = success ? (
    <button className="modal-btn primary" onClick={onClose} type="button">
      Selesai
    </button>
  ) : (
    <>
      <button
        className="modal-btn outline"
        onClick={onClose}
        type="button"
        disabled={submitting}
      >
        Batal
      </button>
      <button
        className="modal-btn primary"
        onClick={handleSubmit}
        type="button"
        disabled={!canSubmit}
      >
        {submitting ? "Memproses…" : !quoteReady && !quoteFailed ? "Memuat…" : "Pasang Bid →"}
      </button>
    </>
  );

  const summary = (
    <div className="modal-summary">
      <div className="modal-summary-row">
        <span className="modal-summary-lbl">Halte</span>
        <span className="modal-summary-val">{halte.name}</span>
      </div>
      <div className="modal-summary-row">
        <span className="modal-summary-lbl">Periode</span>
        <span className="modal-summary-val">
          Tahunan ({PREMIUM_CONTRACT_MONTHS} bulan)
        </span>
      </div>
      <div className="modal-summary-row">
        <span className="modal-summary-lbl">Harga dasar</span>
        <span className="modal-summary-val">
          {q ? `${formatIDR(q.base_price)}/tahun` : "—"}
        </span>
      </div>
      <div className="modal-summary-row">
        <span className="modal-summary-lbl">Penawaran tertinggi saat ini</span>
        <span className="modal-summary-val">
          {q ? (q.current_bid > 0 ? formatIDR(q.current_bid) : "Belum ada penawaran") : "—"}
        </span>
      </div>
      <div className="modal-summary-row total">
        <span className="modal-summary-lbl">Minimum penawaran berikutnya</span>
        <span className="modal-summary-val">
          {q ? formatIDR(q.min_next_bid) : "—"}
        </span>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="§ 01 — PASANG BID"
      title={
        <>
          Bid untuk <em>{halte.name}</em>
        </>
      }
      footer={footer}
      wide
    >
      {success ? (
        <>
          <div className="modal-success">
            <div className="modal-success-icon">✓</div>
            <div className="modal-success-title">Penawaran Tercatat</div>
            <div className="modal-success-desc">
              Penawaran Anda sebesar <strong>{formatIDR(success.amount)}</strong>{" "}
              per tahun untuk {halte.name} telah tercatat. Pantau statusnya di
              Dashboard.
            </div>
          </div>
          {quoteReady && summary}
        </>
      ) : (
        <>
          <div className="modal-field">
            <div className="modal-field-lbl">Penawaran tertinggi saat ini</div>
            <div className="modal-field-display emphasize">
              {!q ? (
                quoteFailed ? "—" : "Memuat…"
              ) : q.current_bid > 0 ? (
                <>
                  {formatIDR(q.current_bid)}{" "}
                  <span className="bid-per-year">/ tahun</span>
                </>
              ) : (
                "Belum ada penawaran"
              )}
            </div>
          </div>

          {quoteFailed && (
            <div className="commerce-alert" role="alert">
              {quoteError?.msg}{" "}
              <button
                type="button"
                className="commerce-link-btn"
                onClick={() => setQuoteVersion((v) => v + 1)}
              >
                Coba lagi
              </button>
            </div>
          )}

          {auctionClosed && (
            <div className="commerce-alert" role="status">
              Lelang halte ini sedang tidak menerima penawaran.
            </div>
          )}

          <div className="modal-field">
            <label className="modal-field-lbl" htmlFor="bid-amount-input">
              Penawaran Anda (per tahun)
            </label>
            <div className="bid-input-wrap">
              <span className="bid-input-prefix" aria-hidden="true">
                Rp
              </span>
              <input
                id="bid-amount-input"
                className="modal-field-input bid-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={groupDigits(digits)}
                onChange={(e) => {
                  touchedRef.current = true;
                  setDigits(toDigits(e.target.value));
                }}
                placeholder={q ? groupDigits(String(q.min_next_bid)) : "0"}
                aria-invalid={validation !== null}
                aria-describedby="bid-amount-hint"
                disabled={submitting}
              />
            </div>
            {validation && (
              <div className="bid-input-error" role="alert">
                {validation}
              </div>
            )}
            <div className="modal-hint" id="bid-amount-hint">
              Penawaran pertama minimal harga dasar. Berikutnya minimal
              penawaran tertinggi + {INCREMENT_PCT_LABEL} (paling sedikit{" "}
              {INCREMENT_FLOOR_LABEL}).
            </div>
            {error && (
              <div className="commerce-alert" role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="modal-field">
            <div className="modal-field-lbl">Brand Anda (untuk preview suara)</div>
            <input
              className="modal-field-input"
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Nama brand Anda"
              maxLength={30}
            />
          </div>

          <VoicePreviewCard
            kicker="Simulasi suara · jika Anda menang"
            halteName={halte.name}
            brandValue={brand}
            emptyPlaceholder="Brand Anda"
            channels={["Papan nama halte", "Pengumuman suara di dalam bus"]}
            onUnsupported={handleVoiceUnsupported}
          />

          {summary}
        </>
      )}
    </Modal>
  );
}
