"use client";

// ============================================================================
// AUTH — backed by Supabase Auth.
//
// Public surface (dipakai Header, dashboard, settings, superadmin, dll.):
//
//   useCurrentUser() / useAuthSync() : User | null      (sync, hook)
//   getCurrentUser()                  : User | null      (sync, cache)
//   isLoggedIn()                      : boolean          (sync)
//   getInitials(name)                 : string
//   login(email, password)            : Promise<LoginResult>
//   logout()                          : Promise<void>
//   useAuthResolved()                 : boolean          (sesi awal sudah dicek?)
//   bootstrapAuthSubscription()       : () => void       (dipasang <AuthBootstrap/>)
//
// Pembacaan sinkron memakai cache di sessionStorage yang diisi oleh:
//   1. login()                               (langsung setelah sign-in)
//   2. supabase.auth.onAuthStateChange       (INITIAL_SESSION saat halaman
//      dimuat, SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED/USER_UPDATED sesudahnya)
//
// PENTING (bug "login/logout macet"): callback onAuthStateChange dijalankan
// supabase-js DI DALAM lock auth. Query DB di dalamnya (yang juga butuh lock
// untuk mengambil access token) membuat deadlock, dan semua operasi auth
// berikutnya (signIn, signOut) ikut menggantung. Karena itu callback di sini
// sinkron dan pekerjaan async-nya ditunda ke macrotask berikutnya.
// ============================================================================

import { useSyncExternalStore } from "react";
import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { supabase, withTimeout } from "@/lib/supabase";

export type UserRole = "admin" | "korporasi" | "umkm" | "superadmin" | "sponsor";

export interface User {
  /** Supabase auth.uid() */
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isLoggedIn: true;
  /** Verification state for the linked company. */
  status?: "pending" | "active" | "rejected";
}

/**
 * Discriminated result for `login()`. The login page uses `reason` to choose
 * between redirect (`ok: true`), an inline error (`invalid` / `network`), and
 * a dedicated info box (`pending` / `rejected`).
 */
export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid"; companyName?: string }
  | { ok: false; reason: "network" }
  | { ok: false; reason: "pending"; companyName: string }
  | {
      ok: false;
      reason: "rejected";
      companyName: string;
      rejectionReason: string | null;
    };

const SESSION_KEY = "airhalte_user_cache";
const FAVORITES_KEY = "airhalte:favorites";
const AUTH_EVENT = "airhalte:auth-changed";
const FAVORITES_EVENT = "airhalte:favorites-changed";

/** Batas tunggu request auth/DB supaya tombol "Memproses…" tidak macet selamanya. */
const AUTH_REQUEST_TIMEOUT_MS = 20_000;
const COMPANY_LOOKUP_TIMEOUT_MS = 10_000;
/** signOut() pernah menggantung saat cookie sesi rusak; jangan tunggu lebih dari ini. */
const SIGN_OUT_TIMEOUT_MS = 1_500;

// ---------------------------------------------------------------------------
// Env guard — if NEXT_PUBLIC_SUPABASE_* are missing we short-circuit login()
// with an "invalid" result instead of letting the Supabase client throw.
// ---------------------------------------------------------------------------
const SUPABASE_AVAILABLE = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ---------------------------------------------------------------------------
// Cache layer — stable snapshot so useSyncExternalStore is happy and so
// callers don't re-parse JSON on every render.
// ---------------------------------------------------------------------------
let _cachedUser: User | null = null;
let _hydrated = false;
/** Naik setiap ada event auth / logout; hasil async yang sudah basi dibuang. */
let _authSeq = 0;
/**
 * True setelah status sesi pertama kali diketahui (INITIAL_SESSION selesai
 * diproses, atau login/logout). Guard halaman memakai ini supaya tidak
 * me-redirect ke /login hanya karena cache sessionStorage kosong (tab baru,
 * kembali dari link reset password / OAuth).
 */
let _authResolved = !SUPABASE_AVAILABLE;

/** Read the cached user object. Lazy-hydrates from sessionStorage on first call. */
function readCache(): User | null {
  if (typeof window === "undefined") return null;
  if (!_hydrated) {
    _hydrated = true;
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as User;
        if (parsed?.isLoggedIn) _cachedUser = parsed;
      }
    } catch {
      _cachedUser = null;
    }
  }
  return _cachedUser;
}

