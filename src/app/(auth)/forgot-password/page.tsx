"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const trimmed = email.trim();
    // Link di email → /auth/callback (tukar kode jadi sesi, cookie di-set di
    // server) → /settings?reset=1, tempat form "Ganti Password" langsung
    // terbuka. Tidak ada halaman /auth/reset-password terpisah.
    const next = encodeURIComponent("/settings?reset=1");
    let resetError: unknown = null;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
      });
      resetError = error;
    } catch (err) {
      resetError = err;
    }
    setSubmitting(false);

    if (resetError) {
      setError("Gagal mengirim link reset. Silakan coba lagi.");
      return;
    }
    setSent(trimmed);
  };

  return (
    <>
      <Link href="/" className="auth-home-back">
        ← Kembali ke Beranda
      </Link>

      {sent ? (
        <div className="auth-success">
          <div className="auth-success-icon" aria-hidden="true">
            ✓
          </div>
          <div className="auth-kicker">§ EMAIL TERKIRIM</div>
          <h1 className="auth-title">
            Cek <em>inbox</em> Anda.
          </h1>
          <p className="auth-sub">
            Jika <strong>{sent}</strong> terdaftar, link reset password dikirim
            ke alamat tersebut. Cek inbox (atau folder spam), lalu buka link
            di browser ini.
          </p>
          <div className="auth-success-actions">
            <Link href="/login" className="auth-btn-primary">
              Kembali ke Login →
            </Link>
            <button
              type="button"
              className="auth-btn-ghost"
              onClick={() => {
                setSent(null);
                setEmail("");
              }}
            >
              Kirim ulang
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="auth-head">
            <div className="auth-kicker">§ LUPA PASSWORD</div>
            <h1 className="auth-title">
              Reset <em>password</em> Anda.
            </h1>
            <p className="auth-sub">
              Masukkan email Anda dan kami akan kirimkan link untuk reset
              password.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="forgot-email" className="auth-label">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                className="auth-input"
                placeholder="nama@perusahaan.co.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={submitting}
            >
              {submitting ? "Mengirim…" : "Kirim Link Reset →"}
            </button>

            <p className="auth-switch">
              <Link href="/login" className="auth-link">
                ← Kembali ke login
              </Link>
            </p>
          </form>
        </>
      )}
    </>
  );
}
