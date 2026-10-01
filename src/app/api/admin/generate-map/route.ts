/**
 * POST /api/admin/generate-map
 *
 * Superadmin-only: regenerate `public/haltes-map.geojson` on demand,
 * reading the latest haltes rows via the service-role key. Wired to
 * the "Sync Map Data" button on the superadmin haltes page so editors
 * can push their changes to the portal map without shelling into a
 * terminal.
 *
 * Auth: session cookie must validate via `getUser()` (JWT verified by
 * Supabase, not just a cookie read) AND the user's `app_metadata.role`
 * must be `"superadmin"`. Same contract as the /superadmin/* middleware.
 *
 * Deploy caveat — Vercel serverless FS:
 *   Writing to `public/` works in dev (local FS) and on a persistent
 *   long-running Node host, but on Vercel the filesystem is ephemeral
 *   per invocation: the file is gone after the next cold start. MVP
 *   plan is fine because superadmin hits this only after data edits
 *   and the CDN caches the previous file until invalidation. If we
 *   move to Vercel and lose the file across deploys, fallback is:
 *     1. run `npm run generate:map` locally,
 *     2. commit + push `public/haltes-map.geojson`,
 *     3. redeploy.
 *   Long-term fix: write to Supabase Storage + serve from there.
 *
 * Response:
 *   200 { ok: true, featureCount, fileSize, generatedAt }
 *   401 { error: "Tidak terautentikasi…" }
 *   403 { error: "Hanya superadmin…" }
 *   500 { error: <message> }
 */
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateMapData } from "../../../../scripts/generate-map-data";

async function requireSuperadmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          /* read-only */
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Tidak terautentikasi. Silakan login ulang." },
      { status: 401 }
    );
  }

  const role =
    (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  if (role !== "superadmin") {
    return NextResponse.json(
      { error: "Hanya superadmin yang boleh sync map data." },
      { status: 403 }
    );
  }

  return null;
}

export async function POST() {
  const authError = await requireSuperadmin();
  if (authError) return authError;

  try {
    const { featureCount, fileSize } = await generateMapData();
    return NextResponse.json({
      ok: true,
      featureCount,
      fileSize,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
