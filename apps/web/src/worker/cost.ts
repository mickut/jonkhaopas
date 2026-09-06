import {
  PROFILES,
  type GridCell,
  type Location,
  type ProfileLocations,
  type Stop,
  type Weights,
} from "../data/types.js";

/** Generalized-cost model constants (see jonkhakerroin-scoring skill). */
const MODE_AVG_SPEED_KMH = 20; // MVP simplification: flat speed, no per-route-type data in stops.json yet.
const TRANSFER_PENALTY_MIN = 5;
/** Distance below which two stops are treated as "the same hub" (no transfer implied). */
const SAME_STOP_KM = 0.05;
/** Matches gtfs-pipeline's grid.ts walking-radius assumption. */
const WALK_SPEED_KMH = 4.8;
/** Asymptote for the soft-capped cost curve ("reasonable travel budget", see skill). Only literal
 * no-service-at-all (Infinity) pins exactly to this ceiling. */
const UNREACHABLE_COST_MINUTES = 90;
/** Controls how gradually costs approach the asymptote — deliberately wider than the asymptote
 * itself so very long rides and sparse-schedule cells (rather than just the truly unreachable)
 * stay visually distinguishable across the whole realistic range instead of bunching near the cap. */
const COST_SOFTNESS_MINUTES = 200;

/** Smoothly bounds any cost into [0, UNREACHABLE_COST_MINUTES): near-linear for small costs, then
 * saturates toward the asymptote for very large ones. Infinity (no service at all) maps exactly
 * to the asymptote. */
function softCapCost(costMinutes: number): number {
  if (!Number.isFinite(costMinutes)) return UNREACHABLE_COST_MINUTES;
  return (
    UNREACHABLE_COST_MINUTES * Math.tanh(costMinutes / COST_SOFTNESS_MINUTES)
  );
}

export function haversineKm(
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

/** Nearest stop to a user-selected location — used as that location's transit "access point". */
export function nearestStopIndex(stops: Stop[], location: Location): number {
  let best = -1;
  let bestDistanceKm = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const distanceKm = haversineKm(
      location.lat,
      location.lon,
      stop.lat,
      stop.lon,
    );
    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      best = i;
    }
  }
  return best;
}

/** Normalizes weights to sum to 1; falls back to equal weighting if all weights are zero/negative. */
export function normalizeWeights(weights: Weights): [number, number, number] {
  const values = PROFILES.map((p) => Math.max(0, weights[p]));
  const sum = values[0]! + values[1]! + values[2]!;
  if (sum <= 0) return [1 / 3, 1 / 3, 1 / 3];
  return [values[0]! / sum, values[1]! / sum, values[2]! / sum];
}

function uniqueLocations(locations: Location[]): Location[] {
  const unique = new Map<string, Location>();
  for (const location of locations) {
    unique.set(`${location.lat}:${location.lon}`, location);
  }
  return [...unique.values()];
}

/** Uniform spatial hash over a set of stops, for fast nearest-stop queries. Longitude degrees are
 * much shorter in real distance than latitude degrees at HSL's ~60.4°N latitude (compressed by
 * cos(lat)), so longitude buckets are widened to match — mirrors the same fix in
 * tools/gtfs-pipeline/src/gtfs/grid.ts's StopIndex (see that file for the full explanation). */
class NearestStopIndex {
  private readonly stops: Stop[];
  private readonly bucketLatDeg = 0.02;
  private readonly bucketLonDeg = 0.02 / Math.cos((60.5 * Math.PI) / 180);
  private readonly buckets = new Map<string, number[]>();

  constructor(stops: Stop[], stopIndices: number[]) {
    this.stops = stops;
    for (const stopIndex of stopIndices) {
      const stop = stops[stopIndex]!;
      const key = this.bucketKey(stop.lat, stop.lon);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(stopIndex);
      else this.buckets.set(key, [stopIndex]);
    }
  }

  private bucketKey(lat: number, lon: number): string {
    return `${Math.floor(lat / this.bucketLatDeg)}_${Math.floor(lon / this.bucketLonDeg)}`;
  }

