// CLI entry point for the GTFS -> static artifacts pipeline (see .github/instructions/data-pipeline.instructions.md).
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { loadStops, computeBbox, isInBbox } from "./gtfs/stops.js";
import { loadRoutes, loadTrips } from "./gtfs/routes.js";
import { loadCalendar, loadCalendarDates, WEEKDAYS } from "./gtfs/calendar.js";
import {
  computeStopHeadways,
  pickRepresentativeWeek,
  PROFILES,
} from "./gtfs/headways.js";
import { buildGrid } from "./gtfs/grid.js";
import { WaterIndex } from "./gtfs/water.js";

const dataDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "data",
  "hsl",
);
const outDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "public",
  "data",
);

async function main() {
  const stops = await loadStops(dataDir);
  const bbox = computeBbox(stops);
  const stopsInBbox = stops.filter((stop) => isInBbox(stop, bbox));

  const routes = await loadRoutes(dataDir);
  const trips = await loadTrips(dataDir);
  const calendar = await loadCalendar(dataDir);
  const calendarDates = await loadCalendarDates(dataDir);

  console.log(`stops: ${stops.length} total, ${stopsInBbox.length} in bbox`);
  console.log(
    `bbox: lat [${bbox.minLat.toFixed(4)}, ${bbox.maxLat.toFixed(4)}], ` +
      `lon [${bbox.minLon.toFixed(4)}, ${bbox.maxLon.toFixed(4)}]`,
  );
  console.log(
    `routes: ${routes.size}, trips: ${trips.length}, services: ${calendar.size}`,
  );

  let added = 0;
  let removed = 0;
  for (const exceptions of calendarDates.values()) {
    for (const e of exceptions) {
      if (e.exceptionType === 1) added++;
      else removed++;
    }
  }
  console.log(`calendar_dates exceptions: ${added} added, ${removed} removed`);

  console.log("weekday-classified service_id sample:");
  let sampleCount = 0;
  for (const [serviceId, cal] of calendar) {
    if (sampleCount >= 3) break;
    const activeDays = WEEKDAYS.filter((day) => cal[day]).join(",");
    console.log(
      `  ${serviceId} [${cal.startDate}-${cal.endDate}]: ${activeDays || "(none)"}`,
    );
    sampleCount++;
  }

  const week = pickRepresentativeWeek(calendar);
  console.log(`representative week: ${week.start} - ${week.end}`);

  console.log("streaming stop_times.txt for headways (this takes a while)...");
  const headways = await computeStopHeadways(dataDir, trips, calendar);
  console.log(`computed headways for ${headways.size} stops`);

  const stopsOut = stopsInBbox.map((stop) => {
    const h = headways.get(stop.id);
    return {
      id: stop.id,
      lat: stop.lat,
      lon: stop.lon,
      headway: PROFILES.map((p) => (h ? h[p] : null)),
    };
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "stops.json"), JSON.stringify(stopsOut));

  console.log("building spatial grid + walk candidates...");
  console.log("loading water tiles (excludes open-sea cells)...");
  const waterIndex = await WaterIndex.load(bbox);
  const { cells, resolution, edgeMeters } = buildGrid(bbox, stopsOut, waterIndex);
  console.log(
    `grid: resolution ${resolution} (avg edge ~${edgeMeters.toFixed(0)}m), ` +
      `${cells.length} populated cells`,
  );
  await writeFile(path.join(outDir, "grid.json"), JSON.stringify(cells));

  await writeFile(
    path.join(outDir, "meta.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      representativeWeek: week,
      bbox,
      stopCount: stopsOut.length,
      profiles: PROFILES,
      grid: { resolution, edgeMeters, cellCount: cells.length },
    }),
  );
  console.log(
    `wrote ${stopsOut.length} stops and ${cells.length} grid cells to ${outDir}`,
  );
}

main();
