// ============================================================================
// PRICING: satu-satunya sumber aturan komersial AirHalte (selaras deck v6.1)
// ----------------------------------------------------------------------------
// Semua angka harga, periode, dan aturan lelang dibaca dari file ini, baik di
// server (API route) maupun di client (modal, panel, copy). Kalau TJ mengubah
// tarif, ubah di sini saja. Jangan hardcode angka harga di komponen.
//
//   Bus stop Non-BRT  → tarif tetap Rp 3 jt / titik / bulan.
//                       Langganan bulanan atau tahunan (12× tanpa diskon).
//   Halte BRT Premium → harga dasar ditetapkan TJ per halte, minimal
//                       Rp 100 jt / halte / tahun. Harga akhir lewat lelang.
//                       Kontrak tahunan (12 bulan).
// ============================================================================

// ---------------------------------------------------------------- Non-BRT
/** Tarif tetap bus stop Non-BRT per titik per bulan (Rupiah). */
export const NON_BRT_MONTHLY_PRICE = 3_000_000;

/** Periode langganan Non-BRT yang diizinkan, dalam bulan. Tidak ada diskon. */
export const SUBSCRIPTION_PERIODS = [1, 12] as const;
export type SubscriptionPeriod = (typeof SUBSCRIPTION_PERIODS)[number];

export function isSubscriptionPeriod(v: unknown): v is SubscriptionPeriod {
  return (SUBSCRIPTION_PERIODS as readonly unknown[]).includes(v);
}

/** Total tagihan langganan Non-BRT untuk satu periode (tanpa diskon). */
export function subscriptionTotal(months: SubscriptionPeriod): number {
  return NON_BRT_MONTHLY_PRICE * months;
}

/** Label periode untuk UI. Nilai lama di DB (3/6/36 bulan) tetap terbaca. */
export function periodLabel(months: number | null | undefined): string {
  if (months === 12) return "Tahunan";
  if (months === 1) return "Bulanan";
  if (!months || !Number.isFinite(months)) return "—";
  return `${months} bulan`;
}

// ---------------------------------------------------------------- Premium (BRT)
/** Harga dasar minimum halte BRT per tahun (Rupiah). */
export const PREMIUM_MIN_BASE_PRICE = 100_000_000;

/** Durasi kontrak pemenang lelang Premium, dalam bulan. */
export const PREMIUM_CONTRACT_MONTHS = 12;

/** Kenaikan minimum antar-bid: 5% dari bid tertinggi, minimal Rp 5 jt. */
export const BID_MIN_INCREMENT_PCT = 0.05;
export const BID_MIN_INCREMENT_FLOOR = 5_000_000;

/** Batas atas wajar untuk satu bid (Rp 1 T), mencegah salah ketik atau overflow. */
export const BID_MAX_AMOUNT = 1_000_000_000_000;

/**
 * Harga dasar yang berlaku untuk satu halte BRT.
 * Nilai kosong, 0, atau di bawah minimum otomatis naik ke Rp 100 jt.
 */
export function effectiveBasePrice(basePrice: number | string | null | undefined): number {
  const n = Number(basePrice ?? 0);
  return Number.isFinite(n) && n >= PREMIUM_MIN_BASE_PRICE
    ? Math.round(n)
    : PREMIUM_MIN_BASE_PRICE;
}

/** Kenaikan minimum dari bid tertinggi saat ini. */
export function minBidIncrement(currentBid: number): number {
  return Math.max(Math.round(currentBid * BID_MIN_INCREMENT_PCT), BID_MIN_INCREMENT_FLOOR);
}

/**
 * Bid minimum berikutnya. Server dan client wajib memakai fungsi yang sama.
 * - Belum ada bid → minimal harga dasar.
 * - Sudah ada bid → bid tertinggi + kenaikan minimum (tidak pernah di bawah harga dasar).
 */
export function minNextBid(
  basePrice: number | string | null | undefined,
  currentBid: number | string | null | undefined,
): number {
  const floor = effectiveBasePrice(basePrice);
  const cur = Number(currentBid ?? 0);
  if (!Number.isFinite(cur) || cur <= 0) return floor;
  return Math.max(floor, cur + minBidIncrement(cur));
}
