import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysToGtfsDate, parseGtfsTimeToMinutes } from "./dates.js";

test("addDaysToGtfsDate adds days within a month", () => {
  assert.equal(addDaysToGtfsDate("20260904", 6), "20260910");
});

test("addDaysToGtfsDate rolls over month/year boundaries", () => {
  assert.equal(addDaysToGtfsDate("20261228", 6), "20270103");
});

test("parseGtfsTimeToMinutes parses normal times", () => {
  assert.equal(parseGtfsTimeToMinutes("06:30:00"), 390);
  assert.equal(parseGtfsTimeToMinutes("00:00:00"), 0);
});

test("parseGtfsTimeToMinutes handles past-midnight hours (GTFS allows HH >= 24)", () => {
  assert.equal(parseGtfsTimeToMinutes("25:15:00"), 1515);
});
