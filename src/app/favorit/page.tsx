"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import HalteCard from "@/components/HalteCard";
import Header from "@/components/Header";
import Ticker from "@/components/Ticker";
import InfoModals, { type InfoPage } from "@/components/modals/InfoModals";
import type { HalteData } from "@/data/haltes";
import { useFavorites } from "@/lib/favorites";
import {
  loadMapData,
  projectSidebarCard,
  type MapRecord,
} from "@/lib/haltes-map";

/** Record uji di DB yang tidak boleh pernah tampil. */
const HIDDEN_IDS = new Set(["test"]);

export default function FavoritPage() {
  const router = useRouter();
  const { ids } = useFavorites();
  const [infoPage, setInfoPage] = useState<InfoPage | null>(null);
  const [tab, setTab] = useState<"all" | "premium" | "mass">("all");
  // Data titik asli (GeoJSON peta + ketersediaan terbaru). null = memuat.
  const [records, setRecords] = useState<MapRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("allow-scroll");
    document.body.classList.add("allow-scroll");
    return () => {
      document.documentElement.classList.remove("allow-scroll");
      document.body.classList.remove("allow-scroll");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMapData().then(
      (data) => {
        if (!cancelled) setRecords(data);
      },
      () => {
        if (cancelled) return;
        setLoadError(true);
        setRecords([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const favorites = useMemo<HalteData[]>(() => {
    if (!records || ids.length === 0) return [];
    const wanted = new Set(ids);
    return records
      .filter((r) => wanted.has(String(r.id)) && !HIDDEN_IDS.has(String(r.id)))
      .map((r) => projectSidebarCard(r));
  }, [records, ids]);

  const loading = ids.length > 0 && records === null;

  const counts = useMemo(
    () => ({
      all: favorites.length,
      premium: favorites.filter((h) => h.mode === "premium").length,
      mass: favorites.filter((h) => h.mode === "mass").length,
    }),
    [favorites]
  );

  const visible = useMemo(() => {
    if (tab === "all") return favorites;
    return favorites.filter((h) => h.mode === tab);
  }, [favorites, tab]);

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "all", label: "Semua" },
    { key: "premium", label: "Premium · Halte BRT" },
    { key: "mass", label: "Non-BRT · Bus stop" },
  ];

  const handleCardClick = (halte: HalteData) => {
    router.push(`/?halteId=${encodeURIComponent(String(halte.id))}`);
  };

  return (
    <div className="app-root scrollable">
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
        }}
      >
        <Ticker />
        <Header onOpenInfo={setInfoPage} hideNav />
      </div>

      <div className="favorit-page" style={{ paddingTop: "180px" }}>
        <button
          type="button"
          className="favorit-back"
          onClick={() => router.push("/")}
        >
          ← Kembali ke Peta
        </button>
        <div className="favorit-head">
          <div className="favorit-kicker">§ HALTE FAVORIT</div>
          <h1 className="favorit-title">
            Halte yang Anda <em>simpan</em>.
          </h1>
        </div>

        {loading ? (
          <p className="favorit-sub">Memuat halte favorit…</p>
        ) : favorites.length === 0 ? (
          <div className="favorit-empty">
            <div className="favorit-empty-icon" aria-hidden="true">
              ♡
            </div>
            <div className="favorit-empty-title">
              {loadError ? "Data halte belum dapat dimuat" : "Belum ada halte favorit"}
            </div>
            <p className="favorit-empty-sub">
              {loadError
                ? "Periksa koneksi lalu muat ulang halaman."
                : "Klik ikon hati di kartu halte untuk menyimpannya. Halte favorit akan tampil di sini."}
            </p>
            <Link href="/" className="auth-btn-primary" style={{ marginTop: 16 }}>
              Jelajahi Peta →
            </Link>
          </div>
        ) : (
          <>
            <div className="favorit-tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`favorit-tab${tab === t.key ? " active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="favorit-tab-badge">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <p className="favorit-sub favorit-count">
              {visible.length} halte tersimpan
            </p>

            {visible.length === 0 ? (
              <div className="favorit-empty">
                <div className="favorit-empty-icon" aria-hidden="true">
                  ♡
                </div>
                <div className="favorit-empty-title">
                  {tab === "premium"
                    ? "Belum ada Halte BRT yang disimpan"
                    : "Belum ada bus stop Non-BRT yang disimpan"}
                </div>
                <p className="favorit-empty-sub">
                  Pindah ke tab lain atau simpan halte dari peta untuk
                  menambahkannya di sini.
                </p>
              </div>
            ) : (
              <div className="favorit-grid">
                {visible.map((h) => (
                  <div key={h.id} data-halte-id={h.id}>
                    <HalteCard
                      halte={h}
                      active={false}
                      onClick={handleCardClick}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <InfoModals open={infoPage} onClose={() => setInfoPage(null)} />
    </div>
  );
}
