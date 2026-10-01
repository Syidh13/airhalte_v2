// ============================================================================
// DATA — tipe HalteData + fixture template lama (dari AirHalte_Portal_4.html)
//
// Data live (peta, kartu, panel) dibangun di lib/haltes-map.ts langsung dari
// DB + API. Fixture HALTES dan helper analitik di bawah adalah TEMPLATE:
// angkanya karangan (bid, pemenang, pax, demografi, CPM, rating) dan TIDAK
// boleh ditampilkan atau digabung ke data live. Export dipertahankan supaya
// import lama tidak patah; semuanya ditandai @deprecated.
// ============================================================================

/** Kode internal lama. Bukan kelas harga: jangan ditampilkan ke pengguna. */
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
export type Mode = 'premium' | 'mass';
export type MassStatus = 'available' | 'taken';

interface HalteBase {
  id: string;
  mode: Mode;
  tier: Tier;
  name: string;
  koridor: string;
  addr: string;
  lat: number;
  lng: number;
  pax: string;
  companies: string;
  // Optional Google Maps Street View embed URL. When present, DetailPanel
  // renders the iframe; otherwise the panel falls back to its placeholder.
  // Use the embed-iframe URL (https://www.google.com/maps/embed?pb=…), not
  // the share URL — and remember to add referrerPolicy="no-referrer-when-downgrade"
  // on the <iframe> or Google may refuse to render the tile.
  streetViewUrl?: string;
}

export interface PremiumHalte extends HalteBase {
  mode: 'premium';
  /** Teks tampilan: penawaran tertinggi bila ada, selain itu harga dasar. */
  currentBid: string;
  /** Teks tampilan harga dasar (sudah dibulatkan ke minimum Rp 100 jt). */
  floor: string;
  delta: string;
  bidders: number;
  bids: number;
  timer: string;
  urgent: boolean;
  closed?: boolean;
  winner?: string;
  /** ISO timestamp — auction window start. Null/undefined when the halte
      has no schedule yet (legacy / unscheduled). DetailPanel countdown
      and the POST /api/haltes/[id]/bids window gate read these. */
  auctionStartsAt?: string | null;
  auctionEndsAt?: string | null;
  /** Harga dasar yang berlaku (Rupiah, sudah lewat effectiveBasePrice).
      Diisi oleh lib/haltes-map.ts dari DB; kosong di fixture lama. */
  basePrice?: number;
  /** Penawaran tertinggi saat ini (Rupiah). 0 = belum ada penawaran. */
  currentBidAmount?: number;
}

export interface MassHalte extends HalteBase {
  mode: 'mass';
  price: string;
  per: string;
  brand: string;
  status: MassStatus;
  subscriber?: string;
  since?: string;
}

export type HalteData = PremiumHalte | MassHalte;

export function isPremium(h: HalteData): h is PremiumHalte {
  return h.mode === 'premium';
}

export function isMass(h: HalteData): h is MassHalte {
  return h.mode === 'mass';
}

/** Warna internal per kode tier. Jangan dipakai untuk menampilkan kelas harga. */
export const TIER_COLORS: Record<Tier, string> = {
  S: '#0F2540',
  A: '#1E3A5F',
  B: '#2C5F7A',
  C: '#4A7AA8',
  D: '#6B95C0',
};

/** @deprecated template — jangan ditampilkan (tangga tier S–D tidak ada di deck). */
export const TIER_LABEL: Record<Tier, string> = {
  S: 'Iconic CBD',
  A: 'Major Commercial',
  B: 'Secondary Hub',
  C: 'Mall Anchor',
  D: 'Volume Play',
};

export const JAKARTA_CENTER: [number, number] = [106.8456, -6.2088];

/**
 * Record DB yang bukan titik nyata (data uji). Tidak boleh tampil di peta,
 * kartu, maupun hitungan. Dipakai oleh loader peta, API availability, dan
 * skrip generate-map-data.
 */
export const EXCLUDED_HALTE_IDS: ReadonlySet<string> = new Set(['test']);

export function isExcludedHalteId(id: string | null | undefined): boolean {
  return !id || EXCLUDED_HALTE_IDS.has(id);
}

