"use client";

import { useState, type FormEvent } from "react";
import {
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { emitInfoToast } from "@/components/FavoriteToaster";
import { supabase, withTimeout } from "@/lib/supabase";

/** Sama dengan aturan di form daftar dan /api/register. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Ganti password akun yang sedang login lewat supabase.auth.updateUser().
 * Tidak ada kolom "password lama": pengecekan di sisi browser saja tidak
 * menambah keamanan, dan form ini juga dipakai setelah link reset password
 * (user tidak tahu password lamanya). Kalau Supabase meminta autentikasi
 * ulang ("Secure password change"), pesan di bawah memandu user.
 */
export default function PasswordChangeForm({
  initiallyOpen = false,
}: {
  /** True saat datang dari link reset password (/settings?reset=1). */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setPwNew("");
    setPwConfirm("");
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    if (!pwNew || !pwConfirm) {
      setError("Isi password baru dan konfirmasinya.");
      return;
    }
    if (pwNew.length < MIN_PASSWORD_LENGTH) {
      setError(`Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.`);
      return;
    }
    if (pwNew !== pwConfirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({ password: pwNew }),
        20_000,
        "update password"
      );
      if (updateError) {
        setError(passwordErrorMessage(updateError));
        return;
      }
      close();
      emitInfoToast("Password berhasil diubah");
    } catch {
      setError("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="set-row-title">Password</div>
      <p className="set-row-sub">
        {initiallyOpen && open
          ? "Link reset berhasil dibuka. Buat password baru untuk akun Anda."
          : `Minimal ${MIN_PASSWORD_LENGTH} karakter.`}
      </p>

      {!open ? (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="set-btn set-btn-outline"
            onClick={() => setOpen(true)}
          >
            Ganti Password →
          </button>
        </div>
      ) : (
        <form
          className="set-form set-inline-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="set-form-grid">
            <div className="set-field">
              <label htmlFor="pw-new" className="set-label">
                Password baru
              </label>
              <input
                id="pw-new"
                type="password"
                className="set-input"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                disabled={saving}
              />
            </div>
            <div className="set-field">
              <label htmlFor="pw-confirm" className="set-label">
                Konfirmasi password baru
              </label>
              <input
                id="pw-confirm"
                type="password"
                className="set-input"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                disabled={saving}
              />
            </div>
          </div>
          {error && (
            <div className="set-form-error" role="alert">
              {error}
            </div>
          )}
          <div className="set-form-actions">
            <button
              type="button"
              className="set-btn set-btn-text"
              onClick={close}
              disabled={saving}
            >
              Batal
            </button>
            <button
              type="submit"
              className="set-btn set-btn-primary"
              disabled={saving}
            >
              {saving ? "Menyimpan…" : "Simpan Password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function passwordErrorMessage(err: unknown): string {
  if (isAuthSessionMissingError(err)) {
    return "Sesi Anda sudah berakhir. Silakan masuk kembali.";
  }
  if (isAuthRetryableFetchError(err)) {
    return "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.";
  }
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case "same_password":
      return "Password baru tidak boleh sama dengan password lama.";
    case "weak_password":
      return "Password terlalu lemah. Gunakan kombinasi huruf, angka, dan simbol.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "Demi keamanan, keluar lalu masuk kembali sebelum mengganti password.";
    case "session_not_found":
    case "session_expired":
      return "Sesi Anda sudah berakhir. Silakan masuk kembali.";
    case "over_request_rate_limit":
      return "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.";
    default:
      return "Password gagal diubah. Silakan coba lagi.";
  }
}
