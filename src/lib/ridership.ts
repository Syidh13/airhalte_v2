// ============================================================================
// RIDERSHIP — estimasi rata-rata potensi penumpang per titik.
// BUKAN data tap-in: AirHalte belum punya akses data penumpang per halte.
//
// Cara hitung (data per titik dibuat oleh src/scripts/generate-ridership.ts):
//   1. Jadwal resmi GTFS Transjakarta → rata-rata perjalanan bus per hari
//      (seminggu penuh) yang berhenti di tiap titik, dipisah per kelompok
//      layanan (BRT & Non-BRT / Mikrotrans / Transjabodetabek).
//   2. Pelanggan setahun kelompok itu ÷ 365 ÷ total perjalanan kelompok itu
//      per hari = rata-rata penumpang per perjalanan bus.
//   3. Estimasi titik = Σ perjalanan × rata-rata penumpang per perjalanan
//      = penumpang yang diangkut bus-bus yang berhenti di titik itu
//      (sepanjang rutenya — bukan jumlah orang yang naik di titik itu).
// Dipisah per kelompok supaya Mikrotrans (armada kecil, perjalanan sangat
// banyak) tidak menurunkan angka halte BRT dan menggelembungkan bus stop.
//
// UI wajib memberi label "Estimasi" + cara hitung singkat.
// ============================================================================

export type ServiceGroup = "brtNonBrt" | "mikrotrans" | "transjabodetabek";

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  "brtNonBrt",
  "mikrotrans",
  "transjabodetabek",
] as const;

/** Total pelanggan setahun per kelompok layanan (data PT Transjakarta). */
export const RIDERSHIP_YEAR = 2025;
export const RIDERSHIP_PER_YEAR: Record<ServiceGroup, number> = {
  brtNonBrt: 207_761_579, // 50,55%
  mikrotrans: 181_689_524, // 44,12%
  transjabodetabek: 21_623_357, // 5,33%
};
export const RIDERSHIP_SOURCE = {
  label: "Data PT Transjakarta 2025, dikutip NU Online Jakarta",
  url: "https://jakarta.nu.or.id/opini/transformasi-transjakarta-perluasan-aksesibilitas-mutu-pelayanan-dan-dinamika-subsidi-apbd-DLvPc",
} as const;

export const GTFS_URL = "https://gtfs.transjakarta.co.id/files/file_gtfs.zip";

/** `route_desc` GTFS → kelompok data penumpang. "BRT", "Angkutan Umum
    Integrasi", "Rusun", "Royaltrans" dan "Bus Wisata" masuk BRT & Non-BRT
    (ketiga kelompok resmi sudah berjumlah 100%). */
export function serviceGroupOf(routeDesc: string): ServiceGroup {
  const d = routeDesc.trim().toLowerCase();
  if (d === "mikrotrans") return "mikrotrans";
  if (d === "transjabodetabek") return "transjabodetabek";
  return "brtNonBrt";
}

/** Bentuk data hasil generator (src/data/halte-ridership.generated.ts). */
export interface RidershipDataset {
  meta: {
    generatedAt: string;
    /** Header Last-Modified file GTFS (atau tanggal file di dalam zip). */
    gtfsDate: string;
    /** Senin–Minggu yang dipakai untuk rata-rata perjalanan per hari. */
    referenceWeek: [string, string];
    /** Total perjalanan jaringan per hari (rata-rata seminggu) per kelompok. */
    runsPerDay: Record<ServiceGroup, number>;
  };
  /**
   * Satu baris per titik:
   *   id,brtNonBrt,mikrotrans,transjabodetabek,rute1|rute2|…
   * Angka = rata-rata perjalanan bus per hari yang berhenti di titik itu.
   * String (bukan objek) supaya ringan untuk TypeScript & bundle.
   */
  rows: string;
}

export interface RidershipEstimate {
  /** Rata-rata perjalanan bus per hari yang berhenti di titik ini. */
  busesPerDay: number;
  /** Estimasi penumpang/hari yang diangkut bus-bus tersebut (dibulatkan). */
  passengersPerDay: number;
  /** Nama rute yang berhenti di titik ini (urut alami). */
  routes: string[];
  ridershipYear: number;
  gtfsDate: string;
}

/** Pembulatan supaya angka tidak terlihat lebih presisi dari datanya. */
export function roundEstimate(n: number): number {
  if (n < 1_000) return Math.round(n / 10) * 10;
  if (n < 10_000) return Math.round(n / 100) * 100;
  return Math.round(n / 1_000) * 1_000;
}

/** Parse dataset jadi Map id → estimasi. Dipanggil sekali per instance. */
export function buildRidershipIndex(
  dataset: RidershipDataset
): Map<string, RidershipEstimate> {
  const { runsPerDay, gtfsDate } = dataset.meta;
  const perRun = Object.fromEntries(
    SERVICE_GROUPS.map((g) => [
      g,
      runsPerDay[g] > 0 ? RIDERSHIP_PER_YEAR[g] / 365 / runsPerDay[g] : 0,
    ])
  ) as Record<ServiceGroup, number>;

  const index = new Map<string, RidershipEstimate>();
  for (const line of dataset.rows.split("\n")) {
    if (!line) continue;
    const [id, a, b, c, routes = ""] = line.split(",");
    const runs: Record<ServiceGroup, number> = {
      brtNonBrt: Number(a) || 0,
      mikrotrans: Number(b) || 0,
      transjabodetabek: Number(c) || 0,
    };
    const busesPerDay = runs.brtNonBrt + runs.mikrotrans + runs.transjabodetabek;
    if (!id || busesPerDay <= 0) continue;
    const passengers = SERVICE_GROUPS.reduce((sum, g) => sum + runs[g] * perRun[g], 0);
    index.set(id, {
      busesPerDay: Math.round(busesPerDay),
      passengersPerDay: roundEstimate(passengers),
      routes: routes ? routes.split("|") : [],
      ridershipYear: RIDERSHIP_YEAR,
      gtfsDate,
    });
  }
  return index;
}
