"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const EVENT = "airhalte:favorite-toast";
const INFO_EVENT = "airhalte:info-toast";

export interface FavoriteToastDetail {
  name: string;
  saved: boolean;
}

export interface InfoToastDetail {
  message: string;
}

export function emitFavoriteToast(detail: FavoriteToastDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FavoriteToastDetail>(EVENT, { detail }));
}

export function emitInfoToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<InfoToastDetail>(INFO_EVENT, { detail: { message } })
  );
}

type ToastState =
  | { kind: "favorite"; id: number; name: string; saved: boolean }
  | { kind: "info"; id: number; message: string };

export default function FavoriteToaster() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showToast = (next: ToastState) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
      setToast(next);
      setVisible(true);
      timerRef.current = setTimeout(() => setVisible(false), 2500);
      hideRef.current = setTimeout(() => setToast(null), 2700);
    };

    const onFav = (e: Event) => {
      const detail = (e as CustomEvent<FavoriteToastDetail>).detail;
      if (!detail) return;
      showToast({ kind: "favorite", id: Date.now(), ...detail });
    };
    const onInfo = (e: Event) => {
      const detail = (e as CustomEvent<InfoToastDetail>).detail;
      if (!detail) return;
      showToast({ kind: "info", id: Date.now(), message: detail.message });
    };

    window.addEventListener(EVENT, onFav);
    window.addEventListener(INFO_EVENT, onInfo);
    return () => {
      window.removeEventListener(EVENT, onFav);
      window.removeEventListener(INFO_EVENT, onInfo);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  if (!toast) return null;

  if (toast.kind === "info") {
    return (
      <div
        className={`fav-toast${visible ? " show" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="fav-toast-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </span>
        <span className="fav-toast-msg">{toast.message}</span>
      </div>
    );
  }

  return (
    <div
      className={`fav-toast${visible ? " show" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className={`fav-toast-icon${toast.saved ? " on" : ""}`} aria-hidden="true">
        {toast.saved ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 21s-8-5.4-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.6-8 11-8 11z" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <path d="M12 21s-8-5.4-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.6-8 11-8 11z" />
          </svg>
        )}
      </span>
      <span className="fav-toast-msg">
        <strong>{toast.name}</strong>{" "}
        {toast.saved ? "disimpan ke" : "dihapus dari"} Favorit
      </span>
      <Link href="/favorit" className="fav-toast-action">
        Lihat Favorit →
      </Link>
    </div>
  );
}
