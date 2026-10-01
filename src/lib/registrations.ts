// ============================================================================
// REGISTRATIONS — helper bersama untuk form pendaftaran perusahaan
// (/signup, /signup/company, /api/register) dan tampilan data perusahaan
// (/settings, dashboard, superadmin). Data aslinya ada di tabel `companies`
// + `contacts` di Supabase; file ini tidak menyimpan apa pun.
// ============================================================================

export type RegistrationStatus = "pending" | "active" | "rejected";

/** Catalog of valid `bidangUsaha` values. Shared between signup + settings. */
export const BIDANG_USAHA_OPTIONS: readonly string[] = [
  "F&B & Kuliner",
  "Retail & Fashion",
  "Perbankan & Keuangan",
  "Kesehatan & Farmasi",
  "Pendidikan & Kursus",
  "Otomotif & Transportasi",
  "Properti & Real Estate",
  "Teknologi & Digital",
  "Lainnya",
] as const;

// ---------------------------------------------------------------------------
// NPWP — format lama 15 digit (XX.XXX.XXX.X-XXX.XXX) dan format 16 digit
// yang berlaku sejak 2024. Keduanya diterima.
// ---------------------------------------------------------------------------
export const NPWP_LENGTHS = [15, 16] as const;
const NPWP_MAX_DIGITS = 16;

/** Hanya angka NPWP, tanpa titik/strip/spasi. */
export function npwpDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * NPWP auto-formatter untuk input. Sampai 15 digit memakai mask lama
 * `XX.XXX.XXX.X-XXX.XXX` (aman untuk input parsial, caret tetap nyaman);
 * 16 digit ditampilkan sebagai angka polos karena format 16 digit tidak
 * memakai pemisah.
 */
export function formatNpwp(raw: string): string {
  const digits = npwpDigits(raw).slice(0, NPWP_MAX_DIGITS);
  if (digits.length === 16) return digits;
  if (digits.length <= 2) return digits;
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "." + digits.slice(2, Math.min(5, digits.length));
  if (digits.length > 5) out += "." + digits.slice(5, Math.min(8, digits.length));
  if (digits.length > 8) out += "." + digits.slice(8, Math.min(9, digits.length));
  if (digits.length > 9) out += "-" + digits.slice(9, Math.min(12, digits.length));
  if (digits.length > 12) out += "." + digits.slice(12, 15);
  return out;
}

/** True iff the value contains exactly 15 or 16 NPWP digits. */
export function isValidNpwp(value: string): boolean {
  const n = npwpDigits(value).length;
  return (NPWP_LENGTHS as readonly number[]).includes(n);
}

/** Pesan validasi NPWP yang sama di client dan server. */
export const NPWP_ERROR_MESSAGE = "NPWP harus 15 atau 16 digit.";

// ---------------------------------------------------------------------------
// Website — hanya http(s). Tanpa skema → dianggap https://.
// Mencegah nilai seperti `javascript:` tersimpan lalu dirender sebagai link.
// ---------------------------------------------------------------------------

/**
 * Normalisasi input website. "" → "" (kosong/opsional), "perusahaan.co.id" →
 * "https://perusahaan.co.id", skema selain http/https atau URL rusak → null.
 */
export function normalizeWebsite(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/** True kalau string aman dipakai sebagai href eksternal (http/https). */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
