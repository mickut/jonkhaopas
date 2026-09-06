import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRepresentativeWeek, type Profile } from "./headways.js";
import type { ServiceCalendar } from "./calendar.js";

function calendarOf(overrides: Partial<ServiceCalendar>): ServiceCalendar {
  return {
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    startDate: "20260904",
    endDate: "20260907",
    ...overrides,
  };
}

test("pickRepresentativeWeek picks the earliest start date and spans 7 days", () => {
  const calendars = new Map<string, ServiceCalendar>([
    ["a", calendarOf({ startDate: "20260910", endDate: "20260913" })],
    ["b", calendarOf({ startDate: "20260904", endDate: "20260907" })],
  ]);
  const week = pickRepresentativeWeek(calendars);
  assert.equal(week.start, "20260904");
  assert.equal(week.end, "20260910");
});

test("pickRepresentativeWeek throws on an empty calendar map", () => {
  assert.throws(() => pickRepresentativeWeek(new Map()));
});

// Sanity check the profile literal union hasn't silently changed shape.
test("Profile type has the three expected values", () => {
  const profiles: Profile[] = ["work", "weekdayEvening", "weekend"];
  assert.equal(profiles.length, 3);
});
