---
applyTo: "apps/web/**"
---

# Frontend (apps/web)

## Stack

Vite + React + TypeScript (strict mode), MapLibre GL JS. No CSS framework — hand-rolled CSS
modules. No state library beyond React hooks + context.

## Structure

```
src/
  map/           MapLibre setup, layers, heatmap renderer
  worker/        Web Worker(s) for score computation (never block main thread)
  ui/            controls: location picker, profile weight sliders, legend
  state/         app state (selected locations, weights, computed grid) via context/hooks
  data/          typed loaders for static artifacts from tools/gtfs-pipeline
```

One component per file, named after the component.

## Map & visual design

- Base map: OpenFreeMap "liberty" (or "bright") vector style, dark-mode variant if available;
  otherwise apply a MapLibre style transform for a dark, low-chroma basemap so the heatmap pops.
- Heatmap layer renders precomputed per-cell Jonkhakerroin scores as a colored grid/hexbin
  overlay — low score (good) = cool/green, high score (bad) = warm/red. Use a perceptually
  uniform scale (e.g. viridis/turbo-like), never rainbow-jet with hard banding.
- Smooth transitions when weights/locations change (interpolate layer paint properties, don't
  hard-swap).
- Location picking: click-to-place pins, draggable, removable, max reasonable count (~5) enforced
  in UI with a friendly message.
- Weight controls: three sliders/segmented control for work / weekday-evening / weekend, live
  recompute (debounced) on change.
- Responsive: works on a single viewport, map fills available space, controls overlay as a
  floating panel (not a separate page/route — this is a single view SPA).
- Accessibility: keyboard-operable controls, sufficient contrast, `prefers-reduced-motion`
  respected for transitions.

## Performance

- All scoring math (see jonkhakerroin-scoring skill) runs in a Web Worker over typed arrays.
  Never run the full grid computation on the main thread.
- Static data artifacts (grid geometry, stop index, frequency profiles) are loaded once, cached,
  and shipped as compact binary/JSON (typed-array-friendly), not verbose GeoJSON with repeated
  keys.
- Avoid re-render storms: memoize map layer updates, update MapLibre paint properties directly
  instead of re-mounting layers.

## Attribution

Footer/legend must show: HSL (CC BY 4.0), OpenStreetMap contributors, map style provider. Not
optional — required by the data licenses.
