/**
 * Offline sanity check of the 7 demo farms in public/data/ (SPEC §10).
 *
 * FAIL (exit 1): missing or invalid file; point outside Uzbekistan or its region; climate record not
 * starting 2006-01-01, any of the 20 complete years 2006–2025 missing or excluded, implausible values
 * (unit errors); NDVI coverage below the thresholds below; land cover not cropland; soil unknown.
 * WARN: things to know but not blocking — stale data, salinity still unknown (team input), file size.
 * FAIL also when fewer than 4 rotations would be shown (current + 3 alternatives) for the SPEC §10
 * demo-script farmer: current rotation cotton → wheat, priorities water + soil health, water often short.
 *
 * The thresholds were fixed before looking at the data; do not loosen them to make a farm pass.
 */
import path from "node:path";
import process from "node:process";
import { stat } from "node:fs/promises";
import { calendarMonthMeans, completeYears, decodeClimate, frostStats } from "@/lib/climate";
import {
  CLIMATOLOGY_FIRST_YEAR,
  CLIMATOLOGY_LAST_YEAR,
  CROPLAND_CLASSES,
  NDVI_RECENT_YEARS,
  RECORD_START,
  SALINITY_CLASS_ECE,
} from "@/lib/constants";
import { calendarContext, cropsFileSchema, indexCrops, type Crop } from "@/lib/crops";
import { boundariesFileSchema, farmFileSchema, regionsFileSchema, type FarmFile, type RegionsFile, type SourceId } from "@/lib/datafiles";
import { dayCount, isoToUtcMs, todayIso } from "@/lib/dates";
import { decodeSeries } from "@/lib/encode";
import { pointInGeometry, type AreaGeometry } from "@/lib/geo";
import { expectedCover, satelliteCheck } from "@/lib/ndvi";
import { effectiveWeights, rankRotations } from "@/lib/ranking";
import { evaluateRotation, rotationsFileSchema, type FarmerInputs, type Rotation } from "@/lib/rotations";
import { dailyEt0 } from "@/lib/water";
import { DATA_DIR, PUBLIC_DATA_DIR, RAW_DIR, readJson, readJsonIfValid } from "./lib/io";
import { boundaryCollectionSchema, loadRegionsSource, toAreaGeometry } from "./lib/sources";

/** Share of a complete year's 23 composites that must have a value (clouds and snow remove some). */
const NDVI_MIN_YEAR_COVERAGE = 0.7;
/** Share of all composites since 2006 that must have a value. */
const NDVI_MIN_TOTAL_COVERAGE = 0.8;
const MAX_FILE_KB = 200;
const STALE_CLIMATE_DAYS = 14;
const STALE_NDVI_DAYS = 120;

type Status = "PASS" | "WARN" | "FAIL";
interface Check {
  status: Status;
  name: string;
  detail: string;
}

const daysAgo = (iso: string) => Math.round((Date.now() - isoToUtcMs(iso)) / 86_400_000);

/**
 * SPEC §10 demo script: priorities water + soil health, water often short. The current rotation is each
 * farm's `demo_rotation` (data/regions.json; Karakalpakstan follows the satellite: cotton every year).
 */
const DEMO_PROFILE = {
  weights: { water_saving: 3, soil_health: 3, forage: 0, income_market: 0, low_risk: 0, simplicity: 0 },
  reliability: "often_short",
} as const;
const DEMO_FARMER: FarmerInputs = {
  mode: "irrigated",
  irrigation: "furrow",
  waterAllocationM3PerHa: null,
  requiredShare: null,
  unavailableCrops: [],
  marketRating: {},
};
/** Current rotation + 3 alternatives (SPEC §10). */
const MIN_ROTATIONS_SHOWN = 4;

type RegionSalinity = RegionsFile["regions"][number]["salinity"];

