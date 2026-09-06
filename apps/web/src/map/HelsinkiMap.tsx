import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  Map,
  Marker,
  NavigationControl,
  Popup as MapLibrePopup,
  type FillLayerSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  applyPatienceCurve,
  buildGridGeoJson,
  normalizedScore,
  percentileRanks,
  scaleDisplayScore,
  smoothRanks,
  SCORE_COLOR_STOPS,
} from "./gridGeoJson.js";
import { useJonkhakerroin, MAX_LOCATIONS } from "../state/useJonkhakerroin.js";
import { WeightControls } from "../ui/WeightControls.js";
import { Legend } from "../ui/Legend.js";
import type { GridCell, Profile } from "../data/types.js";

const HELSINKI_CENTER: [number, number] = [24.9384, 60.1699];
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const GRID_SOURCE_ID = "jonkhakerroin-grid";
const GRID_FILL_LAYER_ID = "jonkhakerroin-grid-fill";
const PROFILE_PIN_CLASS: Record<Profile, string> = {
  work: "location-pin work-pin",
  weekdayEvening: "location-pin evening-pin",
  weekend: "location-pin weekend-pin",
};

const FILL_PAINT: FillLayerSpecification["paint"] = {
  "fill-color": [
    "case",
    ["==", ["get", "score"], null],
    "#52606d",
    ["interpolate", ["linear"], ["get", "score"], ...SCORE_COLOR_STOPS.flat()],
  ],
  "fill-opacity": ["case", ["==", ["get", "score"], null], 0.28, 0.65],
};

function scoreGeoJson(
  grid: GridCell[],
  scores: Float64Array | null,
  hasLocations: boolean,
  patience: number,
) {
  const geojson = buildGridGeoJson(grid);
  if (scores && hasLocations) {
    const ranks = applyPatienceCurve(
      smoothRanks(grid, percentileRanks(scores)),
      patience,
    );
    geojson.features.forEach((feature, i) => {
      const rawScore = scores[i]!;
      feature.properties.rawScore = scaleDisplayScore(rawScore);
      feature.properties.score = Number.isFinite(rawScore)
        ? ranks[i]!
        : normalizedScore(rawScore);
    });
  }
  return geojson;
}

export function HelsinkiMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<Marker[]>([]);
  const popupRef = useRef<Popup | null>(null);
  const state = useJonkhakerroin();
  const stateRef = useRef(state);
  stateRef.current = state;

  // Map init — runs once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: STYLE_URL,
      attributionControl: false,
      center: HELSINKI_CENTER,
      zoom: 11,
      minZoom: 9,
    });
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(
      new AttributionControl({
        customAttribution:
          '<a href="https://www.hsl.fi/en/hsl/open-data" target="_blank" rel="noopener noreferrer">HSL GTFS</a> (CC BY 4.0)',
      }),
      "bottom-right",
    );

    map.on("load", () => {
      setMapReady(true);
      map.addSource(GRID_SOURCE_ID, {
        type: "geojson",
        data: scoreGeoJson(
          stateRef.current.grid,
          stateRef.current.scores,
          Object.values(stateRef.current.locations).every(
            (profileLocations) => profileLocations.length > 0,
          ),
          stateRef.current.patience,
        ),
      });
      map.addLayer({
        id: GRID_FILL_LAYER_ID,
        type: "fill",
        source: GRID_SOURCE_ID,
        paint: FILL_PAINT,
      });

      map.on("mousemove", GRID_FILL_LAYER_ID, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const rawScoreProperty = feature.properties?.["rawScore"];
        const logScoreProperty = feature.properties?.["score"];
        const score = Number(rawScoreProperty ?? NaN);
        const fallbackScore = Number(logScoreProperty);
        const displayScore = Number.isFinite(score)
          ? score.toFixed(1)
          : fallbackScore === 1
            ? "∞"
            : null;
        if (displayScore == null) {
          popupRef.current?.remove();
          return;
        }
        if (!popupRef.current) {
          popupRef.current = new MapLibrePopup({
            closeButton: false,
            closeOnClick: false,
          });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${displayScore}</strong>`)
          .addTo(map);
      });
      map.on("mouseleave", GRID_FILL_LAYER_ID, () => {
        popupRef.current?.remove();
      });

      map.on("click", (e: MapMouseEvent) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: [GRID_FILL_LAYER_ID],
        });
        if (features.length === 0) return;
        stateRef.current.addLocation(stateRef.current.activeProfile, {
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
        });
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Constrain panning once the bbox is known (meta loads asynchronously after map init).
  useEffect(() => {
    const map = mapRef.current;
    const bbox = state.meta?.bbox;
    if (!map || !bbox) return;
    map.setMaxBounds([
      [bbox.minLon, bbox.minLat],
      [bbox.maxLon, bbox.maxLat],
    ]);
  }, [state.meta]);

  // Keep the grid source in sync with newly loaded data / recomputed scores (no layer re-add).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(GRID_SOURCE_ID);
    if (!(source instanceof GeoJSONSource)) return;
    source.setData(
      scoreGeoJson(
        state.grid,
        state.scores,
        Object.values(state.locations).every(
          (profileLocations) => profileLocations.length > 0,
        ),
        state.patience,
      ),
    );
  }, [mapReady, state.grid, state.locations, state.scores, state.patience]);

  // Sync category-specific location marker DOM elements with state.locations.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    Object.entries(state.locations).forEach(([profile, profileLocations]) => {
      profileLocations.forEach((location, index) => {
        const el = document.createElement("div");
        el.className = PROFILE_PIN_CLASS[profile as Profile];
        const marker = new Marker({ element: el, draggable: true })
          .setLngLat([location.lon, location.lat])
          .addTo(map);
        marker.on("dragend", () => {
          const lngLat = marker!.getLngLat();
          stateRef.current.updateLocation(profile as Profile, index, {
            lat: lngLat.lat,
            lon: lngLat.lng,
          });
        });
        el.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          stateRef.current.removeLocation(profile as Profile, index);
        });
        markersRef.current.push(marker);
      });
    });
  }, [state.locations]);

  return (
    <>
      <div className="map-frame">
        <div ref={containerRef} className="map-container" />
      </div>
      <WeightControls
        patience={state.patience}
        onPatienceChange={state.setPatience}
        locations={state.locations}
        activeProfile={state.activeProfile}
        onActiveProfileChange={state.setActiveProfile}
        onRemoveLocation={state.removeLocation}
        maxLocations={MAX_LOCATIONS}
      />
      <Legend />
    </>
  );
}
