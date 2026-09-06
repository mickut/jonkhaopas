---
name: gtfs-hsl-data
description: Structure, quirks, and licensing of the HSL GTFS feed in data/hsl/. Use when parsing, filtering, or reasoning about any file in data/hsl/, or when the region/date range/service-id format matters.
---

# HSL GTFS data (data/hsl/)

Source: https://www.hsl.fi/hsl/avoin-data#paikkatietoaineistojen-latauspalvelu — licensed CC BY 4.0,
attribute "HSL" in the UI.

## Files present

`agency, areas, calendar, calendar_dates, emissions, fare_attributes, fare_rules, feed_info,
routes, shapes, stop_areas, stops, stop_times, transfers, translations, trips, trips2`
(standard GTFS + HSL extras: `areas`, `emissions`, `stop_areas`, `trips2`).

## Quirks to know

- `stop_times.txt` is 50+ MB — always stream, never load whole file.
- `service_id` encodes route + validity window + Finnish weekday abbreviation, e.g.
  `1001_20260904_20260907_Ke` (Ke = Wednesday). Don't parse the weekday out of the string —
  use `calendar.txt`'s monday..sunday columns (and `calendar_dates.txt` add/remove exceptions)
  as source of truth.
- `stops.txt` has quoted names with commas, blank-string fields (e.g. `parent_station` as a lone
  space), and a `vehicle_type`/`digistop_id` HSL extension column beyond core GTFS.
- Coordinates are WGS84 (`stop_lat`,`stop_lon`), standard lat/lon — reproject only for the app's
  grid math if needed, not before.
- `route_type` follows standard GTFS codes (0=tram,1=metro,2=rail,3=bus,4=ferry — verify against
  `routes.txt` values actually present rather than assuming all exist).
- Feed has a rolling short validity window per service_id (~1 week blocks in samples seen) —
  pipeline must pick one representative week (or union of a full cycle) rather than assume the
  whole `calendar.txt` spans one static timetable. Check `feed_info.txt` / min-max of
  `calendar.txt` start/end dates at pipeline run time; don't hardcode dates.

## Region scope

App covers "Helsinki region" — derive a bounding box from `stops.txt` lat/lon distribution or use
HSL's own service area; don't hand-pick an arbitrary small box that excludes real HSL stops.

## Don't

- Don't ship raw GTFS files to the client.
- Don't assume English-only strings — headsigns/names are Finnish/Swedish.