function checkRotations(
  farm: FarmFile,
  current: string,
  salinity: RegionSalinity | undefined,
  crops: ReadonlyMap<string, Crop>,
  rotations: readonly Rotation[],
): Check[] {
  const climate = decodeClimate(farm.climate, farm.point.lat);
  const years = completeYears(climate).filter((y) => y >= CLIMATOLOGY_FIRST_YEAR && y <= CLIMATOLOGY_LAST_YEAR);
  const ece = salinity?.status === "estimated" && salinity.dominant_class !== null ? SALINITY_CLASS_ECE[salinity.dominant_class] : null;
  const calendar = calendarContext(climate);
  const et0 = dailyEt0(climate.dates, climate.tmax, climate.tmin, climate.lat);
  const frost = frostStats(climate, years);
  const evaluations = rotations.map((r) =>
    evaluateRotation(r, {
      calendar,
      et0,
      years,
      frost,
      crops,
      soil: { ph: farm.soil.ph_h2o, ece, eceSource: ece === null ? null : "regional_estimate", slopePct: farm.terrain.slope_pct },
      monthlyWindMs: calendarMonthMeans(farm.climate.monthly.start, farm.climate.monthly.wind_ms),
      farmer: DEMO_FARMER,
    }),
  );
  const ranking = rankRotations(evaluations, effectiveWeights(DEMO_PROFILE.weights, DEMO_PROFILE.reliability), current);
  const shown = (ranking.current === null ? 0 : 1) + ranking.top.length;
  const top = ranking.top.map((r) => `${r.evaluation.id} ${r.score.total ?? "–"}`).join(", ");
  const checks: Check[] = [
    {
      status: shown >= MIN_ROTATIONS_SHOWN ? "PASS" : "FAIL",
      name: "rotations shown",
      detail: `${shown} for the demo farmer — current ${current} ${ranking.current?.score.total ?? "–"}; ${top}; ${ranking.excluded.length} excluded`,
    },
  ];
  // What the satellite saw over the last 3 complete years versus the demo farmer's answer (SPEC §5.3).
  const answer = evaluations.find((e) => e.id === current);
  const recent = Array.from({ length: NDVI_RECENT_YEARS }, (_, i) => CLIMATOLOGY_LAST_YEAR - NDVI_RECENT_YEARS + 1 + i);
  const verdict =
    answer === undefined
      ? null
      : satelliteCheck(farm.ndvi.composites, expectedCover(answer.timeline, crops, answer.years.length), answer.years.length, recent);
  checks.push(
    verdict === null
      ? { status: "FAIL", name: "satellite check", detail: `cannot compare (${current} not evaluated)` }
      : {
          status: verdict.mismatches.length === 0 ? "PASS" : "WARN",
          name: "satellite check",
          detail:
            `${current} vs MODIS ${recent[0]}–${recent.at(-1)}: ${verdict.agree} agree, ${verdict.disagree} differ` +
            (verdict.mismatches.length === 0
              ? " — they agree"
              : ` — "please check": ${verdict.mismatches.map((m) => `${m.year} ${m.kind} ${m.from.slice(5)}→${m.to.slice(5)}`).join("; ")}`),
        },
  );
  return checks;
}

