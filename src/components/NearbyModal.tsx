"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { NearbyPlace, NearbyKind } from "@/lib/overpass";

interface NearbyModalProps {
  open: boolean;
  onClose: () => void;
  halteName: string;
  places: NearbyPlace[];
}

const KIND_ICON: Record<NearbyKind, string> = {
  shop: "🏪",
  bank: "🏦",
  cafe: "☕",
  clinic: "🏥",
  office: "🏢",
  other: "📍",
};

const KIND_LABEL: Record<NearbyKind, string> = {
  shop: "Toko / Retail",
  bank: "Bank / ATM",
  cafe: "Cafe / Resto",
  clinic: "Klinik / Apotek",
  office: "Kantor",
  other: "Lainnya",
};

/**
 * NearbyModal — full list of POIs Overpass returned within 800m of a halte.
 * Backdrop closes on click; ESC also closes. Body scrolls when the list is
 * tall (clamp at 60vh per spec).
 */
export default function NearbyModal({
  open,
  onClose,
  halteName,
  places,
}: NearbyModalProps) {
  // ESC-to-close when the modal is open. Cleanup on close/unmount.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Portal ke <body>: DetailPanel memakai transform/filter, yang membuat
  // `position: fixed` relatif ke panel — modal jadi terpotong di dalamnya.
  return createPortal(
    <div
      className="nearby-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Tempat dalam radius 800m dari ${halteName}`}
      onClick={onClose}
    >
      <div className="nearby-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="nearby-close"
          aria-label="Tutup"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="nearby-head">
          <div className="nearby-title">
            <span aria-hidden="true">📍</span> <em>{halteName}</em>
          </div>
          <div className="nearby-sub">
            {places.length} tempat ditemukan · OpenStreetMap
          </div>
        </div>

        <div className="nearby-list">
          {places.length === 0 ? (
            <div className="nearby-empty">
              Tidak ada tempat ditemukan di sekitar halte ini.
            </div>
          ) : (
            places.map((p, i) => (
              <div key={`${p.name}-${i}`} className="nearby-row">
                <span
                  className="nearby-row-icon"
                  aria-label={KIND_LABEL[p.kind]}
                  title={KIND_LABEL[p.kind]}
                >
                  {KIND_ICON[p.kind]}
                </span>
                <span className="nearby-row-name">{p.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
