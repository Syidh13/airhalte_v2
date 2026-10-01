"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, fetchWithRetry, kickSupabase } from "@/lib/supabase";
import Toast, { type ToastData } from "@/components/Toast";
import {
  formatNpwp,
  isSafeHttpUrl,
  isValidNpwp,
  npwpDigits,
} from "@/lib/registrations";

type Status = "pending" | "active" | "rejected";
type StatusFilter = "all" | Status;

interface Contact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

interface CompanyRow {
  id: string;
  /** auth.users.id — needed for the per-user admin endpoints
      (e.g. /api/admin/users/[id]/reset-password). May be null for
      legacy seed rows that pre-date the auth wiring. */
  auth_user_id: string | null;
  company_name: string;
  bidang_usaha: string;
  npwp: string;
  website: string | null;
  status: Status;
  rejection_reason: string | null;
  created_at: string;
  contacts: Contact[];
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "pending", label: "Menunggu" },
  { key: "active", label: "Aktif" },
  { key: "rejected", label: "Ditolak" },
];

export default function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<CompanyRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [resetFor, setResetFor] = useState<CompanyRow | null>(null);
  // Single-input password state: only one detail row can be expanded at
  // a time (expandedId is a single value), so we don't need a per-row map.
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  // Request-id guard: every fetchAll bumps the counter, only the latest
  // call gets to write to state. Replaces the per-effect `cancelled` flag
  // so the visibility-refetch path is also safe from race conditions.
  const requestIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireToast = useCallback((data: ToastData) => {
    setToast(data);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Clean up the toast timer on unmount so we don't fire setState after
  // navigating away from /superadmin/companies.
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  // Buka/tutup detail satu baris. Input reset password dikosongkan setiap
  // kali baris yang terbuka berganti, supaya draft lama tidak ikut terkirim.
  const toggleExpanded = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
    setResetPassword("");
    setShowResetPw(false);
  };

  const fetchAll = useCallback(async () => {
    const myId = ++requestIdRef.current;
    try {
      const { data, error: err } = await fetchWithRetry(
        () =>
          supabase
            .from("companies")
            .select(
              "id, auth_user_id, company_name, bidang_usaha, npwp, website, status, rejection_reason, created_at, contacts(name, role, email, phone)"
            )
            .order("created_at", { ascending: false }),
        8_000,
        "load companies"
      );
      if (myId !== requestIdRef.current) return; // a newer call superseded us
      if (err) {
        setError("Gagal memuat data perusahaan.");
        setLoading(false);
        return;
      }
      setRows((data as CompanyRow[]) ?? []);
      setLoading(false);
    } catch (e) {
      if (myId !== requestIdRef.current) return;
      setError(
        `Koneksi lambat / timeout. Silakan refresh halaman. (${
          e instanceof Error ? e.message : "unknown"
        })`
      );
      setLoading(false);
    }
  }, []);

  // Initial load + realtime subscription + visibility refetch.
  // RLS allows superadmin to see all companies; the JOIN to contacts is a
  // one-to-many but in practice there's exactly one PIC per company.
  useEffect(() => {
    // Realtime — refetch on any insert/update/delete on companies. Cheap
    // for the typical superadmin volume; switch to a delta-merge if the
    // list grows past a few hundred rows.
    let channel = subscribeChannel();

    function subscribeChannel() {
      return supabase
        .channel("superadmin-companies")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "companies" },
          () => fetchAll()
        )
        .subscribe();
    }

    // Muat awal lewat microtask: effect tidak memanggil setState secara
    // sinkron (react-hooks/set-state-in-effect); semua setState di fetchAll
    // memang baru terjadi setelah request selesai.
    queueMicrotask(() => {
      void fetchAll();
    });

    // When the tab regains focus we both rebuild the realtime channel
    // (Supabase pauses the WS while hidden, and a stale channel can
    // silently miss events) and refetch so the UI is immediately fresh.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Proactive kick BEFORE issuing the refetch — gives the singleton
      // a fresh socket/auth state so the query doesn't have to time out
      // first to recover.
      kickSupabase();
      supabase.removeChannel(channel);
      channel = subscribeChannel();
      fetchAll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, active: 0, rejected: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  // Approve = activate. Used both for the initial pending → active flow
  // AND for "Approve Ulang" on a previously-rejected row (which also clears
  // the rejection reason). Optimistic UI: we patch local state right after
  // the server confirms, instead of waiting for the realtime subscription
  // — gotrue-js lock + dev-mode quirks make realtime unreliable, and the
  // confirm-then-wait felt stuck. Realtime stays as a fallback for changes
  // initiated from another tab.
  const handleApprove = async (row: CompanyRow) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const { error: err } = await fetchWithRetry(
        () =>
          supabase
            .from("companies")
            .update({ status: "active", rejection_reason: null })
            .eq("id", row.id),
        15_000,
        "approve company"
      );
      if (err) {
        setError(`Gagal approve ${row.company_name}: ${err.message}`);
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: "active", rejection_reason: null }
            : r
        )
      );
      fireToast({
        label: row.status === "rejected" ? "DIAKTIFKAN ULANG" : "DISETUJUI",
        msg: row.company_name,
        variant: "ok",
      });
    } catch (e) {
      setError(
        `Gagal approve ${row.company_name}: ${
          e instanceof Error ? e.message : "unknown"
        }`
      );
    } finally {
      setBusyId(null);
    }
  };

  // Reject confirmation — same modal handles both the initial pending → rejected
  // flow AND the "Nonaktifkan" reverse action on an already-active company.
  // The label/title differ (see modal block) but the mutation is identical:
  // status='rejected' + rejection_reason. For the Nonaktifkan path we default
  // the reason to "Dinonaktifkan oleh superadmin" if the user leaves it blank.
  const handleRejectConfirm = async () => {
    if (!rejectFor) return;
    const target = rejectFor;
    const wasActive = target.status === "active";
    const trimmed = rejectReason.trim();
    const finalReason = trimmed || (wasActive ? "Dinonaktifkan oleh superadmin" : null);
    setBusyId(target.id);
    try {
      const { error: err } = await fetchWithRetry(
        () =>
          supabase
            .from("companies")
            .update({
              status: "rejected",
              rejection_reason: finalReason,
            })
            .eq("id", target.id),
        15_000,
        "reject company"
      );
      if (err) {
        setError(`Gagal reject: ${err.message}`);
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === target.id
            ? { ...r, status: "rejected", rejection_reason: finalReason }
            : r
        )
      );
      fireToast({
        label: wasActive ? "DINONAKTIFKAN" : "DITOLAK",
        msg: target.company_name,
        variant: "warn",
      });
      setRejectFor(null);
      setRejectReason("");
    } catch (e) {
      setError(
        `Gagal reject: ${e instanceof Error ? e.message : "unknown"}`
      );
    } finally {
      setBusyId(null);
    }
  };

  // Reset password + force-confirm email. Hits the server route which
  // (a) validates the caller is superadmin, (b) reads the current
  // email_confirmed_at so we can show a secondary toast when this call
  // flipped it, (c) calls supabase.auth.admin.updateUserById with
  // email_confirm: true.
  const handleResetConfirm = async () => {
    if (!resetFor) return;
    const target = resetFor;
    if (!target.auth_user_id) {
      setError(
        `Tidak bisa reset: ${target.company_name} belum punya akun terhubung.`
      );
      return;
    }
    if (resetPassword.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    setBusyId(target.id);
    try {
      const res = await fetch(
        `/api/admin/users/${target.auth_user_id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: resetPassword }),
        }
      );
      const json = (await res.json()) as
        | { ok: true; emailWasConfirmed: boolean }
        | { ok: false; error: string };
      if (!json.ok) {
        setError(`Gagal reset password: ${json.error}`);
        return;
      }
      // Combine the password-reset confirmation with the email-confirmed
      // status into a single toast — two toasts firing back-to-back feels
      // jumpy, and the second message is just a hint anyway.
      fireToast({
        label: "PASSWORD DIRESET",
        msg: json.emailWasConfirmed
          ? `${target.company_name} · Email terverifikasi`
          : target.company_name,
        variant: "ok",
      });
      setResetFor(null);
      setResetPassword("");
      setShowResetPw(false);
    } catch (e) {
      setError(
        `Gagal reset password: ${e instanceof Error ? e.message : "unknown"}`
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="sa-page">
      {error && (
        <div className="sa-error" role="alert">
          {error}
          <button
            type="button"
            className="sa-btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={() => {
              setError(null);
              setLoading(true);
              kickSupabase();
              fetchAll();
            }}
          >
            Coba lagi
          </button>
          <button
            type="button"
            className="sa-error-close"
            onClick={() => setError(null)}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}

      <div className="sa-tabs" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            className={`sa-tab${filter === t.key ? " active" : ""}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
            <span className="sa-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Perusahaan</th>
              <th>Bidang Usaha</th>
              <th>PIC</th>
              <th>Tanggal Daftar</th>
              <th>Status</th>
              <th className="sa-th-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="sa-empty">
                  Memuat data…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="sa-empty">
                  Tidak ada perusahaan dengan status ini.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((row) => {
                const pic = row.contacts?.[0];
                const expanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className={expanded ? "sa-row-expanded" : ""}>
                      <td>
                        <div className="sa-company-name">{row.company_name}</div>
                      </td>
                      <td>{row.bidang_usaha}</td>
                      <td>
                        {pic ? (
                          <>
                            <div>{pic.name}</div>
                            <div className="sa-muted">{pic.email}</div>
                          </>
                        ) : (
                          <span className="sa-muted">—</span>
                        )}
                      </td>
                      <td>{formatDate(row.created_at)}</td>
                      <td>
                        <span className={`sa-status-badge ${row.status}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="sa-td-actions">
                        <button
                          type="button"
                          className="sa-btn-ghost"
                          onClick={() => toggleExpanded(row.id)}
                        >
                          {expanded ? "Tutup" : "Detail"}
                        </button>
                        {row.status === "pending" && (
                          <>
                            <button
                              type="button"
                              className="sa-btn-approve"
                              onClick={() => handleApprove(row)}
                              disabled={busyId === row.id}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="sa-btn-reject"
                              onClick={() => setRejectFor(row)}
                              disabled={busyId === row.id}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {row.status === "active" && (
                          <button
                            type="button"
                            className="sa-btn-reject"
                            onClick={() => setRejectFor(row)}
                            disabled={busyId === row.id}
                          >
                            Nonaktifkan
                          </button>
                        )}
                        {row.status === "rejected" && (
                          <button
                            type="button"
                            className="sa-btn-approve"
                            onClick={() => handleApprove(row)}
                            disabled={busyId === row.id}
                          >
                            Approve Ulang
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="sa-detail-row">
                        <td colSpan={6}>
                          <div className="sa-detail-grid">
                            <DetailField
                              label="NPWP"
                              value={<NpwpValue npwp={row.npwp} />}
                            />
                            <DetailField
                              label="Website"
                              value={
                                row.website && isSafeHttpUrl(row.website) ? (
                                  <a
                                    href={row.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sa-link"
                                  >
                                    {row.website}
                                  </a>
                                ) : (
                                  // Nilai non-http(s) tidak pernah dijadikan link.
                                  row.website || "—"
                                )
                              }
                            />
                            <DetailField
                              label="PIC Jabatan"
                              value={pic?.role ?? "—"}
                            />
                            <DetailField
                              label="PIC Telepon"
                              value={pic?.phone ?? "—"}
                            />
                            {row.status === "rejected" &&
                              row.rejection_reason && (
                                <DetailField
                                  label="Alasan Reject"
                                  value={row.rejection_reason}
                                  span
                                />
                              )}
                          </div>

                          {/* Reset Password & Confirm Email — superadmin
                              tool. Uses inline styles for layout only;
                              reuses .sa-input / .sa-btn-reject / .sa-muted
                              / .sa-detail-label for tokens. */}
                          <div
                            style={{
                              marginTop: 18,
                              paddingTop: 16,
                              borderTop: "1px solid var(--border)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <div className="sa-detail-label">
                              Reset Password &amp; Confirm Email
                            </div>
                            <p
                              className="sa-muted"
                              style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}
                            >
                              Reset password akan sekaligus tandai email
                              sebagai terverifikasi. Berguna kalau user
                              signup saat email confirmation aktif lalu
                              toggle dimatikan.
                            </p>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                marginTop: 4,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  position: "relative",
                                  flex: "1 1 240px",
                                  minWidth: 240,
                                }}
                              >
                                <input
                                  type={showResetPw ? "text" : "password"}
                                  className="sa-input"
                                  placeholder="Password baru"
                                  value={resetPassword}
                                  onChange={(e) =>
                                    setResetPassword(e.target.value)
                                  }
                                  autoComplete="new-password"
                                  disabled={!row.auth_user_id}
                                  style={{ paddingRight: 96, width: "100%" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowResetPw((v) => !v)}
                                  aria-label={
                                    showResetPw
                                      ? "Sembunyikan password"
                                      : "Tampilkan password"
                                  }
                                  style={{
                                    position: "absolute",
                                    right: 6,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    background: "transparent",
                                    border: 0,
                                    color: "var(--brand)",
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    padding: "4px 8px",
                                  }}
                                  disabled={!row.auth_user_id}
                                >
                                  {showResetPw ? "Sembunyikan" : "Tampilkan"}
                                </button>
                              </div>
                              <button
                                type="button"
                                className="sa-btn-reject"
                                onClick={() => setResetFor(row)}
                                disabled={
                                  busyId === row.id ||
                                  resetPassword.length < 8 ||
                                  !row.auth_user_id
                                }
                              >
                                Reset Password
                              </button>
                            </div>
                            <div className="sa-muted">
                              {row.auth_user_id
                                ? "Min 8 karakter"
                                : "Tidak ada akun terhubung — reset tidak tersedia."}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Reject / Nonaktifkan confirmation modal — same modal handles both
          flows; copy adapts to whether the row was 'pending' (rejecting a
          new application) or 'active' (deactivating a previously-approved
          account). */}
      {rejectFor && (() => {
        const deactivating = rejectFor.status === "active";
        return (
        <div className="sa-modal-backdrop" onClick={() => setRejectFor(null)}>
          <div
            className="sa-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sa-modal-title">
              {deactivating
                ? "Nonaktifkan Perusahaan?"
                : "Reject pendaftaran?"}
            </h3>
            <p className="sa-modal-body">
              {deactivating ? (
                <>
                  Anda akan menonaktifkan{" "}
                  <strong>{rejectFor.company_name}</strong>. Akun ini tidak
                  bisa login sampai diaktifkan ulang.
                </>
              ) : (
                <>
                  Anda akan menolak <strong>{rejectFor.company_name}</strong>.
                  Tindakan ini bisa di-revert dengan approve manual.
                </>
              )}
            </p>
            <label className="sa-modal-label">
              Alasan (opsional, ditampilkan ke PIC saat mencoba masuk):
              <textarea
                className="sa-modal-textarea"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={
                  deactivating
                    ? "cth. melanggar T&C, request dari pemilik akun…"
                    : "cth. NPWP tidak valid, dokumen tidak lengkap…"
                }
              />
            </label>
            <div className="sa-modal-actions">
              <button
                type="button"
                className="sa-btn-ghost"
                onClick={() => {
                  setRejectFor(null);
                  setRejectReason("");
                }}
              >
                Batal
              </button>
              <button
                type="button"
                className="sa-btn-reject"
                onClick={handleRejectConfirm}
                disabled={busyId === rejectFor.id}
              >
                {busyId === rejectFor.id
                  ? "Memproses…"
                  : deactivating
                  ? "Ya, Nonaktifkan"
                  : "Ya, Reject"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Reset password confirmation modal — input lives in the detail
          expand row, this modal is just a final "are you sure" gate so
          the superadmin can't fat-finger a reset. */}
      {resetFor && (
        <div
          className="sa-modal-backdrop"
          onClick={() => setResetFor(null)}
        >
          <div
            className="sa-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sa-modal-title">
              Reset password {resetFor.company_name}?
            </h3>
            <p className="sa-modal-body">
              Password lama untuk{" "}
              <strong>{resetFor.contacts?.[0]?.email ?? "PIC"}</strong> akan
              tidak bisa dipakai. Email akan langsung tertandai
              terverifikasi. PIC pakai password baru ini untuk login.
            </p>
            <div className="sa-modal-actions">
              <button
                type="button"
                className="sa-btn-ghost"
                onClick={() => setResetFor(null)}
                disabled={busyId === resetFor.id}
              >
                Batal
              </button>
              <button
                type="button"
                className="sa-btn-reject"
                onClick={handleResetConfirm}
                disabled={busyId === resetFor.id}
              >
                {busyId === resetFor.id ? "Memproses…" : "Ya, Reset"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  pending: "Menunggu",
  active: "Aktif",
  rejected: "Ditolak",
};

/** NPWP 15 digit (format lama) atau 16 digit (sejak 2024), plus penanda jumlah digit. */
function NpwpValue({ npwp }: { npwp: string }) {
  if (!npwp) return <>—</>;
  const count = npwpDigits(npwp).length;
  const valid = isValidNpwp(npwp);
  return (
    <>
      {/* Nilai tidak valid ditampilkan apa adanya (tidak dipotong formatter). */}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {valid ? formatNpwp(npwp) : npwp}
      </span>{" "}
      <span className="sa-muted">
        {valid ? `· ${count} digit` : `· ${count} digit, format tidak valid`}
      </span>
    </>
  );
}

function DetailField({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`sa-detail-field${span ? " sa-detail-span" : ""}`}>
      <div className="sa-detail-label">{label}</div>
      <div className="sa-detail-value">{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
