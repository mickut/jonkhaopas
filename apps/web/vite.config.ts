import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project site at /jonkhaopas/, not the domain root.
  base: command === "build" ? "/jonkhaopas/" : "/",
  plugins: [react()],
  // maplibre-gl ships its own web worker; Vite's dep pre-bundling breaks that worker's
  // relative import resolution, silently stalling all vector tile requests.
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
}));
