"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  BIDANG_USAHA_OPTIONS,
  formatNpwp,
  isValidNpwp,
  NPWP_ERROR_MESSAGE,
} from "@/lib/registrations";

type Step = "form" | "success";

export default function SignupPage() {
  const [step, setStep] = useState<Step>("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Section A — Data Perusahaan
  const [companyName, setCompanyName] = useState("");
  const [bidangUsaha, setBidangUsaha] = useState("");
  const [npwp, setNpwp] = useState("");
  const [website, setWebsite] = useState("");

  // Section B — Person In Charge
  const [picName, setPicName] = useState("");
  const [picRole, setPicRole] = useState("");
  const [picEmail, setPicEmail] = useState("");
  const [picPhone, setPicPhone] = useState("");

  // Section C — Akun
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);

  // Snapshot of submitted data for the success card. We capture rather than
  // re-read state so wiping the form (or future re-submits) doesn't blank the
  // confirmation copy.
  const [submitted, setSubmitted] = useState<{
    company: string;
    email: string;
    needsEmailConfirmation: boolean;
  } | null>(null);

  const handleNpwpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNpwp(formatNpwp(e.target.value));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!isValidNpwp(npwp)) {
      setError(NPWP_ERROR_MESSAGE);
      return;
    }
    if (password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    if (!agree) {
      setError("Anda harus menyetujui syarat & ketentuan serta kebijakan privasi.");
      return;
    }

    setSubmitting(true);

    const trimmedEmail = picEmail.trim();
    const trimmedCompany = companyName.trim();

    // Atomic server-side registration. The /api/register handler creates
    // the auth user, then inserts companies + contacts via the service-role
    // client. If any step fails, the server rolls back and returns ok:false
    // with a Bahasa error message ready to surface. `needsEmailConfirmation`
    // tells us whether Supabase still expects the user to confirm by email
    // (currently OFF in this project).
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          companyName: trimmedCompany,
          bidangUsaha,
          npwp,
          website: website.trim(),
          picName: picName.trim(),
          picRole: picRole.trim(),
          picPhone: picPhone.trim(),
        }),
      });

      const json = (await res.json()) as
        | { ok: true; needsEmailConfirmation?: boolean }
        | { ok: false; error: string };

      if (!json.ok) {
        setSubmitting(false);
        setError(json.error || "Gagal mendaftar. Silakan coba lagi.");
        return;
      }

      setSubmitted({
        company: trimmedCompany,
        email: trimmedEmail,
        needsEmailConfirmation: json.needsEmailConfirmation === true,
      });
      setSubmitting(false);
      setStep("success");
    } catch {
      setSubmitting(false);
      setError(
        "Tidak bisa terhubung ke server. Periksa koneksi internet Anda."
      );
    }
  };

  if (step === "success" && submitted) {
    return (
      <>
        <Link href="/" className="auth-home-back">
          ← Kembali ke Beranda
        </Link>
        <div className="auth-success">
          <div className="auth-success-icon" aria-hidden="true">✓</div>
          <div className="auth-kicker">§ PENDAFTARAN TERKIRIM</div>
          <h1 className="auth-title">
            Pendaftaran <em>terkirim</em>.
          </h1>
          {submitted.needsEmailConfirmation ? (
            <p className="auth-sub">
              Terima kasih, <strong>{submitted.company}</strong>. Konfirmasi
              alamat email lewat link yang kami kirim ke{" "}
              <strong>{submitted.email}</strong>. Setelah itu, admin TJ
              memverifikasi data perusahaan dan NPWP Anda.
            </p>
          ) : (
            <p className="auth-sub">
              Terima kasih, <strong>{submitted.company}</strong>. Akun{" "}
              <strong>{submitted.email}</strong> sudah dibuat. Admin TJ akan
              memverifikasi data perusahaan dan NPWP Anda. Anda dapat masuk
              setelah akun diverifikasi.
            </p>
          )}
          <div className="auth-success-actions">
            <Link href="/" className="auth-btn-primary">
              Kembali ke Beranda →
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Link href="/" className="auth-home-back">
        ← Kembali ke Beranda
      </Link>

      <div className="auth-head">
        <div className="auth-kicker">§ DAFTAR AKUN PERUSAHAAN</div>
        <h1 className="auth-title">
          Sponsori halte untuk <em>bisnis Anda</em>.
        </h1>
        <p className="auth-sub">
          Perusahaan diverifikasi admin TJ berdasarkan NPWP sebelum dapat ikut
          lelang atau berlangganan.
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {/* SECTION A — DATA PERUSAHAAN */}
        <div className="auth-section-label">DATA PERUSAHAAN</div>

        <div className="auth-field">
          <label htmlFor="su-company" className="auth-label">
            Nama perusahaan <span className="auth-req">*</span>
          </label>
          <input
            id="su-company"
            type="text"
            className="auth-input"
            placeholder="cth. PT Brand Sejahtera"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            minLength={3}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="su-bidang" className="auth-label">
            Bidang usaha <span className="auth-req">*</span>
          </label>
          <select
            id="su-bidang"
            className="auth-input auth-select"
            value={bidangUsaha}
            onChange={(e) => setBidangUsaha(e.target.value)}
            required
          >
            <option value="" disabled>Pilih bidang usaha…</option>
            {BIDANG_USAHA_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <div className="auth-field">
          <label htmlFor="su-npwp" className="auth-label">
            NPWP perusahaan <span className="auth-req">*</span>
          </label>
          <input
            id="su-npwp"
            type="text"
            className="auth-input"
            placeholder="15 atau 16 digit"
            inputMode="numeric"
            value={npwp}
            onChange={handleNpwpChange}
            required
          />
          <span className="auth-hint">
            NPWP 15 digit atau 16 digit. Format diterapkan otomatis.
          </span>
        </div>

        <div className="auth-field">
          <label htmlFor="su-website" className="auth-label">
            Website perusahaan <span className="auth-opt">(opsional)</span>
          </label>
          <input
            id="su-website"
            type="url"
            className="auth-input"
            placeholder="https://perusahaan.co.id"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {/* SECTION B — PERSON IN CHARGE */}
        <div className="auth-section-label" style={{ marginTop: 8 }}>
          PERSON IN CHARGE
        </div>

        <div className="auth-row">
          <div className="auth-field">
            <label htmlFor="su-pic-name" className="auth-label">
              Nama lengkap PIC <span className="auth-req">*</span>
            </label>
            <input
              id="su-pic-name"
              type="text"
              className="auth-input"
              placeholder="Nama lengkap"
              value={picName}
              onChange={(e) => setPicName(e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="su-pic-role" className="auth-label">
              Jabatan <span className="auth-req">*</span>
            </label>
            <input
              id="su-pic-role"
              type="text"
              className="auth-input"
              placeholder="cth. Marketing Manager"
              value={picRole}
              onChange={(e) => setPicRole(e.target.value)}
              required
              minLength={2}
            />
          </div>
        </div>

        <div className="auth-row">
          <div className="auth-field">
            <label htmlFor="su-pic-email" className="auth-label">
              Email bisnis <span className="auth-req">*</span>
            </label>
            <input
              id="su-pic-email"
              type="email"
              className="auth-input"
              placeholder="nama@perusahaan.co.id"
              value={picEmail}
              onChange={(e) => setPicEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="su-pic-phone" className="auth-label">
              No. telepon kantor <span className="auth-req">*</span>
            </label>
            <input
              id="su-pic-phone"
              type="tel"
              className="auth-input"
              placeholder="+62 21 xxx xxxx"
              value={picPhone}
              onChange={(e) => setPicPhone(e.target.value)}
              required
            />
          </div>
        </div>

        {/* SECTION C — KEAMANAN AKUN */}
        <div className="auth-section-label" style={{ marginTop: 8 }}>
          KEAMANAN AKUN
        </div>

        <div className="auth-field">
          <label htmlFor="su-pw" className="auth-label">
            Password <span className="auth-req">*</span>
          </label>
          <div className="auth-input-wrap">
            <input
              id="su-pw"
              type={showPw ? "text" : "password"}
              className="auth-input"
              placeholder="Min. 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
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

        <div className="auth-field">
          <label htmlFor="su-pw2" className="auth-label">
            Konfirmasi password <span className="auth-req">*</span>
          </label>
          <input
            id="su-pw2"
            type={showPw ? "text" : "password"}
            className="auth-input"
            placeholder="Ketik ulang password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <label className="auth-check">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>
            Saya menyetujui syarat &amp; ketentuan serta kebijakan privasi
            AirHalte (dokumen resmi menyusul dari TJ).
          </span>
        </label>

        {error && (
          <div className="auth-error" role="alert">{error}</div>
        )}

        {/* Verification notice — sits directly above the CTA so it's the last
            thing the user sees before clicking submit. */}
        <div className="auth-info-strip">
          Setelah mendaftar, admin TJ memverifikasi data perusahaan Anda. Anda
          dapat masuk setelah akun diverifikasi.
        </div>

        <button
          type="submit"
          className="auth-btn-primary"
          disabled={submitting}
        >
          {submitting ? "Mengirim…" : "Ajukan Pendaftaran →"}
        </button>

        <p className="auth-switch">
          Sudah punya akun?{" "}
          <Link href="/login" className="auth-link">Masuk →</Link>
        </p>
      </form>
    </>
  );
}
