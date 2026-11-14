// Copies MapLibre's ES-module web worker into public/ so the browser can load it from our own origin.
// maplibre-gl 6 looks for the worker next to its own module file, which the bundler does not emit;
// FieldMap calls setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"). Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const target = join(process.cwd(), "public", "maplibre");
mkdirSync(target, { recursive: true });
copyFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), join(target, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs to public/maplibre/");
