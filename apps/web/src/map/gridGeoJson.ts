import * as h3 from "h3-js";
import type { GridCell } from "../data/types.js";

/** Normalized score ramp: better is green, worse is red, unreachable is purple. */
export const SCORE_COLOR_STOPS: [number, string][] = [
  [0, "#1a9850"],
  [0.3, "#a6d96a"],
  [0.5, "#fdae61"],
  [0.7, "#d73027"],
  [0.85, "#762a83"],
  [1, "#542788"],
];

const DISPLAY_SCORE_MIN = 2;
const DISPLAY_SCORE_MAX = 2000;
/** Anchored to cost.ts's realistic min (~2min best case) and UNREACHABLE_COST_MINUTES (90) cap,
 * so the full color ramp is used instead of being crammed into a sliver near the low end. */
const LOG_SCORE_MIN = Math.log1p(2);
const LOG_SCORE_MAX = Math.log1p(90);

export function scaleDisplayScore(logScore: number): number {
  if (!Number.isFinite(logScore)) return DISPLAY_SCORE_MAX;
  const normalized =
    (logScore - LOG_SCORE_MIN) / (LOG_SCORE_MAX - LOG_SCORE_MIN);
  const scaled = DISPLAY_SCORE_MIN * 1000 ** normalized;
  return Math.min(DISPLAY_SCORE_MAX, Math.max(DISPLAY_SCORE_MIN, scaled));
}

/** Maps a raw log score to a fixed [0, 1] position on the color ramp, anchored to the same
 * LOG_SCORE_MIN/MAX as scaleDisplayScore — deliberately NOT relative to whichever scores happen
 * to be on screen. A per-render min/max stretch would make the same real cost difference look
 * more or less "sharp" depending on the current achievable range (e.g. adding a second, farther
 * destination profile narrows that range and falsely amplifies ordinary local frequency cliffs
 * into looking like stark color boundaries). */
export function normalizedScore(logScore: number): number {
  if (!Number.isFinite(logScore)) return 1;
  const normalized =
    (logScore - LOG_SCORE_MIN) / (LOG_SCORE_MAX - LOG_SCORE_MIN);
  return Math.min(1, Math.max(0, normalized));
}

/** Percentile rank (0-1) of each score among the CURRENT set of finite scores — for fill color
 * only, never the tooltip value (that stays scaleDisplayScore's fixed, meaningful minute figure).
 * Real HSL connectivity data is often heavily skewed (a compact well-served urban core vs. a much
 * larger, sparser periphery), so normalizedScore's fixed linear scale crams the majority of cells
 * into one or two color stops — the map then looks like a solid-color block with a hard edge at
 * the urban/rural boundary, even though the underlying scores step smoothly cell to cell. Rank
 * guarantees the full color ramp is used in proportion to how the data actually spreads out.
 * Unlike a min/max stretch (which a single extreme outlier can distort, see follow-up #4 in repo
 * memory), rank is robust to outliers — one point moving to a more extreme value barely changes
 * anyone else's rank. */
export function percentileRanks(scores: Float64Array): Float64Array {
  const finiteIndices: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (Number.isFinite(scores[i])) finiteIndices.push(i);
  }
  finiteIndices.sort((a, b) => scores[a]! - scores[b]!);
  const ranks = new Float64Array(scores.length).fill(1);
  const denom = finiteIndices.length - 1;
  finiteIndices.forEach((index, order) => {
    ranks[index] = denom > 0 ? order / denom : 0;
  });
  return ranks;
}

/** Ring-2 (~1km) neighbor indices per cell, cached per `grid` array — it's static, computed once
 * and reused across every recompute instead of rebuilding h3.gridDisk + the cell lookup map. */
const ring2NeighborCache = new WeakMap<GridCell[], number[][]>();

function ring2NeighborIndices(grid: GridCell[]): number[][] {
  const cached = ring2NeighborCache.get(grid);
  if (cached) return cached;
  const cellToIndex = new Map(grid.map((cell, i) => [cell.cell, i]));
  const neighbors = grid.map((cell) =>
    h3
      .gridDisk(cell.cell, 2)
      .map((n) => cellToIndex.get(n))
      .filter((i): i is number => i !== undefined),
  );
  ring2NeighborCache.set(grid, neighbors);
  return neighbors;
}

/** Smooths percentile ranks by averaging each cell with its ring-2 neighbors, twice. This exists
 * purely to fix a visual artifact of percentileRanks: when a large, genuinely-homogeneous area
 * (e.g. a broad rural region with uniformly poor evening/weekend service) borders a genuinely
 * different one, a small REAL difference in raw score can straddle a density spike in the sorted
 * distribution and produce an outsized RANK jump — even though normalizedScore confirms the
 * underlying data changes smoothly cell to cell. Spatial smoothing spreads that transition over a
 * couple of hex-widths instead of concentrating it at a single cell boundary, without touching
 * the underlying score computation or the tooltip's absolute value. */
export function smoothRanks(
  grid: GridCell[],
  ranks: Float64Array,
): Float64Array {
  const neighborIndices = ring2NeighborIndices(grid);
  let current = ranks;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(current.length);
    for (let i = 0; i < grid.length; i++) {
      const neighbors = neighborIndices[i]!;
      let sum = 0;
      for (const j of neighbors) sum += current[j]!;
      next[i] = neighbors.length > 0 ? sum / neighbors.length : current[i]!;
    }
    current = next;
  }
  return current;
}

/** Traveler patience (0-1, see WeightControls) controls how steep the score-to-color curve is,
 * applied as a gamma exponent on top of the (already smoothed) percentile rank: color = rank^gamma.
 * This is a pure color-warp, not a change to the underlying cost model — it's monotonic, so it
 * can't reintroduce the sharp-jump bugs percentileRanks/smoothRanks fix (order is preserved).
 * PATIENCE_BASELINE=0.75 is "the current curve" (gamma=1, untouched ranks). STEEPEST_GAMMA is
 * calibrated so patience=0 halves the green (rank<=0.3) map area versus that baseline: since rank
 * is ~uniform on [0,1], the green-area fraction after warping is 0.3^(1/gamma); solving
 * 0.3^(1/gamma) = 0.15 (half of the baseline's 0.3) gives gamma ≈ 0.635. */
const PATIENCE_BASELINE = 0.75;
const STEEPEST_GAMMA = 0.635;

export function patienceGamma(patience: number): number {
  const clamped = Math.min(1, Math.max(0, patience));
  return STEEPEST_GAMMA ** (1 - clamped / PATIENCE_BASELINE);
}

/** Applies the traveler-patience curve to (smoothed) percentile ranks for fill color. */
export function applyPatienceCurve(
  ranks: Float64Array,
  patience: number,
): Float64Array {
  const gamma = patienceGamma(patience);
  const warped = new Float64Array(ranks.length);
  for (let i = 0; i < ranks.length; i++) {
    warped[i] = ranks[i]! ** gamma;
  }
  return warped;
}

export type GridCellFeature = {
  type: "Feature";
  properties: { index: number; score: number | null; rawScore: number | null };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};
export type GridFeatureCollection = {
  type: "FeatureCollection";
  features: GridCellFeature[];
};

export function buildGridGeoJson(grid: GridCell[]): GridFeatureCollection {
  return {
    type: "FeatureCollection",
    features: grid.map((cell, index): GridCellFeature => {
      const boundary = h3.cellToBoundary(cell.cell, true); // [lng, lat] pairs (GeoJSON order)
      const ring = [...boundary, boundary[0]!];
      return {
        type: "Feature",
        properties: { index, score: null, rawScore: null },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    }),
  };
}