/**
 * @deprecated template — jangan ditampilkan. Fixture demo dengan angka
 * karangan (bid, pemenang, pax, brand). Tidak lagi digabung ke data live;
 * dipertahankan hanya agar import lama tetap terkompilasi.
 */
export const HALTES: HalteData[] = [
  // ===== PREMIUM / BRT — AUCTION (5 samples) =====
  {
    id: 'seed-bendungan-hilir', mode: 'premium', tier: 'S',
    name: 'Halte Bendungan Hilir', koridor: 'Koridor 1 · Sudirman', addr: 'Jl. Jenderal Sudirman · SCBD Entry',
    lat: -6.2076, lng: 106.8200, pax: '11.200', companies: 'Medco · Intiland · The Energy',
    currentBid: 'Rp 6.200.000.000', floor: 'Rp 5,0 M', delta: '▲ +240jt (4m lalu)', bidders: 7, bids: 47, timer: '09h 14j 22m', urgent: false,
    streetViewUrl: 'https://www.google.com/maps/embed?pb=!4v1776936685805!6m8!1m7!1sG8E024RC6uBXal-YE5WhjQ!2m2!1d-6.165591270796693!2d106.8201565220199!3f186.13164!4f0!5f0.7820865974627469',
  },
  {
    id: 'seed-tosari', mode: 'premium', tier: 'S',
    name: 'Halte Tosari', koridor: 'Koridor 1 · Sudirman', addr: 'Jl. M.H. Thamrin · Tosari',
    lat: -6.1983, lng: 106.8234, pax: '10.000', companies: 'BCA Tower · Hyatt · Kempinski',
    currentBid: 'Rp 8.400.000.000', floor: 'Rp 5,0 M', delta: '✓ Closed · +68%', bidders: 14, bids: 124, timer: 'BERAKHIR', urgent: false, closed: true, winner: 'PT BANK CENTRAL ASIA Tbk.',
  },
  {
    id: 'seed-kuningan-timur', mode: 'premium', tier: 'A',
    name: 'Halte Kuningan Timur', koridor: 'Koridor 6 · Rasuna Epicentrum', addr: 'Jl. H.R. Rasuna Said · Epicentrum',
    lat: -6.2237, lng: 106.8340, pax: '7.100', companies: 'Bakrie Tower · Viva · Lippo',
    currentBid: 'Rp 2.850.000.000', floor: 'Rp 2,0 M', delta: '▲ +125jt (22m lalu)', bidders: 4, bids: 23, timer: '08h 22j 08m', urgent: false,
  },
  {
    id: 'seed-kelapa-gading-barat', mode: 'premium', tier: 'C',
    name: 'Halte Kelapa Gading Barat', koridor: 'Koridor 10 · Kelapa Gading', addr: 'Jl. Boulevard Raya · MKG',
    lat: -6.1572, lng: 106.9089, pax: '6.500', companies: 'MKG · La Piazza · Summarecon',
    currentBid: 'Rp 580.000.000', floor: 'Rp 300 jt', delta: '▲ +45jt (1m lalu)', bidders: 12, bids: 68, timer: '02h 06j 41m', urgent: true,
  },
  {
    id: 'seed-pluit', mode: 'premium', tier: 'D',
    name: 'Halte Pluit', koridor: 'Koridor 12 · Jakut', addr: 'Jl. Pluit Selatan Raya',
    lat: -6.1214, lng: 106.7884, pax: '6.500', companies: 'Pluit Village · Emporium Pluit',
    currentBid: 'Rp 165.000.000', floor: 'Rp 100 jt', delta: '▲ +8jt (2j lalu)', bidders: 6, bids: 14, timer: '12h 02j 18m', urgent: false,
  },

  // ===== MASS / NON-BRT — SUBSCRIPTION (5 samples) =====
  {
    id: 'seed-pondok-kopi', mode: 'mass', tier: 'D',
    name: 'Halte Pondok Kopi (Non-BRT)', koridor: 'Non-BRT · Jaktim', addr: 'Jl. Pondok Kopi Raya',
    lat: -6.2438, lng: 106.9510, pax: '4.500',
    price: 'Rp 3 jt', per: '/ bulan', brand: 'Kopi Kenangan',
    companies: 'Cafe · UMKM retail · residensial', status: 'available',
  },
  {
    id: 'seed-buaran', mode: 'mass', tier: 'D',
    name: 'Halte Buaran', koridor: 'Non-BRT · Jaktim', addr: 'Jl. Raden Inten II · Buaran',
    lat: -6.2332, lng: 106.9228, pax: '5.200',
    price: 'Rp 3 jt', per: '/ bulan', brand: 'Apotek K24',
    companies: 'Apotek · retail · traditional market', status: 'taken',
    subscriber: 'Apotek K24 Buaran', since: 'Feb 2026',
  },
  {
    id: 'seed-pemuda-rawamangun', mode: 'mass', tier: 'D',
    name: 'Halte Pemuda Rawamangun', koridor: 'Koridor 4 · UNJ', addr: 'Jl. Pemuda · UNJ',
    lat: -6.1920, lng: 106.8869, pax: '5.500',
    price: 'Rp 3 jt', per: '/ bulan', brand: 'Warung Makan Bu Tini',
    companies: 'UNJ · Arion Mall · F&B student', status: 'available',
  },
  {
    id: 'seed-tebet-barat', mode: 'mass', tier: 'D',
    name: 'Bus Stop Tebet Barat', koridor: 'Non-BRT · Jaksel', addr: 'Jl. Tebet Barat Raya',
    lat: -6.2328, lng: 106.8506, pax: '4.100',
    price: 'Rp 3 jt', per: '/ bulan', brand: 'Kopi Tuku',
    companies: 'F&B trendy · UMKM · residensial', status: 'taken',
    subscriber: 'Kopi Tuku Tebet', since: 'Jan 2026',
  },
  {
    id: 'seed-kemang-raya', mode: 'mass', tier: 'D',
    name: 'Bus Stop Kemang Raya', koridor: 'Non-BRT · Jaksel', addr: 'Jl. Kemang Raya',
    lat: -6.2609, lng: 106.8132, pax: '3.900',
    price: 'Rp 3 jt', per: '/ bulan', brand: 'Gallery Kemang',
    companies: 'Expat F&B · gallery · boutique', status: 'available',
  },
];

