// ============================================================================
// FORMATTING HELPERS
// Small, side-effect-free utilities used by the superadmin dashboard and
// other surfaces that need short-form Rupiah / relative-time strings.
// ============================================================================

/**
 * Compact Indonesian Rupiah, e.g. 4_200_000_000 → "Rp 4,2M",
 * 850_000_000 → "Rp 850jt", 5_000_000 → "Rp 5jt", 12_500 → "Rp 12,5rb".
 *
 * Trade-off: we hand-roll the suffixes because Intl.NumberFormat's compact
 * notation in Indonesian uses "jt"/"M" inconsistently across runtimes
 * (some emit "M" for million, some for milyar). Hardcoding keeps the
 * dashboard consistent with the app's own usage.
 */
export function fmtRupiahShort(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}Rp ${stripTrailingZero(abs / 1_000_000_000)}M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}Rp ${stripTrailingZero(abs / 1_000_000)}jt`;
  }
  if (abs >= 1_000) {
    return `${sign}Rp ${stripTrailingZero(abs / 1_000)}rb`;
  }
  return `${sign}Rp ${Math.round(abs)}`;
}

function stripTrailingZero(n: number): string {
  // 1 decimal max, then trim ",0" → "" so "Rp 5jt" not "Rp 5,0jt".
  const s = n.toFixed(1).replace(".", ",");
  return s.endsWith(",0") ? s.slice(0, -2) : s;
}

/**
 * Indonesian relative time. Intentionally simple — "2 jam lalu", not
 * "2 jam yang lalu" — to match the activity-feed micro-copy throughout
 * the app.
 */
export function fmtRelativeId(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk} minggu lalu`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo} bulan lalu`;
  return `${Math.floor(diffMo / 12)} tahun lalu`;
}

/** Short Indonesian date "24 Apr 2026". */
export function fmtDateShortId(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
