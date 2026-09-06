---
name: map-visualization
description: MapLibre GL vector-tile setup, dark basemap, and heatmap/grid rendering for the Jonkhakerroin score. Use when touching src/map in apps/web.
---

# Map visualization

## Base map

- MapLibre GL JS, vector tiles from OpenFreeMap (`https://tiles.openfreemap.org/styles/...`) —
  no API key required, self-hostable fallback if needed.
- Prefer a dark/muted style (OpenFreeMap "dark" if available, else "liberty"/"bright" with a
  MapLibre style-spec paint override: desaturate land/water fills, dim label halos) so the score
  overlay is the visual focus.
- Center on Helsinki (`60.1699, 24.9384`), constrain `maxBounds`/`minZoom` to the region bbox used
  by the pipeline (see gtfs-hsl-data skill) so users can't pan into empty precomputed-data areas.

## Score overlay

- Grid is H3 hexagons, ~250m edge (see jonkhakerroin-scoring/data-pipeline). Render precomputed
  cells as a MapLibre `fill` layer of hexagon polygons — not a raster heatmap blur, so scores stay
  spatially precise and inspectable.
- Color scale: perceptually uniform sequential palette (e.g. a turbo/viridis-like ramp), low
  (good) → cool color, high (bad) → warm color. Define the ramp as a `[value, color]` stop array
  driving `fill-color` via `interpolate`.
- Normalize the raw log score to `[0, 1]` for the **tooltip's** absolute display value with a
  **fixed** mapping (`gridGeoJson.ts`'s `normalizedScore`, anchored to the cost model's own
  min/asymptote) — not a per-render min/max stretch over whatever's currently on screen. An
  adaptive stretch makes the same real cost difference look more or less "sharp" depending on the
  current achievable score range — e.g. weighting in a second, farther destination profile
  narrows that range and falsely amplifies an ordinary local frequency cliff into what looks like
  a stark purple boundary.
- For the **fill color** specifically, use `percentileRanks` (rank within the current finite
  scores, not `normalizedScore`) instead. HSL connectivity data is often heavily skewed — a
  compact well-served urban core vs. a much larger, sparser periphery — so `normalizedScore`'s
  fixed linear scale crams the majority of cells into one or two color stops: the map then reads
  as a solid-color block with a hard edge at the urban/rural boundary, even though the underlying
  scores step smoothly cell to cell (verify with a whole-grid histogram in normalized-score space
  before assuming a "sharp boundary" report means an actual data discontinuity — it may just mean
  the color ramp is a poor visual fit for how the data is distributed). Percentile rank is _not_
  the same "attractive nuisance" as a min/max stretch: it's robust to outliers (one extreme point
  barely moves anyone else's rank) and guarantees the full ramp is used in proportion to the
  actual distribution, at the cost of the color (not the tooltip number) being relative to
  what's currently computed — an explicit, deliberate tradeoff for visual legibility only.
- `smoothRanks` (ring-2 H3-neighbor averaging, 2 passes) then softens density-spike rank jumps,
  and finally `applyPatienceCurve` (a `rank ** gamma` power-warp, see `patienceGamma` in
  `gridGeoJson.ts`) applies the user's "traveler patience" slider on top: `patience=0.75` is a
  no-op (gamma=1); lower patience → smaller gamma → steeper curve → smaller green/good area. This
  is purely a color transform — it's monotonic (preserves rank order) and never touches the
  underlying cost computation, so it can't reintroduce the sharp-jump bugs rank-smoothing fixes.
- Cell opacity ~0.6–0.75 so the basemap street/rail context stays visible underneath.
- Update via `map.setPaintProperty` on recompute — never remove/re-add the layer per change.
- Hover/tap tooltip shows raw minutes value + which profile dominates the score.

## Pins & controls

- User location pins as a MapLibre `symbol`/marker layer, draggable, with a subtle drop-shadow and
  color distinct from the score ramp.
- Floating control panel (glassmorphism-lite: translucent dark panel, blur backdrop) over the map,
  not a separate layout region — keep the single-view feel.
- Legend is always visible, compact, shows the color ramp with min/max minute labels.

## Performance

- Grid layer built once from precomputed GeoJSON/vector source; only paint properties change on
  recompute, not the source data (unless the grid itself changes, which it shouldn't at runtime).
- Debounce recompute-triggered repaint to animation frames, not every slider tick.
