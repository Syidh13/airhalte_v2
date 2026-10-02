import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Batas tunggu refresh sesi untuk halaman biasa. Saat Supabase lambat/putus,
 * supabase-js mengulang refresh hingga ±30 detik; halaman jangan ikut macet.
 */
const SESSION_REFRESH_TIMEOUT_MS = 5_000;

/**
 * Proxy (Next 16; dulu `middleware.ts`). Dua tugas:
 *
 * 1. Refresh sesi Supabase untuk semua halaman & API yang memakai sesi.
 *    Route handler memakai `setAll` read-only, jadi kalau access token sudah
 *    kedaluwarsa, handler bisa memakai refresh token tanpa menyimpan token
 *    barunya. Browser lalu memegang refresh token yang sudah terpakai dan
 *    sesinya dicabut Supabase ("logout acak"). Di sini token di-refresh lebih
 *    dulu dan cookie barunya ditulis ke request (untuk handler/halaman) dan
 *    ke response (untuk browser). Pola standar @supabase/ssr.
 *
 * 2. Gate /superadmin/*: wajib ada sesi valid dan JWT membawa
 *    `app_metadata.role = 'superadmin'`.
 *      - Tanpa sesi  → /login?next=<path asal>
 *      - Role salah → /?error=forbidden
 *    Otorisasi data tetap dilakukan di tiap API route (requireSuperadmin +
 *    RLS); proxy hanya lapisan pertama.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isSuperadminRoute =
    pathname === "/superadmin" || pathname.startsWith("/superadmin/");

  // GET publik ke /api/haltes/* (ketersediaan yang di-poll tiap 10 detik,
  // detail halte yang di-cache publik, riwayat publik) dan /api/nearby
  // (proxy OpenStreetMap) tidak membaca sesi. Jangan sentuh cookie di sini
  // supaya response publik tidak pernah membawa Set-Cookie.
  if (
    request.method === "GET" &&
    (pathname.startsWith("/api/haltes") || pathname === "/api/nearby")
  ) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    // Env belum lengkap: halaman publik tetap jalan, area superadmin ditutup.
    return isSuperadminRoute
      ? NextResponse.redirect(new URL("/login", request.url))
      : NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet, headers) {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
        // Response yang membawa cookie sesi tidak boleh di-cache CDN.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  if (!isSuperadminRoute) {
    // Cukup refresh bila perlu: getSession() hanya membaca cookie dan baru
    // memanggil Supabase kalau access token hampir/sudah kedaluwarsa. Hasilnya
    // tidak dipakai untuk otorisasi (itu tugas getUser() di route handler).
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        supabase.auth.getSession(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, SESSION_REFRESH_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* gangguan jaringan: jangan blokir halaman */
    } finally {
      if (timer) clearTimeout(timer);
    }
    return response;
  }

  // getUser() memvalidasi JWT ke Supabase (bukan sekadar membaca cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return redirectKeepingCookies(loginUrl, response);
  }

  const role =
    (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  if (role !== "superadmin") {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set("error", "forbidden");
    return redirectKeepingCookies(homeUrl, response);
  }

  return response;
}

/** Redirect tanpa membuang cookie sesi yang baru di-refresh. */
function redirectKeepingCookies(target: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(target);
  const cookies = from.cookies.getAll();
  for (const cookie of cookies) {
    redirect.cookies.set(cookie);
  }
  if (cookies.length > 0) {
    redirect.headers.set("Cache-Control", "private, no-store");
  }
  return redirect;
}

export const config = {
  matcher: [
    // Semua path KECUALI aset: /_next/*, favicon, dan file berekstensi
    // (ikon, gambar, /haltes-map.geojson, font, audio, manifest).
    "/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|geojson|json|txt|xml|webmanifest|mp3|wav|woff2?)$).*)",
  ],
};