function markAuthResolved() {
  if (_authResolved) return;
  _authResolved = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT));
  }
}

function writeCache(user: User | null) {
  _cachedUser = user;
  _hydrated = true;
  _authResolved = true;
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

// ---------------------------------------------------------------------------
// Supabase → app User mapping. Joins companies (status, name) and picks a
// role (superadmin from app_metadata, otherwise default korporasi).
// ---------------------------------------------------------------------------
type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

type CompanyLike = {
  company_name?: string | null;
  status?: string | null;
} | null;

function toUser(authUser: AuthUserLike, company: CompanyLike): User {
  const email = authUser.email ?? "";
  const isSuperadmin = authUser.app_metadata?.role === "superadmin";
  const meta = authUser.user_metadata ?? {};
  const fallbackName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    email.split("@")[0] ||
    "Pengguna";

  return {
    id: authUser.id,
    email,
    name: company?.company_name || fallbackName,
    role: isSuperadmin ? "admin" : "korporasi",
    isLoggedIn: true,
    status: isSuperadmin
      ? "active"
      : ((company?.status as User["status"]) ?? undefined),
  };
}

async function buildUserFromSession(authUser: AuthUserLike): Promise<User> {
  // .maybeSingle() so that a brand-new OAuth user (no company row yet)
  // returns null instead of erroring.
  const { data: company, error } = await withTimeout(
    supabase
      .from("companies")
      .select("company_name, status")
      .eq("auth_user_id", authUser.id)
      .maybeSingle(),
    COMPANY_LOOKUP_TIMEOUT_MS,
    "load company"
  );
  if (error) {
    // Gagal membaca (jaringan / RLS): jangan timpa data yang sudah benar.
    const cached = readCache();
    if (cached && cached.id === authUser.id) return cached;
  }
  return toUser(authUser, (company as CompanyLike) ?? null);
}

/** signOut() dengan batas waktu. Tidak pernah melempar error. */
async function signOutQuietly(): Promise<void> {
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise((resolve) => setTimeout(resolve, SIGN_OUT_TIMEOUT_MS)),
    ]);
  } catch {
    /* network error — local state is cleared by the caller */
  }
}

function isSupabaseAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.includes("-auth-token");
}

/**
 * Bersihkan sisa sesi di browser. @supabase/ssr menyimpan sesi di cookie
 * `sb-<ref>-auth-token(.N)`; kalau signOut() tidak sempat selesai, cookie itu
 * masih ada dan proxy akan menganggap user tetap login di halaman berikutnya.
 */
function clearLocalAuthArtifacts() {
  try {
    window.localStorage.removeItem(FAVORITES_KEY);
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && isSupabaseAuthKey(k)) window.localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  try {
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (name && isSupabaseAuthKey(name)) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();

  if (!SUPABASE_AVAILABLE) {
    return { ok: false, reason: "invalid" };
  }

  let signedIn = false;
  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email: normalized, password }),
      AUTH_REQUEST_TIMEOUT_MS,
      "sign in"
    );
    if (error || !data.user) {
      return isAuthRetryableFetchError(error)
        ? { ok: false, reason: "network" }
        : { ok: false, reason: "invalid" };
    }
    signedIn = true;

    // Superadmin bypass — if the JWT carries the superadmin role, skip the
    // company status gate entirely. Superadmins may not have a company row.
    if (data.user.app_metadata?.role === "superadmin") {
      const user = await buildUserFromSession(data.user);
      writeCache(user);
      return { ok: true, user };
    }

    // Status gate — only `active` companies may proceed. We sign the user
    // back out for pending/rejected so the session doesn't linger; the UI
    // shows the dedicated info box instead.
    const { data: company, error: companyError } = await withTimeout(
      supabase
        .from("companies")
        .select("company_name, status, rejection_reason")
        .eq("auth_user_id", data.user.id)
        .maybeSingle(),
      AUTH_REQUEST_TIMEOUT_MS,
      "load company"
    );
    if (companyError) throw new Error(companyError.message);

    if (company?.status === "pending" || company?.status === "rejected") {
      _authSeq++; // abaikan hasil SIGNED_IN yang masih diproses di latar
    }
    if (company?.status === "pending") {
      await signOutQuietly();
      return { ok: false, reason: "pending", companyName: company.company_name };
    }
    if (company?.status === "rejected") {
      await signOutQuietly();
      return {
        ok: false,
        reason: "rejected",
        companyName: company.company_name,
        rejectionReason: company.rejection_reason ?? null,
      };
    }

    const user = toUser(data.user, company ?? null);
    writeCache(user);
    return { ok: true, user };
  } catch {
    // Timeout / koneksi putus. Kalau sign-in sempat berhasil, keluarkan lagi
    // supaya status perusahaan tetap tervalidasi di percobaan berikutnya.
    if (signedIn) {
      _authSeq++;
      await signOutQuietly();
    }
    return { ok: false, reason: "network" };
  }
}

