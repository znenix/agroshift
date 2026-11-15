/**
 * Downloads raw data into data/raw/ (network, resumable). SPEC §3 and §4.1.
 *
 *   1. Boundaries: geoBoundaries UZB ADM0 and ADM1.
 *   2. Demo-farm points: for each city, the nearest pixel within 25 km (inside the farm's region) whose
 *      1 km MCD12Q1 window is mostly cropland (IGBP 12/14) and whose July–August NDVI is high.
 *      The choice and the reason are written to data/regions.json.
 *   3. Demo farms: NASA POWER daily, the MOD13Q1 NDVI series since 2006, MCD12Q1, SoilGrids and
 *      elevation with 4 neighbours (for slope).
 *   4. Climate cells (skipped with --farms-only): NASA POWER daily for every native POWER cell
 *      (0.5° × 0.625°) that overlaps Uzbekistan.
 *
 * Every response is validated with zod before it is saved; valid files already on disk are reused,
 * so an interrupted run can simply be started again.
 *
 * Usage: npm run prefetch [-- --farms-only] [-- --reselect] [-- --farm=<id>]
 *   --farm=<id> limits steps 2–3 to one demo farm (implies --farms-only); the other farms are not touched.
 */
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import {
  CROPLAND_CLASSES,
  DEMO_MAX_NDVI_CANDIDATES,
  DEMO_SEARCH_RADIUS_KM,
  DEMO_SKIP_NEAR_REJECTED_KM,
  DEMO_SUMMER_MONTHS,
  DEMO_SUMMER_NDVI_MIN,
  DEMO_SUMMER_YEARS,
  GEOBOUNDARIES_API_URL,
  IGBP_CLASSES,
  MCD12Q1,
  MOD13Q1,
  MODIS_WINDOW_KM,
  NDVI_SHORT_RECORD_START,
  RECORD_START,
  SOILGRIDS_MIN_INTERVAL_MS,
} from "@/lib/constants";
import { addDays, todayIso } from "@/lib/dates";
import { elevationResponseSchema, elevationUrl, slopeSamplePoints } from "@/lib/elevation";
import {
  haversineKm,
  pointInGeometry,
  powerCellsCovering,
  sinusoidalToLatLon,
  type AreaGeometry,
  type LatLon,
} from "@/lib/geo";
import { createLimiter, fetchJson } from "@/lib/http";
import {
  classMask,
  contiguousRuns,
  gridOf,
  ndviComposites,
  ornlDatesSchema,
  ornlDatesUrl,
  ornlSubsetSchema,
  ornlSubsetUrl,
  pixelCentre,
  summarizeClasses,
  windowValues,
  type OrnlDate,
  type OrnlSubset,
} from "@/lib/modis";
import { powerDailyResponseSchema, powerDailyUrl, type PowerDailyResponse } from "@/lib/power";
import { soilGridsResponseSchema, soilGridsUrl } from "@/lib/soil";
import { log, RAW_DIR, readJsonIfValid, relative, removeDir, writeJsonAtomic } from "./lib/io";
import {
  boundaryCollectionSchema,
  farmRawMetaSchema,
  geoBoundariesMetaSchema,
  loadRegionsSource,
  saveRegionsSource,
  toAreaGeometry,
  type BoundaryCollection,
  type DemoFarmSource,
  type DemoPoint,
} from "./lib/sources";

const args = new Set(process.argv.slice(2));
// `npm run prefetch --farms-only` (without `--`) reaches the script as npm_config_farms_only.
const farmsOnlyFlag = args.has("--farms-only") || process.env.npm_config_farms_only === "true";
const reselect = args.has("--reselect") || process.env.npm_config_reselect === "true";
const onlyFarm = [...args].find((a) => a.startsWith("--farm="))?.slice("--farm=".length) ?? null;
const farmsOnly = farmsOnlyFlag || onlyFarm !== null;

// ── Polite access: at most 3 parallel requests per service, a small delay, backoff (SPEC §3.1) ──

