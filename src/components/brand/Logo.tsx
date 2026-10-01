import type { CSSProperties } from "react";
import { LOGO_ASPECT, LOGO_PATH, LOGO_VIEWBOX } from "./logo-path";

/**
 * Wordmark resmi "airhalte" (vektor, satu path).
 *
 * Kenapa komponen, bukan <img>? Karena warnanya ikut `currentColor`, jadi satu
 * sumber dipakai untuk semua latar: biru di latar terang, putih di latar gelap
 * (sidebar, dark mode) tanpa file terpisah dan tanpa request jaringan.
 *
 * Pemakaian:
 *   <Logo />                     → biru brand (putih otomatis saat html.dark)
 *   <Logo tone="white" />        → selalu putih (sidebar gelap)
 *   <Logo tone="current" />      → ikut warna teks induknya
 *   <Logo height={24} />         → atur tinggi; lebar mengikuti rasio ±4,5 : 1
 *
 * Styling ada di src/styles/brand.css. Kalau nanti logonya diganti, cukup
 * trace ulang ke logo-path.ts, komponen ini tidak perlu disentuh.
 */
export type LogoTone = "brand" | "white" | "current";

type LogoProps = {
  /** Tinggi logo. Angka = px. Default 28. */
  height?: number | string;
  tone?: LogoTone;
  className?: string;
  style?: CSSProperties;
  /** Teks alternatif untuk screen reader. */
  title?: string;
};

export default function Logo({
  height = 28,
  tone = "brand",
  className,
  style,
  title = "airhalte",
}: LogoProps) {
  const width = typeof height === "number" ? Math.round(height * LOGO_ASPECT) : "auto";
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      role="img"
      aria-label={title}
      focusable="false"
      className={`ah-logo ah-logo--${tone}${className ? ` ${className}` : ""}`}
      style={{ height, width, ...style }}
    >
      <path fill="currentColor" d={LOGO_PATH} />
    </svg>
  );
}