export async function logout(): Promise<void> {
  // signOut() dibatasi 1,5 detik (signOutQuietly) supaya redirect pemanggil
  // (Header / SuperadminTopbar) selalu jalan. Sisa sesi lokal dibersihkan di
  // bawah, jadi halaman berikutnya selalu melihat user sudah keluar.
  if (SUPABASE_AVAILABLE) await signOutQuietly();
  if (typeof window !== "undefined") {
    clearLocalAuthArtifacts();
    window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
  }
  _authSeq++; // batalkan sinkronisasi user yang masih berjalan
  writeCache(null);
}

export function getCurrentUser(): User | null {
  return readCache();
}

export function isLoggedIn(): boolean {
  return readCache() !== null;
}

export function useCurrentUser(): User | null {
  return useAuthSync();
}

function subscribeAuth(cb: () => void) {
  window.addEventListener(AUTH_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(AUTH_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useAuthSync(): User | null {
  return useSyncExternalStore<User | null>(
    subscribeAuth,
    () => readCache(),
    () => null
  );
}

/**
 * Sudahkah sesi awal dicek? Pakai bersama useAuthSync() di guard halaman:
 * redirect ke /login hanya kalau `resolved && !user`.
 */
export function useAuthResolved(): boolean {
  return useSyncExternalStore<boolean>(
    subscribeAuth,
    () => _authResolved,
    () => false
  );
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Session bootstrap — call once at app mount (mounted by <AuthBootstrap/>
// in the root layout). Subscribes to auth changes so the local cache is
// always in sync. The INITIAL_SESSION event fired on subscribe replaces the
// old separate getSession() pull.
// ---------------------------------------------------------------------------
let _bootstrapped = false;

function scheduleUserSync(session: Session | null) {
  const seq = ++_authSeq;
  const authUser = session?.user ?? null;
  // Macrotask berikutnya = setelah supabase-js melepas lock auth.
  setTimeout(() => {
    void (async () => {
      let user: User | null = null;
      if (authUser) {
        try {
          user = await buildUserFromSession(authUser);
        } catch {
          // Timeout / jaringan: biarkan cache yang ada, tapi tandai sudah
          // dicek supaya halaman tidak menunggu selamanya.
          if (seq === _authSeq) markAuthResolved();
          return;
        }
      }
      if (seq !== _authSeq) return; // sudah ada event yang lebih baru
      // Isi sama (mis. TOKEN_REFRESHED tiap jam): cukup tandai sudah dicek,
      // jangan picu render ulang semua pemakai useAuthSync().
      if (JSON.stringify(user) === JSON.stringify(readCache())) {
        markAuthResolved();
        return;
      }
      writeCache(user);
    })();
  }, 0);
}

export function bootstrapAuthSubscription(): () => void {
  if (_bootstrapped || !SUPABASE_AVAILABLE) return () => {};
  _bootstrapped = true;

  // Callback WAJIB sinkron. Jangan jadikan async dan jangan await API
  // Supabase di dalamnya (lihat catatan deadlock di atas file).
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    scheduleUserSync(session);
  });

  return () => {
    data.subscription.unsubscribe();
    _bootstrapped = false;
  };
}
