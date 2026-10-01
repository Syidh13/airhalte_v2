"use client";

import { useState } from "react";
import Modal from "./Modal";
import VoicePreviewCard from "./VoicePreviewCard";
import type { ToastData } from "@/components/Toast";
import {
  NON_BRT_MONTHLY_PRICE,
  SUBSCRIPTION_PERIODS,
  periodLabel,
  subscriptionTotal,
  type SubscriptionPeriod,
} from "@/lib/pricing";

/** Bagian titik yang dipakai modal. */
interface SubscribeModalHalte {
  id: string;
  name: string;
  koridor?: string;
}

interface SubscribeModalProps {
  open: boolean;
  halte: SubscribeModalHalte | null;
  onClose: () => void;
  onToast: (t: ToastData) => void;
  /** Bumped on the parent after the server confirms the subscription so
      DetailPanel and the dashboard My Subscriptions page can refetch.
      Mirror of BidModal's onSubmitted. */
  onSubmitted?: (info: { totalPrice: number; endsAt: string }) => void;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

/** 36_000_000 → "Rp 36 jt". */
function formatJuta(amount: number): string {
  return `Rp ${(amount / 1_000_000).toLocaleString("id-ID")} jt`;
}

/** Pilihan periode — angka dari lib/pricing.ts, sama dengan server. */
function optionNote(months: SubscriptionPeriod): string {
  const total = formatJuta(subscriptionTotal(months));
  return months === 1 ? total : `${total} (${months} bulan)`;
}

export default function SubscribeModal(props: SubscribeModalProps) {
  if (!props.halte) return null;
  // Keyed per titik: state otomatis bersih setiap modal dibuka untuk titik
  // lain, tanpa reset lewat effect.
  return (
    <SubscribeModalContent key={props.halte.id} {...props} halte={props.halte} />
  );
}

function SubscribeModalContent({
  open,
  halte,
  onClose,
  onToast,
  onSubmitted,
}: SubscribeModalProps & { halte: SubscribeModalHalte }) {
  const [brand, setBrand] = useState("");
  const [period, setPeriod] = useState<SubscriptionPeriod>(1);
  const [success, setSuccess] = useState<
    { totalPrice: number; endsAt: string; period: SubscriptionPeriod } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Waktu modal dibuka — dasar pratinjau periode. Server memakai jamnya
  // sendiri saat submit; selisih beberapa detik tidak masalah.
  const [openedAt] = useState(() => Date.now());

  const total = subscriptionTotal(period);
  const startsDate = new Date(openedAt);
  const endsDate = addMonths(startsDate, period);

  const handleSubmit = async () => {
    if (submitting) return;
    setError(null);

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/haltes/${encodeURIComponent(halte.id)}/subscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration_months: period }),
        }
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; subscription_id: string; total_price: number; ends_at: string }
        | { ok: false; error: string }
        | null;

      if (!json || !json.ok) {
        const msg =
          json && !json.ok
            ? json.error
            : `Langganan gagal dibuat (HTTP ${res.status}).`;
        setError(msg);
        onToast({
          label: "LANGGANAN GAGAL",
          msg,
          variant: "warn",
        });
        return;
      }

      setSuccess({
        totalPrice: json.total_price,
        endsAt: json.ends_at,
        period,
      });
      onToast({
        label: "LANGGANAN AKTIF",
        msg: `${halte.name} · langganan ${periodLabel(period).toLowerCase()}`,
        variant: "ok",
      });
      onSubmitted?.({ totalPrice: json.total_price, endsAt: json.ends_at });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Tidak bisa terhubung ke server. Periksa koneksi internet Anda.";
      setError(msg);
      onToast({ label: "LANGGANAN GAGAL", msg, variant: "warn" });
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
        disabled={submitting}
      >
        {submitting ? "Memproses…" : "Berlangganan →"}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="§ 02 — LANGGANAN"
      title={
        <>
          Sponsor <em>{halte.name}</em>
        </>
      }
      footer={footer}
      wide
    >
      {success ? (
        <div className="modal-success">
          <div className="modal-success-icon">✓</div>
          <div className="modal-success-title">Langganan Aktif</div>
          <div className="modal-success-desc">
            <strong>{halte.name}</strong> berlangganan{" "}
            {periodLabel(success.period).toLowerCase()} ({success.period} bulan),
            total <strong>{formatRupiah(success.totalPrice)}</strong>. Aktif
            sampai <strong>{formatDateShort(new Date(success.endsAt))}</strong>.
            Lihat statusnya di Dashboard.
          </div>
        </div>
      ) : (
        <>
          <div className="modal-field">
            <div className="modal-field-lbl">Harga langganan</div>
            <div className="modal-field-display emphasize">
              {formatRupiah(NON_BRT_MONTHLY_PRICE)}{" "}
              <span className="bid-per-year">/ bulan</span>
            </div>
          </div>

          <div className="modal-field">
            <div className="modal-field-lbl">Periode langganan</div>
            <div className="period-options" role="radiogroup" aria-label="Periode langganan">
              {SUBSCRIPTION_PERIODS.map((months) => {
                const active = months === period;
                return (
                  <button
                    key={months}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`period-option${active ? " active" : ""}`}
                    onClick={() => setPeriod(months)}
                    disabled={submitting}
                  >
                    <span className="period-option-label">{periodLabel(months)}</span>
                    <span className="period-option-note">{optionNote(months)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="modal-field">
            <div className="modal-field-lbl">
              Nama brand Anda (untuk preview suara, opsional)
            </div>
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
            kicker="Simulasi suara"
            halteName={halte.name}
            brandValue={brand}
            channels={["Papan nama halte", "Pengumuman suara di dalam bus"]}
            onUnsupported={handleVoiceUnsupported}
          />

          <div className="modal-summary">
            <div className="modal-summary-row">
              <span className="modal-summary-lbl">Titik</span>
              <span className="modal-summary-val">{halte.name}</span>
            </div>
            {halte.koridor && (
              <div className="modal-summary-row">
                <span className="modal-summary-lbl">Lokasi</span>
                <span className="modal-summary-val">{halte.koridor}</span>
              </div>
            )}
            <div className="modal-summary-row">
              <span className="modal-summary-lbl">Periode</span>
              <span className="modal-summary-val">
                {periodLabel(period)} ({period} bulan)
              </span>
            </div>
            <div className="modal-summary-row">
              <span className="modal-summary-lbl">Harga</span>
              <span className="modal-summary-val">
                {formatRupiah(NON_BRT_MONTHLY_PRICE)} × {period} bulan
              </span>
            </div>
            <div className="modal-summary-row">
              <span className="modal-summary-lbl">Periode aktif</span>
              <span className="modal-summary-val">
                {formatDateShort(startsDate)} → {formatDateShort(endsDate)}
              </span>
            </div>
            <div className="modal-summary-row total">
              <span className="modal-summary-lbl">Total bayar</span>
              <span className="modal-summary-val">{formatRupiah(total)}</span>
            </div>
          </div>

          {error && (
            <div className="commerce-alert" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
