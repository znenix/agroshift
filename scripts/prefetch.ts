/**
 * Downloads raw data into data/raw/ (network, resumable): NASA POWER daily climate for the climate
 * cells and the 6 demo farms, MODIS NDVI and land cover, SoilGrids, elevation. SPEC §3 and §4.1.
 * Implemented in Phase 1; until then it exits with code 1 so nobody mistakes it for a real run.
 *
 * Usage: npm run prefetch                  demo farms first, then all climate cells
 *        npm run prefetch -- --farms-only  the 6 demo farms only
 */
import process from "node:process";

// `npm run prefetch --farms-only` (without `--`) reaches the script as npm_config_farms_only instead.
const farmsOnly = process.argv.slice(2).includes("--farms-only") || process.env.npm_config_farms_only === "true";

console.error(`prefetch${farmsOnly ? " --farms-only" : ""}: not implemented yet (Phase 1). Nothing was downloaded.`);
process.exitCode = 1;
