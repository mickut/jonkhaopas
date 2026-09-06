# Implementation Plan

Follows `.github/copilot-instructions.md` + the instructions/skills it references. Phases are
ordered by dependency; each should end in a runnable/verifiable state.

## Phase 0 — Repo scaffold ✅ done

- `.devcontainer/devcontainer.json`: Node 24 (current LTS) dev container, publishes/forwards Vite
  port 5173, `postCreateCommand` installs deps for both `apps/web` and `tools/gtfs-pipeline`.
- `apps/web`: Vite + React + TS scaffold, strict tsconfig, MapLibre GL JS + OpenFreeMap "liberty"
  style loaded (`src/map/HelsinkiMap.tsx`), centered on Helsinki, no overlay yet.
- `tools/gtfs-pipeline`: Node + TS project scaffold (`package.json`, `tsconfig.json`,
  `src/index.ts` stub), CLI entry point via `npm run build:data` (tsx), streaming CSV reader
  util still TODO for Phase 1.
- `LICENSE` (CC BY 4.0), root `README.md` (setup/run only).
- All commands from here on run inside the dev container (`devcontainer exec ...` or VS Code
  "Reopen in Container") — never on the host.
- Verified: `devcontainer up` builds the container; `npm run build` (apps/web) and
  `npm run typecheck` / `npm run build:data` (tools/gtfs-pipeline) pass inside it; `npm run dev`
  serves the Helsinki map, reachable from the host on the published port 5173.
- Bugfix: map rendered as a blank/empty background with zero vector-tile or glyph requests.
  Root cause: Vite's dependency pre-bundler breaks `maplibre-gl`'s internal web worker (used for
  tile parsing), so tiles/glyphs were silently never fetched. Fixed via
  `optimizeDeps.exclude: ['maplibre-gl']` in `apps/web/vite.config.ts` (+ clearing
  `node_modules/.vite`). Verified via browser network trace: `.pbf` tile and font requests now
  fire and the map renders Helsinki fully.

## Phase 1 — GTFS pipeline: stops, routes, service calendar ✅ done

Per `data-pipeline.instructions.md` + `gtfs-hsl-data` skill:

- Streaming CSV reader (`src/gtfs/csv.ts`, csv-parse) reused by all loaders.
- `src/gtfs/stops.ts`: parses `stops.txt`, derives bbox from the stop distribution (min/max
  lat/lon), `isInBbox` filter.
- `src/gtfs/routes.ts`: parses `routes.txt` (route_id → shortName/type) and `trips.txt`
  (trip_id → routeId/serviceId).
- `src/gtfs/calendar.ts`: parses `calendar.txt` (service_id → weekday flags + date range) and
  `calendar_dates.txt` (exceptions), plus pure `dateToWeekday`/`serviceRunsOnDate` helpers used
  by later phases to resolve a representative week.
- Verified against real data (`npm run build:data` inside the container): 8344 stops (all in the
  derived bbox), 465 routes, 367833 trips, 7276 services, 111 calendar_dates removals, weekday
  classification sample printed correctly.