const limiters = {
  power: createLimiter(3, 300),
  ornl: createLimiter(3, 300),
  soilgrids: createLimiter(1, SOILGRIDS_MIN_INTERVAL_MS),
  openMeteo: createLimiter(2, 250),
  geoBoundaries: createLimiter(2, 0),
};

type Service = keyof typeof limiters;
const TIMEOUT_MS: Record<Service, number> = {
  power: 180_000,
  ornl: 180_000,
  soilgrids: 60_000,
  openMeteo: 30_000,
  geoBoundaries: 120_000,
};

let requestCount = 0;

function get<T>(service: Service, url: string, schema: z.ZodType<T>, priority = false): Promise<T> {
  return limiters[service](async () => {
    const result = await fetchJson(url, {
      schema,
      timeoutMs: TIMEOUT_MS[service],
      retries: 4,
      backoffMs: service === "ornl" ? 5_000 : 2_000,
      onRetry: (attempt, reason) => log(service, `retry ${attempt} after ${reason}: ${url.slice(0, 140)}`),
    });
    requestCount++;
    return result;
  }, priority);
}

/** The validated file at `file`, or fetch it, validate it and save it. */
async function cached<T>(file: string, schema: z.ZodType<T>, fetcher: () => Promise<T>, maxAgeDays?: number): Promise<T> {
  const existing = await readJsonIfValid(file, schema, maxAgeDays);
  if (existing !== null) return existing;
  const fresh = await fetcher();
  await writeJsonAtomic(file, fresh);
  return fresh;
}

/** "Latest available" resources (date lists, POWER up to today) are refreshed after a week. */
const REFRESH_DAYS = 7;

// ── 1. Boundaries ────────────────────────────────────────────────────────────

interface Boundaries {
  country: AreaGeometry;
  regions: Map<string, AreaGeometry>;
}

async function fetchBoundaries(): Promise<Boundaries> {
  const dir = path.join(RAW_DIR, "boundaries");
  const collections: Record<"ADM0" | "ADM1", BoundaryCollection> = {
    ADM0: { type: "FeatureCollection", features: [] },
    ADM1: { type: "FeatureCollection", features: [] },
  };
  for (const level of ["ADM0", "ADM1"] as const) {
    const meta = await cached(path.join(dir, `geoBoundaries-UZB-${level}.meta.json`), geoBoundariesMetaSchema, () =>
      get("geoBoundaries", `${GEOBOUNDARIES_API_URL}/${level}/`, geoBoundariesMetaSchema),
    );
    collections[level] = await cached(path.join(dir, `geoBoundaries-UZB-${level}.geojson`), boundaryCollectionSchema, () =>
      get("geoBoundaries", meta.gjDownloadURL, boundaryCollectionSchema),
    );
    await cached(path.join(dir, `geoBoundaries-UZB-${level}_simplified.geojson`), boundaryCollectionSchema, () =>
      get("geoBoundaries", meta.simplifiedGeometryGeoJSON, boundaryCollectionSchema),
    );
  }
  const countryFeature = collections.ADM0.features[0];
  if (countryFeature === undefined) throw new Error("geoBoundaries ADM0 has no feature");
  const regions = new Map(collections.ADM1.features.map((f) => [f.properties.shapeISO, toAreaGeometry(f.geometry)]));
  if (regions.size !== 14) throw new Error(`expected 14 ADM1 regions, got ${regions.size}`);
  log("boundaries", `country + ${regions.size} regions ready`);
  return { country: toAreaGeometry(countryFeature.geometry), regions };
}

// ── 2. Demo-farm selection (SPEC §4.1) ───────────────────────────────────────

const ornlDates = (file: string, product: string, point: LatLon, priority = false) =>
  cached(file, ornlDatesSchema, () => get("ornl", ornlDatesUrl(product, point), ornlDatesSchema, priority), REFRESH_DAYS);

const ornlSubset = (file: string, args: Parameters<typeof ornlSubsetUrl>[0], priority = false) =>
  cached(file, ornlSubsetSchema, () => get("ornl", ornlSubsetUrl(args), ornlSubsetSchema, priority));

