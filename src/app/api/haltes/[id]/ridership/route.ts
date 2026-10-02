/**
 * GET /api/haltes/[id]/ridership
 *
 * Estimasi rata-rata potensi penumpang untuk satu titik (lihat
 * lib/ridership.ts untuk cara hitung). Data statis hasil
 * `npm run generate:ridership` (jadwal GTFS TJ) — tidak menyentuh DB.
 *
 * Response:
 *   200 { data: RidershipEstimate }  — titik ada di jadwal GTFS
 *   200 { data: null }               — titik tidak ada di jadwal GTFS
 *
 * Cache: data hanya berubah saat file generated di-deploy ulang.
 */
import { NextResponse, type NextRequest } from "next/server";
import { HALTE_RIDERSHIP } from "@/data/halte-ridership.generated";
import { buildRidershipIndex, type RidershipEstimate } from "@/lib/ridership";

let index: Map<string, RidershipEstimate> | null = null;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  index ??= buildRidershipIndex(HALTE_RIDERSHIP);
  return NextResponse.json(
    { data: index.get(id.toLowerCase()) ?? null },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}
