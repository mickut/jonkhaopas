# Jonkhaopas

Single-page map app for the Helsinki region: drop pins for your places, weight three travel
profiles (work / weekday evening / weekend), and see the **Jonkhakerroin** — a public-transport
connectivity score per map cell. Lower is better.

## History

Jonkhaopas ("middle-of-nowhere guide") is a tongue-in-cheek take on HSL's official journey
planner, "Reittiopas". The original version was built in 2002-2003 by the author while figuring
out where to live next, (mis)using YTV's (HSL's predecessor) REST API to estimate travel times.
This version instead runs entirely offline against HSL's Open Data GTFS feed, pre-processed into
small static artifacts so the map stays responsive.

## Structure

- `apps/web` — the SPA (Vite + React + TypeScript + MapLibre GL JS)
- `tools/gtfs-pipeline` — offline GTFS → static data artifacts
- `data/hsl` — raw HSL GTFS feed (not shipped to the client, not tracked in git — see below)
- `.devcontainer` — dev container definition; all commands below run inside it
- `.github` — Copilot instructions/skills; see `.github/copilot-instructions.md` first
- `PLAN.md` — implementation plan/phases

## Dev container (required)

All tooling (npm install, dev servers, pipeline scripts) runs inside the dev container — never on
the host. Open this folder in VS Code and choose **Reopen in Container**, or via CLI:

```powershell
npm install -g @devcontainers/cli
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . -- bash
```

## Run the data pipeline

The raw HSL GTFS feed isn't tracked in git (`stop_times.txt` alone is ~873MB) — download it first:

```powershell
mkdir data/hsl -Force
Invoke-WebRequest https://dev.hsl.fi/gtfs/hsl.zip -OutFile data/hsl.zip
Expand-Archive data/hsl.zip -DestinationPath data/hsl -Force
Remove-Item data/hsl.zip
```

(CC BY 4.0, HSL — see [hsl.fi/en/hsl/open-data](https://www.hsl.fi/en/hsl/open-data) for other
distribution channels and terms.)

Then build the static artifacts the app consumes:

```powershell
cd tools/gtfs-pipeline
npm install
npm run build:data   # reads ../../data/hsl, writes apps/web/public/data/*.json
```

The pipeline streams the large `stop_times.txt` file and should be rerun when the HSL feed is
refreshed.

## Run the app

```powershell
cd apps/web
npm install
npm run dev
```

For a production check:

```powershell
npm test
npm run build
```

In the app, select a destination category before clicking the map: work spots, weekday-evening
stops, and weekend spots are scored independently. Add at least one destination to each category
to activate the heatmap. Lower Jonkhakerroin values indicate better connectivity; the map uses a
logarithmic color scale and the metric is intentionally unitless.

## License

Code and docs: CC BY 4.0 (see `LICENSE`). Transit data: HSL, CC BY 4.0. Map data: OpenStreetMap
contributors. Attribution shown in-app footer.