  /** Best-access-cost (walk+wait) indexed stop for `profile` near (lat, lon), expanding the
   * search ring outward. Ranking by raw distance alone (like a plain nearest-stop search) would
   * let a handful of near-but-nearly-useless stops (e.g. a 900min headway) win over a much better
   * one (e.g. an 11min headway) that's only slightly farther — the exact "sharp jump next to
   * ordinary service" bug this is guarding against, so once any candidate is found we keep
   * expanding a few more rings and compare all of them by walk+wait, not just take the first. */
  bestAccess(
    lat: number,
    lon: number,
    profile: number,
  ): { distanceKm: number; stopIndex: number; accessMinutes: number } | null {
    const centerLatBucket = Math.floor(lat / this.bucketLatDeg);
    const centerLonBucket = Math.floor(lon / this.bucketLonDeg);
    const MAX_RING = 12; // ~12 buckets out (~26km) before giving up on a "nearby" service stop
    const EXTRA_RINGS_AFTER_FIRST_FIND = 3;
    let bestAccessMinutes = Infinity;
    let bestDistanceKm = Infinity;
    let bestIndex = -1;
    let ringOfFirstFind = -1;
    for (let ring = 0; ring <= MAX_RING; ring++) {
      if (
        ringOfFirstFind !== -1 &&
        ring > ringOfFirstFind + EXTRA_RINGS_AFTER_FIRST_FIND
      ) {
        break;
      }
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== ring) continue; // only the new outer ring
          const key = `${centerLatBucket + dy}_${centerLonBucket + dx}`;
          const bucket = this.buckets.get(key);
          if (!bucket) continue;
          if (ringOfFirstFind === -1) ringOfFirstFind = ring;
          for (const stopIndex of bucket) {
            const stop = this.stops[stopIndex]!;
            const distanceKm = haversineKm(lat, lon, stop.lat, stop.lon);
            const walkMinutes = (distanceKm / WALK_SPEED_KMH) * 60;
            const waitMinutes = stop.headway[profile]! / 2;
            const accessMinutes = walkMinutes + waitMinutes;
            if (accessMinutes < bestAccessMinutes) {
              bestAccessMinutes = accessMinutes;
              bestDistanceKm = distanceKm;
              bestIndex = stopIndex;
            }
          }
        }
      }
    }
    return bestIndex === -1
      ? null
      : {
          distanceKm: bestDistanceKm,
          stopIndex: bestIndex,
          accessMinutes: bestAccessMinutes,
        };
  }
}

/** Per-profile nearest-stop-with-service index, cached per `stops` array (the worker only ever
 * loads stops once, see scoring.worker.ts) so repeated recomputes on slider/pin changes don't
 * rebuild it every time. */
const servicedStopIndexCache = new WeakMap<Stop[], NearestStopIndex[]>();

function servicedStopIndexByProfile(stops: Stop[]): NearestStopIndex[] {
  const cached = servicedStopIndexCache.get(stops);
  if (cached) return cached;
  const byProfile = PROFILES.map((_, profile) => {
    const indices = stops.reduce<number[]>((acc, stop, stopIndex) => {
      if (stop.headway[profile] != null) acc.push(stopIndex);
      return acc;
    }, []);
    return new NearestStopIndex(stops, indices);
  });
  servicedStopIndexCache.set(stops, byProfile);
  return byProfile;
}

type BestAccess = {
  distanceKm: number;
  stopIndex: number;
  accessMinutes: number;
};

/** Per-cell, per-profile best-access-cost lookup, cached per (stops, grid) pair. `bestAccess`
 * depends only on a cell's position and the (static) stop/headway data — never on the user's
 * selected destinations or weights — so it's wasted work to recompute per `computeScores` call.
 * Computed once, up front, the first time a given (stops, grid) pair is scored; every later
 * recompute (dragging a pin, moving a slider) just reads from this array instead of re-running
 * the ring search. Keyed on both `stops` and `grid` (not just `grid`) since they could in
 * principle vary independently (e.g. tests reusing the same grid with different stop data). */
const bestAccessCache = new WeakMap<
  Stop[],
  WeakMap<GridCell[], (BestAccess | null)[][]>
>();

function bestAccessByCellAndProfile(
  stops: Stop[],
  grid: GridCell[],
  servicedByProfile: NearestStopIndex[],
): (BestAccess | null)[][] {
  const byGrid = bestAccessCache.get(stops) ?? new WeakMap();
  bestAccessCache.set(stops, byGrid);
  const cached = byGrid.get(grid);
  if (cached) return cached;
  const perProfile = PROFILES.map((_, profile) =>
    grid.map((cell) =>
      servicedByProfile[profile]!.bestAccess(cell.lat, cell.lon, profile),
    ),
  );
  byGrid.set(grid, perProfile);
  return perProfile;
}

export type ScoreResult = {
  /** Logarithmic Jonkhakerroin per cell, same order as `grid`. */
  scores: Float64Array;
  /** Per-cell, per-profile unbounded generalized cost, flattened as [cell*3 + profile]. */
  profileCosts: Float64Array;
};

