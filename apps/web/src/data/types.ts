/** Typed shapes matching tools/gtfs-pipeline's output artifacts (see data-pipeline instructions
 * and jonkhakerroin-scoring skill for the exact contract). */

export type Profile = "work" | "weekdayEvening" | "weekend";
export const PROFILES: readonly Profile[] = [
  "work",
  "weekdayEvening",
  "weekend",
];

export type Stop = {
  id: string;
  lat: number;
  lon: number;
  /** Minutes between departures per profile (work, weekdayEvening, weekend); null = no service. */
  headway: [number | null, number | null, number | null];
};

export type GridCell = {
  cell: string;
  lat: number;
  lon: number;
  /** [stopIndex into the stops array, walkMinutes], nearest first, capped at ~16 candidates. */
  stops: [number, number][];
};

export type Meta = {
  generatedAt: string;
  representativeWeek: { start: string; end: string };
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  stopCount: number;
  profiles: readonly Profile[];
  grid: { resolution: number; edgeMeters: number; cellCount: number };
};

export type Location = { lat: number; lon: number };

export type ProfileLocations = Record<Profile, Location[]>;

export type Weights = Record<Profile, number>;