// ============================================================================
// ANALYTICS HELPERS — ported from AirHalte_Portal_4.html
// Semua angka di bawah (demografi, jam sibuk, dwell, radius eksklusif, CPM,
// rating) adalah karangan template, bukan data resmi TJ. Jangan ditampilkan.
// ============================================================================

export interface DemoSegment {
  lbl: string;
  pct: number;
  color: string;
}

export interface Demographics {
  profile: string;
  segments: DemoSegment[];
  sesNote: string;
}

export interface PeakPattern {
  pattern: number[];
  peakLabel: string;
}

export interface DwellData {
  dwell: number;
  plays: number;
}

export interface Exclusivity {
  radius: string;
  categories: string[];
  locked: boolean;
}

export interface CPMData {
  cpi: number;
  cpm: number;
  exposureMultiplier: number;
  comparison: {
    multiple: string;
    label: string;
    isCheaper: boolean;
  };
  isPrestige: boolean;
  /** true bila data penumpang resmi belum ada — UI tampilkan status, bukan angka. */
  noData?: boolean;
}

/** @deprecated template — jangan ditampilkan */
export function getDemographics(halte: HalteData): Demographics {
  const k = (halte.koridor || '').toLowerCase();
  const addr = (halte.addr || '').toLowerCase();

  if (/sudirman|scbd|senayan|kuningan|thamrin|hi/.test(k + ' ' + addr)) {
    return {
      profile: 'White-collar CBD',
      segments: [
        { lbl: 'Profesional 25-45', pct: 58, color: '#1E3A5F' },
        { lbl: 'Manajer / C-level', pct: 22, color: '#0F2540' },
        { lbl: 'Mahasiswa', pct: 12, color: '#3B6B9B' },
        { lbl: 'Lainnya', pct: 8, color: '#8B847A' },
      ],
      sesNote: 'SES A/B+ dominan',
    };
  }
  if (/gading|pluit|kemang|cilandak|pondok indah|hub|mall/.test(k + ' ' + addr)) {
    return {
      profile: 'Mid-class commuter',
      segments: [
        { lbl: 'Karyawan 25-40', pct: 42, color: '#1E3A5F' },
        { lbl: 'Ibu rumah tangga', pct: 26, color: '#4A7AA8' },
        { lbl: 'Pelajar/student', pct: 20, color: '#3B6B9B' },
        { lbl: 'Lansia', pct: 12, color: '#8B847A' },
      ],
      sesNote: 'SES B+/B dominan',
    };
  }
  if (/tanah abang|senen|pasar|grogol|harmoni/.test(k + ' ' + addr)) {
    return {
      profile: 'Trader & shopper',
      segments: [
        { lbl: 'Pedagang/UMKM', pct: 38, color: '#5680B8' },
        { lbl: 'Shopper grosir', pct: 30, color: '#4A7AA8' },
        { lbl: 'Karyawan toko', pct: 22, color: '#1E3A5F' },
        { lbl: 'Lainnya', pct: 10, color: '#8B847A' },
      ],
      sesNote: 'SES B/C+ dominan',
    };
  }
  if (/cawang|cililitan|kampung melayu|jatinegara|klender|pulogadung/.test(k + ' ' + addr)) {
    return {
      profile: 'Worker commuter',
      segments: [
        { lbl: 'Buruh/teknisi', pct: 36, color: '#3B6B9B' },
        { lbl: 'Pelajar/SMK', pct: 28, color: '#4A7AA8' },
        { lbl: 'Karyawan kantor', pct: 24, color: '#1E3A5F' },
        { lbl: 'Lainnya', pct: 12, color: '#8B847A' },
      ],
      sesNote: 'SES C+/C dominan',
    };
  }
  return {
    profile: 'Residential commuter',
    segments: [
      { lbl: 'Karyawan 25-45', pct: 40, color: '#1E3A5F' },
      { lbl: 'Ibu rumah tangga', pct: 24, color: '#4A7AA8' },
      { lbl: 'Pelajar/student', pct: 22, color: '#3B6B9B' },
      { lbl: 'Lainnya', pct: 14, color: '#8B847A' },
    ],
    sesNote: 'SES B/C+ dominan',
  };
}

