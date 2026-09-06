/** GTFS dates are YYYYMMDD strings; lexicographic string comparison equals chronological order. */
export function addDaysToGtfsDate(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

/** Parses "HH:MM:SS" (HH may exceed 23 for past-midnight trips) into minutes since midnight. */
export function parseGtfsTimeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}
