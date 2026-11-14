/**
 * Builds the static data the app serves (offline, fast): data/raw/ → public/data/
 * (cells/, farms/, grid.json, regions.json). SPEC §4.2.
 * Implemented in Phase 1; until then it exits with code 1 so nobody mistakes it for a real run.
 */
import process from "node:process";

console.error("build-data: not implemented yet (Phase 1). public/data/ was not changed.");
process.exitCode = 1;