/** @deprecated template — jangan ditampilkan */
export function getPeakPattern(halte: HalteData): PeakPattern {
  const k = (halte.koridor || '').toLowerCase();
  const addr = (halte.addr || '').toLowerCase();

  if (/sudirman|scbd|senayan|kuningan|thamrin|hi/.test(k + ' ' + addr)) {
    return {
      pattern: [0.05,0.03,0.02,0.02,0.05,0.15,0.45,0.85,1.0,0.7,0.4,0.35,0.5,0.45,0.4,0.45,0.6,0.85,0.95,0.7,0.45,0.25,0.15,0.08],
      peakLabel: '07:00–09:00 & 17:00–19:00',
    };
  }
  if (/gading|pluit|kemang|cilandak|pondok indah|hub|mall/.test(k + ' ' + addr)) {
    return {
      pattern: [0.05,0.02,0.02,0.02,0.05,0.1,0.2,0.4,0.5,0.55,0.6,0.7,0.85,0.8,0.7,0.75,0.85,0.95,1.0,0.85,0.6,0.4,0.25,0.12],
      peakLabel: '11:00–14:00 & 17:00–20:00',
    };
  }
  if (/tanah abang|senen|pasar|grogol|harmoni/.test(k + ' ' + addr)) {
    return {
      pattern: [0.1,0.15,0.25,0.45,0.7,0.85,1.0,0.95,0.9,0.85,0.8,0.7,0.55,0.5,0.5,0.45,0.4,0.35,0.3,0.25,0.18,0.12,0.1,0.08],
      peakLabel: '05:00–10:00',
    };
  }
  if (/cawang|cililitan|kampung melayu|jatinegara|klender|pulogadung/.test(k + ' ' + addr)) {
    return {
      pattern: [0.1,0.15,0.25,0.5,0.8,0.95,1.0,0.85,0.55,0.35,0.3,0.3,0.35,0.35,0.35,0.4,0.55,0.7,0.75,0.6,0.4,0.25,0.18,0.12],
      peakLabel: '05:00–08:00',
    };
  }
  return {
    pattern: [0.05,0.03,0.02,0.05,0.15,0.4,0.8,1.0,0.85,0.55,0.45,0.4,0.45,0.45,0.4,0.45,0.6,0.85,0.9,0.7,0.5,0.3,0.18,0.1],
    peakLabel: '06:00–08:00 & 17:00–19:00',
  };
}

