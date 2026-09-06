import path from "node:path";
import { readCsvRows } from "./csv.js";

export type Route = {
  id: string;
  shortName: string;
  /** Standard GTFS route_type code (0=tram,1=metro,2=rail,3=bus,4=ferry — verify per feed). */
  type: number;
};

export type Trip = {
  id: string;
  routeId: string;
  serviceId: string;
};

export async function loadRoutes(dataDir: string): Promise<Map<string, Route>> {
  const routes = new Map<string, Route>();
  for await (const row of readCsvRows(path.join(dataDir, "routes.txt"))) {
    if (!row.route_id) continue;
    routes.set(row.route_id, {
      id: row.route_id,
      shortName: row.route_short_name ?? "",
      type: Number(row.route_type),
    });
  }
  return routes;
}

export async function loadTrips(dataDir: string): Promise<Trip[]> {
  const trips: Trip[] = [];
  for await (const row of readCsvRows(path.join(dataDir, "trips.txt"))) {
    if (!row.trip_id || !row.route_id || !row.service_id) continue;
    trips.push({
      id: row.trip_id,
      routeId: row.route_id,
      serviceId: row.service_id,
    });
  }
  return trips;
}
