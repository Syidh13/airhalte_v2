"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase, withTimeout, kickSupabase } from "@/lib/supabase";
import MapPicker from "@/components/superadmin/MapPicker";
import { normalizeStreetViewUrl } from "@/lib/streetView";
import { NON_BRT_MONTHLY_PRICE, PREMIUM_MIN_BASE_PRICE } from "@/lib/pricing";

type HalteType = "brt" | "non-brt";
type HalteTier = "premium" | "mass";

interface Halte {
  id: string;
  name: string;
  corridor: string | null;
  lat: number;
  lng: number;
  type: HalteType;
  tier: HalteTier;
  base_price: number;
  current_bid: number;
  street_view_url: string | null;
  is_available: boolean;
}

interface FormState {
  id: string;
  name: string;
  corridor: string;
  lat: string;
  lng: string;
  type: HalteType;
  tier: HalteTier;
  base_price: string;
  street_view_url: string;
  is_available: boolean;
}

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  corridor: "",
  lat: "",
  lng: "",
  type: "non-brt",
  tier: "mass",
  base_price: String(NON_BRT_MONTHLY_PRICE),
  street_view_url: "",
  is_available: true,
};

/** Label harga dari lib/pricing.ts, mis. "Rp 100 jt" dan "Rp 3 jt". */
const MIN_BASE_LABEL = `Rp ${PREMIUM_MIN_BASE_PRICE / 1_000_000} jt`;
const NON_BRT_PRICE_LABEL = `Rp ${NON_BRT_MONTHLY_PRICE / 1_000_000} jt`;

/** Segmen komersial selalu mengikuti tipe halte (kolom tier di DB). */
function tierForType(type: HalteType): HalteTier {
  return type === "brt" ? "premium" : "mass";
}

