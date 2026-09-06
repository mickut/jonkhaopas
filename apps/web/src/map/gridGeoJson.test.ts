import { test } from "node:test";
import assert from "node:assert/strict";
import * as h3 from "h3-js";
import {
  applyPatienceCurve,
  normalizedScore,
  patienceGamma,
  percentileRanks,
  scaleDisplayScore,
  smoothRanks,
} from "./gridGeoJson.js";
import type { GridCell } from "../data/types.js";

test("scaleDisplayScore maps the logarithmic domain to the 2-2000 UI range", () => {
  assert.equal(scaleDisplayScore(Math.log1p(2)), 2);
  assert.equal(scaleDisplayScore(Math.log1p(90)), 2000);
  assert.equal(scaleDisplayScore(Infinity), 2000);
  assert.ok(
    scaleDisplayScore(Math.log1p(20)) > 2 &&
      scaleDisplayScore(Math.log1p(20)) < 2000,
  );
});

test("normalizedScore is a fixed [0, 1] mapping, not relative to whatever's currently on screen", () => {
  assert.equal(normalizedScore(Math.log1p(2)), 0);
  assert.equal(normalizedScore(Math.log1p(90)), 1);
  assert.equal(normalizedScore(Infinity), 1);
  // Same raw score must always map to the same normalized position, independent of any other
  // scores passed around it — the whole point is to avoid a per-render adaptive stretch.
  const a = normalizedScore(Math.log1p(20));
  const b = normalizedScore(Math.log1p(20));
  assert.equal(a, b);
  assert.ok(a > 0 && a < 1);
});

test("patienceGamma(0.75) leaves the current curve unchanged", () => {
  assert.equal(patienceGamma(0.75), 1);
});

test("patienceGamma is monotonically decreasing (lower patience = steeper curve = smaller gamma)", () => {
  const g0 = patienceGamma(0);
  const g05 = patienceGamma(0.5);
  const g075 = patienceGamma(0.75);
  const g1 = patienceGamma(1);
  assert.ok(g0 < g05);
  assert.ok(g05 < g075);
  assert.ok(g075 < g1);
});

test("patienceGamma(0) halves the green (rank<=0.3) area versus the baseline curve", () => {
  const gamma = patienceGamma(0);
  // Fraction of ~uniform ranks landing in "green" (rank^gamma <= 0.3) is 0.3^(1/gamma).
  const greenFraction = 0.3 ** (1 / gamma);
  assert.ok(Math.abs(greenFraction - 0.15) < 1e-3);
});

test("patienceGamma clamps out-of-range input", () => {
  assert.equal(patienceGamma(-1), patienceGamma(0));
  assert.equal(patienceGamma(2), patienceGamma(1));
});

test("applyPatienceCurve is a no-op at patience=0.75 and preserves rank order", () => {
  const ranks = Float64Array.from([0, 0.25, 0.5, 0.75, 1]);
  const unchanged = applyPatienceCurve(ranks, 0.75);
  ranks.forEach((r, i) => assert.equal(unchanged[i], r));

  const steeper = applyPatienceCurve(ranks, 0);
  for (let i = 1; i < steeper.length; i++) {
    assert.ok(steeper[i]! >= steeper[i - 1]!);
  }
});

test("percentileRanks spreads a skewed distribution evenly across [0, 1]", () => {
  // Heavily skewed: 9 nearly-identical "good" scores, 1 much worse one — mimics a compact
  // well-served core surrounded by a much larger sparse periphery.
  const scores = Float64Array.from([
    1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 50,
  ]);
  const ranks = percentileRanks(scores);

  assert.equal(ranks[0], 0, "the best score should rank at the very bottom");
  assert.equal(ranks[9], 1, "the worst score should rank at the very top");
  // Ranks should be evenly spaced regardless of how close together the raw values are.
  for (let i = 1; i < 9; i++) {
    assert.ok(
      Math.abs(ranks[i]! - ranks[i - 1]!) > 0,
      "each successive score should get a distinct, evenly-spaced rank",
    );
  }
});

test("percentileRanks is robust to an extreme outlier, unlike a min/max stretch", () => {
  const withoutOutlier = Float64Array.from([1, 2, 3, 4, 5]);
  const withOutlier = Float64Array.from([1, 2, 3, 4, 100000]);
  const ranksWithout = percentileRanks(withoutOutlier);
  const ranksWith = percentileRanks(withOutlier);
  // The relative ranking of the first 4 (non-outlier) values should be unaffected by the outlier.
  for (let i = 0; i < 4; i++) {
    assert.equal(ranksWithout[i], ranksWith[i]);
  }
});

test("percentileRanks treats non-finite scores as the worst rank", () => {
  const scores = Float64Array.from([1, 2, Infinity, 3]);
  const ranks = percentileRanks(scores);
  assert.equal(ranks[2], 1);
});

test("smoothRanks softens a sharp rank jump between neighboring cells without erasing the trend", () => {
  // A real chain of contiguous H3 cells at HSL's resolution (res 8), built by walking outward
  // from a real cell — a "half low, half high" step split down the middle, mimicking a dense
  // homogeneous cluster butting up against a genuinely different area.
  const center = "88089969b3fffff"; // a real cell used elsewhere in this codebase's diagnostics
  const disk = h3.gridDisk(center, 4);
  const grid: GridCell[] = disk.map((cell) => {
    const [lat, lon] = h3.cellToLatLng(cell);
    return { cell, lat, lon, stops: [] };
  });
  const [centerLat, centerLon] = h3.cellToLatLng(center);
  const ranks = new Float64Array(grid.map((c) => (c.lon >= centerLon ? 1 : 0)));

  const smoothed = smoothRanks(grid, ranks);

  // Find the sharpest step in the raw ranks vs. the smoothed ranks across real h3 neighbors.
  const cellToIndex = new Map(grid.map((c, i) => [c.cell, i]));
  function maxNeighborJump(values: Float64Array): number {
    let max = 0;
    for (let i = 0; i < grid.length; i++) {
      for (const n of h3.gridDisk(grid[i]!.cell, 1)) {
        if (n === grid[i]!.cell) continue;
        const j = cellToIndex.get(n);
        if (j === undefined) continue;
        max = Math.max(max, Math.abs(values[i]! - values[j]!));
      }
    }
    return max;
  }

  const rawJump = maxNeighborJump(ranks);
  const smoothedJump = maxNeighborJump(smoothed);
  assert.ok(
    rawJump > smoothedJump,
    "smoothing should reduce the sharpest neighbor jump",
  );
  // The overall low-vs-high trend should still be there — not flattened to a uniform value.
  const minLonIndex = grid.reduce(
    (best, c, i) => (c.lon < grid[best]!.lon ? i : best),
    0,
  );
  const maxLonIndex = grid.reduce(
    (best, c, i) => (c.lon > grid[best]!.lon ? i : best),
    0,
  );
  assert.ok(smoothed[minLonIndex]! < smoothed[maxLonIndex]!);
});