function checkClimate(farm: FarmFile, checks: Check[]): void {
  const c = farm.climate;
  const add = (status: Status, name: string, detail: string) => checks.push({ status, name, detail });
  const series = { tmax: decodeSeries(c.daily.tmax_c), tmin: decodeSeries(c.daily.tmin_c), precip: decodeSeries(c.daily.precip_mm) };
  const lengthsOk = Object.values(series).every((s) => s.length === c.days) && c.days === dayCount(c.start, c.end);
  add(lengthsOk && c.start === RECORD_START ? "PASS" : "FAIL", "climate record", `${c.start} → ${c.end}, ${c.days} days, cell ${c.cell.id}`);
  add(daysAgo(c.end) <= STALE_CLIMATE_DAYS ? "PASS" : "WARN", "climate freshness", `last day ${c.end} (${daysAgo(c.end)} days ago)`);

  const usable = c.years.filter((y) => y.year >= CLIMATOLOGY_FIRST_YEAR && y.year <= CLIMATOLOGY_LAST_YEAR && y.complete && !y.excluded);
  const expectedYears = CLIMATOLOGY_LAST_YEAR - CLIMATOLOGY_FIRST_YEAR + 1;
  const missingDays = c.years.reduce((sum, y) => sum + y.missing.tmax_c + y.missing.tmin_c + y.missing.precip_mm, 0);
  add(usable.length === expectedYears ? "PASS" : "FAIL", "complete years", `${usable.length}/${expectedYears} usable (2006–2025); ${missingDays} missing daily values in total`);

  let inverted = 0;
  let outOfRange = 0;
  for (let i = 0; i < c.days; i++) {
    const tmax = series.tmax[i];
    const tmin = series.tmin[i];
    const p = series.precip[i];
    if (typeof tmax === "number" && typeof tmin === "number" && tmax < tmin) inverted++;
    if (
      (typeof tmax === "number" && (tmax < -45 || tmax > 60)) ||
      (typeof tmin === "number" && (tmin < -50 || tmin > 45)) ||
      (typeof p === "number" && (p < 0 || p > 400))
    ) {
      outOfRange++;
    }
  }
  add(inverted === 0 && outOfRange === 0 ? "PASS" : "FAIL", "climate plausibility", `Tmax<Tmin on ${inverted} days, ${outOfRange} values outside physical ranges`);
}

function checkNdvi(farm: FarmFile, checks: Check[]): void {
  const n = farm.ndvi;
  const add = (status: Status, name: string, detail: string) => checks.push({ status, name, detail });
  const first = n.composites[0]?.date ?? "none";
  const last = n.composites.at(-1)?.date ?? "none";
  const valid = n.composites.filter((c) => c.ndvi !== null);
  const total = valid.length / Math.max(1, n.composites.length);
  const startYear = Number(n.period.start.slice(0, 4));
  const weakYears: string[] = [];
  for (let year = startYear; year <= CLIMATOLOGY_LAST_YEAR; year++) {
    const inYear = n.composites.filter((c) => c.date.startsWith(String(year)));
    const ok = inYear.filter((c) => c.ndvi !== null).length;
    if (inYear.length < 23 || ok / 23 < NDVI_MIN_YEAR_COVERAGE) weakYears.push(`${year} (${ok}/${inYear.length})`);
  }
  add(first >= n.period.start && first <= `${startYear}-01-31` ? "PASS" : "FAIL", "NDVI record", `${n.composites.length} composites, ${first} → ${last}`);
  add(
    n.period.start <= RECORD_START ? "PASS" : "WARN",
    "NDVI period",
    n.period.start <= RECORD_START
      ? `full record from ${n.period.start}`
      : `from ${n.period.start} only (team decision, SPEC asks 2006 →): trends and seasonal curves cover ${CLIMATOLOGY_LAST_YEAR - startYear + 1} complete years`,
  );
  add(
    weakYears.length === 0 && total >= NDVI_MIN_TOTAL_COVERAGE ? "PASS" : "FAIL",
    "NDVI coverage",
    `${valid.length}/${n.composites.length} composites with a value (${Math.round(total * 100)} %)` +
      (weakYears.length > 0 ? `; below ${NDVI_MIN_YEAR_COVERAGE * 100} % in ${weakYears.join(", ")}` : ""),
  );
  add(last !== "none" && daysAgo(last) <= STALE_NDVI_DAYS ? "PASS" : "WARN", "NDVI freshness", `last composite ${last} (${last === "none" ? "?" : daysAgo(last)} days ago)`);
  const outOfRange = valid.filter((c) => c.ndvi !== null && (c.ndvi < -0.2 || c.ndvi > 1)).length;
  add(outOfRange === 0 ? "PASS" : "FAIL", "NDVI plausibility", `${outOfRange} medians outside −0.2…1`);
  add(
    n.cropland_pixels * 2 > n.pixels ? "PASS" : "WARN",
    "NDVI pixels",
    `${n.cropland_pixels}/${n.pixels} pixels in the ${n.window_km} km window are cropland-like (MCD12Q1 ${n.mask_land_cover_year})`,
  );
}

