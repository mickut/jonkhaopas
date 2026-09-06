// Copies maplibre-gl's self-hosted worker + its internal shared chunk into public/, unhashed,
// so the worker's own relative import ("./maplibre-gl-shared.mjs") resolves at runtime — Vite's
// `?url` asset pipeline only copies+hashes a single file, breaking that sibling-file reference.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..", "node_modules", "maplibre-gl", "dist");
const destDir = path.resolve(here, "..", "public", "maplibre");

mkdirSync(destDir, { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  // copyFileSync fails with EPERM on some bind-mounted dev volumes; read+write avoids that syscall.
  writeFileSync(path.join(destDir, name), readFileSync(path.join(srcDir, name)));
}
