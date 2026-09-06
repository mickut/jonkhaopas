import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScores, haversineKm, normalizeWeights } from "./cost.js";
import type {
  GridCell,
  ProfileLocations,
  Stop,
  Weights,
} from "../data/types.js";

const EQUAL_WEIGHTS: Weights = { work: 1, weekdayEvening: 1, weekend: 1 };
const NO_LOCATIONS: ProfileLocations = {
  work: [],
  weekdayEvening: [],
  weekend: [],
};

test("haversineKm returns ~0 for identical points and a plausible distance otherwise", () => {
  assert.ok(haversineKm(60.17, 24.94, 60.17, 24.94) < 1e-9);
  // Helsinki to roughly Espoo center, ~10km apart.
  const d = haversineKm(60.1699, 24.9384, 60.2055, 24.6559);
  assert.ok(d > 10 && d < 20);
});

test("normalizeWeights normalizes to sum 1, falls back to equal weights when all zero", () => {
  const [a, b, c] = normalizeWeights({
    work: 2,
    weekdayEvening: 2,
    weekend: 0,
  });
  assert.ok(Math.abs(a + b + c - 1) < 1e-9);
  assert.equal(a, 0.5);
  assert.equal(c, 0);

  const equal = normalizeWeights({ work: 0, weekdayEvening: 0, weekend: 0 });
  assert.deepEqual(equal, [1 / 3, 1 / 3, 1 / 3]);
});

test("computeScores gives a lower score to the cell closer to a high-frequency stop", () => {
  const stops: Stop[] = [
    { id: "frequent", lat: 60.17, lon: 24.94, headway: [5, 10, 10] },
    { id: "infrequent", lat: 60.3, lon: 25.1, headway: [60, 60, 60] },
  ];
  const grid: GridCell[] = [
    { cell: "near", lat: 60.1705, lon: 24.9405, stops: [[0, 1]] }, // 1 min walk to frequent stop
    { cell: "far", lat: 60.301, lon: 25.101, stops: [[1, 1]] }, // 1 min walk to infrequent stop
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    work: [{ lat: 60.17, lon: 24.94 }],
    weekdayEvening: [{ lat: 60.17, lon: 24.94 }],
    weekend: [{ lat: 60.17, lon: 24.94 }],
  }; // right at the frequent stop
  const { scores } = computeScores(stops, grid, locations, EQUAL_WEIGHTS);

  assert.ok(
    scores[0]! < scores[1]!,
    "cell near the frequent stop should score lower (better)",
  );
});

test("computeScores falls back to a walking-time estimate when no candidate stop has service for a profile", () => {
  const stops: Stop[] = [
    { id: "weekday-only", lat: 60.17, lon: 24.94, headway: [10, 10, null] },
  ];
  const grid: GridCell[] = [
    { cell: "a", lat: 60.1701, lon: 24.9401, stops: [[0, 1]] },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    weekend: [{ lat: 60.1701, lon: 24.9401 }], // right at the cell — walk time ~0
  };
  const weekendOnly: Weights = { work: 0, weekdayEvening: 0, weekend: 1 };
  const { scores } = computeScores(stops, grid, locations, weekendOnly);

  assert.ok(
    Number.isFinite(scores[0]) && scores[0]! < Math.log1p(1),
    "no weekend service should fall back to walking distance, not pin to the unreachable cap",
  );
});

test("computeScores' walking fallback still scores a farther destination as worse", () => {
  const stops: Stop[] = [
    { id: "weekday-only", lat: 60.17, lon: 24.94, headway: [10, 10, null] },
  ];
  const grid: GridCell[] = [
    { cell: "near", lat: 60.1701, lon: 24.9401, stops: [[0, 1]] },
    { cell: "far", lat: 60.3, lon: 25.1, stops: [[0, 1]] },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    weekend: [{ lat: 60.1701, lon: 24.9401 }],
  };
  const weekendOnly: Weights = { work: 0, weekdayEvening: 0, weekend: 1 };
  const { scores } = computeScores(stops, grid, locations, weekendOnly);

  assert.ok(
    scores[0]! < scores[1]!,
    "the cell far from the destination should walk-score worse",
  );
});

