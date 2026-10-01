import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. **Server-side only** — the import marker
 * `server-only` will hard-fail any module graph that tries to ship this to
 * the browser. The service role key bypasses RLS, so leaking it would
 * expose every row in every table.
 *
 * Use this from Route Handlers / Server Actions for trusted superadmin
 * mutations (e.g. force-update of company status, deleting a halte).
 * For reads on behalf of an authenticated superadmin, prefer the anon
 * client + RLS policy `is_superadmin()` so that auth.uid() is correct
 * for audit columns.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Don't crash the build if the env var is missing — some local dev
  // setups won't have it. The first call will throw with a clear message.
   
  console.warn(
    "[supabase-admin] SUPABASE_SERVICE_ROLE_KEY missing — admin client unavailable."
  );
}

export const supabaseAdmin = createClient(url ?? "", serviceKey ?? "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
