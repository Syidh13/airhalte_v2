import { createBrowserClient } from "@supabase/ssr";

/**
 * Single shared Supabase browser client. Uses createBrowserClient from
 * @supabase/ssr so the session is stored in cookies (not just localStorage).
 * This allows src/proxy.ts (Next 16, dulu middleware) to refresh the session
 * and gate routes server-side (e.g. /superadmin/*), and lets API routes read
 * the caller's session.
 *
 * Jangan await API Supabase lain di dalam callback onAuthStateChange: callback
 * itu berjalan di dalam lock auth (lihat catatan di src/lib/auth.ts).
 *
 * The public anon key is safe to expose — RLS policies in schema.sql
 * are the source of truth for what each user can read/write.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Wrap a Supabase (or any) thenable with a timeout. Supabase's browser
 * client occasionally hangs after long inactivity — the WebSocket dies
 * and queued REST requests sit there forever. Without this, the UI gets
 * stuck on "Memuat data…" with no way out short of a hard refresh.
 *
 * On timeout we also kick the realtime socket so the next call has a
 * fresh connection instead of hitting the same dead one.
 */
export function withTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label = "supabase query"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      kickSupabase();
      reject(new Error(`Timeout: ${label} took longer than ${ms}ms`));
    }, ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Best-effort revival of a stuck Supabase singleton. Tears down the
 * realtime socket and forces an auth-session re-read so the next REST
 * call hits a fresh internal state.
 *
 * Called automatically by withTimeout, but exported so pages can also
 * trigger it on tab-visibility changes (proactive) instead of waiting
 * for the first hung query (reactive).
 */
export function kickSupabase(): void {
  try {
    supabase.realtime.disconnect();
    supabase.realtime.connect();
  } catch {
    /* ignore */
  }
  // Don't await — fire-and-forget. The point is just to nudge the auth
  // client out of any stuck refresh state.
  try {
    void supabase.auth.getSession();
  } catch {
    /* ignore */
  }
}

/**
 * Run a fetcher with one automatic retry on timeout. After the first
 * timeout the singleton has been kicked (see withTimeout → kickSupabase),
 * so the second attempt usually succeeds within ~1s. Anything else
 * (including a second timeout) bubbles to the caller.
 */
export async function fetchWithRetry<T>(
  fetcher: () => PromiseLike<T>,
  ms: number,
  label = "supabase query"
): Promise<T> {
  try {
    return await withTimeout(fetcher(), ms, label);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("Timeout:")) throw e;
    // Tiny gap so the realtime reconnect can settle before retrying.
    await new Promise((r) => setTimeout(r, 250));
    return await withTimeout(fetcher(), ms, `${label} (retry)`);
  }
}
