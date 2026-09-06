import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateToWeekday,
  serviceRunsOnDate,
  type ServiceCalendar,
} from "./calendar.js";

test("dateToWeekday resolves GTFS dates in UTC regardless of local timezone", () => {
  // 2026-09-07 is a Monday
  assert.equal(dateToWeekday("20260907"), "monday");
  assert.equal(dateToWeekday("20260906"), "sunday");
});

const wednesdayOnly: ServiceCalendar = {
  monday: false,
  tuesday: false,
  wednesday: true,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  startDate: "20260904",
  endDate: "20260910",
};

test("serviceRunsOnDate follows calendar.txt weekday flags within the date range", () => {
  assert.equal(serviceRunsOnDate(wednesdayOnly, undefined, "20260909"), true); // Wednesday, in range
  assert.equal(serviceRunsOnDate(wednesdayOnly, undefined, "20260910"), false); // Thursday, in range
});

test("serviceRunsOnDate is false outside the calendar.txt date range", () => {
  assert.equal(serviceRunsOnDate(wednesdayOnly, undefined, "20260916"), false); // next Wednesday, out of range
});

test("calendar_dates exception_type=1 (added) forces the service to run", () => {
  const added = [{ date: "20260910", exceptionType: 1 as const }]; // Thursday, normally not running
  assert.equal(serviceRunsOnDate(wednesdayOnly, added, "20260910"), true);
});

test("calendar_dates exception_type=2 (removed) forces the service to not run", () => {
  const removed = [{ date: "20260909", exceptionType: 2 as const }]; // Wednesday, normally running
  assert.equal(serviceRunsOnDate(wednesdayOnly, removed, "20260909"), false);
});

test("serviceRunsOnDate is false when there is no calendar entry at all", () => {
  assert.equal(serviceRunsOnDate(undefined, undefined, "20260909"), false);
});
