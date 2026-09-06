# Jonkhaopas — Copilot Instructions

## What this is

Single-page web app (Helsinki region) where a user drops 1+ locations (home/work/etc.) and
picks weighting for three travel-time profiles — **work** (weekday daytime), **weekday evening**,
**weekend** — and gets a **Jonkhakerroin** heatmap: a public-transport connectivity score per
map cell. **Lower score = better connectivity.**

Data source: HSL GTFS feed in `data/hsl/` (see [gtfs-hsl-data skill](skills/gtfs-hsl-data/SKILL.md)).
`data/hsl/stop_times.txt` is 50+ MB — never load it raw in the browser or read it whole into an editor.
All GTFS processing happens offline/build-time in `tools/gtfs-pipeline`, producing small static
artifacts consumed by the frontend.

## Dev environment (required, not optional)

This repo has a `.devcontainer/`. **All commands — `npm install`, `npm run dev`, pipeline scripts,
tests, linting — MUST run inside the dev container, never on the host.** If a terminal isn't
already inside the container, use the Dev Containers CLI (`devcontainer exec --workspace-folder . -- <cmd>`)
or VS Code's "Reopen in Container" first. Do not install project dependencies on the host.

### Restart Vite with a cleared cache — don't just trust a long-running dev server

Vite's file watcher relies on inotify events that frequently don't propagate reliably through
Windows-host Docker bind mounts, so a `npm run dev` process that's been running for a while can
silently keep serving a **stale** transform of a changed file — a browser page reload does NOT
fix this, since the staleness lives in the Vite server's own module cache, not the browser tab.
This is especially easy to miss for Web Worker source files (anything under `src/worker/`),
since workers don't participate in normal HMR anyway even when the watcher IS working.

Restart the dev server (`fuser -k 5173/tcp`, `rm -rf apps/web/node_modules/.vite`, then
`npm run dev` again — or the "Dev: Restart Vite" task, which does exactly this) whenever:

- You've edited `src/worker/*.ts` (scoring.worker.ts, cost.ts) or any other file the worker
  imports, and the dev server has been running since before those edits.
- A fix "doesn't seem to work at all" or "doesn't move the needle" in the browser despite solid
  diagnostics proving the logic is correct in isolation (e.g. a standalone `tsx` script against
  the same source reproduces the expected behavior but the browser doesn't).
- You're about to do a round of "verify in the browser" after a longer stretch of source edits
  and haven't restarted the dev server in that time.

To confirm staleness before restarting (or confirm a restart fixed it), diff what's actually
served against what's on disk, e.g.:

```
curl -s http://localhost:5173/src/worker/cost.ts | diff - apps/web/src/worker/cost.ts
```

A large diff (or a served file that's suspiciously shorter/older-looking) means the dev server
needs a restart, not another source edit.

## Stack decisions (do not relitigate without reason)

- Frontend: Vite + React + TypeScript, MapLibre GL JS, vector tiles (OpenFreeMap, no API key).
- State: React state/hooks only — no Redux/MobX for this scope.
- Styling: CSS modules or vanilla-extract; no heavy UI framework. Dark, map-first UI.
- Data pipeline: Node.js + TypeScript, streaming CSV parsing (`csv-parse` or custom).
- No general-purpose backend. Any server-side need must be a static build step or a single
  serverless function — call it out explicitly before adding one.
- Package manager: npm.

## Repo layout

```
apps/web/              SPA (Vite/React/TS)
tools/gtfs-pipeline/    offline GTFS -> static artifacts (grid, stop index, frequency profiles)
data/hsl/               raw GTFS (read-only, not shipped to client)
.devcontainer/          dev container definition — all tooling runs here, not on host
.github/                instructions + skills (this file, instructions/*, skills/*)
```

## Conventions

- Terse. No filler comments, no restating obvious code, no per-function doc comments.
- One README.md at repo root covering setup/run only. Do not scatter extra markdown docs.
- TypeScript: explicit types on public function signatures; prefer `type` over `interface` unless
  extending; one component/class per file.
- Prefer composition over inheritance.
- Attribution: HSL GTFS data and OSM tiles are CC BY 4.0 — surface attribution in the UI footer,
  not just docs.
- License for this project's own code/output: CC BY 4.0 (see `LICENSE`).

## Relevant instructions/skills

- [apps/web instructions](instructions/frontend.instructions.md) — frontend/MapLibre conventions.
- [tools/gtfs-pipeline instructions](instructions/data-pipeline.instructions.md) — GTFS processing rules.
- [gtfs-hsl-data skill](skills/gtfs-hsl-data/SKILL.md) — HSL feed quirks and structure.
- [jonkhakerroin-scoring skill](skills/jonkhakerroin-scoring/SKILL.md) — the scoring algorithm.
- [map-visualization skill](skills/map-visualization/SKILL.md) — MapLibre heatmap styling/perf.

Read the relevant instruction/skill file before touching its area. Don't guess at GTFS semantics
or scoring math — they're specified there.