test("computeScores walks to the nearest stop that actually has service, instead of jumping straight to the destination cost", () => {
  const stops: Stop[] = [
    // No weekend service anywhere nearby the cell...
    { id: "weekday-only", lat: 60.17, lon: 24.94, headway: [10, 10, null] },
    // ...but a weekend-served stop exists a short, unrelated walk away.
    { id: "weekend-served", lat: 60.171, lon: 24.94, headway: [10, 10, 20] },
  ];
  const grid: GridCell[] = [
    { cell: "a", lat: 60.1701, lon: 24.9401, stops: [[0, 1]] },
  ];
  // Destination is far away — if the model fell back to walking straight there, the cost would
  // be huge; walking the short distance to the weekend-served stop should win instead.
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    weekend: [{ lat: 60.5, lon: 25.5 }],
  };
  const weekendOnly: Weights = { work: 0, weekdayEvening: 0, weekend: 1 };
  const { profileCosts } = computeScores(stops, grid, locations, weekendOnly);

  // Walking ~100m to the weekend-served stop + wait/ride/transfer should stay well under the
  // "walk all the way to a destination ~50km away" cost.
  assert.ok(
    profileCosts[2]! < 30,
    "should walk a short distance to reach service, not jump to the far-destination cost",
  );
});

test("computeScores' walk-to-service cost increases with distance to the nearest serviced stop", () => {
  const closeService: Stop[] = [
    { id: "weekday-only", lat: 60.17, lon: 24.94, headway: [10, 10, null] },
    {
      id: "weekend-served-close",
      lat: 60.171,
      lon: 24.94,
      headway: [10, 10, 20],
    },
  ];
  const farService: Stop[] = [
    { id: "weekday-only", lat: 60.17, lon: 24.94, headway: [10, 10, null] },
    { id: "weekend-served-far", lat: 60.19, lon: 24.94, headway: [10, 10, 20] },
  ];
  const grid: GridCell[] = [
    { cell: "a", lat: 60.1701, lon: 24.9401, stops: [[0, 1]] },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    weekend: [{ lat: 60.5, lon: 25.5 }],
  };
  const weekendOnly: Weights = { work: 0, weekdayEvening: 0, weekend: 1 };
  const closeCost = computeScores(closeService, grid, locations, weekendOnly)
    .profileCosts[2]!;
  const farCost = computeScores(farService, grid, locations, weekendOnly)
    .profileCosts[2]!;

  assert.ok(
    closeCost < farCost,
    "a farther-away serviced stop should cost proportionally more, not the same",
  );
});

test("computeScores prefers walking over waiting for a very infrequent stop right next to the destination", () => {
  const stops: Stop[] = [
    // Runs for every profile, but only once every 7.5 hours — not worth waiting for when you're
    // basically standing at the destination already.
    { id: "rare", lat: 60.17, lon: 24.94, headway: [450, 450, 450] },
  ];
  const grid: GridCell[] = [
    { cell: "at-destination", lat: 60.1701, lon: 24.9401, stops: [[0, 1]] },
  ];
  const locations: ProfileLocations = {
    work: [{ lat: 60.17, lon: 24.94 }],
    weekdayEvening: [{ lat: 60.17, lon: 24.94 }],
    weekend: [{ lat: 60.17, lon: 24.94 }],
  };
  const { profileCosts } = computeScores(stops, grid, locations, EQUAL_WEIGHTS);

  // Waiting for the 450min headway alone would cost 225min (well past the walking estimate for
  // ~11m); the cell should score like a short walk, not like a barely-reachable transit trip.
  assert.ok(
    profileCosts[0]! < 5,
    "should walk instead of waiting for the rare service",
  );
});

test("computeScores walks a bit further to a genuinely useful stop instead of settling for a nearer near-useless one", () => {
  const stops: Stop[] = [
    // Several stops right next to the cell, but weekend service is barely usable (900min = 15h).
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `barely-served-${i}`,
      lat: 60.17 + i * 0.0002,
      lon: 24.94,
      headway: [5, 5, 900] as (number | null)[],
    })),
    // A short walk further, but a genuinely frequent weekend service.
    { id: "well-served", lat: 60.171, lon: 24.94, headway: [5, 5, 11] },
  ];
  const grid: GridCell[] = [
    // Precomputed candidates (mirrors a real cell.json entry) only include the near ones — the
    // well-served stop is only reachable via the worker's wider bestAccess search, not locally.
    {
      cell: "a",
      lat: 60.1701,
      lon: 24.9401,
      stops: [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    weekend: [{ lat: 60.5, lon: 25.5 }], // far away, so a walk-to-destination fallback loses
  };
  const weekendOnly: Weights = { work: 0, weekdayEvening: 0, weekend: 1 };
  const { profileCosts } = computeScores(stops, grid, locations, weekendOnly);

  // A 900min headway alone costs 450min waiting; walking the extra ~100m to the 11min-headway
  // stop plus its ~5.5min wait should easily beat that.
  assert.ok(
    profileCosts[2]! < 30,
    "should walk to the well-served stop instead of settling for the barely-served ones",
  );
});