- Unit tests (`src/gtfs/calendar.test.ts`, Node's built-in `node:test` via `npm test`): 6/6 passing,
  covering weekday resolution, date-range bounds, and both calendar_dates exception types.
- Note: `stop_times.txt` is ~873MB (far larger than initially assumed) — Phase 2 streaming is
  non-negotiable; `trips.txt`/`trips2.txt` are ~33MB each, still loaded fully but via the same
  streaming reader for consistency/memory safety.

## Phase 2 — GTFS pipeline: headways from stop_times ✅ done

- `src/gtfs/dates.ts`: `addDaysToGtfsDate` (month/year-boundary safe) and `parseGtfsTimeToMinutes`
  (handles GTFS past-midnight HH >= 24).
- `src/gtfs/headways.ts`: `pickRepresentativeWeek` (earliest 7-day window from calendar.txt's
  overall start), `classifyServices` (restricts to services overlapping that week, splits into
  weekday/weekend), and `computeStopHeadways` — streams `stop_times.txt` via `readline` + manual
  field-index slicing (not full CSV parsing — safe here since only pre-quoted-field columns
  trip_id/departure_time/stop_id are needed, see code comment) for performance on the ~873MB file.
  Converts per-stop/profile departure counts to average headway minutes via
  `profileWindowMinutes * matchingDayCount / count`.
- `src/index.ts`: orchestrates Phase 1+2, writes `apps/web/public/data/stops.json` (id, lat, lon,
  headway[work, weekdayEvening, weekend], `null` when no eligible departures) and `meta.json`
  (generation timestamp, representative week, bbox, stop count, profile names).
- Verified against real data: full pipeline run (Phase 1+2) completes in ~11.5s; 7871/8344 stops
  got at least one profile headway. Spot-checked a real metro stop (Kivenlahti, route 31M1):
  headway ≈ 5.8 / 9.2 / 9 minutes (work/weekdayEvening/weekend) — plausible single-digit peak
  frequency as required. A very low (<1 min) value also showed up at a major bus-interchange stop
  (Sörnäinen, 20+ converging routes) — traced and confirmed genuine (not a bug): raw stop_times
  rows for that stop_id span many months of the rolling feed, but the low headway is from
  correctly-filtered departures within just the representative week across many routes sharing
  one physical stop_id.
- Unit tests (`src/gtfs/dates.test.ts`, `src/gtfs/headways.test.ts`): 7 new tests (13 total in the
  package), covering date arithmetic, past-midnight time parsing, and representative-week
  selection.

## Phase 3 — GTFS pipeline: spatial grid + walk candidates ✅ done

- `src/gtfs/grid.ts`: `pickResolution` chooses the H3 resolution whose average edge length is
  nearest ~250m, but steps down if the resulting cell count over the bbox would exceed a
  `MAX_CELLS` (40,000) cap — see adjusted-resolution note below. `StopIndex` is a simple uniform
  spatial hash (2km buckets) so nearest-stop lookups per cell don't scan all 8000+ stops.
  `buildGrid` generates H3 cells over the bbox (`h3.polygonToCells`), keeps up to 6 nearest stops
  within a 1.2km/15min walk radius (4.8 km/h) per cell as `[stopIndex, walkMinutes]`, and **omits
  cells with zero reachable stops** (permanently unreachable, not worth shipping).
- `src/index.ts`: writes `apps/web/public/data/grid.json` (array of `{cell, lat, lon, stops}`)
  and extends `meta.json` with grid resolution/edge/cell-count stats.
- Adjusted-resolution note: the Helsinki-region bbox (~90km × 110km, since it's derived from the
  full HSL service area including rural edges) is large enough that the resolved-decision target
  of ~250m edge (H3 res9, ~94k cells) would blow past the file-size budget. `pickResolution`
  auto-stepped down to **res8 (~531m avg edge, 3473 populated cells)** to keep output small —
  this is an intentional, documented deviation from the original "~250m" target, not a bug.
- Verified against real data: full pipeline (Phase 1+2+3) runs in ~12s; `grid.json` ≈ 740KB,
  `stops.json` ≈ 758KB (well under the "low single-digit MB" target). Spot-checked a mid-list
  cell: its 6 candidate stops are all within ~250m of the cell centroid geographically, sorted by
  walk time ascending (1.6–6.7 min) — plausible.
- Unit tests (`src/gtfs/grid.test.ts`): 2 new tests (15 total in the package) — nearest-stop
  ordering/cap and correct omission of cells with no reachable stop, using real `h3-js` over a
  small synthetic bbox.

## Phase 4 — Frontend data loading + Web Worker scoring ✅ done

- `apps/web/src/data/types.ts`: canonical `Stop`/`GridCell`/`Meta`/`Location`/`Weights` types
  matching the pipeline's JSON contract; `apps/web/src/data/loadData.ts`: typed `fetch` loaders
  (`loadStops`/`loadGrid`/`loadMeta`) for `/data/*.json` (served from `public/data`).
- `apps/web/src/worker/cost.ts`: pure, unit-testable implementation of the
  `jonkhakerroin-scoring` cost model — `haversineKm`, `nearestStopIndex` (a location's transit
  access point), `normalizeWeights`, and `computeScores` (per-cell, per-profile min-cost search
  with unbounded weighted aggregation).
- `apps/web/src/worker/protocol.ts` + `scoring.worker.ts`: message-passing Web Worker wrapper
  around `computeScores` (`init` loads stops/grid once, `compute` returns scores by requestId) —
  not yet wired to the UI (that's Phase 5).
- Documented MVP simplifications in code comments (per the scoring skill's stated non-goals):
  flat mode-average speed (20 km/h) for ride-time estimate instead of per-route-type speed, since
  `stops.json` doesn't carry `route_type` — and a same-stop-distance proxy (0.05km threshold) for
  the transfer penalty instead of a shared-route check, since we lack per-stop route membership
  in the pipeline output. Both are reasonable stand-ins and don't block later refinement.
- Tooling: added `tsx`/`node --test` (same pattern as `tools/gtfs-pipeline`) as `apps/web`'s test
  runner via `npm test`; excluded `*.test.ts` from `tsconfig.app.json`'s build include (the app's
  `tsconfig` restricts `types` to `vite/client` only, so Node test-runner globals don't typecheck
  there — tests still run fine via `tsx`, just aren't part of the `tsc -b` production build check).
- Verified: `npm test` — 5/5 passing, including a synthetic fixture confirming a cell near a
  high-frequency stop scores lower (better) than one near an infrequent stop, and that
  profile-specific unreachability (no weekend service) remains unbounded. `npm run build` still
  passes (worker/data modules compile cleanly and are wired into the map UI in Phase
  5).

## Phase 5 — Map overlay + controls ✅ done

- `apps/web/src/map/gridGeoJson.ts`: converts H3 cell indexes to GeoJSON polygon features and
  defines the cool(good) → warm(bad) Jonkhakerroin color ramp.
- `apps/web/src/map/HelsinkiMap.tsx`: adds the grid as one MapLibre GeoJSON fill source/layer,
  updates source data in place after worker results, and adds hover tooltips with raw Jonkhakerroin plus
  the highest-cost profile. Map bounds are applied from `meta.json` after data loads.
- `apps/web/src/state/useJonkhakerroin.ts`: loads static data once, owns selected locations and
  profile weights, starts the module Web Worker, ignores stale result messages, and debounces
  recomputation by 120ms.
- `apps/web/src/ui/{WeightControls,Legend,Attribution}.tsx`: floating weight sliders, score legend,
  and required HSL/OpenStreetMap/OpenFreeMap attribution. Location pins are draggable and capped at
  five; double-clicking a pin removes it.
- Added `h3-js` to `apps/web` so the compact H3 grid artifact can be rendered without shipping
  repeated polygon geometry.
- Destination points are profile-specific: work spots, weekday-evening stops, and weekend spots
  are stored separately, capped at five per category, rendered with distinct pin colors, and sent
  to the scorer under their matching profile only. The controls expose an active category with
  per-category counts and removal actions.
- Jonkhakerroin is presented as a unitless, open-ended metric. The map applies a logarithmic
  `log1p` color domain, and scoring is withheld until work, weekday-evening, and weekend each have
  at least one destination. Category swatches are repeated in the destination overlay so marker
  colors remain legible outside the map.
- The normalized color ramp runs from green (better), through red (worse), to purple (worst or
  unreachable). Duplicate coordinates within one category are deduplicated, so repeated spots at
  the same location do not change that category's score.
- The displayed logarithmic score is rescaled to a practical open-ended UI range: approximately
  2 at the low end, 2000 at the high reference value, and 2000 for unreachable/infinite cells.
- Finite logarithmic scores are min-max normalized over the current grid before coloring, while
  unreachable cells use the purple endpoint. The category scorer uses the minimum cost across
  unique destinations rather than averaging by destination count.
- Browser verification confirmed the empty-state gate, unitless logarithmic legend, and visible
  work-category swatch after placing a destination. Frontend tests remain 6/6 and the production
  build passes.
- Fixed tooltip score parsing so MapLibre-serialized feature properties display the unitless
  Jonkhakerroin reliably. The legend title is now exactly `Jonkhakerroin`; browser verification
  showed `Jonkhakerroin 19.7` with the dominant profile after all three categories were placed.
- Verified in the browser at `http://localhost:5173/`: the 3473-cell overlay renders over the
  basemap, category switching adds independent work/evening/weekend points, and the map container
  remains full viewport after the MapLibre stylesheet loads. `npm test` passes 6/6 and `npm run
  build` passes, including the emitted scoring worker chunk.

## Phase 6 — Polish & compliance ✅ done

- Attribution footer (HSL CC BY 4.0, OSM, OpenFreeMap).
- `prefers-reduced-motion` handling, keyboard operability check on controls.
- README finalized (setup, run pipeline, run dev, build, license note).
- Empty/edge states: zero locations selected (prompt to add one), all-unreachable cells (purple
  worst endpoint, don't show as false "good").
- Finalized root `README.md` with dev-container-only setup, pipeline refresh guidance, frontend
  test/build commands, category-specific destination behavior, score semantics, and attribution.
- Verified keyboard focus styles and active category state for the destination controls;
  `prefers-reduced-motion` disables transitions/animations. Browser verification covered
  empty state, independent category placement, and the full-viewport map layout.
- Fixed two final visual issues: the custom duplicate attribution panel was removed in favor of
  one MapLibre attribution control containing HSL, OpenFreeMap, and OpenStreetMap credits; and
  the initial grid now renders neutral slate cells until at least one destination exists, rather
  than implying every cell is a 90-minute failure.

## Resolved decisions

- Grid: hexagonal (H3), ~250m edge — see `map-visualization` skill.
- GTFS week: pipeline picks a single representative "current" week per run, not a multi-week union.
- Pipeline cadence: manual, on demand (`npm run build:data`) — no CI/scheduled job for MVP.
