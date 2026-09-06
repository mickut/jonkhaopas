import * as h3 from "h3-js";
import type { Bbox } from "./stops.js";
import { PROFILES } from "./headways.js";

export type WaterIndex = { isWater(lat: number, lon: number): boolean };

const TARGET_EDGE_METERS = 250;
/** Hard cap on total cell count so grid.json stays a "low single-digit MB" client fetch. */
const MAX_CELLS = 40_000;
const WALK_SPEED_KMH = 4.8;
const MAX_WALK_MINUTES = 25;
const MAX_WALK_KM = (WALK_SPEED_KMH * MAX_WALK_MINUTES) / 60;
/** Cells farther than this from every stop are skipped entirely, even though the raw bbox (see
 * stops.ts computeBbox) is a rectangle over the full HSL stop distribution and can span open sea
 * far beyond any real coastline or island. Bigger than MAX_WALK_KM so real coastal/archipelago
 * transitions still degrade smoothly (see the empty-candidate-list comment in buildGrid below). */
const CELL_INCLUSION_BUFFER_KM = MAX_WALK_KM * 2;
/** Search pool before profile-aware selection narrows it down (see pickCandidates). */
const CANDIDATE_POOL_SIZE = 60;
/** How many purely-nearest-overall stops to always keep, regardless of profile service. */
const OVERALL_CANDIDATES = 10;
/** How many best-access-cost (walk+wait) stops to guarantee per profile, ranked by usefulness —
 * not just distance. Without this, a cluster of closer-but-near-useless stops (e.g. a 900min
 * headway) can crowd every genuinely useful stop for a profile (e.g. an 11min headway one just
 * slightly farther) out of the candidate list entirely, forcing that cell into a much worse cost
 * while its neighbor (whose nearest cluster happens to include the good stop) scores normally —
 * a sharp, unrealistic cliff between two cells that are both genuinely near the good stop. */
const PER_PROFILE_CANDIDATES = 4;
/** Final cap after merging overall + per-profile picks, so grid.json size stays bounded. */
const MAX_CANDIDATES_PER_CELL = 24;

export type GridStop = {
  id: string;
  lat: number;
  lon: number;
  headway: (number | null)[];
};
export type GridCell = {
  cell: string;
  lat: number;
  lon: number;
  /** [stopIndex into the stops.json array, walkMinutes] pairs, nearest first. */
  stops: [number, number][];
};

function bboxToPolygon(bbox: Bbox): [number, number][] {
  return [
    [bbox.minLat, bbox.minLon],
    [bbox.minLat, bbox.maxLon],
    [bbox.maxLat, bbox.maxLon],
    [bbox.maxLat, bbox.minLon],
  ];
}

/** Picks the H3 resolution whose average edge length is closest to ~250m, capped so the
 * resulting cell count over the bbox stays under MAX_CELLS (favors file size over exact match). */
function pickResolution(bbox: Bbox): number {
  let best = 9;
  let bestDiff = Infinity;
  for (let res = 5; res <= 10; res++) {
    const edgeMeters = h3.getHexagonEdgeLengthAvg(res, "m");
    const diff = Math.abs(edgeMeters - TARGET_EDGE_METERS);
    if (diff < bestDiff) {
      best = res;
      bestDiff = diff;
    }
  }
  while (best > 5) {
    const cellCount = h3.polygonToCells(bboxToPolygon(bbox), best).length;
    if (cellCount <= MAX_CELLS) break;
    best--;
  }
  return best;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Uniform spatial hash over stops so nearest-stop lookups per cell don't scan every stop.
 * Buckets must be at least as wide (in real km) as the largest search radius (MAX_WALK_KM) in
 * BOTH axes, or the 3x3-neighborhood scan in nearby() can silently miss in-range stops. Longitude
 * degrees are much shorter in real distance at HSL's ~60.4°N latitude (compressed by cos(lat) —
 * roughly half as wide as a latitude degree), so a single shared bucketDeg for both axes made the
 * longitude buckets too narrow and dropped stops that were offset mostly east-west. */
class StopIndex {
  private readonly bucketLatDeg = 0.02; // ~2.2km
  private readonly bucketLonDeg = 0.02 / Math.cos((60.5 * Math.PI) / 180); // ~2.2km at this latitude
  private readonly buckets = new Map<string, number[]>();

  constructor(private readonly stops: GridStop[]) {
    stops.forEach((stop, index) => {
      const key = this.bucketKey(stop.lat, stop.lon);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    });
  }

