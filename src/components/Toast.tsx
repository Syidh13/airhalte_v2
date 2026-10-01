"use client";

import { useState } from "react";

export type ToastVariant = "ok" | "warn";
export interface ToastData {
  label: string;
  msg: string;
  variant?: ToastVariant;
}

interface ToastProps {
  toast: ToastData | null;
}

export default function Toast({ toast }: ToastProps) {
  // Simpan toast terakhir supaya teksnya tetap terlihat selama animasi
  // keluar (saat prop `toast` sudah null). Diperbarui saat render (pola
  // "menyimpan info dari render sebelumnya"), bukan lewat effect.
  const [shown, setShown] = useState<ToastData | null>(toast);
  if (toast && toast !== shown) {
    setShown(toast);
  }

  return (
    <div
      className={`toast ${toast ? "show" : ""} ${toast?.variant ?? ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="toast-lbl">{shown?.label}</span>
      <span className="toast-msg">{shown?.msg}</span>
    </div>
  );
}