function firstComposite(subset: OrnlSubset): number[] {
  const composite = subset.subset[0];
  if (composite === undefined) throw new Error(`empty ORNL subset: ${subset.header}`);
  return composite.data;
}

function lastOf<T>(items: readonly T[], what: string): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error(`no ${what}`);
  return item;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

async function selectDemoPoint(farm: DemoFarmSource, boundaries: Boundaries): Promise<DemoPoint> {
  const scope = farm.id;
  const dir = path.join(RAW_DIR, "selection", farm.id);
  const region = boundaries.regions.get(farm.region);
  if (region === undefined) throw new Error(`no boundary for region ${farm.region}`);
  const origin: LatLon = { lat: farm.city.lat, lon: farm.city.lon };

  // Land cover for the whole search area in one request, latest MCD12Q1 year.
  const lcDates = await ornlDates(path.join(dir, "mcd12q1_dates.json"), MCD12Q1.product, origin, true);
  const lcLatest = lastOf(lcDates.dates, "MCD12Q1 dates");
  const lcYear = Number(lcLatest.calendar_date.slice(0, 4));
  const halfKm = Math.ceil(DEMO_SEARCH_RADIUS_KM + MODIS_WINDOW_KM);
  const area = await ornlSubset(path.join(dir, `mcd12q1_${lcLatest.modis_date}_${halfKm}km.json`), {
    product: MCD12Q1.product,
    band: MCD12Q1.band,
    point: origin,
    startDate: lcLatest.modis_date,
    endDate: lcLatest.modis_date,
    kmAboveBelow: halfKm,
    kmLeftRight: halfKm,
  }, true);
  const grid = gridOf(area);
  const classes = firstComposite(area);
  const halfPixels = Math.round((MODIS_WINDOW_KM * 1000) / grid.cellsize);

  let pixelsInRadius = 0;
  const candidates: Array<{ point: LatLon; distance: number }> = [];
  for (let row = 0; row < grid.nrows; row++) {
    for (let col = 0; col < grid.ncols; col++) {
      const { x, y } = pixelCentre(grid, row, col);
      const point = sinusoidalToLatLon(x, y);
      const distance = haversineKm(origin, point);
      if (distance > DEMO_SEARCH_RADIUS_KM || !pointInGeometry(point, region)) continue;
      pixelsInRadius++;
      const window = windowValues(grid, classes, row, col, halfPixels);
      if (window === null) continue;
      const summary = summarizeClasses(window);
      if (summary.majority !== null && CROPLAND_CLASSES.includes(summary.majority)) candidates.push({ point, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  log(scope, `${candidates.length} cropland candidates among ${pixelsInRadius} pixels within ${DEMO_SEARCH_RADIUS_KM} km`);

  // Nearest first: confirm land cover at the exact point and require a high July–August NDVI.
  const ndviDates = await ornlDates(path.join(dir, "mod13q1_dates.json"), MOD13Q1.product, origin, true);
  const summer = ndviDates.dates.filter((d) => {
    const year = Number(d.calendar_date.slice(0, 4));
    const month = Number(d.calendar_date.slice(5, 7));
    return DEMO_SUMMER_YEARS.includes(year) && DEMO_SUMMER_MONTHS.includes(month);
  });
  if (summer.length === 0) throw new Error("no July–August MOD13Q1 composites in the selection years");

  const rejected: LatLon[] = [];
  let checked = 0;
  let skipped = 0;
  const reject = (candidate: { point: LatLon }) => rejected.push(candidate.point);
  for (const candidate of candidates) {
    if (checked >= DEMO_MAX_NDVI_CANDIDATES) break;
    if (rejected.some((r) => haversineKm(r, candidate.point) < DEMO_SKIP_NEAR_REJECTED_KM)) {
      skipped++;
      continue;
    }
    const index = checked++;
    const key = `${candidate.point.lat.toFixed(5)}_${candidate.point.lon.toFixed(5)}`;
    const lc = await ornlSubset(path.join(dir, `candidate_${key}_mcd12q1.json`), {
      product: MCD12Q1.product,
      band: MCD12Q1.band,
      point: candidate.point,
      startDate: lcLatest.modis_date,
      endDate: lcLatest.modis_date,
    }, true);
    const lcSummary = summarizeClasses(firstComposite(lc));
    if (lcSummary.majority === null || !CROPLAND_CLASSES.includes(lcSummary.majority)) {
      log(scope, `candidate ${index + 1} (${candidate.distance.toFixed(1)} km): point window is not mostly cropland, skipped`);
      reject(candidate);
      continue;
    }
    // One request per run of consecutive composites (here: one per summer), never a range that spans more.
    const fetchBand = (band: string) =>
      Promise.all(
        contiguousRuns(ndviDates.dates, summer).map((run) => {
          const first = run[0]?.modis_date ?? "";
          const last = lastOf(run, "dates").modis_date;
          return ornlSubset(path.join(dir, `candidate_${key}_${band}_${first}_${last}.json`), {
            product: MOD13Q1.product,
            band,
            point: candidate.point,
            startDate: first,
            endDate: last,
          }, true);
        }),
      );
    const [ndvi, reliability] = await Promise.all([fetchBand(MOD13Q1.ndviBand), fetchBand(MOD13Q1.reliabilityBand)]);
    const firstNdvi = ndvi[0];
    if (firstNdvi === undefined) {
      reject(candidate);
      continue;
    }
    const mask = classMask(gridOf(firstNdvi), gridOf(lc), firstComposite(lc), CROPLAND_CLASSES);
    const composites = ndviComposites(ndvi, reliability, mask);
    let peak: { ndvi: number; date: string } | null = null;
    for (const c of composites) if (c.ndvi !== null && (peak === null || c.ndvi > peak.ndvi)) peak = { ndvi: c.ndvi, date: c.date };
    if (peak === null || peak.ndvi < DEMO_SUMMER_NDVI_MIN) {
      log(scope, `candidate ${index + 1} (${candidate.distance.toFixed(1)} km): summer NDVI peak ${peak?.ndvi ?? "n/a"} < ${DEMO_SUMMER_NDVI_MIN}, skipped`);
      reject(candidate);
      continue;
    }
    const cls = lcSummary.majority;
    const share = lcSummary.majorityCount / lcSummary.total;
    const reason =
      `Nearest pixel to ${farm.city.names.en} (${candidate.distance.toFixed(1)} km away, inside ${farm.region}) whose 1 km ` +
      `MCD12Q1 ${lcYear} window is mostly class ${cls} (${IGBP_CLASSES[cls] ?? "unknown"}, ${lcSummary.majorityCount}/${lcSummary.total} pixels) ` +
      `and whose July–August NDVI reached ${peak.ndvi.toFixed(2)} (composite of ${peak.date}); ${index + 1} candidate(s) checked` +
      (skipped > 0 ? `, ${skipped} skipped within ${DEMO_SKIP_NEAR_REJECTED_KM} km of a rejected one.` : ".");
    log(scope, `selected ${candidate.point.lat.toFixed(5)}, ${candidate.point.lon.toFixed(5)}: ${reason}`);
    return {
      lat: round(candidate.point.lat, 6),
      lon: round(candidate.point.lon, 6),
      distance_km: round(candidate.distance, 1),
      land_cover: { product: "MCD12Q1", year: lcYear, majority_class: cls, majority_share: round(share, 2) },
      summer_ndvi: { peak: peak.ndvi, peak_date: peak.date, years: [...DEMO_SUMMER_YEARS] },
      candidates: { pixels_in_radius: pixelsInRadius, cropland_candidates: candidates.length, ndvi_checked: index + 1 },
      reason,
      selected_on: todayIso(),
    };
  }
  throw new Error(
    `${farm.id}: none of the ${checked} cropland candidates checked (${skipped} skipped as near-duplicates) reached ` +
      `July–August NDVI ${DEMO_SUMMER_NDVI_MIN}. Not relaxing the rule automatically — report and decide.`,
  );
}

// ── 3. Demo-farm data ────────────────────────────────────────────────────────

/** POWER daily from RECORD_START to today; if the full request fails, 5-year blocks (SPEC §3.1). */
async function fetchPower(dir: string, point: LatLon, scope: string): Promise<void> {
  const end = todayIso();
  const full = path.join(dir, "power.json");
  if ((await readJsonIfValid(full, powerDailyResponseSchema, REFRESH_DAYS)) !== null) return;
  try {
    await writeJsonAtomic(full, await get("power", powerDailyUrl(point, RECORD_START, end), powerDailyResponseSchema));
    return;
  } catch (error) {
    log(scope, `full-range POWER request failed (${error instanceof Error ? error.message : String(error)}); using 5-year blocks`);
  }
  const blocks: Array<Promise<PowerDailyResponse>> = [];
  for (let year = Number(RECORD_START.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 5) {
    const start = `${year}-01-01`;
    const blockEnd = [addDays(`${year + 5}-01-01`, -1), end].sort()[0] ?? end;
    blocks.push(
      cached(path.join(dir, "power_blocks", `${start}_${blockEnd}.json`), powerDailyResponseSchema, () =>
        get("power", powerDailyUrl(point, start, blockEnd), powerDailyResponseSchema),
      ),
    );
  }
  await Promise.all(blocks);
}

async function fetchFarm(farm: DemoFarmSource, point: DemoPoint): Promise<void> {
  const scope = farm.id;
  const dir = path.join(RAW_DIR, "farms", farm.id);
  const metaFile = path.join(dir, "meta.json");
  let meta = await readJsonIfValid(metaFile, farmRawMetaSchema);
  if (meta !== null && (meta.lat !== point.lat || meta.lon !== point.lon)) {
    log(scope, "demo point changed: discarding old raw farm data");
    await removeDir(dir);
    meta = null;
  }
  const writeMeta = (ndviStart: string | undefined) =>
    writeJsonAtomic(metaFile, { lat: point.lat, lon: point.lon, ...(ndviStart === undefined ? {} : { ndvi_start: ndviStart }) });
  await writeMeta(meta?.ndvi_start);
  const p: LatLon = { lat: point.lat, lon: point.lon };

  await fetchPower(dir, p, scope);
  log(scope, "POWER daily ready");

  await cached(path.join(dir, "soilgrids.json"), soilGridsResponseSchema, () => get("soilgrids", soilGridsUrl(p), soilGridsResponseSchema));
  await cached(path.join(dir, "elevation.json"), elevationResponseSchema, () =>
    get("openMeteo", elevationUrl(slopeSamplePoints(p)), elevationResponseSchema),
  );
  log(scope, "SoilGrids and elevation ready");

  const lcDates = await ornlDates(path.join(dir, "mcd12q1_dates.json"), MCD12Q1.product, p);
  const lcLatest = lastOf(lcDates.dates, "MCD12Q1 dates");
  await ornlSubset(path.join(dir, `mcd12q1_${lcLatest.modis_date}.json`), {
    product: MCD12Q1.product,
    band: MCD12Q1.band,
    point: p,
    startDate: lcLatest.modis_date,
    endDate: lcLatest.modis_date,
  });

  const ndviDates = await ornlDates(path.join(dir, "mod13q1_dates.json"), MOD13Q1.product, p);
  // Request runs always follow the grid of the full record (2006 →), so files already on disk keep matching.
  const runs = contiguousRuns(ndviDates.dates, ndviDates.dates.filter((d) => d.calendar_date >= RECORD_START));
  const bands = [MOD13Q1.ndviBand, MOD13Q1.reliabilityBand];
  const runFile = (band: string, run: OrnlDate[]) =>
    path.join(dir, "mod13q1", `${band}_${run[0]?.modis_date ?? ""}_${lastOf(run, "dates").modis_date}.json`);

  // NDVI period, decided once per farm and kept in meta.json (team decision 2026-11-14): a farm whose
  // full record is already on disk keeps it; any other farm fetches from NDVI_SHORT_RECORD_START.
  let ndviStart = meta?.ndvi_start;
  if (ndviStart === undefined) {
    const present = await Promise.all(
      bands.flatMap((band) => runs.map(async (run) => (await readJsonIfValid(runFile(band, run), ornlSubsetSchema)) !== null)),
    );
    ndviStart = present.every(Boolean) ? RECORD_START : NDVI_SHORT_RECORD_START;
    await writeMeta(ndviStart);
  }
  const start = ndviStart;
  log(scope, `NDVI period ${start} → latest${start === RECORD_START ? " (full record)" : " (shorter record, team decision)"}`);

  const wanted = runs.filter((run) => lastOf(run, "dates").calendar_date >= start);
  const total = wanted.length * bands.length;
  let done = 0;
  await Promise.all(
    bands.flatMap((band) =>
      wanted.map(async (run) => {
        await ornlSubset(runFile(band, run), {
          product: MOD13Q1.product,
          band,
          point: p,
          startDate: run[0]?.modis_date ?? "",
          endDate: lastOf(run, "dates").modis_date,
        });
        done++;
        if (done % 8 === 0 || done === total) log(scope, `MOD13Q1 ${done}/${total} requests ready`);
      }),
    ),
  );
  const composites = wanted.flat().filter((d) => d.calendar_date >= start);
  log(scope, `all raw data ready (${composites.length} NDVI composites, ${composites[0]?.calendar_date} → ${composites.at(-1)?.calendar_date})`);
}

// ── 4. Climate cells ─────────────────────────────────────────────────────────

async function fetchCells(boundaries: Boundaries): Promise<string[]> {
  const cells = powerCellsCovering(boundaries.country);
  log("cells", `${cells.length} native POWER cells overlap Uzbekistan`);
  const failures: string[] = [];
  let done = 0;
  await Promise.all(
    cells.map(async (cell) => {
      try {
        await fetchPower(path.join(RAW_DIR, "cells", cell.id), { lat: cell.lat, lon: cell.lon }, `cell ${cell.id}`);
      } catch (error) {
        failures.push(`${cell.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      done++;
      if (done % 20 === 0 || done === cells.length) log("cells", `${done}/${cells.length} done`);
    }),
  );
  return failures;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const started = Date.now();
  log("prefetch", `start${farmsOnly ? " (demo farms only)" : ""}${reselect ? " (reselecting demo points)" : ""}${onlyFarm !== null ? ` (only ${onlyFarm})` : ""}; raw data in ${relative(RAW_DIR)}`);
  const boundaries = await fetchBoundaries();
  const source = await loadRegionsSource();
  if (onlyFarm !== null && !source.demo_farms.some((f) => f.id === onlyFarm)) throw new Error(`no demo farm with id ${onlyFarm}`);
  const failures: string[] = [];

  // Each farm runs on its own: select → save its point → download its data, so a slow selection
  // never holds up the other farms. Saves of data/regions.json are serialised through one queue.
  let saving: Promise<void> = Promise.resolve();
  const persist = () => (saving = saving.then(() => saveRegionsSource(source)));
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const farmsDone = Promise.all(
    source.demo_farms.filter((farm) => onlyFarm === null || farm.id === onlyFarm).map(async (farm) => {
      let point = farm.point;
      if (point === null || reselect) {
        try {
          point = await selectDemoPoint(farm, boundaries);
        } catch (error) {
          failures.push(`${farm.id} selection: ${message(error)}`);
          return;
        }
        farm.point = point;
        await persist();
        log(farm.id, `point saved to ${relative(path.join(process.cwd(), "data", "regions.json"))}`);
      }
      try {
        await fetchFarm(farm, point);
      } catch (error) {
        failures.push(`${farm.id} data: ${message(error)}`);
      }
    }),
  );
  // The climate cells use another server (NASA POWER), so they run alongside the MODIS downloads;
  // each server keeps its own limit of 3 parallel requests (shared limiters in this process).
  const cellsDone = farmsOnly ? Promise.resolve<string[]>([]) : fetchCells(boundaries);
  const [, cellFailures] = await Promise.all([farmsDone, cellsDone]);
  failures.push(...cellFailures);
  await saving;

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  log("prefetch", `finished in ${minutes} min, ${requestCount} network requests`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s) — run again to retry (completed downloads are kept):\n  ${failures.join("\n  ")}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  },
);
