import path from "node:path";
import { readCsvRows } from "./csv.js";

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type Bbox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export async function loadStops(dataDir: string): Promise<Stop[]> {
  const stops: Stop[] = [];
  for await (const row of readCsvRows(path.join(dataDir, "stops.txt"))) {
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    if (!row.stop_id || !Number.isFinite(lat) || !Number.isFinite(lon))
      continue;
    stops.push({ id: row.stop_id, name: row.stop_name ?? "", lat, lon });
  }
  return stops;
}

/** Bbox derived from the stop distribution itself (see gtfs-hsl-data skill: don't hand-pick a region). */
export function computeBbox(stops: Stop[]): Bbox {
  if (stops.length === 0)
    throw new Error("computeBbox: no stops to derive a bbox from");
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const stop of stops) {
    if (stop.lat < minLat) minLat = stop.lat;
    if (stop.lat > maxLat) maxLat = stop.lat;
    if (stop.lon < minLon) minLon = stop.lon;
    if (stop.lon > maxLon) maxLon = stop.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

export function isInBbox(stop: Stop, bbox: Bbox): boolean {
  return (
    stop.lat >= bbox.minLat &&
    stop.lat <= bbox.maxLat &&
    stop.lon >= bbox.minLon &&
    stop.lon <= bbox.maxLon
  );
}
