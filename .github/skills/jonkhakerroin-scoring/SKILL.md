---
name: jonkhakerroin-scoring
description: The Jonkhakerroin connectivity-score algorithm — time profiles, generalized-cost model, grid aggregation, weighting. Use when implementing or modifying score computation, the grid/stop data contract, or the weighting UI.
---

# Jonkhakerroin scoring

"Jonkhakerroin" = a generalized-cost accessibility score per grid cell, relative to the user's
selected location(s). **Lower is better.** MVP is an accessibility _proxy_, not full multimodal
routing (no OTP/R5 dependency) — this is a deliberate scope decision to keep the app a static SPA.

## Time profiles

Three fixed profiles, each with its own per-stop headway computed by the pipeline:

- `work`: Mon–Fri, 06:00–09:00 and 15:00–18:00 (commute peaks)
- `weekdayEvening`: Mon–Fri, 18:00–24:00
- `weekend`: Sat–Sun, all day (09:00–24:00)

User assigns a weight (0–1, normalized to sum 1) to each profile via UI sliders; final cell score
is the weighted sum of the three per-profile cell scores.

Weights are FIXED constants, not user-adjustable (`FIXED_WEIGHTS` in
`apps/web/src/state/useJonkhakerroin.ts`): `work=0.6`, `weekdayEvening=0.4`, `weekend=0.2`. The UI
instead exposes a single "traveler patience" slider (0–1) that controls color-ramp steepness (a
gamma-warp applied to percentile rank, see the map-visualization skill) — it does not change the
underlying cost computation at all.

## Per-profile cell score (generalized cost, minutes)

For a grid cell `c` and a selected location `L`:

```
cost(c, L, profile) = min over nearby stops s of:
    walk(c, s) + wait(s, profile) + rideEstimate(s, L, profile) + transferPenalty
```

- `walk(c, s)`: walking minutes from cell centroid to stop `s` (precomputed, capped at ~25 min
  radius; stops beyond that are not candidates for that cell).
- `wait(s, profile)`: half the average headway at `s` for that profile (standard wait-time proxy).
- `rideEstimate(s, L, profile)`: straight-line distance from `s` to nearest stop of `L`, divided by
  a mode-average speed constant (tram/bus ~20 km/h, metro/rail ~35 km/h effective incl. stops) —
  a heuristic stand-in for real in-vehicle+transfer time. Use the faster of available line types
  serving `s` if known from `routes.txt`.
- `transferPenalty`: flat constant (e.g. 5 min) added once per profile if `rideEstimate` implies
  a mode change is likely (i.e. `s` and nearest stop of `L` aren't on a shared route) — approximate,
  not schedule-exact.
- `cost(c, L, profile)` is always the minimum of three options, so a local service gap costs
  proportionally more with distance instead of jumping straight to "unreachable":
  1. the transit-based formula above, using `c`'s precomputed candidate stops that serve `profile`;
  2. walking from `c` to whichever nearby stop gives the **best walk+wait access** for `profile`
     (not limited to `c`'s precomputed candidates, and not just the nearest-with-any-service —
     ranked by access cost, see below), then transit from there. This is what actually kicks in
     when a cell's local candidates lack the profile's service, or only have near-useless service
     (e.g. a 900min headway technically isn't "no service" but is bad enough that walking further
     to an 11min-headway stop wins); cost scales with real walking distance to a genuinely useful
     stop, not with distance to `L`, and not with however bad the nearest-by-distance option is;
  3. walking from `c` straight to `L` (same walk-speed constant as `walk(c, s)`) — wins when `L`
     is already close and no reasonably nearby stop is worth the wait, or no stop anywhere serves
     `profile` at all.
     Option 2's search (`worker/cost.ts`'s `NearestStopIndex.bestAccess`) is a pure function of cell
     position + stop/headway data — independent of `L`/weights — so it's precomputed once per
     (stops, grid) pair and cached (`bestAccessByCellAndProfile`), not recomputed on every
     recompute. The first-ever score after loading data pays this cost (currently ~0.5s for the full
     HSL grid); every later recompute (dragging a pin, moving a weight slider) is a cache hit.
- Bound each profile's cost with a smooth saturating curve (`cap * tanh(cost / knee)`, cap =
  `UNREACHABLE_COST_MINUTES` = 90, knee = `COST_SOFTNESS_MINUTES` = 200) rather than a hard clamp —
  the wider knee keeps long rides and sparse-schedule cells (including the walking cases above)
  gradually distinguishable across the whole realistic range instead of bunching near the cap. The
  only case left mapping to literal `Infinity` (pinning exactly to the cap) is a weighted profile
  with zero destinations picked for it yet — there's nothing to compute a distance to.

With multiple selected locations, use the **best (minimum)** cost to any one of them per profile —
the score answers "how well connected is this cell to at least one of my places".

## Aggregation into final Jonkhakerroin

```
jonkhakerroin(c) = sum(weight[p] * cost(c, L*, p) for p in profiles)
```

Normalize/clip for color scale display (see map-visualization skill) but keep the raw minute value
available in a tooltip — the number should be meaningful ("~22 min"), not just a color.

## Where this runs

- Steps that depend only on the GTFS feed (headways, stop→stop distances/candidates, walk times)
  are precomputed by `tools/gtfs-pipeline` (see its instructions file) into `stops.json`/`grid.json`,
  from one representative week of the feed (rebuilt manually via `npm run build:data` whenever
  `data/hsl/` is refreshed — not a live/scheduled job).
- Steps that depend on user-selected `L` (the min-cost search per cell, weighting) run client-side
  in a Web Worker over the precomputed arrays — this must be fast enough for interactive sliders
  (target: recompute full grid in <200ms for a metro-area-sized grid).

## Non-goals (MVP)

- No real-time/live vehicle data.
- No exact scheduled itinerary routing (no transfers-at-specific-times simulation).
- No fare/cost dimension (fare files present in GTFS but out of scope).
