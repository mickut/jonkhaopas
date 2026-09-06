import type { GridCell, Meta, Stop } from "./types.js";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`failed to fetch ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadStops(): Promise<Stop[]> {
  return fetchJson<Stop[]>("/data/stops.json");
}

export function loadGrid(): Promise<GridCell[]> {
  return fetchJson<GridCell[]>("/data/grid.json");
}

export function loadMeta(): Promise<Meta> {
  return fetchJson<Meta>("/data/meta.json");
}