/**
 * Computes the Jonkhakerroin score for every grid cell, in the same order as `grid`.
 * See jonkhakerroin-scoring skill for the cost(c, L, profile) formula this implements.
 */
export function computeScores(
  stops: Stop[],
  grid: GridCell[],
  locations: ProfileLocations,
  weights: Weights,
): ScoreResult {
  const scores = new Float64Array(grid.length);
  const profileCosts = new Float64Array(grid.length * 3);
  if (PROFILES.every((profile) => locations[profile].length === 0)) {
    scores.fill(Infinity);
    profileCosts.fill(Infinity);
    return { scores, profileCosts };
  }

  const [wWork, wEvening, wWeekend] = normalizeWeights(weights);
  const profileWeights = [wWork, wEvening, wWeekend];
  const uniqueLocationsByProfile = PROFILES.map((profile) =>
    uniqueLocations(locations[profile]),
  );
  const locationStopIndicesByProfile = uniqueLocationsByProfile.map(
    (uniqueLocs) =>
      uniqueLocs.map((location) => nearestStopIndex(stops, location)),
  );
  const servicedByProfile = servicedStopIndexByProfile(stops);
  const bestAccessByProfile = bestAccessByCellAndProfile(
    stops,
    grid,
    servicedByProfile,
  );
  for (let cellIndex = 0; cellIndex < grid.length; cellIndex++) {
    const cell = grid[cellIndex]!;
    let total = 0;
    for (let profile = 0; profile < 3; profile++) {
      let bestCost = Infinity;
      const locationStopIndices = locationStopIndicesByProfile[profile]!;
      if (profileWeights[profile] === 0) continue;
      for (const [stopIndex, walkMinutes] of cell.stops) {
        const stop = stops[stopIndex]!;
        const headway = stop.headway[profile];
        if (headway == null) continue; // no service for this profile at this stop
        const waitMinutes = headway / 2;
        for (const locStopIndex of locationStopIndices) {
          const locStop = stops[locStopIndex]!;
          const rideKm = haversineKm(
            stop.lat,
            stop.lon,
            locStop.lat,
            locStop.lon,
          );
          const rideMinutes = (rideKm / MODE_AVG_SPEED_KMH) * 60;
          const transferMinutes =
            rideKm > SAME_STOP_KM ? TRANSFER_PENALTY_MIN : 0;
          const cost =
            walkMinutes + waitMinutes + rideMinutes + transferMinutes;
          if (cost < bestCost) bestCost = cost;
        }
      }
      // Also compare against walking a bit further to whichever nearby stop gives the best
      // walk+wait access — a technically-non-null but near-useless headway (e.g. 900min) must
      // not out-rank walking slightly further to a genuinely good stop just because it's a hair
      // closer. Precomputed/cached (see bestAccessByCellAndProfile) since it's destination- and
      // weight-independent, so this lookup is O(1) here regardless of how expensive the
      // underlying search was on first use.
      const bestAccess = bestAccessByProfile[profile]![cellIndex];
      if (bestAccess) {
        const stop = stops[bestAccess.stopIndex]!;
        for (const locStopIndex of locationStopIndices) {
          const locStop = stops[locStopIndex]!;
          const rideKm = haversineKm(
            stop.lat,
            stop.lon,
            locStop.lat,
            locStop.lon,
          );
          const rideMinutes = (rideKm / MODE_AVG_SPEED_KMH) * 60;
          const transferMinutes =
            rideKm > SAME_STOP_KM ? TRANSFER_PENALTY_MIN : 0;
          const cost = bestAccess.accessMinutes + rideMinutes + transferMinutes;
          if (cost < bestCost) bestCost = cost;
        }
      }
      // Always also consider walking straight to the destination: this is the only option when
      // no stop anywhere serves this profile, but it can also beat transit when the destination
      // is already nearby and the closest matching service is too infrequent to be worth waiting
      // for (e.g. standing right next to a stop that only runs a few times a day).
      for (const location of uniqueLocationsByProfile[profile]!) {
        const walkKm = haversineKm(
          cell.lat,
          cell.lon,
          location.lat,
          location.lon,
        );
        const walkOnlyMinutes = (walkKm / WALK_SPEED_KMH) * 60;
        if (walkOnlyMinutes < bestCost) bestCost = walkOnlyMinutes;
      }
      bestCost = softCapCost(bestCost);
      profileCosts[cellIndex * 3 + profile] = bestCost;
      total += profileWeights[profile]! * bestCost;
    }
    scores[cellIndex] = Math.log1p(total);
  }

  return { scores, profileCosts };
}
