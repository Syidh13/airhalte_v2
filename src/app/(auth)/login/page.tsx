"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import Toast, { type ToastData } from "@/components/Toast";
import { login } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type StatusInfo =
  | { kind: "pending"; companyName: string }
  | { kind: "rejected"; companyName: string; reason: string | null }
  | null;

// --- Query string (dibaca di client tanpa useSearchParams/Suspense) --------
const noopSubscribe = () => () => {};

/** `?status=pending|rejected` dari /auth/callback atau /signup/company. */
function readStatusParam(): "pending" | "rejected" | null {
  const v = new URLSearchParams(window.location.search).get("status");
  return v === "pending" || v === "rejected" ? v : null;
}

/**
 * Tujuan setelah login: `?next=` dari proxy (mis. /superadmin/companies).
 * Hanya path internal; selain itu "/" (mencegah open redirect).
 */
function readNextPath(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<StatusInfo>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  // Info status dari URL hanya ditampilkan sampai user mencoba masuk lagi.
  const [paramDismissed, setParamDismissed] = useState(false);
  const statusParam = useSyncExternalStore(
    noopSubscribe,
    readStatusParam,
    () => null
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shownStatus: StatusInfo =
    statusInfo ??
    (statusParam && !paramDismissed
      ? statusParam === "pending"
        ? { kind: "pending", companyName: "" }
        : { kind: "rejected", companyName: "", reason: null }
      : null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const fireToast = (data: ToastData) => {
    setToast(data);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setStatusInfo(null);
    setParamDismissed(true);
    setSubmitting(true);

    let result: Awaited<ReturnType<typeof login>>;
    try {
      result = await login(email, password);
    } catch {
      result = { ok: false, reason: "network" };
    }
    setSubmitting(false);

    if (result.ok) {
      router.push(readNextPath());
      return;
    }
    // Discriminated `reason` lets us pick between an inline error message
    // and one of the two status info boxes (pending / rejected).
    switch (result.reason) {
      case "invalid":
        setError("Email atau password salah.");
        return;
      case "network":
        setError(
          "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi."
        );
        return;
      case "pending":
        setStatusInfo({ kind: "pending", companyName: result.companyName });
        return;
      case "rejected":
        setStatusInfo({
          kind: "rejected",
          companyName: result.companyName,
          reason: result.rejectionReason,
        });
        return;
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (oauthError) {
      fireToast({
        label: "GAGAL LOGIN",
        msg: "Tidak bisa login dengan Google. Silakan coba lagi.",
        variant: "warn",
      });
    }
    // On success Supabase redirects the browser to Google, so we won't reach
    // any code below this line.
  };

  return (
    <>
      <Link href="/" className="auth-home-back">
        ← Kembali ke Beranda
      </Link>

      <div className="auth-head">
        <div className="auth-kicker">§ MASUK AKUN</div>
        <h1 className="auth-title">
          Selamat datang <em>kembali</em>.
        </h1>
        <p className="auth-sub">
          Ikuti lelang Halte BRT, kelola langganan bus stop Non-BRT, dan pantau
          status penawaran Anda.
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate={false}>
        <div className="auth-field">
          <label htmlFor="login-email" className="auth-label">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="auth-input"
            placeholder="nama@perusahaan.co.id"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="auth-field">
          <div className="auth-label-row">
            <label htmlFor="login-password" className="auth-label">
              Password
            </label>
            <Link href="/forgot-password" className="auth-link-mini">
              Lupa password?
            </Link>
          </div>
          <div className="auth-input-wrap">
            <input
              id="login-password"
              type={showPw ? "text" : "password"}
              className="auth-input"
              placeholder="Min. 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              minLength={8}
              required
            />
            <button
              type="button"
              className="auth-input-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Sembunyikan password" : "Tampilkan password"}
            >
              {showPw ? "Sembunyikan" : "Tampilkan"}
            </button>
          </div>
        </div>

        {error && (
          <div className="auth-error" role="alert">{error}</div>
        )}

        {shownStatus?.kind === "pending" && (
          <div className="auth-status-box pending" role="status">
            <div className="auth-status-title">⏳ Akun sedang diverifikasi</div>
            <p className="auth-status-text">
              {shownStatus.companyName ? (
                <>
                  Data <strong>{shownStatus.companyName}</strong> sedang
                  diverifikasi admin TJ.
                </>
              ) : (
                <>Data perusahaan Anda sedang diverifikasi admin TJ.</>
              )}{" "}
              Anda dapat masuk setelah akun diverifikasi.
            </p>
          </div>
        )}

        {shownStatus?.kind === "rejected" && (
          <div className="auth-status-box rejected" role="alert">
            <div className="auth-status-title">⚠ Pendaftaran ditolak</div>
            <p className="auth-status-text">
              {shownStatus.companyName ? (
                <>
                  Pendaftaran <strong>{shownStatus.companyName}</strong>{" "}
                  ditolak admin TJ.
                </>
              ) : (
                <>Pendaftaran perusahaan Anda ditolak admin TJ.</>
              )}
              {shownStatus.reason && (
                <> Alasan: {shownStatus.reason.replace(/[.\s]+$/, "")}.</>
              )}{" "}
              Hubungi admin TJ untuk informasi lebih lanjut.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="auth-btn-primary"
          disabled={submitting}
        >
          {submitting ? "Memproses…" : "Masuk →"}
        </button>

        {/* TODO: Re-enable saat Google OAuth di-setup di Supabase Dashboard.
            Saat ini provider disabled → Supabase reject request dengan
            error 400 "Unsupported provider". */}
        {false && (
          <>
            <div className="auth-divider">
              <span>atau</span>
            </div>

            <button
              type="button"
              className="auth-btn-google"
              onClick={handleGoogle}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.345 0-4.328-1.584-5.036-3.711H.957v2.331A8.997 8.997 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.655 3.58 9 3.58z"
                />
              </svg>
              Masuk dengan Google
            </button>
          </>
        )}

        <p className="auth-switch">
          Belum punya akun?{" "}
          <Link href="/signup" className="auth-link">
            Daftar sekarang →
          </Link>
        </p>
      </form>

      <Toast toast={toast} />
    </>
  );
}
