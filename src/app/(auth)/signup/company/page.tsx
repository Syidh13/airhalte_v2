"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import {
  BIDANG_USAHA_OPTIONS,
  formatNpwp,
  isValidNpwp,
  normalizeWebsite,
  NPWP_ERROR_MESSAGE,
} from "@/lib/registrations";

/**
 * Post-OAuth profile completion. Reached when a user logs in with Google for
 * the first time — Supabase has already created the auth.users row, but no
 * `companies` record exists yet so the callback redirected them here.
 *
 * The form is the same as /signup minus the email/password fields (we have
 * those from the OAuth provider).
 */
export default function CompanyOnboardingPage() {
  const router = useRouter();

  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authUserId, setAuthUserId] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [bidangUsaha, setBidangUsaha] = useState("");
  const [npwp, setNpwp] = useState("");
  const [website, setWebsite] = useState("");

  const [picName, setPicName] = useState("");
  const [picRole, setPicRole] = useState("");
  const [picPhone, setPicPhone] = useState("");

  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the current Supabase user. If there isn't one, kick back to /login.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setAuthUserId(data.user.id);
      setAuthEmail(data.user.email ?? "");
      // Pre-fill PIC name from OAuth metadata if available.
      const meta = data.user.user_metadata ?? {};
      const fullName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        "";
      if (fullName) setPicName(fullName);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (companyName.trim().length < 3) {
      setError("Nama perusahaan minimal 3 karakter.");
      return;
    }
    if (!bidangUsaha) {
      setError("Bidang usaha wajib dipilih.");
      return;
    }
    if (!isValidNpwp(npwp)) {
      setError(NPWP_ERROR_MESSAGE);
      return;
    }
    const normalizedWebsite = normalizeWebsite(website);
    if (normalizedWebsite === null) {
      setError("Alamat website tidak valid (gunakan http:// atau https://).");
      return;
    }
    if (picName.trim().length < 3 || !picRole.trim() || !picPhone.trim()) {
      setError("Data PIC belum lengkap.");
      return;
    }
    if (!agree) {
      setError("Anda harus menyetujui syarat & ketentuan serta kebijakan privasi.");
      return;
    }

    setSubmitting(true);

    // `status` sengaja tidak dikirim: default DB = 'pending', dan hanya admin
    // TJ yang boleh mengubahnya (dipaksa juga oleh trigger di DB).
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({
        auth_user_id: authUserId,
        company_name: companyName.trim(),
        bidang_usaha: bidangUsaha,
        npwp,
        website: normalizedWebsite || null,
      })
      .select("id")
      .single();
    if (companyError || !company) {
      setSubmitting(false);
      setError("Gagal menyimpan data perusahaan. Silakan coba lagi.");
      return;
    }

    const { error: contactError } = await supabase.from("contacts").insert({
      company_id: company.id,
      name: picName.trim(),
      role: picRole.trim(),
      email: authEmail,
      phone: picPhone.trim(),
    });
    if (contactError) {
      setSubmitting(false);
      setError("Gagal menyimpan data PIC. Silakan coba lagi.");
      return;
    }

    setSubmitting(false);
    router.replace("/login?status=pending");
  };

  if (!authReady) {
    return (
      <div className="auth-head">
        <p className="auth-sub">Memuat data akun…</p>
      </div>
    );
  }

  return (
    <>
      <Link href="/" className="auth-home-back">
        ← Kembali ke Beranda
      </Link>

      <div className="auth-head">
        <div className="auth-kicker">§ LENGKAPI DATA PERUSAHAAN</div>
        <h1 className="auth-title">
          Satu langkah <em>terakhir</em>.
        </h1>
        <p className="auth-sub">
          Akun Google Anda (<strong>{authEmail}</strong>) sudah terhubung.
          Lengkapi data perusahaan untuk diverifikasi admin TJ.
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-section-label">DATA PERUSAHAAN</div>

        <div className="auth-field">
          <label htmlFor="co-name" className="auth-label">
            Nama perusahaan <span className="auth-req">*</span>
          </label>
          <input
            id="co-name"
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
          <label htmlFor="co-bidang" className="auth-label">
            Bidang usaha <span className="auth-req">*</span>
          </label>
          <select
            id="co-bidang"
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
          <label htmlFor="co-npwp" className="auth-label">
            NPWP perusahaan <span className="auth-req">*</span>
          </label>
          <input
            id="co-npwp"
            type="text"
            className="auth-input"
            placeholder="15 atau 16 digit"
            inputMode="numeric"
            value={npwp}
            onChange={(e) => setNpwp(formatNpwp(e.target.value))}
            required
          />
          <span className="auth-hint">
            NPWP 15 digit atau 16 digit. Format diterapkan otomatis.
          </span>
        </div>

        <div className="auth-field">
          <label htmlFor="co-web" className="auth-label">
            Website perusahaan <span className="auth-opt">(opsional)</span>
          </label>
          <input
            id="co-web"
            type="url"
            className="auth-input"
            placeholder="https://perusahaan.co.id"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <div className="auth-section-label" style={{ marginTop: 8 }}>
          PERSON IN CHARGE
        </div>

        <div className="auth-row">
          <div className="auth-field">
            <label htmlFor="co-pic-name" className="auth-label">
              Nama lengkap PIC <span className="auth-req">*</span>
            </label>
            <input
              id="co-pic-name"
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
            <label htmlFor="co-pic-role" className="auth-label">
              Jabatan <span className="auth-req">*</span>
            </label>
            <input
              id="co-pic-role"
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

        <div className="auth-field">
          <label htmlFor="co-phone" className="auth-label">
            No. telepon kantor <span className="auth-req">*</span>
          </label>
          <input
            id="co-phone"
            type="tel"
            className="auth-input"
            placeholder="+62 21 xxx xxxx"
            value={picPhone}
            onChange={(e) => setPicPhone(e.target.value)}
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
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <div className="auth-info-strip">
          Setelah dikirim, admin TJ memverifikasi data perusahaan Anda. Anda
          dapat masuk setelah akun diverifikasi.
        </div>

        <button
          type="submit"
          className="auth-btn-primary"
          disabled={submitting}
        >
          {submitting ? "Mengirim…" : "Lengkapi Pendaftaran →"}
        </button>
      </form>
    </>
  );
}