/** @deprecated template — jangan ditampilkan */
export function getDwellData(halte: HalteData): DwellData {
  const mass = halte.mode === 'mass';
  return { dwell: mass ? 8 : 3, plays: mass ? 96 : 168 };
}

/** @deprecated template — jangan ditampilkan */
export function getExclusivity(halte: HalteData): Exclusivity {
  const t = halte.tier;
  if (t === 'S' || t === 'A') return { radius: '500m', categories: ['Full category exclusive'], locked: true };
  if (t === 'B' || t === 'C') return { radius: '300m', categories: ['Sub-category exclusive'], locked: true };
  return { radius: '200m', categories: ['Brand exclusive only'], locked: false };
}

/** @deprecated template — jangan ditampilkan */
export function calcCPM(halte: HalteData): CPMData {
  const mass = halte.mode === 'mass';
  const paxRaw = parseInt((halte.pax || '0').replace(/[^\d]/g, '')) || 0;
  const pax = paxRaw || 1;
  let monthlyCost: number;
  if (mass) {
    monthlyCost = 3_000_000;
  } else {
    const annual = parseInt(((halte as PremiumHalte).currentBid || '0').replace(/[^\d]/g, ''));
    monthlyCost = Math.round(annual / 12);
  }
  const exposureMultiplier = mass ? 4 : 3;
  const monthlyImpressions = pax * 30 * exposureMultiplier;
  const cpi = monthlyCost / monthlyImpressions;
  const cpm = Math.round(cpi * 1000);

  const benchmarks = {
    billboard: { cpm: 22_000, label: 'iklan billboard luar ruang' },
    radio: { cpm: 18_000, label: 'iklan radio FM' },
    digital: { cpm: 38_000, label: 'iklan digital (Meta/Google)' },
  };
  const comps = Object.values(benchmarks).filter(b => b.cpm > cpm);
  let comparison: CPMData['comparison'];
  if (comps.length) {
    comps.sort((a, b) => a.cpm - b.cpm);
    const best = comps[0];
    comparison = { multiple: (best.cpm / cpm).toFixed(1), label: best.label, isCheaper: true };
  } else {
    const cheapest = Object.values(benchmarks).sort((a, b) => a.cpm - b.cpm)[0];
    comparison = { multiple: (cpm / cheapest.cpm).toFixed(1), label: cheapest.label, isCheaper: false };
  }

  return {
    cpi: Math.round(cpi),
    cpm,
    exposureMultiplier,
    comparison,
    isPrestige: !mass && halte.tier === 'S',
    noData: paxRaw === 0,
  };
}

export function getHaltePhoto(halte: HalteData): string {
  // Foto acak (picsum) dimatikan — tidak merepresentasikan halte sebenarnya.
  // Kembalikan URL foto resmi per halte bila sudah tersedia.
  void halte;
  return "";
}

/** @deprecated template — jangan ditampilkan */
export function getMarkerPrice(halte: HalteData): string {
  if (halte.mode === 'mass') {
    const h = halte as MassHalte;
    return h.status === 'taken' ? 'Dipesan' : 'Rp 5jt/bln';
  }
  const h = halte as PremiumHalte;
  const num = parseInt((h.currentBid || '0').replace(/[^\d]/g, ''));
  if (num >= 1_000_000_000) {
    return 'Rp ' + (num / 1_000_000_000).toFixed(1).replace('.0', '').replace('.', ',') + ' M';
  }
  if (num >= 1_000_000) {
    return 'Rp ' + Math.round(num / 1_000_000) + ' jt';
  }
  return h.currentBid;
}

/** @deprecated template — jangan ditampilkan */
export function getRating(halte: HalteData): string {
  // Deterministic 0..4 bucket from the (string) id so the same halte
  // always renders the same rating across reloads. Simple char-sum
  // works because we only need 5 evenly-spread buckets.
  let sum = 0;
  for (let i = 0; i < halte.id.length; i++) sum += halte.id.charCodeAt(i);
  return (4.6 + (sum % 5) * 0.07).toFixed(2);
}
