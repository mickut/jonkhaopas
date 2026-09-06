import path from "node:path";
import { readCsvRows } from "./csv.js";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** service_id -> which weekdays it runs (calendar.txt) within [startDate, endDate], GTFS YYYYMMDD strings. */
export type ServiceCalendar = Record<Weekday, boolean> & {
  startDate: string;
  endDate: string;
};

export type ExceptionType = 1 | 2; // 1 = service added, 2 = service removed

export type CalendarException = {
  date: string; // YYYYMMDD
  exceptionType: ExceptionType;
};

export async function loadCalendar(
  dataDir: string,
): Promise<Map<string, ServiceCalendar>> {
  const calendar = new Map<string, ServiceCalendar>();
  for await (const row of readCsvRows(path.join(dataDir, "calendar.txt"))) {
    if (!row.service_id) continue;
    calendar.set(row.service_id, {
      monday: row.monday === "1",
      tuesday: row.tuesday === "1",
      wednesday: row.wednesday === "1",
      thursday: row.thursday === "1",
      friday: row.friday === "1",
      saturday: row.saturday === "1",
      sunday: row.sunday === "1",
      startDate: row.start_date ?? "",
      endDate: row.end_date ?? "",
    });
  }
  return calendar;
}

export async function loadCalendarDates(
  dataDir: string,
): Promise<Map<string, CalendarException[]>> {
  const exceptions = new Map<string, CalendarException[]>();
  for await (const row of readCsvRows(
    path.join(dataDir, "calendar_dates.txt"),
  )) {
    if (!row.service_id || !row.date) continue;
    const exceptionType = Number(row.exception_type) as ExceptionType;
    const list = exceptions.get(row.service_id) ?? [];
    list.push({ date: row.date, exceptionType });
    exceptions.set(row.service_id, list);
  }
  return exceptions;
}

/** GTFS date (YYYYMMDD) -> weekday name, computed in UTC so no local-timezone shift affects the result. */
export function dateToWeekday(date: string): Weekday {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sunday..6=Saturday
  return WEEKDAYS[(dayOfWeek + 6) % 7]!; // rotate so 0=Monday..6=Sunday
}

/** Whether a service_id runs on a given date, honoring calendar_dates add/remove exceptions. */
export function serviceRunsOnDate(
  calendar: ServiceCalendar | undefined,
  exceptions: CalendarException[] | undefined,
  date: string,
): boolean {
  const exception = exceptions?.find((e) => e.date === date);
  if (exception) return exception.exceptionType === 1;
  if (!calendar) return false;
  if (date < calendar.startDate || date > calendar.endDate) return false;
  return calendar[dateToWeekday(date)];
}