  private bucketKey(lat: number, lon: number): string {
    return `${Math.floor(lat / this.bucketLatDeg)}_${Math.floor(lon / this.bucketLonDeg)}`;
  }

  nearby(
    lat: number,
    lon: number,
    maxKm: number,
    limit: number,
  ): [number, number][] {
    const candidates: [number, number][] = []; // [stopIndex, distanceKm]
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = this.bucketKey(
          lat + dy * this.bucketLatDeg,
          lon + dx * this.bucketLonDeg,
        );
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        for (const index of bucket) {
          const stop = this.stops[index]!;
          const distanceKm = haversineKm(lat, lon, stop.lat, stop.lon);
          if (distanceKm <= maxKm) candidates.push([index, distanceKm]);
        }
      }
    }
    candidates.sort((a, b) => a[1] - b[1]);
    return candidates.slice(0, limit);
  }
}

/** Merges the nearest-overall stops with the best-access-cost-with-service stops per profile, so
 * no profile's connectivity gets silently erased just because other stops happen to be closer. */
function pickCandidates(
  pool: [number, number][],
  stops: GridStop[],
): [number, number][] {
  const picked = new Map<number, number>(); // stopIndex -> distanceKm
  for (const [stopIndex, distanceKm] of pool.slice(0, OVERALL_CANDIDATES)) {
    picked.set(stopIndex, distanceKm);
  }
  for (let profile = 0; profile < PROFILES.length; profile++) {
    // Rank by walk-plus-wait, not raw distance: a handful of near-but-nearly-useless stops (e.g.
    // a 900min headway) must not crowd out a much better (e.g. 11min headway) stop that's only
    // slightly farther — being the "nearest with any service" isn't the same as being useful.
    const serviced = pool
      .filter(([stopIndex]) => stops[stopIndex]!.headway[profile] != null)
      .map(([stopIndex, distanceKm]): [number, number, number] => {
        const walkMinutes = (distanceKm / WALK_SPEED_KMH) * 60;
        const waitMinutes = stops[stopIndex]!.headway[profile]! / 2;
        return [stopIndex, distanceKm, walkMinutes + waitMinutes];
      })
      .sort((a, b) => a[2] - b[2]);
    for (const [stopIndex, distanceKm] of serviced.slice(
      0,
      PER_PROFILE_CANDIDATES,
    )) {
      if (!picked.has(stopIndex)) picked.set(stopIndex, distanceKm);
    }
  }
  return [...picked.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_CANDIDATES_PER_CELL);
}

export function buildGrid(
  bbox: Bbox,
  stops: GridStop[],
  waterIndex?: WaterIndex,
): { cells: GridCell[]; resolution: number; edgeMeters: number } {
  const resolution = pickResolution(bbox);
  const edgeMeters = h3.getHexagonEdgeLengthAvg(resolution, "m");
  const index = new StopIndex(stops);
  const h3cells = h3.polygonToCells(bboxToPolygon(bbox), resolution);

  const cells: GridCell[] = [];
  for (const cell of h3cells) {
    const [lat, lon] = h3.cellToLatLng(cell);
    // A cell that's literally open water is never worth scoring, no matter how close a stop is —
    // swimming isn't a transport strategy. Checked first since it's the cheapest test and rules
    // out most of the raw bbox rectangle's open-sea area up front (see stops.ts computeBbox).
    if (waterIndex?.isWater(lat, lon)) continue;
    const pool = index.nearby(lat, lon, MAX_WALK_KM, CANDIDATE_POOL_SIZE);
    // Ship the cell even with an empty candidate list (e.g. a land cell between the nearest
    // walkable stop and an outer island) — the frontend's cost.ts walks further to reach real
    // service or straight to the destination in that case, producing a smooth, proportional cost.
    // Used to skip these cells entirely ("permanently unreachable, not worth shipping"), but that
    // left real gaps in the rendered grid exactly where a gradual transition was needed. But skip
    // cells beyond CELL_INCLUSION_BUFFER_KM of every stop — not worth shipping just to render gray.
    const nearAnyStop =
      pool.length > 0 ||
      index.nearby(lat, lon, CELL_INCLUSION_BUFFER_KM, 1).length > 0;
    if (!nearAnyStop) continue;
    const nearby = pool.length > 0 ? pickCandidates(pool, stops) : [];
    const stopsForCell: [number, number][] = nearby.map(
      ([stopIndex, distanceKm]) => [
        stopIndex,
        (distanceKm / WALK_SPEED_KMH) * 60,
      ],
    );
    cells.push({ cell, lat, lon, stops: stopsForCell });
  }

  return { cells, resolution, edgeMeters };
}
