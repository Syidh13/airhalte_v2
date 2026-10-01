// ============================================================================
// NETWORK: jumlah titik jaringan Transjakarta yang dipasarkan AirHalte.
// Sumber: API resmi TJ (snapshot yang dipakai di deck planning 2027).
// Dipakai untuk copy statis (metadata, header, halaman auth). Untuk angka
// live di peta, hitung dari data GeoJSON, bukan dari konstanta ini.
// ============================================================================

export const NETWORK = {
  /** Halte BRT (segmen Premium, lewat lelang). */
  brt: 270,
  /** Bus stop Non-BRT (tarif tetap bulanan/tahunan). */
  nonBrt: 7_306,
} as const;

export const NETWORK_TOTAL = NETWORK.brt + NETWORK.nonBrt; // 7.576

/** 7576 → "7.576" (format angka Indonesia). */
export function fmtCount(n: number): string {
  return n.toLocaleString("id-ID");
}
