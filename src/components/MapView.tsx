"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { JAKARTA_CENTER } from "@/data/haltes";
import { fmtRupiahShort } from "@/lib/format";
import { fmtCount } from "@/lib/network";
import { NON_BRT_MONTHLY_PRICE, PREMIUM_CONTRACT_MONTHS } from "@/lib/pricing";
import {
  PRICE_COPY,
  premiumDisplayPrice,
  type MapRecord,
} from "@/lib/haltes-map";

// Chip label = live DB value for that halte: penawaran tertinggi when a bid
// exists, otherwise its harga dasar (floored to Rp 100 jt). Both arrive via
// the availability poll, so labels follow the DB without a detail fetch.
function markerPriceLabel(r: MapRecord): string {
  if (r.mode === "mass") {
    return r.available ? `${fmtRupiahShort(NON_BRT_MONTHLY_PRICE)}/bln` : "Tidak tersedia";
  }
  if (!r.available) return "Ditutup";
  return fmtRupiahShort(premiumDisplayPrice(r.basePrice, r.currentBidAmount).amount);
}

function markerAriaLabel(r: MapRecord): string {
  if (r.mode === "mass" || !r.available) return `${r.name} — ${markerPriceLabel(r)}`;
  const { amount, hasBid } = premiumDisplayPrice(r.basePrice, r.currentBidAmount);
  return `${r.name} — ${hasBid ? "penawaran tertinggi" : "harga dasar"} ${fmtRupiahShort(amount)}/tahun`;
}

/** Changes whenever a chip's visible content would change → rebuild it. */
function markerSignature(r: MapRecord): string {
  return `${r.available ? 1 : 0}|${markerAriaLabel(r)}`;
}

// AirHalte editorial map style — warm cream paper, deep-blue accents
const AIRHALTE_MAP_STYLE = {
  version: 8 as const,
  name: "AirHalte Editorial",
  sources: {
    openmaptiles: {
      type: "vector" as const,
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background" as const, paint: { "background-color": "#F4F1EA" } },
    {
      id: "park", type: "fill" as const, source: "openmaptiles", "source-layer": "park",
      filter: ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false] as unknown[],
      paint: { "fill-color": "#E4E3D1", "fill-opacity": 0.6 },
    },
    {
      id: "landuse_residential", type: "fill" as const, source: "openmaptiles", "source-layer": "landuse",
      maxzoom: 16,
      filter: ["all",
        ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
        ["==", ["get", "class"], "residential"],
      ] as unknown[],
      paint: { "fill-color": "#EDE7D6", "fill-opacity": ["interpolate", ["exponential", 0.6], ["zoom"], 8, 0.5, 16, 0.3] as unknown },
    },
    {
      id: "water", type: "fill" as const, source: "openmaptiles", "source-layer": "water",
      filter: ["all",
        ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
        ["!=", ["get", "brunnel"], "tunnel"],
      ] as unknown[],
      paint: { "fill-color": "#B8C4BE", "fill-antialias": true },
    },
    {
      id: "waterway", type: "line" as const, source: "openmaptiles", "source-layer": "waterway",
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false] as unknown[],
      paint: { "line-color": "#B8C4BE", "line-width": 1 },
    },
    {
      id: "building", type: "fill" as const, source: "openmaptiles", "source-layer": "building",
      minzoom: 12,
      paint: {
        "fill-antialias": true,
        "fill-color": "#E5DDC8",
        "fill-outline-color": "#D4CDB9",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 16, 0.7] as unknown,
      },
    },
    {
      id: "highway_minor", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      minzoom: 11,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["minor", "service", "track"], true, false],
      ] as unknown[],
      layout: { "line-cap": "round" as const, "line-join": "round" as const },
      paint: { "line-color": "#E0D8C2", "line-opacity": 0.8, "line-width": ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.2, 20, 14] as unknown },
    },
    {
      id: "highway_major_casing", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      minzoom: 11,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
      ] as unknown[],
      layout: { "line-cap": "butt" as const, "line-join": "miter" as const },
      paint: { "line-color": "#C9BFA3", "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 2, 20, 20] as unknown },
    },
    {
      id: "highway_major_inner", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      minzoom: 11,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
      ] as unknown[],
      layout: { "line-cap": "round" as const, "line-join": "round" as const },
      paint: { "line-color": "#F4F1EA", "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 1.5, 20, 17] as unknown },
    },
    {
      id: "highway_major_subtle", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      maxzoom: 11,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
      ] as unknown[],
      paint: { "line-color": "#C9BFA3", "line-width": 1.5 },
    },
    {
      id: "highway_motorway_casing", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      minzoom: 6,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["==", ["get", "class"], "motorway"],
      ] as unknown[],
      layout: { "line-cap": "butt" as const, "line-join": "miter" as const },
      paint: { "line-color": "#8B6F63", "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 5.8, 0, 6, 3, 20, 36] as unknown },
    },
    {
      id: "highway_motorway_inner", type: "line" as const, source: "openmaptiles", "source-layer": "transportation",
      minzoom: 6,
      filter: ["all",
        ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        ["==", ["get", "class"], "motorway"],
      ] as unknown[],
      layout: { "line-cap": "round" as const, "line-join": "round" as const },
      paint: { "line-color": "#F4E8DA", "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 5.8, 0, 6, 2, 20, 32] as unknown },
    },
    {
      id: "place_suburb", type: "symbol" as const, source: "openmaptiles", "source-layer": "place",
      minzoom: 11, maxzoom: 15,
      filter: ["all", ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false]] as unknown[],
      layout: {
        "text-field": ["get", "name:latin"] as unknown,
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 11] as unknown,
        "text-max-width": 7,
        "text-letter-spacing": 0.12,
        "text-transform": "uppercase" as const,
      },
      paint: { "text-color": "#6A6558", "text-halo-color": "#F4F1EA", "text-halo-width": 1.5 },
    },
    {
      id: "place_city", type: "symbol" as const, source: "openmaptiles", "source-layer": "place",
      minzoom: 4, maxzoom: 13,
      filter: ["all", ["==", ["get", "class"], "city"]] as unknown[],
      layout: {
        "text-field": ["get", "name:latin"] as unknown,
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 16, 13, 20] as unknown,
        "text-max-width": 8,
      },
      paint: { "text-color": "#0E0E0E", "text-halo-color": "#F4F1EA", "text-halo-width": 2.5 },
    },
    {
      id: "road_label", type: "symbol" as const, source: "openmaptiles", "source-layer": "transportation_name",
      minzoom: 13,
      filter: ["all", ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]] as unknown[],
      layout: {
        "text-field": ["get", "name:latin"] as unknown,
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "symbol-placement": "line" as const,
        "text-letter-spacing": 0.04,
      },
      paint: { "text-color": "#6A6558", "text-halo-color": "#F4F1EA", "text-halo-width": 2 },
    },
  ],
};

