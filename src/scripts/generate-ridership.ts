/**
 * Generate estimasi potensi penumpang per titik dari GTFS resmi Transjakarta.
 *
 * Run:  npm run generate:ridership
 *       npm run generate:ridership -- --gtfs /path/ke/file_gtfs.zip
 *       npm run generate:ridership -- --gtfs /path/ke/folder-gtfs
 *
 * Tanpa --gtfs, file diunduh dari GTFS_URL (lib/ridership.ts) ke folder
 * temp lalu diekstrak dengan `unzip` (macOS / Linux).
 *
 * Yang dihitung, per titik di public/haltes-map.geojson:
 *   rata-rata perjalanan bus per hari (Senin–Minggu) yang berhenti di titik
 *   itu, dipisah per kelompok layanan, plus daftar rute. Konversi ke
 *   estimasi penumpang terjadi saat runtime di lib/ridership.ts, jadi angka
 *   pelanggan tahunan bisa diperbarui tanpa menjalankan ulang script ini.
 *
 * Aturan GTFS yang dipakai:
 *   - Feed TJ berbasis frequencies.txt: jumlah perjalanan satu jendela =
 *     ceil((end_time − start_time) / headway_secs). Trip tanpa baris
 *     frequencies dihitung 1 perjalanan.
 *   - Layanan aktif per hari dari calendar.txt (rentang tanggal + hari).
 *   - Platform halte BRT (G…) digabung ke stasiunnya (parent_station H…),
 *     yang menjadi id halte BRT di AirHalte. Bus stop (B…P) dipakai apa adanya.
 *   - Satu titik dihitung sekali per perjalanan (rute loop yang melewati
 *     titik yang sama dua kali tidak dihitung ganda). Baris dengan
 *     pickup_type=1 DAN drop_off_type=1 (bus lewat tanpa berhenti) dibuang.
 *
 * Output: src/data/halte-ridership.generated.ts (di-commit; jangan diedit).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  GTFS_URL,
  SERVICE_GROUPS,
  serviceGroupOf,
  type RidershipDataset,
  type ServiceGroup,
} from "../lib/ridership";

const OUTPUT_PATH = resolve(process.cwd(), "src/data/halte-ridership.generated.ts");
const GEOJSON_PATH = resolve(process.cwd(), "public/haltes-map.geojson");
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// ---------------------------------------------------------------------------
// CSV (RFC 4180, satu record per baris — cukup untuk GTFS)
// ---------------------------------------------------------------------------
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(dir: string, name: string): Record<string, string>[] {
  const path = join(dir, `${name}.txt`);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  const header = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSecs(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function isoDate(d: Date): string {
  const s = ymd(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
}

/** Senin pada / setelah hari ini, lalu 7 hari ke depan. */
function referenceWeek(): Date[] {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  while (start.getDay() !== 1) start.setDate(start.getDate() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function prepareGtfs(arg: string | undefined): Promise<{ dir: string; gtfsDate: string | null }> {
  if (arg && existsSync(arg) && statSync(arg).isDirectory()) return { dir: resolve(arg), gtfsDate: null };

  const work = mkdtempSync(join(tmpdir(), "airhalte-gtfs-"));
  const zipPath = arg ? resolve(arg) : join(work, "file_gtfs.zip");
  let gtfsDate: string | null = null;
  if (!arg) {
    console.log(`[ridership] Mengunduh ${GTFS_URL} …`);
    const res = await fetch(GTFS_URL);
    if (!res.ok) throw new Error(`Unduh GTFS gagal: HTTP ${res.status}`);
    const lastModified = res.headers.get("last-modified");
    if (lastModified) gtfsDate = isoDate(new Date(lastModified));
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  } else if (!existsSync(zipPath)) {
    throw new Error(`File GTFS tidak ditemukan: ${zipPath}`);
  }
  const dir = join(work, "gtfs");
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);
  return { dir, gtfsDate };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argIdx = process.argv.indexOf("--gtfs");
  const { dir, gtfsDate: headerDate } = await prepareGtfs(
    argIdx >= 0 ? process.argv[argIdx + 1] : undefined
  );
  const gtfsDate = headerDate ?? isoDate(statSync(join(dir, "stops.txt")).mtime);

  const calendar = new Map(readCsv(dir, "calendar").map((c) => [c.service_id, c]));
  const routes = new Map(readCsv(dir, "routes").map((r) => [r.route_id, r]));
  const trips = readCsv(dir, "trips");
  const stops = new Map(readCsv(dir, "stops").map((s) => [s.stop_id, s]));
  const frequencies = new Map<string, Record<string, string>[]>();
  for (const f of readCsv(dir, "frequencies")) {
    const list = frequencies.get(f.trip_id) ?? [];
    list.push(f);
    frequencies.set(f.trip_id, list);
  }

  // Titik (station-level, lowercase) yang disinggahi tiap trip.
  const tripStops = new Map<string, Set<string>>();
  for (const st of readCsv(dir, "stop_times")) {
    if (st.pickup_type === "1" && st.drop_off_type === "1") continue;
    const stop = stops.get(st.stop_id);
    const id = (stop?.parent_station || st.stop_id).toLowerCase();
    const set = tripStops.get(st.trip_id) ?? new Set<string>();
    set.add(id);
    tripStops.set(st.trip_id, set);
  }

  // Perjalanan per hari untuk satu trip (0 bila layanannya tidak aktif).
  const week = referenceWeek();
  const runsOn = (trip: Record<string, string>, day: Date): number => {
    const cal = calendar.get(trip.service_id);
    if (!cal) return 0;
    const date = ymd(day);
    if (date < cal.start_date || date > cal.end_date) return 0;
    const dayKey = DAY_KEYS[(day.getDay() + 6) % 7];
    if (cal[dayKey] !== "1") return 0;
    const windows = frequencies.get(trip.trip_id);
    if (!windows?.length) return 1;
    return windows.reduce((sum, f) => {
      const headway = Number(f.headway_secs);
      if (!(headway > 0)) return sum;
      return sum + Math.ceil((toSecs(f.end_time) - toSecs(f.start_time)) / headway);
    }, 0);
  };

  const emptyRuns = (): Record<ServiceGroup, number> => ({ brtNonBrt: 0, mikrotrans: 0, transjabodetabek: 0 });
  const networkRuns = emptyRuns();
  const perStop = new Map<string, { runs: Record<ServiceGroup, number>; routes: Set<string> }>();

  for (const trip of trips) {
    const route = routes.get(trip.route_id);
    const group = serviceGroupOf(route?.route_desc ?? "");
    const avgRuns = week.reduce((sum, d) => sum + runsOn(trip, d), 0) / 7;
    if (avgRuns <= 0) continue;
    networkRuns[group] += avgRuns;
    for (const id of tripStops.get(trip.trip_id) ?? []) {
      const entry = perStop.get(id) ?? { runs: emptyRuns(), routes: new Set<string>() };
      entry.runs[group] += avgRuns;
      entry.routes.add(route?.route_short_name || trip.route_id);
      perStop.set(id, entry);
    }
  }

  // Hanya titik yang ada di peta AirHalte.
  const geo = JSON.parse(readFileSync(GEOJSON_PATH, "utf8")) as {
    features: { properties: { id: string; mode: string; name: string } }[];
  };
  const stats = { premium: [0, 0], mass: [0, 0] } as Record<string, [number, number]>;
  const unmatchedPremium: string[] = [];
  const lines: string[] = [];
  for (const { properties: p } of geo.features) {
    const mode = p.mode === "premium" ? "premium" : "mass";
    stats[mode][1]++;
    const entry = perStop.get(p.id.toLowerCase());
    if (!entry) {
      if (mode === "premium") unmatchedPremium.push(`${p.id} (${p.name})`);
      continue;
    }
    stats[mode][0]++;
    const routeList = [...entry.routes].sort((a, b) =>
      a.localeCompare(b, "id", { numeric: true })
    );
    lines.push(
      [p.id, ...SERVICE_GROUPS.map((g) => round1(entry.runs[g])), routeList.join("|")].join(",")
    );
  }
  lines.sort();

  const dataset: RidershipDataset = {
    meta: {
      generatedAt: new Date().toISOString(),
      gtfsDate,
      referenceWeek: [isoDate(week[0]), isoDate(week[6])],
      runsPerDay: Object.fromEntries(
        SERVICE_GROUPS.map((g) => [g, Math.round(networkRuns[g])])
      ) as Record<ServiceGroup, number>,
    },
    rows: lines.join("\n"),
  };

  const file =
    "// AUTO-GENERATED oleh src/scripts/generate-ridership.ts — jangan diedit manual.\n" +
    "// Jalankan ulang: npm run generate:ridership\n" +
    'import type { RidershipDataset } from "@/lib/ridership";\n\n' +
    `export const HALTE_RIDERSHIP: RidershipDataset = {\n` +
    `  meta: ${JSON.stringify(dataset.meta)},\n` +
    `  rows: ${JSON.stringify(dataset.rows)},\n` +
    "};\n";
  writeFileSync(OUTPUT_PATH, file, "utf8");

  console.log(`[ridership] GTFS ${gtfsDate}, minggu acuan ${dataset.meta.referenceWeek.join(" – ")}`);
  console.log("[ridership] Perjalanan jaringan per hari:", dataset.meta.runsPerDay);
  console.log(`[ridership] Halte BRT cocok ${stats.premium[0]}/${stats.premium[1]}, bus stop cocok ${stats.mass[0]}/${stats.mass[1]}`);
  if (unmatchedPremium.length) console.log("[ridership] Halte BRT tanpa jadwal:", unmatchedPremium.join(", "));
  console.log(`[ridership] Ditulis: ${OUTPUT_PATH} (${(file.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error("[ridership] Gagal:", err);
  process.exit(1);
});
