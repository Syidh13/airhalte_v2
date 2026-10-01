import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth + email-confirmation callback. Supabase redirects here with a `code`
 * query param after the external auth flow completes; we exchange it for a
 * session, then route the user based on their company status.
 *
 * Routing matrix:
 *   no company row         → /signup/company  (e.g. fresh Google login)
 *   company.status=active  → / (or ?next=…, hanya path internal)
 *   company.status=pending → /login?status=pending
 *   company.status=rejected→ /login?status=rejected
 */

/**
 * `next` hanya boleh path di origin sendiri. Menolak "//evil.com", "/\evil.com",
 * URL absolut, dan trik lain (tab/newline yang dibuang parser URL) dengan
 * memastikan hasil resolve tetap di origin yang sama. Selain itu → "/".
 */
function safeNextPath(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin
  );

  if (!code) {
    return NextResponse.redirect(new URL("/login", requestUrl.origin));
  }

  // In Next 15+ `cookies()` is async. The SSR helper expects a getAll/setAll
  // pair to support refreshing the session cookie on every request.
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login", requestUrl.origin));
  }

  const { data: company } = await supabase
    .from("companies")
    .select("status")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!company) {
    // Brand-new OAuth user — they need to fill in company details.
    return NextResponse.redirect(
      new URL("/signup/company", requestUrl.origin)
    );
  }
  if (company.status === "pending") {
    return NextResponse.redirect(
      new URL("/login?status=pending", requestUrl.origin)
    );
  }
  if (company.status === "rejected") {
    return NextResponse.redirect(
      new URL("/login?status=rejected", requestUrl.origin)
    );
  }
  // active → forward to `next` (default `/`, sudah divalidasi safeNextPath).
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
