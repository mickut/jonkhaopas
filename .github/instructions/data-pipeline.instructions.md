---
applyTo: "tools/gtfs-pipeline/**"
---

# GTFS pipeline (tools/gtfs-pipeline)

## Rules

- Never read `data/hsl/stop_times.txt` (50+ MB) fully into memory or into an editor tool — stream
  it line-by-line (Node `readline`/`csv-parse` stream).
- Pipeline runs offline (CLI script), output is static artifacts checked into `apps/web/public/data`
  or fetched at deploy time — never re-parsed by the browser.
- Deterministic output: same GTFS input + same code = byte-identical output (stable sort keys,
  fixed float precision) so diffs are meaningful.
- Restrict processing to the Helsinki region bounding box (see gtfs-hsl-data skill) to keep
  artifact size small.
- Pipeline is run manually on demand (`npm run build:data`) whenever `data/hsl/` is refreshed —
  no CI/scheduled job for MVP. Each run picks one representative "current" week (see stage 3
  below), so re-run after updating the GTFS feed to pick up a new week.

## Pipeline stages

1. **Load & filter**: parse `stops.txt`, `routes.txt`, `trips.txt`, `calendar.txt`/`calendar_dates.txt`,
   filter to the Helsinki region bbox.
2. **Pick one representative week**: use the earliest full week within `calendar.txt`/`feed_info.txt`'s
   overall validity range (not a union across the feed's rolling multi-week cycle — resulting
   headways reflect that single week, re-run the pipeline to refresh).
3. **Classify service_id → day-type** (weekday / saturday / sunday) via `calendar.txt` days +
   `calendar_dates.txt` exceptions, restricted to that week.
4. **Stream `stop_times.txt`**: for each (stop_id, service_id) accumulate departure timestamps only
   — discard the row immediately after extracting time + trip/service refs.
5. **Bucket departures** per stop into the 3 time profiles (see jonkhakerroin-scoring skill for
   exact time windows) → per-stop headway (avg minutes between departures) per profile.
6. **Build spatial grid** over the region: H3 hexagons, ~250m edge length (see jonkhakerroin-scoring
   skill), and for each cell, the k-nearest stops within walking radius with walk time.
7. **Emit artifacts**: stop index (id, lat/lon, per-profile headway), grid index (cell id,
   centroid, nearest-stop refs+walk time), as compact JSON/typed-array-friendly binary.

## Output contract (apps/web/public/data)

- `stops.bin`/`stops.json` — stop id, lat, lon, headway[3]
- `grid.bin`/`grid.json` — cell id, centroid, [stopIndex, walkMinutes] list
- `meta.json` — GTFS feed version/date range, region bbox, generation timestamp (for cache-busting
  and attribution display)

Keep output format documented only in this file + the scoring skill — do not duplicate elsewhere.
