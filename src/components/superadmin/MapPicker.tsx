"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

const POSITRON_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
// Jakarta center — keep in [lng, lat] order for MapLibre. The brief said
// [-6.2088, 106.8456] (lat, lng), and MapLibre wants the inverse, so we
// transpose explicitly here to make the convention obvious.
const JAKARTA_LNG_LAT: [number, number] = [106.8456, -6.2088];
const DEFAULT_ZOOM = 12;

interface NominatimHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  /** Initial lat passed in from the parent form, may be NaN if empty. */
  initialLat: number;
  initialLng: number;
  /** Live lat/lng from parent input fields — keeps marker in sync if
   *  the user types into the manual fields while picker is open. */
  syncedLat: number;
  syncedLng: number;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}

/**
 * Modal map picker overlay. Renders ABOVE an existing modal (z-index
 * 10001), so the parent halte form stays mounted underneath and we can
 * write the picked coordinates straight back into its input fields.
 *
 * Three ways to set the location:
 *   1) Click anywhere on the map → drops a marker
 *   2) Search via Nominatim → click a result → flies + drops marker
 *   3) Type into Lat/Lng in the parent form → marker syncs via syncedLat/Lng
 */
export default function MapPicker({
  initialLat,
  initialLng,
  syncedLat,
  syncedLng,
  onCancel,
  onConfirm,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const mapReadyRef = useRef(false);

  // The "picked" coords drive the confirm button label and the value
  // we hand back to the parent. Initialize from props so re-opening the
  // picker after a previous pick shows the existing marker right away.
  const [pickedLat, setPickedLat] = useState<number | null>(
    Number.isFinite(initialLat) ? initialLat : null
  );
  const [pickedLng, setPickedLng] = useState<number | null>(
    Number.isFinite(initialLng) ? initialLng : null
  );

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  // Helper: place / move the marker. We re-use the same marker instance
  // so dragging feels seamless instead of flicker-on-replace.
  const setMarker = useCallback((lng: number, lat: number) => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;

    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className = "sa-map-picker-marker";
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        draggable: true,
      })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lng: nlng, lat: nlat } = marker.getLngLat();
        setPickedLat(round6(nlat));
        setPickedLng(round6(nlng));
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Init map on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibregl;

      const startLng =
        Number.isFinite(initialLng) ? initialLng : JAKARTA_LNG_LAT[0];
      const startLat =
        Number.isFinite(initialLat) ? initialLat : JAKARTA_LNG_LAT[1];
      const startZoom = Number.isFinite(initialLat) ? 15 : DEFAULT_ZOOM;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: POSITRON_STYLE,
        center: [startLng, startLat],
        zoom: startZoom,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;
        mapReadyRef.current = true;
        // Drop the initial marker if we have coords.
        if (Number.isFinite(initialLat) && Number.isFinite(initialLng)) {
          setMarker(initialLng, initialLat);
        }
      });

      // Click-to-pick. We still drop a marker even if mapReady hasn't
      // fired yet — MapLibre's click event implies the canvas is alive.
      map.on("click", (e) => {
        const { lng, lat } = e.lngLat;
        const r = round6;
        setPickedLat(r(lat));
        setPickedLng(r(lng));
        setMarker(lng, lat);
      });
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
      mapReadyRef.current = false;
    };
    // Init only once. initialLat/Lng are read on mount only — subsequent
    // changes flow through the syncedLat/Lng effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Sync from parent input fields → marker + local picked state.
  // Only fires when syncedLat/Lng actually change (i.e. the user typed a
  // new value into the form's Lat/Lng inputs while the picker is open).
  //
  // IMPORTANT: pickedLat/Lng must NOT be in this dep array.  When the
  // user drags the marker, pickedLat/Lng change but syncedLat/Lng stay
  // the same (they come from the unchanged form inputs).  If pickedLat/Lng
  // were deps, the effect would re-run after every drag, see
  // "picked ≠ synced", and snap the marker back to the original position —
  // making dragging impossible.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReadyRef.current) return;
    if (!Number.isFinite(syncedLat) || !Number.isFinite(syncedLng)) return;
    setMarker(syncedLng, syncedLat);
    // Mirrors a parent-controlled prop change (the user typed new Lat/Lng in
    // the form) into local state. Only runs when syncedLat/Lng change and is
    // gated on the MapLibre instance being ready, so it cannot loop; moving
    // it into render would lose that gate and risk the drag regression
    // described above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPickedLat(syncedLat);
    setPickedLng(syncedLng);
  }, [syncedLat, syncedLng, setMarker]);

  // -------------------------------------------------------------------------
  // Nominatim search. Triggered by submitting the search form (Enter or
  // the implicit submit). Restricted to Indonesia + 5 results to match
  // the operator's likely use case (placing Jakarta haltes).
  // -------------------------------------------------------------------------
  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    setSearchErr(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        q
      )}&format=json&limit=5&countrycodes=id`;
      const res = await fetch(url, {
        headers: {
          // Nominatim's TOS asks for an identifying UA. Browsers won't
          // let us override User-Agent, but Accept-Language is the next
          // best signal that we're a real client, not a scraper.
          "Accept-Language": "id,en",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as NominatimHit[];
      setResults(json);
      setShowResults(true);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "Search failed");
      setResults([]);
      setShowResults(true);
    } finally {
      setSearching(false);
    }
  }, []);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    runSearch(q);
  };

  const pickResult = (hit: NominatimHit) => {
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setPickedLat(round6(lat));
    setPickedLng(round6(lng));
    setShowResults(false);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 16, duration: 700 });
    }
    setMarker(lng, lat);
  };

  const canConfirm = useMemo(
    () => pickedLat !== null && pickedLng !== null,
    [pickedLat, pickedLng]
  );

  return (
    <div
      className="sa-map-picker-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Pilih lokasi dari peta"
    >
      <div
        className="sa-map-picker"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-map-picker-head">
          <h3 className="sa-map-picker-title">Pilih Lokasi dari Peta</h3>
          <p className="sa-map-picker-sub">
            Cari lokasi atau klik di peta untuk menentukan koordinat halte.
          </p>
        </div>

        <form
          onSubmit={onSearchSubmit}
          className="sa-map-picker-search"
          autoComplete="off"
        >
          <input
            type="search"
            className="sa-input sa-map-picker-search-input"
            placeholder="Cari lokasi…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
          />
          <button
            type="submit"
            className="sa-btn-primary sa-map-picker-search-btn"
            disabled={searching || query.trim().length === 0}
          >
            {searching ? "…" : "Cari"}
          </button>

          {showResults && (
            <div className="sa-map-picker-results">
              {searchErr && (
                <div className="sa-map-picker-result-empty">
                  Pencarian gagal: {searchErr}
                </div>
              )}
              {!searchErr && results.length === 0 && (
                <div className="sa-map-picker-result-empty">
                  Tidak ada hasil untuk &ldquo;{query}&rdquo;.
                </div>
              )}
              {results.map((r) => (
                <button
                  key={r.place_id}
                  type="button"
                  className="sa-map-picker-result"
                  onClick={() => pickResult(r)}
                >
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="sa-map-picker-map" ref={containerRef} />

        <div className="sa-map-picker-footer">
          <div className="sa-map-picker-coords">
            {canConfirm ? (
              <>
                <span className="sa-map-picker-coord-label">Lat:</span>{" "}
                <code>{pickedLat}</code>
                <span
                  className="sa-map-picker-coord-label"
                  style={{ marginLeft: 12 }}
                >
                  Lng:
                </span>{" "}
                <code>{pickedLng}</code>
              </>
            ) : (
              <span className="sa-muted">
                Klik di peta untuk menentukan lokasi.
              </span>
            )}
          </div>
          <div className="sa-map-picker-actions">
            <button
              type="button"
              className="sa-btn-ghost"
              onClick={onCancel}
            >
              Batal
            </button>
            <button
              type="button"
              className="sa-btn-primary"
              disabled={!canConfirm}
              onClick={() => {
                if (pickedLat !== null && pickedLng !== null) {
                  onConfirm(pickedLat, pickedLng);
                }
              }}
            >
              Gunakan Lokasi Ini
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 6-decimal precision is ~11cm at the equator — plenty for halte placement
 *  and avoids storing 14-digit floating-point noise back to Postgres. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
