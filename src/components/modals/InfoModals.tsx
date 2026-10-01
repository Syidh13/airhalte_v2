"use client";

import Modal from "./Modal";
import type { ToastData } from "@/components/Toast";
import { NETWORK, fmtCount } from "@/lib/network";
import {
  NON_BRT_MONTHLY_PRICE,
  PREMIUM_CONTRACT_MONTHS,
  PREMIUM_MIN_BASE_PRICE,
  subscriptionTotal,
} from "@/lib/pricing";

/** "tier" dipertahankan sebagai id modal "Harga & Paket" (dipakai Header). */
export type InfoPage = "tier" | "cara-kerja" | "riwayat";

interface InfoModalsProps {
  open: InfoPage | null;
  onClose: () => void;
  /** Tidak dipakai lagi; tetap diterima supaya pemanggil lama tidak rusak. */
  onToast?: (t: ToastData) => void;
}

/** 3_000_000 → "Rp 3 jt", 100_000_000 → "Rp 100 jt" */
function rupiahJt(n: number): string {
  return `Rp ${(n / 1_000_000).toLocaleString("id-ID")} jt`;
}

export default function InfoModals({ open, onClose }: InfoModalsProps) {
  if (open === "tier") return <HargaModal onClose={onClose} />;
  if (open === "cara-kerja") return <CaraKerjaModal onClose={onClose} />;
  if (open === "riwayat") return <RiwayatModal onClose={onClose} />;
  return (
    <Modal open={false} onClose={onClose} kicker="" title="" footer={null}>
      <></>
    </Modal>
  );
}

function HargaModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      kicker="§ HARGA & PAKET"
      title={
        <>
          Dua jenis titik, <em>dua cara sewa</em>
        </>
      }
      footer={
        <button className="modal-btn primary" onClick={onClose} type="button">
          Mengerti
        </button>
      }
      wide
    >
      <div className="info-plan-grid">
        <section className="info-plan-card">
          <div className="info-plan-badge">Premium</div>
          <h4 className="info-plan-title">Halte BRT</h4>
          <div className="info-plan-meta">
            {`${fmtCount(NETWORK.brt)} halte · untuk korporasi`}
          </div>
          <div className="info-plan-price">
            mulai {rupiahJt(PREMIUM_MIN_BASE_PRICE)}
            <span>/tahun</span>
          </div>
          <ul className="info-plan-list">
            <li>
              Harga dasar ditetapkan TJ per halte, minimal{" "}
              {rupiahJt(PREMIUM_MIN_BASE_PRICE)}/tahun.
            </li>
            <li>Harga akhir ditentukan lewat lelang.</li>
            <li>Kontrak tahunan ({PREMIUM_CONTRACT_MONTHS} bulan).</li>
          </ul>
        </section>

        <section className="info-plan-card">
          <div className="info-plan-badge alt">Non-BRT</div>
          <h4 className="info-plan-title">Bus stop Non-BRT</h4>
          <div className="info-plan-meta">
            {`${fmtCount(NETWORK.nonBrt)} titik · untuk UMKM & bisnis lokal`}
          </div>
          <div className="info-plan-price">
            {rupiahJt(NON_BRT_MONTHLY_PRICE)}
            <span>/titik/bulan</span>
          </div>
          <ul className="info-plan-list">
            <li>Tarif tetap, tanpa lelang.</li>
            <li>
              Langganan bulanan ({rupiahJt(subscriptionTotal(1))}) atau tahunan
              ({rupiahJt(subscriptionTotal(12))}, tanpa diskon).
            </li>
            <li>Langsung aktif setelah konfirmasi.</li>
          </ul>
        </section>
      </div>
      <div className="info-footnote">
        Hanya perusahaan dengan NPWP yang sudah diverifikasi admin TJ yang dapat
        ikut lelang atau berlangganan.
      </div>
    </Modal>
  );
}

function CaraKerjaModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      kicker="§ CARA KERJA"
      title={
        <>
          Dari pendaftaran <em>sampai titik tersewa</em>
        </>
      }
      footer={
        <button className="modal-btn primary" onClick={onClose} type="button">
          Jelajahi Peta →
        </button>
      }
      wide
    >
      <ol className="info-steps">
        <li>
          <strong>1.</strong> Daftar akun dan ajukan data perusahaan dengan
          NPWP. Admin TJ memverifikasi sebelum akun dapat bertransaksi.
        </li>
        <li>
          <strong>2.</strong> Pilih titik di peta. Status ketersediaan dan harga
          diperbarui tiap 10 detik.
        </li>
      </ol>

      <div className="info-mode-tabs info-flow-split">
        <div className="info-mode-col">
          <div className="info-mode-title">3a · Premium (Halte BRT)</div>
          <div className="info-mode-desc">
            Lelang · kontrak {PREMIUM_CONTRACT_MONTHS} bulan
          </div>
          <ul className="info-plan-list">
            <li>Ikut lelang sesuai jadwal yang ditetapkan TJ.</li>
            <li>Penawaran minimal sebesar harga dasar halte.</li>
            <li>Pemenang ditetapkan otomatis saat lelang ditutup.</li>
            <li>Kontrak berlaku {PREMIUM_CONTRACT_MONTHS} bulan.</li>
          </ul>
        </div>
        <div className="info-mode-col">
          <div className="info-mode-title">3b · Non-BRT (bus stop)</div>
          <div className="info-mode-desc">
            Langganan · {rupiahJt(NON_BRT_MONTHLY_PRICE)}/titik/bulan
          </div>
          <ul className="info-plan-list">
            <li>Pilih langganan bulanan atau tahunan.</li>
            <li>Langganan langsung aktif setelah konfirmasi.</li>
          </ul>
        </div>
      </div>

      <ol className="info-steps">
        <li>
          <strong>4.</strong> Dengarkan simulasi pengumuman suara dengan nama
          brand Anda di formulir penawaran atau langganan.
        </li>
      </ol>
    </Modal>
  );
}

function RiwayatModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      kicker="§ RIWAYAT LELANG"
      title={
        <>
          Lelang <em>yang sudah ditutup</em>
        </>
      }
      footer={
        <button className="modal-btn primary" onClick={onClose} type="button">
          Tutup
        </button>
      }
      wide
    >
      <p className="info-empty-line">
        Riwayat lelang akan tampil di sini setelah lelang pertama ditutup.
      </p>
    </Modal>
  );
}
