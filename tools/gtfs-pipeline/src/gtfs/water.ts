// Excludes grid cells whose center is open water, per OpenFreeMap's own "water" vector-tile
// layer — the same OpenMapTiles-schema data already rendering the (verifiably accurate, down to
// individual archipelago skerries) basemap coastline. A coarser dataset like Natural Earth's
// public-domain land polygons was tried first, but at continental-scale generalization it drops
// most of Helsinki's small skerries entirely, so it couldn't tell real land from open sea here.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bbox } from "./stops.js";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
/** OpenMapTiles' "water" layer is available 0-14; 13 balances per-tile detail (small skerries
 * need to actually show up) against total tile-fetch count for a bbox this size (~a few hundred). */
const ZOOM = 13;
const CACHE_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "data",
  "water-tiles",
);
/** Fetch tiles a few at a time so we don't hammer the (free, shared) tile host. */
const CONCURRENCY = 8;

type Ring = [number, number][]; // [lon, lat]
type PolygonWithHoles = Ring[]; // rings[0] = exterior, rings[1..] = holes

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

async function fetchTileCached(
  urlTemplate: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${z}_${x}_${y}.pbf`);
  try {
    return await readFile(cachePath);
  } catch {
    const url = urlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const res = await fetch(url);
    if (res.status === 404) return null; // e.g. an all-ocean tile the source doesn't bother shipping
    if (!res.ok) throw new Error(`failed to fetch tile ${url}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(cachePath, buf);
    return buf;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

/** Per-tile water polygons (with holes), keyed by `${x}_${y}` at the fixed ZOOM above, so a query
 * point only ever gets tested against the handful of polygons in its own tile. */
export class WaterIndex {
  private readonly tiles = new Map<string, PolygonWithHoles[]>();

  private constructor() {}

  static async load(bbox: Bbox): Promise<WaterIndex> {
    const index = new WaterIndex();
    const tileJsonRes = await fetch(TILEJSON_URL);
    if (!tileJsonRes.ok) {
      throw new Error(`failed to fetch ${TILEJSON_URL}: ${tileJsonRes.status}`);
    }
    const tileJson = (await tileJsonRes.json()) as { tiles: string[] };
    const urlTemplate = tileJson.tiles[0];
    if (!urlTemplate) throw new Error("TileJSON response had no tile URL template");

    const nw = lonLatToTile(bbox.minLon, bbox.maxLat, ZOOM);
    const se = lonLatToTile(bbox.maxLon, bbox.minLat, ZOOM);
    const tileKeys: { x: number; y: number }[] = [];
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        tileKeys.push({ x, y });
      }
    }

    await mapWithConcurrency(tileKeys, CONCURRENCY, async ({ x, y }) => {
      const buf = await fetchTileCached(urlTemplate, ZOOM, x, y);
      if (!buf) return;
      const layer = new VectorTile(new PbfReader(buf)).layers["water"];
      if (!layer) return;
      const polygons: PolygonWithHoles[] = [];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(x, y, ZOOM);
        const geometry = feature.geometry;
        if (geometry.type === "Polygon") {
          polygons.push(geometry.coordinates as PolygonWithHoles);
        } else if (geometry.type === "MultiPolygon") {
          for (const polygon of geometry.coordinates) {
            polygons.push(polygon as PolygonWithHoles);
          }
        }
      }
      index.tiles.set(`${x}_${y}`, polygons);
    });

    return index;
  }

  isWater(lat: number, lon: number): boolean {
    const { x, y } = lonLatToTile(lon, lat, ZOOM);
    const polygons = this.tiles.get(`${x}_${y}`);
    if (!polygons) return false;
    for (const polygon of polygons) {
      const [exterior, ...holes] = polygon;
      if (!exterior || !pointInRing(lat, lon, exterior)) continue;
      if (holes.some((hole) => pointInRing(lat, lon, hole))) continue;
      return true;
    }
    return false;
  }
}

/** Ray-casting point-in-ring (odd-even rule). Ring coordinates are [lon, lat]. */
function pointInRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