const RASTER_STYLE = {
  version: 8 as const,
  sources: {
    "osm-raster": {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm-tiles", type: "raster" as const, source: "osm-raster" }],
};

interface MapViewProps {
  /**
   * Halte BRT with an open auction (filtered by search).
   * Up to 270 items. Rendered as HTML chip markers when unclustered.
   */
  premiumHaltes: MapRecord[];
  /**
   * Bus stop Non-BRT that are listed (filtered by search).
   * Up to ~7 300 items. Rendered as GPU circle layer when unclustered.
   */
  massHaltes: MapRecord[];
  activeHalteId: string | null;
  onHalteClick: (halte: MapRecord) => void;
  mode: "premium" | "mass";
  onMapReady?: () => void;
  /** False until the first live availability snapshot is known — the
      stats badge then shows "—" instead of a misleading 0. */
  liveReady?: boolean;
}

// ---------------------------------------------------------------------------
// Two independent GeoJSON sources — one per mode.
//
// Key insight: mode switching is now a pure GPU visibility toggle (one
// setLayoutProperty call per layer, <1 ms).  We never call source.setData()
// on a mode switch — that used to be the main cause of the freeze because
// MapLibre had to re-cluster 7 500 features on the main thread.
//
// Premium source: up to 270 Halte BRT, HTML chip markers when unclustered.
// Mass source:    up to ~7 300 bus stop Non-BRT, GPU circles when unclustered.
// ---------------------------------------------------------------------------
const PREMIUM_SRC_ID         = "haltes-premium-src";
const MASS_SRC_ID            = "haltes-mass-src";
const SELECTED_SRC_ID        = "selected-halte-src";

const PREMIUM_CLUSTER_LAYER  = "premium-clusters";
const PREMIUM_CLUSTER_COUNT  = "premium-cluster-count";
const PREMIUM_HIT_LAYER      = "premium-unclustered-hit";

const MASS_CLUSTER_LAYER     = "mass-clusters";
const MASS_CLUSTER_COUNT     = "mass-cluster-count";
const MASS_UNCLUSTERED_LAYER = "mass-unclustered";
const MASS_SELECTED_LAYER    = "mass-selected";

// Points uncluster above this zoom. Floor for flyTo / easeTo.
const CLUSTER_MAX_ZOOM = 15;

export default function MapView({
  premiumHaltes,
  massHaltes,
  activeHalteId,
  onHalteClick,
  mode,
  onMapReady,
  liveReady = true,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<
    Map<string, { marker: import("maplibre-gl").Marker; el: HTMLElement; sig: string }>
  >(new Map());
  // Lookup by id — merged from both modes so flyTo / click can resolve any id.
  const haltesById = useRef<Map<string, MapRecord>>(new Map());
  const onHalteClickRef = useRef(onHalteClick);
  const mapReadyRef = useRef(false);
  const sourceReadyRef = useRef(false);

  // Map "epoch": bumped every time a map instance finishes loading its
  // sources. The premium / mass setData effects depend on it, so they
  // (re)apply the current data to EVERY new map instance.
  //
  // Why a counter and not a boolean: props often settle before MapLibre
  // finishes loading (e.g. navigating back to `/` with the GeoJSON in the
  // browser cache). A boolean `sourcesReady` handled that once, but Fast
  // Refresh (and the raster fallback) destroy and re-create the map while
  // React state survives — `setSourcesReady(true)` on the new map was a
  // no-op, the setData effects never re-ran and the map stayed blank
  // ("peta blank / marker hilang"). An incrementing epoch always changes.
  const [mapEpoch, setMapEpoch] = useState(0);
  // MapLibre failed to load (chunk import error, WebGL unavailable…).
  const [mapFailed, setMapFailed] = useState(false);

  // Avoid re-creating syncUnclusteredMarkers every time a halte is clicked.
  // A ref is updated synchronously from the effect below, so the callback
  // always sees the latest value without being a dependency.
  const activeHalteIdRef = useRef(activeHalteId);

  // ---- Mass data debounce (large dataset, streaming batches) ----
  const massDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMassGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; taken: number }> | null>(null);
  const prevMassCountRef = useRef(0);

  // ---- Last-wins rAF throttle for syncUnclusteredMarkers ----
  const syncRafRef = useRef<number | null>(null);

  // Track mode inside map event closures (avoids stale captures).
  const modeRef = useRef(mode);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);

  useEffect(() => { onHalteClickRef.current = onHalteClick; }, [onHalteClick]);
  useEffect(() => { activeHalteIdRef.current = activeHalteId; }, [activeHalteId]);

  // DEV-only watchdog: a console hint when the map hasn't finished loading
  // its sources 5 s after mount. Usual causes: the style / tile server is
  // unreachable (the raster fallback kicks in after repeated tile errors)
  // or an exception during init — check the console / network tab.
  // Re-inits after Fast Refresh are handled by the epoch logic above.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const timer = setTimeout(() => {
      if (!sourceReadyRef.current) {
        console.warn(
          "[MapView] Style peta belum siap setelah 5 dtk (sumber AirHalte " +
            "belum terpasang). Cek koneksi ke tiles.openfreemap.org atau error " +
            "MapLibre di console."
        );
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // ---------------------------------------------------------------------------
  // Build a price-pill marker DOM element for a premium halte.
  // Label = live harga dasar / penawaran tertinggi from the lean MapRecord
  // (see markerPriceLabel). The registry stores a signature so a chip is
  // rebuilt when its label changes (e.g. a new bid lands via polling).
  // ---------------------------------------------------------------------------
  const buildMarkerEl = useCallback((halte: MapRecord): HTMLElement => {
    const isTaken = !halte.available;
    const isAvailableMass = halte.mode === "mass" && halte.available;
    const priceLabel = markerPriceLabel(halte);

    const root = document.createElement("div");
    root.className = "marker-root";

    const el = document.createElement("div");
    el.className = [
      "marker-inner",
      isTaken ? "taken" : "",
      isAvailableMass ? "available-mass" : "",
    ]
      .filter(Boolean)
      .join(" ");
    el.dataset.halteId = halte.id;
    el.setAttribute("aria-label", markerAriaLabel(halte));

    const dot = document.createElement("span");
    dot.className = "tier-dot-m";
    dot.style.background = "var(--brand)";

    const price = document.createElement("span");
    price.className = "marker-price";
    price.textContent = priceLabel;

    el.appendChild(dot);
    el.appendChild(price);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      // Resolve by id so the click always carries the latest record.
      onHalteClickRef.current(haltesById.current.get(halte.id) ?? halte);
    });

    root.appendChild(el);
    (root as unknown as HTMLElement & { __inner: HTMLElement }).__inner = el;
    return root;
  }, []);

  // ---------------------------------------------------------------------------
  // Convert a haltes list into a GeoJSON FeatureCollection for a cluster source.
  // `taken` (0/1) drives the mass-mode circle color via data expression.
  // ---------------------------------------------------------------------------
  const buildGeoJson = useCallback(
    (
      list: MapRecord[]
    ): GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; taken: number }> => ({
      type: "FeatureCollection",
      features: list.map((r) => ({
        type: "Feature",
        properties: { id: r.id, taken: r.available ? 0 : 1 },
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      })),
    }),
    []
  );

  // ---------------------------------------------------------------------------
  // Diff visible unclustered features against the marker registry.
  // Only called in premium mode — mass uses GPU circles instead.
  // Uses activeHalteIdRef (not the prop) so this function is never recreated
  // just because the user clicked a different halte.
  // ---------------------------------------------------------------------------
  const syncUnclusteredMarkers = useCallback(
    (map: import("maplibre-gl").Map, maplibregl: typeof import("maplibre-gl")) => {
      if (!sourceReadyRef.current) return;
      if (modeRef.current === "mass") return;

      const features = map.queryRenderedFeatures(undefined, {
        layers: [PREMIUM_HIT_LAYER],
      });

      const visibleIds = new Set<string>();
      for (const f of features) {
        const id = (f.properties as { id?: string } | null)?.id;
        if (typeof id === "string") visibleIds.add(id);
      }

      // Remove markers no longer visible, or whose label/state changed
      // (they are rebuilt with fresh content in the loop below).
      for (const [id, entry] of markersRef.current) {
        const current = haltesById.current.get(id);
        if (!visibleIds.has(id) || !current || markerSignature(current) !== entry.sig) {
          entry.marker.remove();
          markersRef.current.delete(id);
        }
      }

      // Add markers that just became visible.
      for (const id of visibleIds) {
        if (markersRef.current.has(id)) continue;
        const halte = haltesById.current.get(id);
        if (!halte) continue;
        const root = buildMarkerEl(halte);
        const inner = (root as unknown as HTMLElement & { __inner: HTMLElement })
          .__inner;
        if (id === activeHalteIdRef.current) inner.classList.add("active");
        const marker = new maplibregl.Marker({ element: root, anchor: "center" })
          .setLngLat([halte.lng, halte.lat])
          .addTo(map);
        markersRef.current.set(id, { marker, el: inner, sig: markerSignature(halte) });
      }
    },
    // activeHalteIdRef is accessed via ref — not listed as dep so this
    // callback is stable and does NOT cause the mode effect to re-run on click.
    [buildMarkerEl]
  );

  // ---------------------------------------------------------------------------
  // Init map on mount — sets up both sources and all layers.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;

    // Tear down everything bound to the current map instance: pending
    // debounce / rAF work, HTML chips, the map itself and the readiness
    // refs. Used by the effect cleanup (unmount, Fast Refresh) and by the
    // raster fallback right before it re-creates the map.
    const teardownMap = () => {
      if (massDataTimerRef.current) {
        clearTimeout(massDataTimerRef.current);
        massDataTimerRef.current = null;
      }
      pendingMassGeoJsonRef.current = null;
      if (syncRafRef.current !== null) {
        cancelAnimationFrame(syncRafRef.current);
        syncRafRef.current = null;
      }
      const markers = markersRef.current;
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      sourceReadyRef.current = false;
      prevMassCountRef.current = 0;
    };

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !mapContainer.current) return;
      maplibreRef.current = maplibregl;

      let tileErrorCount = 0;
      let fallbackTriggered = false;

      const initWithStyle = (
        style: typeof AIRHALTE_MAP_STYLE | typeof RASTER_STYLE,
        isRaster = false
      ) => {
        if (cancelled || !mapContainer.current) return;

        let created: import("maplibre-gl").Map | null = null;
        try {
          created = new maplibregl.Map({
            container: mapContainer.current,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style: style as any,
            center: JAKARTA_CENTER,
            zoom: 11,
            minZoom: 9,
            maxZoom: 18,
            attributionControl: { compact: true },
          });
        } catch (err) {
          // e.g. WebGL unavailable — show the retry overlay, not a blank map.
          console.error("[MapView] MapLibre init failed:", err);
          setMapFailed(true);
          return;
        }
        const map = created;

        mapRef.current = map;
        mapContainer.current.classList.toggle("raster-fallback", isRaster);

        // Sumber & layer AirHalte dipasang begitu style siap ("style.load"),
        // TIDAK menunggu event "load". "load" baru jalan setelah SEMUA tile
        // basemap di layar selesai diunduh; di jaringan lambat itu bisa
        // puluhan detik dan selama itu chip/marker belum muncul (gejala
        // "peta kosong"). "load" tetap dipasang sebagai jaring pengaman;
        // flag `setupDone` memastikan setup hanya jalan sekali per instance.
        let setupDone = false;
        const setupAirHalteLayers = () => {
          if (cancelled || setupDone) return;
          setupDone = true;
          mapReadyRef.current = true;

          // -----------------------------------------------------------------
          // PREMIUM source + layers
          // -----------------------------------------------------------------
          map.addSource(PREMIUM_SRC_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterMaxZoom: CLUSTER_MAX_ZOOM,
            clusterRadius: 60,
          });

          // Premium cluster bubbles
          map.addLayer({
            id: PREMIUM_CLUSTER_LAYER,
            type: "circle",
            source: PREMIUM_SRC_ID,
            filter: ["has", "point_count"],
            layout: {
              visibility: modeRef.current === "premium" ? "visible" : "none",
            },
            paint: {
              "circle-color": [
                "step", ["get", "point_count"],
                "#1E3A5F", 25, "#1E3A5F", 100, "#172E4A",
              ],
              "circle-radius": [
                "step", ["get", "point_count"],
                18, 25, 24, 100, 30,
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.9)",
              "circle-opacity": 0.92,
            },
          });

          map.addLayer({
            id: PREMIUM_CLUSTER_COUNT,
            type: "symbol",
            source: PREMIUM_SRC_ID,
            filter: ["has", "point_count"],
            layout: {
              visibility: modeRef.current === "premium" ? "visible" : "none",
              "text-field": ["get", "point_count_abbreviated"] as unknown as string,
              "text-font": ["Noto Sans Bold"],
              "text-size": 13,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#FFFFFF" },
          });

          // Invisible hit-test layer — radius 1 so queryRenderedFeatures works.
          map.addLayer({
            id: PREMIUM_HIT_LAYER,
            type: "circle",
            source: PREMIUM_SRC_ID,
            filter: ["!", ["has", "point_count"]],
            layout: {
              visibility: modeRef.current === "premium" ? "visible" : "none",
            },
            paint: { "circle-radius": 1, "circle-opacity": 0 },
          });

          // -----------------------------------------------------------------
          // MASS source + layers
          // -----------------------------------------------------------------
          map.addSource(MASS_SRC_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterMaxZoom: CLUSTER_MAX_ZOOM,
            clusterRadius: 90,
          });

          // Mass cluster bubbles
          map.addLayer({
            id: MASS_CLUSTER_LAYER,
            type: "circle",
            source: MASS_SRC_ID,
            filter: ["has", "point_count"],
            layout: {
              visibility: modeRef.current === "mass" ? "visible" : "none",
            },
            paint: {
              "circle-color": [
                "step", ["get", "point_count"],
                "#1E3A5F", 25, "#1E3A5F", 100, "#172E4A", 500, "#0E1F33",
              ],
              "circle-radius": [
                "step", ["get", "point_count"],
                18, 25, 24, 100, 30, 500, 38,
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.9)",
              "circle-opacity": 0.92,
            },
          });

          map.addLayer({
            id: MASS_CLUSTER_COUNT,
            type: "symbol",
            source: MASS_SRC_ID,
            filter: ["has", "point_count"],
            layout: {
              visibility: modeRef.current === "mass" ? "visible" : "none",
              "text-field": ["get", "point_count_abbreviated"] as unknown as string,
              "text-font": ["Noto Sans Bold"],
              "text-size": 13,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#FFFFFF" },
          });

          // GPU circles — replaces ~7 500 DOM markers in mass mode.
          map.addLayer({
            id: MASS_UNCLUSTERED_LAYER,
            type: "circle",
            source: MASS_SRC_ID,
            filter: ["!", ["has", "point_count"]],
            layout: {
              visibility: modeRef.current === "mass" ? "visible" : "none",
            },
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                10, 3, 14, 5, 17, 8,
              ] as unknown as number,
              "circle-color": [
                "case",
                ["==", ["get", "taken"], 1], "#9CA3AF",
                "#1E3A5F",
              ] as unknown as string,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "rgba(255,255,255,0.85)",
              "circle-opacity": 0.9,
            },
          });

          // -----------------------------------------------------------------
          // Selected-dot ring (mass mode — shared across both modes but only
          // shown in mass where there are no HTML marker active states).
          // -----------------------------------------------------------------
          map.addSource(SELECTED_SRC_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          map.addLayer({
            id: MASS_SELECTED_LAYER,
            type: "circle",
            source: SELECTED_SRC_ID,
            layout: { visibility: "none" },
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                10, 7, 14, 11, 17, 16,
              ] as unknown as number,
              "circle-color": "transparent",
              "circle-stroke-width": 2.5,
              "circle-stroke-color": "#FFFFFF",
              "circle-opacity": 0,
              "circle-stroke-opacity": 1,
            },
          });

          sourceReadyRef.current = true;
          // New epoch → the setData effects (re)apply the current data to
          // THIS map instance, even if their props settled long ago.
          if (!cancelled) setMapEpoch((e) => e + 1);

          // -----------------------------------------------------------------
          // Event handlers
          // -----------------------------------------------------------------

          // Mass GPU dot click
          map.on("click", MASS_UNCLUSTERED_LAYER, (e) => {
            if (modeRef.current !== "mass") return;
            const feature = e.features?.[0];
            if (!feature) return;
            const raw = (feature.properties as { id?: unknown })?.id;
            const id = typeof raw === "string" ? raw : null;
            if (!id) return;
            const halte = haltesById.current.get(id);
            if (halte) onHalteClickRef.current(halte);
          });

          map.on("mouseenter", MASS_UNCLUSTERED_LAYER, () => {
            if (modeRef.current === "mass") map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", MASS_UNCLUSTERED_LAYER, () => {
            map.getCanvas().style.cursor = "";
          });

          // Helper: expand a cluster from a given source
          const expandCluster = (
            srcId: string,
            feature: import("maplibre-gl").MapGeoJSONFeature
          ) => {
            const clusterId = (feature.properties as { cluster_id?: number })?.cluster_id;
            const src = map.getSource(srcId) as
              | (import("maplibre-gl").GeoJSONSource & {
                  getClusterExpansionZoom: (id: number) => Promise<number>;
                })
              | undefined;
            if (!src || clusterId == null) return;
            src
              .getClusterExpansionZoom(clusterId)
              .then((zoom) => {
                const geom = feature.geometry as GeoJSON.Point;
                map.flyTo({
                  center: geom.coordinates as [number, number],
                  zoom: Math.min(Math.max(zoom + 0.5, CLUSTER_MAX_ZOOM + 1), 18),
                  duration: 350,
                  essential: true,
                });
                const onMoveEnd = () => {
                  map.off("moveend", onMoveEnd);
                  if (syncRafRef.current !== null) cancelAnimationFrame(syncRafRef.current);
                  syncRafRef.current = requestAnimationFrame(() => {
                    syncRafRef.current = null;
                    syncUnclusteredMarkers(map, maplibregl);
                  });
                };
                map.once("moveend", onMoveEnd);
              })
              .catch(() => {/* swallow */});
          };

          map.on("click", PREMIUM_CLUSTER_LAYER, (e) => {
            if (modeRef.current !== "premium") return;
            const f = e.features?.[0];
            if (f) expandCluster(PREMIUM_SRC_ID, f);
          });

          map.on("click", MASS_CLUSTER_LAYER, (e) => {
            if (modeRef.current !== "mass") return;
            const f = e.features?.[0];
            if (f) expandCluster(MASS_SRC_ID, f);
          });

          // Cursor affordance for clusters
          [PREMIUM_CLUSTER_LAYER, MASS_CLUSTER_LAYER].forEach((layer) => {
            map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
          });

          // Re-sync HTML chips after camera moves (premium only — mass skips).
          const trigger = () => {
            if (syncRafRef.current !== null) cancelAnimationFrame(syncRafRef.current);
            syncRafRef.current = requestAnimationFrame(() => {
              syncRafRef.current = null;
              syncUnclusteredMarkers(map, maplibregl);
            });
          };
          map.on("moveend", trigger);
          map.on("zoomend", trigger);
          // Chip HTML dibangun dari queryRenderedFeatures, jadi sinkronkan
          // lagi SETELAH frame berisi data baru selesai digambar ("render").
          // Tanpa ini, sinkron pertama bisa jalan sebelum layer premium
          // tergambar dan chip baru muncul setelah peta digeser.
          let chipSyncPending = true;
          map.on("sourcedata", (e) => {
            if (
              (e.sourceId === PREMIUM_SRC_ID || e.sourceId === MASS_SRC_ID) &&
              e.isSourceLoaded
            ) {
              chipSyncPending = true;
              trigger();
            }
          });
          map.on("render", () => {
            if (!chipSyncPending || !map.getSource(PREMIUM_SRC_ID)) return;
            if (!map.isSourceLoaded(PREMIUM_SRC_ID)) return;
            chipSyncPending = false;
            trigger();
          });

          trigger();
          onMapReady?.();
        };
        map.on("style.load", setupAirHalteLayers);
        map.on("load", setupAirHalteLayers);

        if (!isRaster) {
          map.on("error", (e) => {
            const err = e?.error as { status?: number; message?: string } | null;
            const status = err?.status ?? 0;
            const msg = err?.message || "";
            if (status >= 400 || /Failed to fetch|Network|CORS|tile/i.test(msg)) {
              tileErrorCount++;
              if (tileErrorCount >= 3 && !fallbackTriggered) {
                fallbackTriggered = true;
                // Full teardown (HTML chips, pending timers, refs) before
                // re-creating; the raster map's "load" bumps the epoch.
                teardownMap();
                initWithStyle(RASTER_STYLE, true);
              }
            }
          });
        }
      };

      initWithStyle(AIRHALTE_MAP_STYLE);
    }).catch((err: unknown) => {
      // Chunk failed to load (offline, stale dev build, blocked by an
      // extension…) or init threw. Show the retry overlay instead of a
      // silent blank map.
      if (cancelled) return;
      console.error("[MapView] Failed to load MapLibre:", err);
      setMapFailed(true);
    });

    return () => {
      cancelled = true;
      teardownMap();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Mode toggle — visibility ONLY, no setData.
  // Both sources are always loaded; toggling their layers' visibility is a
  // single GPU state change — essentially instantaneous.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    modeRef.current = mode;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const isPremium = mode === "premium";

    const setVis = (layerId: string, visible: boolean) => {
      if (map.getLayer(layerId))
        map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    };

    // Premium layer group
    setVis(PREMIUM_CLUSTER_LAYER, isPremium);
    setVis(PREMIUM_CLUSTER_COUNT, isPremium);
    setVis(PREMIUM_HIT_LAYER, isPremium);

    // Mass layer group
    setVis(MASS_CLUSTER_LAYER, !isPremium);
    setVis(MASS_CLUSTER_COUNT, !isPremium);
    setVis(MASS_UNCLUSTERED_LAYER, !isPremium);

    if (isPremium) {
      // Clear mass selected ring
      setVis(MASS_SELECTED_LAYER, false);
      const selSrc = map.getSource(SELECTED_SRC_ID) as
        | import("maplibre-gl").GeoJSONSource | undefined;
      selSrc?.setData({ type: "FeatureCollection", features: [] });

      // DOM markers may have been cleared — re-sync premium chips.
      const ml = maplibreRef.current;
      if (ml) {
        if (syncRafRef.current !== null) cancelAnimationFrame(syncRafRef.current);
        syncRafRef.current = requestAnimationFrame(() => {
          syncRafRef.current = null;
          syncUnclusteredMarkers(map, ml);
        });
      }
    } else {
      // Remove premium DOM markers (GPU circles take over).
      for (const { marker } of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
    }
  }, [mode, syncUnclusteredMarkers]);

  // ---------------------------------------------------------------------------
  // Keep haltesById in sync (merged lookup for flyTo / click resolution).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const merged = new Map<string, MapRecord>();
    for (const h of premiumHaltes) merged.set(h.id, h);
    for (const h of massHaltes) merged.set(h.id, h);
    haltesById.current = merged;
  }, [premiumHaltes, massHaltes]);

  // ---------------------------------------------------------------------------
  // Premium data update — immediate (at most 270 items, never debounced).
  // Phase 5b: explicit triggerRepaint() after setData. setData *should*
  // schedule a repaint on its own, but on a clustered GeoJSON source
  // MapLibre sometimes defers the visual until the next camera move,
  // which manifests as "sidebar updated but marker didn't" after a poll
  // tick lands a freshly-listed halte. Forcing the repaint costs nothing
  // and removes a class of "where's my marker?" reports.
  // `mapEpoch` is in the dep array so this effect re-applies the data to
  // every freshly loaded map instance (see comment on `mapEpoch` above).
  // The extra marker sync refreshes chip labels (e.g. a new bid) right
  // away, even when the set of visible haltes didn't change.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sourceReadyRef.current) return;
    const src = map.getSource(PREMIUM_SRC_ID) as
      | import("maplibre-gl").GeoJSONSource | undefined;
    if (src) {
      src.setData(buildGeoJson(premiumHaltes));
      map.triggerRepaint();
      const ml = maplibreRef.current;
      if (ml) {
        if (syncRafRef.current !== null) cancelAnimationFrame(syncRafRef.current);
        syncRafRef.current = requestAnimationFrame(() => {
          syncRafRef.current = null;
          syncUnclusteredMarkers(map, ml);
        });
      }
    }
  }, [premiumHaltes, buildGeoJson, syncUnclusteredMarkers, mapEpoch]);

  // ---------------------------------------------------------------------------
  // Mass data update — debounced during streaming batches.
  // "Significant" change (large delta or first load) applies immediately so
  // the first paint of mass mode feels instant.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sourceReadyRef.current) return;
    const src = map.getSource(MASS_SRC_ID) as
      | import("maplibre-gl").GeoJSONSource | undefined;
    if (!src) return;

    const geoJson = buildGeoJson(massHaltes);
    const prevCount = prevMassCountRef.current;
    prevMassCountRef.current = massHaltes.length;

    const isSignificant = Math.abs(massHaltes.length - prevCount) > 100 || prevCount === 0;

    if (isSignificant) {
      if (massDataTimerRef.current) clearTimeout(massDataTimerRef.current);
      pendingMassGeoJsonRef.current = null;
      src.setData(geoJson);
      map.triggerRepaint();
    } else {
      pendingMassGeoJsonRef.current = geoJson;
      if (massDataTimerRef.current) clearTimeout(massDataTimerRef.current);
      massDataTimerRef.current = setTimeout(() => {
        massDataTimerRef.current = null;
        // The map may have been replaced (raster fallback) since scheduling.
        if (!pendingMassGeoJsonRef.current || mapRef.current !== map) return;
        src.setData(pendingMassGeoJsonRef.current);
        map.triggerRepaint();
        pendingMassGeoJsonRef.current = null;
      }, 400);
    }
    // mapEpoch in deps for the same reason as the premium effect —
    // see comment there.
  }, [massHaltes, buildGeoJson, mapEpoch]);

  // ---------------------------------------------------------------------------
  // Sync active marker highlight.
  // Premium: toggle CSS "active" class on HTML chip.
  // Mass: update selected-ring source.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    for (const [id, { el }] of markersRef.current) {
      el.classList.toggle("active", id === activeHalteId);
    }

    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const selSrc = map.getSource(SELECTED_SRC_ID) as
      | import("maplibre-gl").GeoJSONSource | undefined;
    if (!selSrc) return;

    if (modeRef.current === "mass" && activeHalteId) {
      const halte = haltesById.current.get(activeHalteId);
      if (halte) {
        selSrc.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [halte.lng, halte.lat] },
          }],
        });
        if (map.getLayer(MASS_SELECTED_LAYER))
          map.setLayoutProperty(MASS_SELECTED_LAYER, "visibility", "visible");
        return;
      }
    }
    selSrc.setData({ type: "FeatureCollection", features: [] });
    if (map.getLayer(MASS_SELECTED_LAYER))
      map.setLayoutProperty(MASS_SELECTED_LAYER, "visibility", "none");
    // mapEpoch: re-apply the selection ring on a freshly loaded map.
  }, [activeHalteId, mapEpoch]);

  // ---------------------------------------------------------------------------
  // Fly to active halte.
  // Never zoom out; minimum zoom ensures the halte is always unclustered.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activeHalteId || !mapRef.current || !mapReadyRef.current) return;
    const halte = haltesById.current.get(activeHalteId);
    if (halte) {
      const minZoom = modeRef.current === "mass"
        ? CLUSTER_MAX_ZOOM + 1   // z16 — mass dots only appear above clusterMaxZoom
        : CLUSTER_MAX_ZOOM;      // z15 — premium haltes sparse enough at z15
      mapRef.current.easeTo({
        center: [halte.lng, halte.lat],
        zoom: Math.max(mapRef.current.getZoom(), minZoom),
        padding: { right: 420, top: 80, bottom: 80, left: 20 },
        duration: 800,
      });
    }
  }, [activeHalteId]);

  const activeCount = mode === "premium" ? premiumHaltes.length : massHaltes.length;

  return (
    <div className="map-wrap">
      <div ref={mapContainer} id="map" />

      {mapFailed && (
        <div className="map-failed" role="alert">
          <p className="map-failed-title">Peta gagal dimuat.</p>
          <button
            type="button"
            className="map-failed-btn"
            onClick={() => window.location.reload()}
          >
            Muat ulang peta
          </button>
        </div>
      )}

      {/* Map controls */}
      <div className="map-control">
        <button className="map-btn" title="Perbesar" onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button className="map-btn" title="Perkecil" onClick={() => mapRef.current?.zoomOut()}>−</button>
        <button
          className="map-btn"
          title="Reset tampilan"
          onClick={() => mapRef.current?.flyTo({ center: JAKARTA_CENTER, zoom: 11, duration: 800 })}
        >
          ⊙
        </button>
      </div>

      {/* Stats badge — live count of what the map shows right now. */}
      <div className="map-stats">
        <div className="map-stat-item">
          <div className="map-stat-lbl">{mode === "premium" ? "Lelang berjalan" : "Titik tersedia"}</div>
          <div className="map-stat-val hl">{liveReady ? fmtCount(activeCount) : "—"}</div>
        </div>
        <div className="map-stat-sep" />
        <div className="map-stat-item">
          <div className="map-stat-lbl">Mode</div>
          <div className="map-stat-val" style={{ fontSize: "13px" }}>
            {mode === "premium" ? "Premium" : "Non-BRT"}
          </div>
        </div>
      </div>

      {/* Legend — pricing rules from lib/pricing.ts only. */}
      {mode === "premium" ? (
        <div className="map-legend">
          <div className="legend-title">Halte BRT · Premium</div>
          <div className="legend-row">
            <span className="legend-dot" style={{ background: "var(--brand)" }} />
            <span className="legend-lbl">Harga dasar</span>
            <span className="legend-val">{PRICE_COPY.premiumFrom}</span>
          </div>
          <p className="legend-note">
            Lewat lelang, kontrak {PREMIUM_CONTRACT_MONTHS} bulan. Label di peta:
            harga dasar atau penawaran tertinggi.
          </p>
        </div>
      ) : (
        <div className="map-legend">
          <div className="legend-title">Bus stop Non-BRT</div>
          <div className="legend-row">
            <span className="legend-dot" style={{ background: "var(--brand)" }} />
            <span className="legend-lbl">Tersedia</span>
            <span className="legend-val">{PRICE_COPY.nonBrtMonthly}</span>
          </div>
          <p className="legend-note">
            Langganan bulanan atau tahunan ({PRICE_COPY.nonBrtYearly}).
          </p>
        </div>
      )}
    </div>
  );
}