async function checkFarm(id: string, regionNames: Map<string, string>, boundaries: Outlines | null): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (status: Status, name: string, detail: string) => checks.push({ status, name, detail });
  const file = path.join(PUBLIC_DATA_DIR, "farms", `${id}.json`);
  const farm = await readJsonIfValid(file, farmFileSchema);
  if (farm === null) {
    add("FAIL", "file", `public/data/farms/${id}.json missing or invalid (run npm run build-data)`);
    return checks;
  }
  const sizeKb = (await stat(file)).size / 1024;
  add(sizeKb <= MAX_FILE_KB ? "PASS" : "WARN", "file", `valid, ${sizeKb.toFixed(0)} KB`);

  const p = { lat: farm.point.lat, lon: farm.point.lon };
  if (boundaries === null) {
    add("FAIL", "location", "public/data/boundaries.json missing");
  } else {
    const region = boundaries.regions.find((r) => r.id === farm.region);
    const inCountry = pointInGeometry(p, boundaries.country);
    const inRegion = region !== undefined && pointInGeometry(p, region.geometry);
    add(
      inCountry && inRegion ? "PASS" : "FAIL",
      "location",
      `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} — ${farm.point.distance_km} km from ${farm.city.names.en}, ${inRegion ? "in" : "NOT in"} ${regionNames.get(farm.region) ?? farm.region} (${boundaries.detail})`,
    );
  }

  checkClimate(farm, checks);
  checkNdvi(farm, checks);

  const lc = farm.land_cover;
  add(
    lc.majority_class !== null && CROPLAND_CLASSES.includes(lc.majority_class) ? "PASS" : "FAIL",
    "land cover",
    `MCD12Q1 ${lc.year}: class ${lc.majority_class ?? "none"} (${lc.majority_class_name ?? "tie"}), ${Math.round(lc.majority_share * 100)} % of the window`,
  );

  const s = farm.soil;
  const soilValues = [s.ph_h2o, s.soc_g_kg, s.clay_pct, s.sand_pct, s.silt_pct];
  const texture = (s.clay_pct ?? 0) + (s.sand_pct ?? 0) + (s.silt_pct ?? 0);
  add(
    s.status !== "unknown" && soilValues.every((v) => v !== null) ? (Math.abs(texture - 100) <= 3 ? "PASS" : "WARN") : "FAIL",
    "soil",
    `${s.status}: pH ${s.ph_h2o ?? "?"}, SOC ${s.soc_g_kg ?? "?"} g/kg, clay/sand/silt ${s.clay_pct ?? "?"}/${s.sand_pct ?? "?"}/${s.silt_pct ?? "?"} % (sum ${texture.toFixed(1)})`,
  );
  add(
    Number.isFinite(farm.terrain.slope_pct) && farm.terrain.slope_pct >= 0 && farm.terrain.slope_pct < 100 ? "PASS" : "FAIL",
    "terrain",
    `elevation ${farm.terrain.elevation_m} m, slope ${farm.terrain.slope_pct} %`,
  );
  const sourceIds = farm.sources.map((src) => src.id);
  const required: SourceId[] = ["nasa-power", "modis-ornl", "copernicus-dem"];
  const sourcesOk = required.every((id) => sourceIds.includes(id)) && (sourceIds.includes("soilgrids") || sourceIds.includes("team-soil"));
  add(sourcesOk ? "PASS" : "FAIL", "sources", sourceIds.join(", "));
  return checks;
}

