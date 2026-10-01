"use client";

import { Suspense, useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Ticker from "@/components/Ticker";
import Header from "@/components/Header";
import ModeSwitch, { type Mode } from "@/components/ModeSwitch";
import FilterBar from "@/components/FilterBar";
import HalteCard from "@/components/HalteCard";
import MapView from "@/components/MapView";
import DetailPanel from "@/components/DetailPanel";
import Toast, { type ToastData } from "@/components/Toast";
import BidModal from "@/components/modals/BidModal";
import SubscribeModal from "@/components/modals/SubscribeModal";
import InfoModals, { type InfoPage } from "@/components/modals/InfoModals";
import {
  type HalteData,
  type PremiumHalte,
  type MassHalte,
} from "@/data/haltes";
import {
  AVAILABILITY_POLL_INTERVAL_MS,
  applyAvailability,
  loadMapData,
  fetchHalteDetail,
  projectSidebarCard,
  useAvailabilityPolling,
  type MapRecord,
} from "@/lib/haltes-map";
import { fmtCount } from "@/lib/network";

/** Soonest auction end first; haltes without a schedule go last. */
function compareEndsSoonest(a: MapRecord, b: MapRecord): number {
  const ta = a.auctionEndsAt ? Date.parse(a.auctionEndsAt) : NaN;
  const tb = b.auctionEndsAt ? Date.parse(b.auctionEndsAt) : NaN;
  const ea = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
  const eb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.name.localeCompare(b.name, "id");
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  );
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("premium");
  const [search, setSearch] = useState("");

  // Active halte — split into a lean "click stub" + the lazy-fetched full
  // detail. The stub populates the panel instantly so it opens with a real
  // header (name + segment) while the detail fetch is still in flight.
  const [activeHalteLean, setActiveHalteLean] = useState<MapRecord | null>(null);
  // Detail fetch result, keyed by halte id. Loading / error / detail for the
  // active halte are DERIVED from it (no setState inside the effect body).
  const [detailResult, setDetailResult] = useState<{
    id: string;
    detail: HalteData | null;
    error: string | null;
  } | null>(null);

  const [toast, setToast] = useState<ToastData | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bidHalte, setBidHalte] = useState<PremiumHalte | null>(null);
  const [subscribeHalte, setSubscribeHalte] = useState<MassHalte | null>(null);
  const [infoPage, setInfoPage] = useState<InfoPage | null>(null);
  // Bumped each time BidModal lands a successful bid — DetailPanel reads
  // this as a refetch trigger for the live bid aggregate.
  const [bidRefreshKey, setBidRefreshKey] = useState(0);
  // Mirror for the Non-BRT subscribe flow — DetailPanel refetches its
  // anonymous sub history + flips the CTA once the subscription lands.
  // Polling will hide the titik from the map ~10s later.
  const [subscribeRefreshKey, setSubscribeRefreshKey] = useState(0);

  // Stable layer: the merged lean records loaded once on mount from the
  // static GeoJSON + the first availability snapshot.
  const [mapData, setMapData] = useState<MapRecord[]>([]);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  // ?halteId= deep link: applied once BOTH the records and the map are
  // ready (MapView's fly-to needs a loaded map). Refs + a callback invoked
  // from whichever of the two finishes last — no setState inside effects.
  const pendingHalteIdRef = useRef<string | null>(null);
  const mapReadyRef = useRef(false);
  const mapDataRef = useRef<MapRecord[]>([]);

  const applyPendingHalte = useCallback(() => {
    const id = pendingHalteIdRef.current;
    if (!id || !mapReadyRef.current || mapDataRef.current.length === 0) return;
    pendingHalteIdRef.current = null;
    const record = mapDataRef.current.find((r) => r.id === id);
    if (!record) return;
    setMode(record.mode);
    setSearch("");
    setActiveHalteLean(record);
    router.replace("/", { scroll: false });
  }, [router]);

  const handleMapReady = useCallback(() => {
    mapReadyRef.current = true;
    applyPendingHalte();
  }, [applyPendingHalte]);

  // Read ?halteId= from URL on mount and stash it until map + data are ready.
  useEffect(() => {
    const id = searchParams.get("halteId");
    if (id) pendingHalteIdRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMapData()
      .then((records) => {
        if (cancelled) return;
        mapDataRef.current = records;
        setMapData(records);
        setMapLoading(false);
        applyPendingHalte();
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[map] load failed:", msg);
        setMapError(msg);
        setMapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyPendingHalte]);

  // Realtime layer: availability polling (Map<id, snapshot>, empty until
  // the first successful poll, then every 10 s).
  const availabilityMap = useAvailabilityPolling(true);

  // Effective records = stable layer overlaid with the latest snapshot.
  // applyAvailability returns the SAME record object when nothing changed,
  // and we return the same `mapData` array when no record changed, so the
  // filtered lists stay referentially stable and MapView's setData effects
  // don't re-cluster 7 300 features on every poll.
  const liveMapData = useMemo<MapRecord[]>(() => {
    if (availabilityMap.size === 0) return mapData;
    let changed = false;
    const next = mapData.map((r) => {
      const fresh = availabilityMap.get(r.id);
      if (fresh === undefined) return r;
      const merged = applyAvailability(r, fresh);
      if (merged !== r) changed = true;
      return merged;
    });
    return changed ? next : mapData;
  }, [mapData, availabilityMap]);

  // True once we have live listing state (initial fetch or a poll). Before
  // that nothing is listed, and "0" would be a misleading count.
  const liveReady = useMemo(
    () => availabilityMap.size > 0 || mapData.some((r) => r.is_listed),
    [availabilityMap, mapData]
  );

  const listingsRef = useRef<HTMLDivElement>(null);

  // Hydrate detail fetch for the clicked halte. Keyed by id so availability
  // polling (which replaces record objects) doesn't trigger refetches.
  const activeHalteId = activeHalteLean?.id ?? null;
  useEffect(() => {
    if (!activeHalteId) return;
    let cancelled = false;
    fetchHalteDetail(activeHalteId)
      .then((detail) => {
        if (!cancelled) setDetailResult({ id: activeHalteId, detail, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setDetailResult({ id: activeHalteId, detail: null, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [activeHalteId]);

  const detailForActive =
    activeHalteId && detailResult?.id === activeHalteId ? detailResult : null;
  const activeHalteDetail = detailForActive?.detail ?? null;
  const activeHalteError = detailForActive?.error ?? null;
  const activeHalteLoading = activeHalteId !== null && detailForActive === null;

  // Split filtered lists by mode so MapView can hold both in memory.
  // Mode switching becomes a pure GPU visibility toggle — no data reload.
  // Both gate on `is_listed` (server-derived): Halte BRT with an open
  // auction, bus stop Non-BRT that are active and not rented. The
  // unfiltered liveMapData is still consulted when resolving a halteId
  // from the URL or a card click, so direct/share links keep working.
  const premiumFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return liveMapData.filter((r) => {
      if (!r.is_listed || r.mode !== "premium") return false;
      return q ? r.name.toLowerCase().includes(q) : true;
    });
  }, [liveMapData, search]);

  const massFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return liveMapData.filter((r) => {
      if (!r.is_listed || r.mode !== "mass") return false;
      return q ? r.name.toLowerCase().includes(q) : true;
    });
  }, [liveMapData, search]);

  // Sidebar order. Premium: soonest auction end first (real DB schedule).
  // Non-BRT: file order — there is no meaningful ranking data yet.
  const premiumSorted = useMemo(
    () => [...premiumFiltered].sort(compareEndsSoonest),
    [premiumFiltered]
  );

  // For sidebar card list — current mode's slice, projected into the full
  // HalteData shape. Capped at SIDEBAR_CAP to avoid rendering 7 300 cards
  // in Non-BRT mode — the long tail is reachable via search instead.
  const SIDEBAR_CAP = 100;
  const sidebarTotal = useMemo(() => {
    return (mode === "premium" ? premiumFiltered : massFiltered).length;
  }, [mode, premiumFiltered, massFiltered]);
  const filteredCards = useMemo<HalteData[]>(() => {
    const filtered = mode === "premium" ? premiumSorted : massFiltered;
    return filtered.slice(0, SIDEBAR_CAP).map(projectSidebarCard);
  }, [mode, premiumSorted, massFiltered]);

  const showToast = useCallback((data: ToastData) => {
    setToast(data);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Both the map-marker click and the sidebar-card click eventually end up
  // here. We accept either a lean MapRecord (from MapView) or a projected
  // HalteData (from HalteCard) — both carry id + name + mode, which is all
  // we need to kick off the detail fetch.
  const handleMapClick = useCallback((record: MapRecord) => {
    setActiveHalteLean(record);
    setTimeout(() => {
      const el = listingsRef.current?.querySelector(
        `[data-halte-id="${record.id}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, []);

  const handleCardClick = useCallback(
    (halte: HalteData) => {
      const record = liveMapData.find((r) => r.id === halte.id);
      if (record) handleMapClick(record);
    },
    [liveMapData, handleMapClick]
  );

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setSearch("");
    setActiveHalteLean(null);
  };

  const handleBid = (halte: HalteData) => {
    if (halte.mode === "premium") setBidHalte(halte);
  };
  const handleSubscribe = (halte: HalteData) => {
    if (halte.mode === "mass") setSubscribeHalte(halte);
  };
  const handleNotify = (halte: HalteData) => {
    // No waitlist/notification backend exists — say only what is true.
    showToast({
      label: "BELUM TERSEDIA",
      msg: `${halte.name} belum dapat dipesan saat ini.`,
      variant: "warn",
    });
  };

  // Count of *listable* titik for the current mode — drives the results
  // title. Matches the visible-on-map count (before search).
  const totalCount = useMemo(
    () => liveMapData.filter((r) => r.is_listed && r.mode === mode).length,
    [liveMapData, mode]
  );
  const hasQuery = search.trim().length > 0;

  let resultsTitle: React.ReactNode;
  if (mapLoading) {
    resultsTitle = <>Memuat data titik…</>;
  } else if (mapError) {
    resultsTitle = <>Data titik belum dapat dimuat</>;
  } else if (!liveReady) {
    resultsTitle = <>Status ketersediaan belum termuat</>;
  } else if (mode === "premium") {
    resultsTitle = (
      <>
        <em>{fmtCount(totalCount)} halte BRT</em> dengan lelang berjalan
      </>
    );
  } else {
    resultsTitle = (
      <>
        <em>{fmtCount(totalCount)} bus stop Non-BRT</em> tersedia untuk
        langganan
      </>
    );
  }

  // Empty-state copy for the listing column (one calm line, no numbers).
  let emptyTitle = "Tidak ada hasil";
  let emptySub = "Coba kata kunci lain.";
  if (!liveReady) {
    emptyTitle = "Status ketersediaan belum termuat";
    emptySub = `Diperbarui otomatis setiap ${AVAILABILITY_POLL_INTERVAL_MS / 1000} detik.`;
  } else if (!hasQuery && mode === "premium") {
    emptyTitle = "Belum ada lelang berjalan";
    emptySub = "Jadwal lelang halte BRT ditetapkan oleh Transjakarta.";
  } else if (!hasQuery) {
    emptyTitle = "Belum ada bus stop Non-BRT yang tersedia";
    emptySub = "Titik diaktifkan oleh Transjakarta.";
  }

  // DetailPanel takes the richest shape we have for the active halte:
  //   detail (lazy-fetched full row) > lean stub projection > null.
  const activePanelHalte: HalteData | null = activeHalteDetail
    ?? (activeHalteLean ? projectSidebarCard(activeHalteLean) : null);

  return (
    <div className="app-root">
      <Ticker />
      <Header onOpenInfo={setInfoPage} />

      <div className="app-body">
        <aside className="sidebar">
          <ModeSwitch activeMode={mode} onModeChange={handleModeChange} />

          <FilterBar searchValue={search} onSearchChange={setSearch} />

          <div className="results-head">
            <div className="results-kicker">
              {mode === "premium" ? "Halte BRT · Premium" : "Bus stop Non-BRT"}
            </div>
            <h2 className="results-title">{resultsTitle}</h2>
            {!mapLoading && !mapError && liveReady && (
              <div className="results-meta">
                <span>
                  Ditampilkan{" "}
                  <strong style={{ color: "var(--text-2)" }}>
                    {fmtCount(filteredCards.length)}
                  </strong>{" "}
                  dari{" "}
                  <strong style={{ color: "var(--text-2)" }}>
                    {fmtCount(sidebarTotal)}
                  </strong>
                </span>
                {mode === "premium" && (
                  <span>
                    Urutan: <strong>Berakhir segera</strong>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="listings-scroll" ref={listingsRef}>
            {mapLoading ? (
              <div className="listing-empty">
                <div className="listing-empty-icon">⏳</div>
                <div className="listing-empty-title">Memuat halte…</div>
                <div className="listing-empty-sub">
                  Mengambil peta dari server.
                </div>
              </div>
            ) : mapError ? (
              <div className="listing-empty">
                <div className="listing-empty-icon">⚠️</div>
                <div className="listing-empty-title">Gagal memuat halte</div>
                <div className="listing-empty-sub">{mapError}</div>
              </div>
            ) : filteredCards.length === 0 ? (
              <div className="listing-empty">
                <div className="listing-empty-icon">
                  {!liveReady ? "⏳" : hasQuery ? "🔍" : "📍"}
                </div>
                <div className="listing-empty-title">{emptyTitle}</div>
                <div className="listing-empty-sub">{emptySub}</div>
              </div>
            ) : (
              <>
                {filteredCards.map((halte) => (
                  <div key={halte.id} data-halte-id={halte.id}>
                    <HalteCard
                      halte={halte}
                      active={activeHalteLean?.id === halte.id}
                      onClick={handleCardClick}
                    />
                  </div>
                ))}
                {sidebarTotal > SIDEBAR_CAP && (
                  <div className="listings-cap-notice">
                    Menampilkan {SIDEBAR_CAP} dari {fmtCount(sidebarTotal)}{" "}
                    titik. Gunakan pencarian untuk mempersempit.
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        <main className="map-area">
          <MapView
            premiumHaltes={premiumFiltered}
            massHaltes={massFiltered}
            activeHalteId={activeHalteLean?.id ?? null}
            onHalteClick={handleMapClick}
            mode={mode}
            onMapReady={handleMapReady}
            liveReady={liveReady}
          />

          {/* Loading overlay — hides empty-cluster flash on first load. */}
          {mapLoading && (
            <div className="map-loading-overlay">
              <div className="map-loading-spinner" />
              <span className="map-loading-text">Memuat peta…</span>
            </div>
          )}

          <DetailPanel
            halte={activePanelHalte}
            detailLoading={activeHalteLoading}
            detailError={activeHalteError}
            onClose={() => setActiveHalteLean(null)}
            onBid={handleBid}
            onSubscribe={handleSubscribe}
            onNotify={handleNotify}
            bidRefreshKey={bidRefreshKey}
            subscribeRefreshKey={subscribeRefreshKey}
          />
        </main>
      </div>

      <BidModal
        open={!!bidHalte}
        halte={bidHalte}
        onClose={() => setBidHalte(null)}
        onToast={showToast}
        onSubmitted={() => setBidRefreshKey((v) => v + 1)}
      />
      <SubscribeModal
        open={!!subscribeHalte}
        halte={subscribeHalte}
        onClose={() => setSubscribeHalte(null)}
        onToast={showToast}
        onSubmitted={() => setSubscribeRefreshKey((v) => v + 1)}
      />
      <InfoModals
        open={infoPage}
        onClose={() => setInfoPage(null)}
        onToast={showToast}
      />

      <Toast toast={toast} />
    </div>
  );
}