test("computeScores returns Infinity for every cell when no locations are selected", () => {
  const stops: Stop[] = [
    { id: "s", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
  ];
  const grid: GridCell[] = [
    { cell: "a", lat: 60.17, lon: 24.94, stops: [[0, 1]] },
  ];
  const { scores } = computeScores(stops, grid, NO_LOCATIONS, EQUAL_WEIGHTS);
  assert.deepEqual(Array.from(scores), [Infinity]);
});

test("computeScores clamps a pathologically long ride instead of letting it dominate the scale", () => {
  const stops: Stop[] = [
    { id: "near", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
    { id: "far", lat: 61.5, lon: 27.0, headway: [5, 5, 5] }, // ~250km away
  ];
  const grid: GridCell[] = [
    { cell: "far-cell", lat: 61.501, lon: 27.001, stops: [[1, 1]] },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    work: [{ lat: 60.17, lon: 24.94 }],
  };
  const workOnly: Weights = { work: 1, weekdayEvening: 0, weekend: 0 };
  const { profileCosts } = computeScores(stops, grid, locations, workOnly);
  // Soft-capped: bounded below the asymptote, but not flattened to one identical value.
  assert.ok(profileCosts[0]! > 60 && profileCosts[0]! < 90);
});

test("computeScores keeps longer rides gradually worse instead of pinning them all to the same cap", () => {
  const stops: Stop[] = [
    { id: "near", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
    { id: "mid", lat: 60.6, lon: 25.3, headway: [5, 5, 5] }, // ~50km away
    { id: "far", lat: 61.5, lon: 27.0, headway: [5, 5, 5] }, // ~250km away
  ];
  const grid: GridCell[] = [
    { cell: "mid-cell", lat: 60.601, lon: 25.301, stops: [[1, 1]] },
    { cell: "far-cell", lat: 61.501, lon: 27.001, stops: [[2, 1]] },
  ];
  const locations: ProfileLocations = {
    ...NO_LOCATIONS,
    work: [{ lat: 60.17, lon: 24.94 }],
  };
  const workOnly: Weights = { work: 1, weekdayEvening: 0, weekend: 0 };
  const { profileCosts } = computeScores(stops, grid, locations, workOnly);
  assert.ok(
    profileCosts[0]! < profileCosts[3]!,
    "a much longer ride should still score worse, not tie with the shorter far ride",
  );
});

test("computeScores keeps each profile tied to its own destinations", () => {
  const stops: Stop[] = [
    { id: "work-stop", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
    { id: "weekend-stop", lat: 60.3, lon: 25.1, headway: [5, 5, 5] },
  ];
  const grid: GridCell[] = [
    { cell: "work-cell", lat: 60.17, lon: 24.94, stops: [[0, 1]] },
    { cell: "weekend-cell", lat: 60.3, lon: 25.1, stops: [[1, 1]] },
  ];
  const locations: ProfileLocations = {
    work: [{ lat: 60.17, lon: 24.94 }],
    weekdayEvening: [],
    weekend: [{ lat: 60.3, lon: 25.1 }],
  };
  const { profileCosts } = computeScores(stops, grid, locations, EQUAL_WEIGHTS);

  assert.ok(profileCosts[0]! < profileCosts[1]!);
  assert.ok(profileCosts[5]! < profileCosts[2]!);
});

test("duplicate destinations in one profile do not change the score", () => {
  const stops: Stop[] = [
    { id: "s", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
  ];
  const grid: GridCell[] = [
    { cell: "a", lat: 60.17, lon: 24.94, stops: [[0, 1]] },
  ];
  const location = { lat: 60.17, lon: 24.94 };
  const oneEach: ProfileLocations = {
    work: [location],
    weekdayEvening: [location],
    weekend: [location],
  };
  const duplicateWork: ProfileLocations = {
    work: [location, location, location],
    weekdayEvening: [location],
    weekend: [location],
  };

  const oneScore = computeScores(stops, grid, oneEach, EQUAL_WEIGHTS).scores[0];
  const duplicateScore = computeScores(
    stops,
    grid,
    duplicateWork,
    EQUAL_WEIGHTS,
  ).scores[0];
  assert.equal(duplicateScore, oneScore);
});
