/**
 * Generate static GeoJSON of all haltes for the portal map.
 *
 * Run: npm run generate:map
 *
 * Reads the `haltes` table via the service role key (bypasses RLS +
 * PostgREST 1000-row cap) and writes a minified GeoJSON FeatureCollection
 * to `public/haltes-map.geojson`. Each feature carries the minimal set of
 * props the map needs to render + filter: id, name, mode, tier, available,
 * corridor. Harga dasar / penawaran / jadwal lelang TIDAK di-bake di sini —
 * nilainya berubah-ubah dan datang live dari /api/haltes/availability.
 * Record uji (id 'test') selalu dibuang.
 *
 * The file is the "stable" layer of the hybrid data pipeline:
 *   Supabase → this script → public/haltes-map.geojson → browser
 * regenerated manually (or via the superadmin "Sync Map Data" button)
 * when master data changes — which happens maybe once every few months.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isExcludedHalteId, type Tier } from "../data/haltes";

function loadEnvLocal(): void {
  try {
    const path = resolve(process.cwd(), ".env.local");
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // fine if already exported
  }
}

loadEnvLocal();

const PAGE_SIZE = 1000;
const OUTPUT_PATH = resolve(process.cwd(), "public/haltes-map.geojson");

interface DbRow {
  id: string;
  name: string;
  corridor: string | null;
  lat: number;
  lng: number;
  tier: "premium" | "mass";
  is_available: boolean;
}

type Mode = "premium" | "mass";

interface FeatureProps {
  id: string;
  name: string;
  mode: Mode;
  /** Legacy code kept for file-shape stability (A = BRT, D = Non-BRT).
      Not a price class; the portal derives it from `mode` and never shows it. */
  tier: Tier;
  available: boolean;
  /** TJ corridor number/code (e.g. "1", "13", "M11"). Null for haltes
      that don't carry corridor metadata in DB. Read by the sidebar
      synthesize path so non-hardcoded haltes show real koridor info. */
  corridor: string | null;
}

interface MapFeature {
  type: "Feature";
  properties: FeatureProps;
  geometry: { type: "Point"; coordinates: [number, number] };
}

export async function generateMapData(): Promise<{
  featureCount: number;
  fileSize: number;
  filePath: string;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "[generate-map] Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows: DbRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("haltes")
      .select("id, name, corridor, lat, lng, tier, is_available")
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(`Supabase error: ${error.message}`);
    const page = (data ?? []) as DbRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (rows.length > 50_000) {
      throw new Error(`Safety limit hit at ${rows.length} rows`);
    }
  }

  const features: MapFeature[] = rows
    .filter(
      (r) =>
        !isExcludedHalteId(r.id) &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng)
    )
    .map((r) => {
      // No editorial twin lookup any more: tier is a fixed per-mode code.
      const tier: Tier = r.tier === "premium" ? "A" : "D";
      return {
        type: "Feature" as const,
        properties: {
          id: r.id,
          name: r.name,
          mode: r.tier,
          tier,
          available: r.is_available,
          corridor: r.corridor ?? null,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [r.lng, r.lat] as [number, number],
        },
      };
    });

  const collection = {
    type: "FeatureCollection" as const,
    generatedAt: new Date().toISOString(),
    features,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const json = JSON.stringify(collection);
  writeFileSync(OUTPUT_PATH, json, "utf8");
  const size = Buffer.byteLength(json, "utf8");

  return {
    featureCount: features.length,
    fileSize: size,
    filePath: OUTPUT_PATH,
  };
}

async function main() {
  console.log("[generate-map] Fetching haltes from Supabase…");
  const { featureCount, fileSize, filePath } = await generateMapData();
  const sizeKb = (fileSize / 1024).toFixed(1);
  console.log(`[generate-map] ✓ Wrote ${featureCount} features → ${filePath}`);
  console.log(`[generate-map]   File size: ${sizeKb} KB`);
}

// Only run main() when executed directly via tsx (not when imported by the
// admin API route). import.meta.url === `file://${process.argv[1]}` is the
// canonical ESM check for "am I the entrypoint?"
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${resolve(process.argv[1])}`;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[generate-map] Failed:", err);
    process.exit(1);
  });
}
