import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGrid, type GridStop } from "./grid.js";
import type { Bbox } from "./stops.js";

// A small bbox around central Helsinki so h3-js only has to generate a handful of cells.
const tinyBbox: Bbox = {
  minLat: 60.15,
  maxLat: 60.19,
  minLon: 24.9,
  maxLon: 24.98,
};

test("buildGrid assigns the nearest stop first, for cells that have one in range", () => {
  const stops: GridStop[] = [
    { id: "near", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
    { id: "far", lat: 61.5, lon: 26.5, headway: [5, 5, 5] }, // far outside the bbox, never a candidate
  ];
  const { cells, resolution, edgeMeters } = buildGrid(tinyBbox, stops);

  assert.ok(cells.length > 0, "expected at least one populated cell");
  assert.ok(resolution >= 5 && resolution <= 10);
  assert.ok(edgeMeters > 0);

  for (const cell of cells) {
    // Cells beyond the walk radius but within the inclusion buffer are still shipped (with an
    // empty candidate list) for smooth degradation near real coastlines/islands — see buildGrid.
    if (cell.stops.length === 0) continue;
    const [nearestIndex, walkMinutes] = cell.stops[0]!;
    assert.equal(
      nearestIndex,
      0,
      'the only in-range stop should be index 0 ("near")',
    );
    assert.ok(walkMinutes >= 0 && walkMinutes <= 25);
  }
});

test("buildGrid produces no cells when no stop is within the inclusion buffer", () => {
  const stops: GridStop[] = [
    { id: "far", lat: 61.5, lon: 26.5, headway: [5, 5, 5] },
  ];
  const { cells } = buildGrid(tinyBbox, stops);
  assert.equal(cells.length, 0);
});

test("buildGrid excludes cells far out in open sea even when the raw bbox extends that far", () => {
  // A single distant outlier stop (e.g. a remote archipelago ferry stop) makes computeBbox's
  // rectangle span a lot of empty sea between it and the rest of the network — buildGrid must
  // not ship every cell in that rectangle just because it's technically within the bbox.
  const wideBbox: Bbox = { minLat: 60.1, maxLat: 60.5, minLon: 24.9, maxLon: 25.5 };
  const stops: GridStop[] = [
    { id: "mainland", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
    { id: "remote-outlier", lat: 60.5, lon: 25.5, headway: [5, 5, 5] },
  ];
  const { cells } = buildGrid(wideBbox, stops);
  const midSeaCell = cells.find(
    (cell) =>
      Math.abs(cell.lat - 60.33) < 0.02 && Math.abs(cell.lon - 25.2) < 0.02,
  );
  assert.equal(
    midSeaCell,
    undefined,
    "a cell roughly midway between the two far-apart stops should be excluded, not shipped empty",
  );
});

test("buildGrid excludes a cell fully reported as water, even right next to a stop", () => {
  const stops: GridStop[] = [
    { id: "near", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
  ];
  const allWater = { isFullyInWater: () => true };
  const { cells } = buildGrid(tinyBbox, stops, allWater);
  assert.equal(
    cells.length,
    0,
    "swimming isn't a transport strategy — no cell should ship if it's fully water, regardless of nearby service",
  );
});

test("buildGrid keeps a cell only partially in water (e.g. touching the coast)", () => {
  const stops: GridStop[] = [
    { id: "near", lat: 60.17, lon: 24.94, headway: [5, 5, 5] },
  ];
  const partiallyWater = { isFullyInWater: () => false };
  const { cells } = buildGrid(tinyBbox, stops, partiallyWater);
  assert.ok(
    cells.length > 0,
    "a cell that's only partly water (not fully submerged) should still ship",
  );
});

test("buildGrid finds an in-range stop offset mostly east-west, not just north-south", () => {
  // At HSL's ~60N latitude, longitude degrees are ~half as wide in real distance as latitude
  // degrees (compressed by cos(lat)) — a spatial bucket sized for latitude alone silently drops
  // stops offset mostly east-west even when they're well within the walk radius.
  const origin = { lat: 60.17, lon: 24.94 };
  const eastOffsetDeg = 1.8 / (111.32 * Math.cos((origin.lat * Math.PI) / 180)); // ~1.8km east
  const stops: GridStop[] = [
    { id: "origin", ...origin, headway: [5, 5, 5] },
    {
      id: "east",
      lat: origin.lat,
      lon: origin.lon + eastOffsetDeg,
      headway: [5, 5, 5],
    },
  ];
  const { cells } = buildGrid(tinyBbox, stops);
  const includesEastStop = cells.some((cell) =>
    cell.stops.some(([stopIndex]) => stops[stopIndex]!.id === "east"),
  );
  assert.ok(
    includesEastStop,
    "a stop ~1.8km away purely east-west should be within the 2km walk radius",
  );
});

test("buildGrid includes more than 6 candidates per cell when that many stops are in range", () => {
  // 20 stops clustered right at the cell center — all well within walking range.
  const stops: GridStop[] = Array.from({ length: 20 }, (_, i) => ({
    id: `stop-${i}`,
    lat: 60.17 + i * 0.0001,
    lon: 24.94,
    headway: [5, 5, 5],
  }));
  const { cells } = buildGrid(tinyBbox, stops);
  const cell = cells.find((c) => c.stops.length > 0);
  assert.ok(cell, "expected at least one populated cell");
  assert.ok(
    cell!.stops.length > 6,
    "candidate list should not be capped at the old limit of 6",
  );
});

test("buildGrid keeps a weekend-served stop as a candidate even when many closer stops lack weekend service", () => {
  const stops: GridStop[] = [
    // 12 stops closer than the weekend-served one, none of them running weekends.
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `weekday-only-${i}`,
      lat: 60.17 + i * 0.0001,
      lon: 24.94,
      headway: [5, 5, null] as (number | null)[],
    })),
    // Farther away, but the only stop that actually runs on weekends.
    { id: "weekend-served", lat: 60.1715, lon: 24.94, headway: [5, 5, 5] },
  ];
  const { cells } = buildGrid(tinyBbox, stops);
  const cell = cells.find((c) => c.stops.length > 0);
  assert.ok(cell, "expected at least one populated cell");
  const includesWeekendStop = cell!.stops.some(
    ([stopIndex]) => stops[stopIndex]!.id === "weekend-served",
  );
  assert.ok(
    includesWeekendStop,
    "the only weekend-served stop should not be crowded out by closer weekday-only stops",
  );
});

test("buildGrid prefers a much-better-frequency stop over several closer near-useless ones", () => {
  const stops: GridStop[] = [
    // 5 closer stops that technically have weekend service, but a 900min headway is barely
    // usable — nearest-by-distance selection alone would fill all the profile slots with these.
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `barely-served-${i}`,
      lat: 60.17 + i * 0.0001,
      lon: 24.94,
      headway: [5, 5, 900] as (number | null)[],
    })),
    // Farther away, but a genuinely frequent weekend service.
    { id: "well-served", lat: 60.1706, lon: 24.94, headway: [5, 5, 11] },
  ];
  const { cells } = buildGrid(tinyBbox, stops);
  const cell = cells.find((c) => c.stops.length > 0);
  assert.ok(cell, "expected at least one populated cell");
  const includesWellServedStop = cell!.stops.some(
    ([stopIndex]) => stops[stopIndex]!.id === "well-served",
  );
  assert.ok(
    includesWellServedStop,
    "a far-but-frequent stop should not be crowded out by several near-but-barely-usable ones",
  );
});