interface Outlines {
  country: AreaGeometry;
  regions: Array<{ id: string; geometry: AreaGeometry }>;
  detail: string;
}

/**
 * Full-resolution geoBoundaries when the raw files are present: demo points sit close to region edges
 * (the nearest cropland to a city lies at the city boundary), closer than the ~500 m simplification
 * of public/data/boundaries.json. Falls back to the simplified file on machines without data/raw.
 */
async function loadBoundaries(): Promise<Outlines | null> {
  const dir = path.join(RAW_DIR, "boundaries");
  const adm0 = await readJsonIfValid(path.join(dir, "geoBoundaries-UZB-ADM0.geojson"), boundaryCollectionSchema);
  const adm1 = await readJsonIfValid(path.join(dir, "geoBoundaries-UZB-ADM1.geojson"), boundaryCollectionSchema);
  const countryFeature = adm0?.features[0];
  if (adm1 !== null && countryFeature !== undefined) {
    return {
      country: toAreaGeometry(countryFeature.geometry),
      regions: adm1.features.map((f) => ({ id: f.properties.shapeISO, geometry: toAreaGeometry(f.geometry) })),
      detail: "full-resolution geoBoundaries (data/raw)",
    };
  }
  const file = await readJsonIfValid(path.join(PUBLIC_DATA_DIR, "boundaries.json"), boundariesFileSchema);
  return file === null ? null : { country: file.country, regions: file.regions, detail: `public/data/boundaries.json, simplified ${file.tolerance_deg}°` };
}

async function main(): Promise<number> {
  const source = await loadRegionsSource();
  const regions = await readJsonIfValid(path.join(PUBLIC_DATA_DIR, "regions.json"), regionsFileSchema);
  const boundaries = await loadBoundaries();
  const regionNames = new Map(source.regions.map((r) => [r.id, r.names.en]));
  const crops = indexCrops((await readJson(path.join(DATA_DIR, "crops.json"), cropsFileSchema)).crops);
  const rotations = (await readJson(path.join(DATA_DIR, "rotations.json"), rotationsFileSchema)).rotations;
  let failed = 0;
  let warned = 0;
  console.log(`check-demo — ${todayIso()} — public/data/farms (thresholds fixed in scripts/check-demo.ts)\n`);
  for (const farm of source.demo_farms) {
    const checks = await checkFarm(farm.id, regionNames, boundaries);
    const salinity = regions?.regions.find((r) => r.id === farm.region)?.salinity;
    checks.push({
      status: salinity?.status === "estimated" ? "PASS" : "WARN",
      name: "salinity",
      detail: salinity?.status === "estimated" ? `${salinity.dominant_class} (estimated, ${salinity.source})` : "unknown — team input pending (data/manual/salinity_regions.json)",
    });
    const farmFile = await readJsonIfValid(path.join(PUBLIC_DATA_DIR, "farms", `${farm.id}.json`), farmFileSchema);
    checks.push(
      ...(farmFile === null
        ? [{ status: "FAIL", name: "rotations shown", detail: "no valid farm file" } satisfies Check]
        : checkRotations(farmFile, farm.demo_rotation, salinity, crops, rotations)),
    );
    const worst: Status = checks.some((c) => c.status === "FAIL") ? "FAIL" : checks.some((c) => c.status === "WARN") ? "WARN" : "PASS";
    if (worst === "FAIL") failed++;
    if (worst === "WARN") warned++;
    console.log(`${worst.padEnd(4)}  ${farm.id}`);
    for (const c of checks) console.log(`      ${c.status.padEnd(4)}  ${c.name.padEnd(20)} ${c.detail}`);
    console.log("");
  }
  console.log(`${source.demo_farms.length - failed}/${source.demo_farms.length} demo farms pass all checks (${warned} with warnings, ${failed} failing).`);
  return failed === 0 ? 0 : 1;
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

