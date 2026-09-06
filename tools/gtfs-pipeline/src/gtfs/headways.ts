import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { ServiceCalendar } from "./calendar.js";
import type { Trip } from "./routes.js";
import { addDaysToGtfsDate, parseGtfsTimeToMinutes } from "./dates.js";

export const PROFILES = ["work", "weekdayEvening", "weekend"] as const;
export type Profile = (typeof PROFILES)[number];

/** [startMinute, endMinute) windows per profile, see jonkhakerroin-scoring skill. */
const WORK_WINDOWS = [
  [6 * 60, 9 * 60],
  [15 * 60, 18 * 60],
] as const;
const WEEKDAY_EVENING_WINDOW = [18 * 60, 24 * 60] as const;
const WEEKEND_WINDOW = [9 * 60, 24 * 60] as const;

/** Total in-window minutes across all matching days in the representative week (5 weekdays, 2 weekend days). */
const PROFILE_TOTAL_MINUTES: Record<Profile, number> = {
  work:
    (WORK_WINDOWS[0][1] -
      WORK_WINDOWS[0][0] +
      (WORK_WINDOWS[1][1] - WORK_WINDOWS[1][0])) *
    5,
  weekdayEvening: (WEEKDAY_EVENING_WINDOW[1] - WEEKDAY_EVENING_WINDOW[0]) * 5,
  weekend: (WEEKEND_WINDOW[1] - WEEKEND_WINDOW[0]) * 2,
};

/** Picks the earliest 7-day window covering calendar.txt's overall validity range (see data-pipeline instructions). */
export function pickRepresentativeWeek(
  calendars: Map<string, ServiceCalendar>,
): {
  start: string;
  end: string;
} {
  let minStart: string | undefined;
  for (const cal of calendars.values()) {
    if (!minStart || cal.startDate < minStart) minStart = cal.startDate;
  }
  if (!minStart)
    throw new Error("pickRepresentativeWeek: no calendar entries found");
  return { start: minStart, end: addDaysToGtfsDate(minStart, 6) };
}

type ServiceProfileFlags = { weekday: boolean; weekend: boolean };

/** Which profile day-types a service contributes to, restricted to services overlapping the representative week. */
function classifyServices(
  calendars: Map<string, ServiceCalendar>,
  week: { start: string; end: string },
): Map<string, ServiceProfileFlags> {
  const classified = new Map<string, ServiceProfileFlags>();
  for (const [serviceId, cal] of calendars) {
    const overlaps = cal.startDate <= week.end && cal.endDate >= week.start;
    if (!overlaps) continue;
    const weekday =
      cal.monday || cal.tuesday || cal.wednesday || cal.thursday || cal.friday;
    const weekend = cal.saturday || cal.sunday;
    if (weekday || weekend) classified.set(serviceId, { weekday, weekend });
  }
  return classified;
}

function matchesProfile(
  minutesOfDay: number,
  dayFlags: ServiceProfileFlags,
): Profile[] {
  const profiles: Profile[] = [];
  if (dayFlags.weekday) {
    if (WORK_WINDOWS.some(([s, e]) => minutesOfDay >= s && minutesOfDay < e))
      profiles.push("work");
    if (
      minutesOfDay >= WEEKDAY_EVENING_WINDOW[0] &&
      minutesOfDay < WEEKDAY_EVENING_WINDOW[1]
    ) {
      profiles.push("weekdayEvening");
    }
  }
  if (
    dayFlags.weekend &&
    minutesOfDay >= WEEKEND_WINDOW[0] &&
    minutesOfDay < WEEKEND_WINDOW[1]
  ) {
    profiles.push("weekend");
  }
  return profiles;
}

export type StopHeadways = Record<Profile, number | null>;

/**
 * Streams stop_times.txt (~870MB) line-by-line, counting departures per stop per profile within
 * the representative week, then converts counts to average headway minutes.
 */
export async function computeStopHeadways(
  dataDir: string,
  trips: Trip[],
  calendars: Map<string, ServiceCalendar>,
): Promise<Map<string, StopHeadways>> {
  const week = pickRepresentativeWeek(calendars);
  const serviceProfiles = classifyServices(calendars, week);

  const tripToServiceId = new Map<string, string>();
  for (const trip of trips) tripToServiceId.set(trip.id, trip.serviceId);

  const counts = new Map<string, Record<Profile, number>>();

  const rl = createInterface({
    input: createReadStream(path.join(dataDir, "stop_times.txt")),
    crlfDelay: Infinity,
  });

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;
    // Only trip_id (0), departure_time (2), stop_id (3) are needed; all precede the only quoted
    // field (stop_headsign, index 5), so a naive split is safe here (see gtfs-hsl-data skill).
    const commaIdx0 = line.indexOf(",");
    const commaIdx1 = line.indexOf(",", commaIdx0 + 1);
    const commaIdx2 = line.indexOf(",", commaIdx1 + 1);
    const commaIdx3 = line.indexOf(",", commaIdx2 + 1);
    if (commaIdx0 < 0 || commaIdx1 < 0 || commaIdx2 < 0 || commaIdx3 < 0)
      continue;

    const tripId = line.slice(0, commaIdx0);
    const departureTime = line.slice(commaIdx1 + 1, commaIdx2);
    const stopId = line.slice(commaIdx2 + 1, commaIdx3);

    const serviceId = tripToServiceId.get(tripId);
    if (!serviceId) continue;
    const dayFlags = serviceProfiles.get(serviceId);
    if (!dayFlags) continue;

    const minutesOfDay = parseGtfsTimeToMinutes(departureTime);
    const profiles = matchesProfile(minutesOfDay, dayFlags);
    if (profiles.length === 0) continue;

    let stopCounts = counts.get(stopId);
    if (!stopCounts) {
      stopCounts = { work: 0, weekdayEvening: 0, weekend: 0 };
      counts.set(stopId, stopCounts);
    }
    for (const profile of profiles) stopCounts[profile]++;
  }

  const headways = new Map<string, StopHeadways>();
  for (const [stopId, stopCounts] of counts) {
    const result = {} as StopHeadways;
    for (const profile of PROFILES) {
      const count = stopCounts[profile];
      result[profile] =
        count > 0 ? PROFILE_TOTAL_MINUTES[profile] / count : null;
    }
    headways.set(stopId, result);
  }
  return headways;
}