export default function HaltesPage() {
  const [rows, setRows] = useState<Halte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<Halte | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Halte | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Sync map data pipeline — regenerates /public/haltes-map.geojson from the
  // current haltes table so the portal's stable layer reflects the latest
  // lat/lng/tier/mode edits. Availability stays live via /api/haltes/availability.
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; featureCount: number; fileSize: number; at: string }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  // Request-id guard: every fetchAll bumps the counter, only the latest
  // call writes to state. Replaces the per-effect `cancelled` flag so the
  // visibility-refetch path is also race-safe.
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const myId = ++requestIdRef.current;
    try {
      // Call the server-side API route which uses the service role key.
      // This bypasses Supabase hosted's PostgREST max_rows=1000 cap that
      // the browser anon client cannot override with .range().
      const res = await withTimeout(
        fetch("/api/admin/haltes"),
        25_000,
        "load haltes"
      );
      if (myId !== requestIdRef.current) return;
      if (!res.ok) {
        setError("Gagal memuat data halte.");
        setLoading(false);
        return;
      }
      const json = await res.json();
      if (myId !== requestIdRef.current) return;
      setRows((json.data as Halte[]) ?? []);
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

  useEffect(() => {
    let channel = subscribeChannel();

    function subscribeChannel() {
      return supabase
        .channel("superadmin-haltes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "haltes" },
          () => fetchAll()
        )
        .subscribe();
    }

    // Initial load. fetchAll only sets state after awaiting the network
    // (never synchronously), so this cannot cause a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();

    // Tab-visibility recovery: Supabase pauses the realtime WS while the
    // tab is hidden, and a stale channel can silently miss events when the
    // tab returns. Rebuild + refetch on every visibility-on transition.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        (h.corridor ?? "").toLowerCase().includes(q) ||
        h.id.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  };

  const handleSyncMap = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncStatus({ kind: "idle" });
    try {
      const res = await withTimeout(
        fetch("/api/admin/generate-map", { method: "POST" }),
        60_000,
        "generate map"
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        featureCount?: number;
        fileSize?: number;
        generatedAt?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setSyncStatus({
          kind: "err",
          message: json.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setSyncStatus({
        kind: "ok",
        featureCount: json.featureCount ?? 0,
        fileSize: json.fileSize ?? 0,
        at: json.generatedAt ?? new Date().toISOString(),
      });
    } catch (e) {
      setSyncStatus({
        kind: "err",
        message: e instanceof Error ? e.message : "unknown",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const openEdit = (halte: Halte) => {
    setForm({
      id: halte.id,
      name: halte.name,
      corridor: halte.corridor ?? "",
      lat: String(halte.lat),
      lng: String(halte.lng),
      type: halte.type,
      tier: tierForType(halte.type),
      // Non-BRT memakai tarif tetap; nilai lama di DB tidak dipakai.
      base_price:
        halte.type === "brt"
          ? String(halte.base_price)
          : String(NON_BRT_MONTHLY_PRICE),
      street_view_url: halte.street_view_url ?? "",
      is_available: halte.is_available,
    });
    setEditing(halte);
    setCreating(false);
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim()) {
      setError("ID dan nama halte wajib diisi.");
      return;
    }
    // Normalise decimal separator: Indonesian locale uses commas in number
    // inputs, but Number() only accepts dots. Replace before parsing.
    const lat = Number(form.lat.replace(",", "."));
    const lng = Number(form.lng.replace(",", "."));
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Lat / lng harus angka.");
      return;
    }
    const basePrice =
      form.type === "brt" ? Number(form.base_price) || 0 : NON_BRT_MONTHLY_PRICE;
    if (form.type === "brt" && basePrice < PREMIUM_MIN_BASE_PRICE) {
      setError(
        `Harga dasar Halte BRT minimal Rp ${PREMIUM_MIN_BASE_PRICE.toLocaleString("id-ID")}/tahun.`
      );
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      corridor: form.corridor.trim() || null,
      lat,
      lng,
      type: form.type,
      tier: tierForType(form.type),
      base_price: basePrice,
      // Normalize the pasted Google Maps URL into the iframe-embeddable
      // form so the DetailPanel iframe actually renders. Saving the
      // normalized version (instead of normalizing on render) means we
      // pay this cost once at write-time, not on every detail-panel open.
      street_view_url:
        normalizeStreetViewUrl(form.street_view_url) || null,
      is_available: form.is_available,
    };

    try {
      const method = editing ? "PUT" : "POST";
      const body = editing ? { ...payload, id: editing.id } : payload;
      const res = await withTimeout(
        fetch("/api/admin/haltes", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        12_000,
        editing ? "update halte" : "insert halte"
      );
      const json = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(`Gagal menyimpan: ${json.error ?? res.statusText}`);
        return;
      }
      closeForm();
      // Explicitly refresh the list so the new/updated row shows up
      // immediately without waiting for the realtime subscription.
      setLoading(true);
      fetchAll();
    } catch (e) {
      setBusy(false);
      setError(
        `Gagal menyimpan: ${e instanceof Error ? e.message : "Koneksi timeout — coba lagi."}`
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteFor) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withTimeout(
        fetch(`/api/admin/haltes?id=${encodeURIComponent(deleteFor.id)}`, {
          method: "DELETE",
        }),
        10_000,
        "delete halte"
      );
      const json = await res.json();
      setBusy(false);
      setDeleteFor(null);
      if (!res.ok) {
        setError(`Gagal hapus: ${json.error ?? res.statusText}`);
      } else {
        setLoading(true);
        fetchAll();
      }
    } catch (e) {
      setBusy(false);
      setDeleteFor(null);
      setError(
        `Gagal hapus: ${e instanceof Error ? e.message : "Koneksi timeout — coba lagi."}`
      );
    }
  };

  const formOpen = creating || editing !== null;

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

      <div className="sa-toolbar">
        <input
          type="search"
          className="sa-search"
          placeholder="Cari nama, koridor, atau ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="sa-btn-ghost"
          onClick={handleSyncMap}
          disabled={syncBusy}
          title="Regenerate /public/haltes-map.geojson dari tabel haltes saat ini"
        >
          {syncBusy ? "Sync map…" : "Sync Map Data"}
        </button>
        <button
          type="button"
          className="sa-btn-primary"
          onClick={openCreate}
        >
          + Tambah Halte
        </button>
      </div>

      {syncStatus.kind !== "idle" && (
        <div
          className="sa-error"
          role="status"
          style={
            syncStatus.kind === "ok"
              ? {
                  background: "rgba(34, 140, 72, 0.1)",
                  color: "#1c7a3f",
                  borderColor: "rgba(34, 140, 72, 0.3)",
                }
              : undefined
          }
        >
          {syncStatus.kind === "ok"
            ? `✓ Map data ter-sync: ${syncStatus.featureCount.toLocaleString("id-ID")} halte · ${(syncStatus.fileSize / 1024).toFixed(0)} KB · ${new Date(syncStatus.at).toLocaleTimeString("id-ID")}`
            : `✕ Sync gagal: ${syncStatus.message}`}
          <button
            type="button"
            className="sa-error-close"
            onClick={() => setSyncStatus({ kind: "idle" })}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nama</th>
              <th>Koridor</th>
              <th>Tipe</th>
              <th>Segmen</th>
              <th>Harga Dasar</th>
              <th>Status</th>
              <th className="sa-th-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="sa-empty">
                  Memuat data…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="sa-empty">
                  Tidak ada halte ditemukan.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((h) => (
                <tr key={h.id}>
                  <td className="sa-mono">{h.id}</td>
                  <td>{h.name}</td>
                  <td>{h.corridor ?? "—"}</td>
                  <td>
                    <span className={`sa-pill ${h.type}`}>
                      {h.type === "brt" ? "BRT" : "Non-BRT"}
                    </span>
                  </td>
                  <td>
                    <span className={`sa-pill ${h.tier}`}>
                      {h.type === "brt" ? "Premium" : "Non-BRT"}
                    </span>
                  </td>
                  <td>
                    {h.type === "brt" ? (
                      <>
                        {formatRupiah(h.base_price)}
                        <span className="sa-muted"> /tahun</span>
                        {h.base_price < PREMIUM_MIN_BASE_PRICE && (
                          <div className="sa-field-warn">Di bawah minimum</div>
                        )}
                      </>
                    ) : (
                      <>
                        {formatRupiah(NON_BRT_MONTHLY_PRICE)}
                        <span className="sa-muted"> /bulan</span>
                      </>
                    )}
                  </td>
                  <td>
                    <span
                      className={`sa-status-badge ${
                        h.is_available ? "active" : "rejected"
                      }`}
                    >
                      {h.is_available ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="sa-td-actions">
                    <button
                      type="button"
                      className="sa-btn-ghost"
                      onClick={() => openEdit(h)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="sa-btn-reject"
                      onClick={() => setDeleteFor(h)}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="sa-modal-backdrop" onClick={closeForm}>
          <div
            className="sa-modal sa-modal-wide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sa-modal-title">
              {editing ? `Edit ${editing.name}` : "Tambah Halte Baru"}
            </h3>
            <form onSubmit={handleSubmit} className="sa-form">
              <div className="sa-form-row">
                <FormField label="ID (slug)">
                  <input
                    type="text"
                    className="sa-input"
                    value={form.id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, id: e.target.value }))
                    }
                    placeholder="harmoni-central"
                    disabled={editing !== null}
                    required
                  />
                </FormField>
                <FormField label="Nama Halte">
                  <input
                    type="text"
                    className="sa-input"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    required
                  />
                </FormField>
              </div>
              <div className="sa-form-row">
                <FormField label="Koridor">
                  <input
                    type="text"
                    className="sa-input"
                    value={form.corridor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, corridor: e.target.value }))
                    }
                    placeholder="cth. 1, 2, 3A"
                  />
                </FormField>
                <FormField
                  label={
                    form.type === "brt"
                      ? "Harga dasar (Rp/tahun)"
                      : "Tarif (Rp/bulan)"
                  }
                >
                  <input
                    // type="text" + inputMode="numeric" instead of type="number"
                    // because (a) type="number" still accepts "e", "+", "-",
                    // and pasted scientific notation, and (b) we want to show
                    // a thousand-separated preview underneath. We strip
                    // every non-digit on input — the stored state is the
                    // raw integer string, never the formatted version.
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="sa-input"
                    value={form.base_price}
                    onChange={(e) => {
                      const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                      setForm((f) => ({ ...f, base_price: digitsOnly }));
                    }}
                    placeholder={String(PREMIUM_MIN_BASE_PRICE)}
                    // Non-BRT: tarif tetap, tidak bisa diubah per titik.
                    disabled={form.type !== "brt"}
                  />
                  {form.base_price && Number(form.base_price) > 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-3)",
                        marginTop: 4,
                      }}
                    >
                      ={" "}
                      <strong>
                        Rp{" "}
                        {Number(form.base_price).toLocaleString("id-ID")}
                      </strong>
                    </div>
                  )}
                  {form.type === "brt" ? (
                    <div
                      className={
                        Number(form.base_price) < PREMIUM_MIN_BASE_PRICE
                          ? "sa-field-warn"
                          : "sa-field-hint"
                      }
                    >
                      Minimal {MIN_BASE_LABEL}/tahun
                    </div>
                  ) : (
                    <div className="sa-field-hint">
                      Tarif tetap bus stop Non-BRT: {NON_BRT_PRICE_LABEL}/bulan per
                      titik
                    </div>
                  )}
                </FormField>
              </div>
              {/* Lat / Lng + map picker button */}
              <div className="sa-form-row" style={{ alignItems: "flex-end" }}>
                <FormField label="Latitude">
                  <input
                    type="number"
                    step="any"
                    className="sa-input"
                    value={form.lat}
                    onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                    required
                  />
                </FormField>
                <FormField label="Longitude">
                  <input
                    type="number"
                    step="any"
                    className="sa-input"
                    value={form.lng}
                    onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                    required
                  />
                </FormField>
              </div>
              <button
                type="button"
                className="sa-btn-ghost sa-map-picker-open-btn"
                onClick={() => setPickerOpen(true)}
              >
                <span aria-hidden="true">📍</span> Pilih dari Peta
              </button>

              {/* Tipe + Segmen (segmen mengikuti tipe) */}
              <div className="sa-form-row">
                <FormField label="Tipe">
                  <select
                    className="sa-input"
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as HalteType;
                      setForm((f) => ({
                        ...f,
                        type,
                        tier: tierForType(type),
                        // Non-BRT → tarif tetap; BRT → minimal harga dasar.
                        base_price:
                          type === "brt"
                            ? Number(f.base_price) >= PREMIUM_MIN_BASE_PRICE
                              ? f.base_price
                              : String(PREMIUM_MIN_BASE_PRICE)
                            : String(NON_BRT_MONTHLY_PRICE),
                      }));
                    }}
                  >
                    <option value="brt">BRT</option>
                    <option value="non-brt">Non-BRT</option>
                  </select>
                </FormField>
                <FormField label="Segmen">
                  <div className="sa-input sa-input-readonly" aria-readonly="true">
                    {form.type === "brt"
                      ? "Premium · lelang, kontrak tahunan"
                      : "Non-BRT · langganan bulanan/tahunan"}
                  </div>
                </FormField>
              </div>

              {/* Street View — full width */}
              <div className="sa-form-field">
                <span className="sa-form-label">Street View URL (opsional)</span>

                {/* Compact inline guide */}
                <div style={{
                  background: "var(--surface-2, #F4F1EA)",
                  border: "1px solid var(--border, #E0D8C2)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  lineHeight: 1.55,
                }}>
                  <strong style={{ color: "var(--text-1)" }}>Cara:</strong>{" "}
                  Buka Google Maps → drag <strong>ikon orang kuning</strong> ke jalan →
                  posisikan kamera → <strong>copy URL</strong> dari address bar → paste di bawah.
                </div>

                <input
                  type="text"
                  className="sa-input"
                  value={form.street_view_url}
                  onChange={(e) => setForm((f) => ({ ...f, street_view_url: e.target.value }))}
                  placeholder="Paste URL Google Maps Street View di sini…"
                />

                {/* Live status + preview */}
                {(() => {
                  const normalized = normalizeStreetViewUrl(form.street_view_url);
                  const hasUrl = form.street_view_url.trim().length > 0;
                  const isEmbed = normalized.includes("output=svembed") || normalized.includes("/maps/embed");
                  const isRecognized = hasUrl && isEmbed;
                  const isUnknown   = hasUrl && !isEmbed;
                  return (
                    <>
                      {isRecognized && (
                        <p style={{ fontSize: 12, color: "#16a34a", margin: 0, fontWeight: 600 }}>
                          ✓ URL dikenali — preview di bawah
                        </p>
                      )}
                      {isUnknown && (
                        <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>
                          ⚠ URL tidak dikenali. Pastikan kamu dalam mode Street View saat copy URL.
                        </p>
                      )}
                      {isRecognized && (
                        <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border, #E0D8C2)" }}>
                          <iframe
                            key={normalized}
                            src={normalized}
                            width="100%"
                            height="200"
                            style={{ display: "block", border: "none" }}
                            referrerPolicy="no-referrer-when-downgrade"
                            loading="lazy"
                            title="Street View Preview"
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <label className="sa-checkbox">
                <input
                  type="checkbox"
                  checked={form.is_available}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_available: e.target.checked }))
                  }
                />
                Tersedia untuk lelang/langganan
              </label>
              <div className="sa-modal-actions">
                <button
                  type="button"
                  className="sa-btn-ghost"
                  onClick={closeForm}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="sa-btn-primary"
                  disabled={busy}
                >
                  {busy ? "Menyimpan…" : editing ? "Simpan" : "Tambah"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Map picker — rendered as a sibling so it overlays the form modal
          via its own higher z-index (10001) backdrop. Only render when the
          form is open AND the user has clicked "Pilih dari Peta". */}
      {formOpen && pickerOpen && (
        <MapPicker
          initialLat={parseFloat(form.lat)}
          initialLng={parseFloat(form.lng)}
          syncedLat={parseFloat(form.lat)}
          syncedLng={parseFloat(form.lng)}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(lat, lng) => {
            setForm((f) => ({
              ...f,
              lat: String(lat),
              lng: String(lng),
            }));
            setPickerOpen(false);
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteFor && (
        <div className="sa-modal-backdrop" onClick={() => setDeleteFor(null)}>
          <div
            className="sa-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sa-modal-title">Hapus halte?</h3>
            <p className="sa-modal-body">
              Anda akan menghapus <strong>{deleteFor.name}</strong> (
              <code>{deleteFor.id}</code>). Tindakan ini permanen dan akan
              gagal jika halte masih punya bid/subscription aktif.
            </p>
            <div className="sa-modal-actions">
              <button
                type="button"
                className="sa-btn-ghost"
                onClick={() => setDeleteFor(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="sa-btn-reject"
                onClick={handleDeleteConfirm}
                disabled={busy}
              >
                {busy ? "Menghapus…" : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="sa-form-field">
      <span className="sa-form-label">{label}</span>
      {children}
    </label>
  );
}

function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}
