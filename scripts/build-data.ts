/**
 * Builds the static data the app serves (offline, fast): data/raw/ → public/data/ (SPEC §4.2).
 *
 *   boundaries.json   simplified country and region outlines (map, point-in-country test)
 *   farms/{id}.json   the 7 demo farms: climate, NDVI series, land cover, soil, slope, sources
 *   cells/{id}.json   climate for every prefetched native POWER cell
 *   grid.json         list of cells (summary indicators are added in Phase 2)
 *   regions.json      regions with salinity status, and the demo-farm list
 *
 * Every file is validated against src/lib/datafiles.ts before it is written. Nothing is invented:
 * a missing input stays `null` and is reported.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import { annualClimate, climateTrends, decodeClimate } from "@/lib/climate";
import {
  BOUNDARY_SIMPLIFY_TOLERANCE_DEG,
  CLIMATOLOGY_FIRST_YEAR,
  CLIMATOLOGY_LAST_YEAR,
  CROPLAND_CLASSES,
  IGBP_CLASSES,
  MAX_MISSING_SHARE,
  MOD13Q1,
  MODIS_WINDOW_KM,
  POWER_GRID,
  RECORD_START,
  SLOPE_NEIGHBOUR_DISTANCE_M,
} from "@/lib/constants";
import {
  boundariesFileSchema,
  CLIMATE_ENCODING,
  cellFileSchema,
  cellIndicatorsSchema,
  dataMetaSchema,
  farmFileSchema,
  gridFileSchema,
  regionsFileSchema,
  type CellFile,
  type ClimateData,
  type DataMeta,
  type FarmFile,
  type RegionsFile,
  type SourceId,
  type SourceRef,
} from "@/lib/datafiles";
import { sourceRef } from "@/lib/datasources";
import { utcMsToIso } from "@/lib/dates";
import { elevationResponseSchema, slopeFromElevations, SLOPE_SAMPLE_ORDER } from "@/lib/elevation";
import { encodeSeries } from "@/lib/encode";
import { powerCellByIndex, powerCellFor, powerCellsCovering, simplifyGeometry, type AreaGeometry } from "@/lib/geo";
import { classMask, gridOf, ndviComposites, ornlDatesSchema, ornlSubsetSchema, summarizeClasses, type OrnlSubset } from "@/lib/modis";
import {
  mergeDailySeries,
  monthlyMeans,
  parsePowerDaily,
  powerDailyResponseSchema,
  seriesOf,
  yearCoverage,
  type DailySeries,
} from "@/lib/power";
import { soilGridsResponseSchema, topsoilValues } from "@/lib/soil";
import { dailyEt0 } from "@/lib/water";
import { DATA_DIR, log, PUBLIC_DATA_DIR, RAW_DIR, readJson, readJsonIfValid, relative, writeJsonAtomic } from "./lib/io";
import {
  boundaryCollectionSchema,
  farmRawMetaSchema,
  loadRegionsSource,
  salinitySourceSchema,
  soilFallbackSourceSchema,
  toAreaGeometry,
  type DemoFarmSource,
} from "./lib/sources";

const DAILY = { tmax_c: "T2M_MAX", tmin_c: "T2M_MIN", precip_mm: "PRECTOTCORR" } as const;
const MONTHLY = { wind_ms: "WS2M", gwetroot: "GWETROOT" } as const;
/** POWER units we expect; a change upstream must fail the build rather than mislabel values. */
const EXPECTED_UNITS: Record<string, string> = { T2M_MAX: "C", T2M_MIN: "C", PRECTOTCORR: "mm/day", WS2M: "m/s", GWETROOT: "1" };

const problems: string[] = [];
const fileDate = async (file: string) => utcMsToIso((await stat(file)).mtimeMs);

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

// ── Climate (farms and cells) ────────────────────────────────────────────────

/** POWER daily for a raw directory: power.json, or the 5-year blocks if the full request failed. */
async function loadPower(dir: string): Promise<{ series: DailySeries; timeStandard: string; retrieved: string } | null> {
  const parameters = [...Object.values(DAILY), ...Object.values(MONTHLY)];
  const full = path.join(dir, "power.json");
  const single = await readJsonIfValid(full, powerDailyResponseSchema);
  if (single !== null) {
    return { series: parsePowerDaily(single, parameters), timeStandard: single.header.time_standard, retrieved: await fileDate(full) };
  }
  const blockFiles = (await listFiles(path.join(dir, "power_blocks"))).filter((f) => f.endsWith(".json"));
  if (blockFiles.length === 0) return null;
  const blocks = await Promise.all(blockFiles.map((f) => readJson(f, powerDailyResponseSchema)));
  const first = blocks[0];
  if (first === undefined) return null;
  return {
    series: mergeDailySeries(blocks.map((b) => parsePowerDaily(b, parameters))),
    timeStandard: first.header.time_standard,
    retrieved: (await Promise.all(blockFiles.map(fileDate))).sort().at(-1) ?? "",
  };
}

function buildClimate(series: DailySeries, timeStandard: string, lat: number, lon: number): ClimateData {
  for (const [parameter, unit] of Object.entries(EXPECTED_UNITS)) {
    if (series.units[parameter] !== unit) {
      throw new Error(`POWER ${parameter} unit is "${series.units[parameter]}", expected "${unit}"`);
    }
  }
  const start = series.dates[0];
  const end = series.dates.at(-1);
  if (start === undefined || end === undefined) throw new Error("empty POWER series");
  if (start !== RECORD_START) throw new Error(`POWER series starts ${start}, expected ${RECORD_START}`);

  const dailyCoverage = yearCoverage(series, Object.values(DAILY));
  const allCoverage = new Map(yearCoverage(series, [...Object.values(DAILY), ...Object.values(MONTHLY)]).map((y) => [y.year, y]));
  const wind = monthlyMeans(series.dates, seriesOf(series, MONTHLY.wind_ms), 2);
  const gwet = monthlyMeans(series.dates, seriesOf(series, MONTHLY.gwetroot), 3);
  if (wind.start !== gwet.start || wind.means.length !== gwet.means.length) throw new Error("monthly series do not align");
  const cell = powerCellFor({ lat, lon });

  return {
    cell: { id: cell.id, lat: cell.lat, lon: cell.lon },
    start,
    end,
    days: series.dates.length,
    encoding: CLIMATE_ENCODING,
    daily: {
      tmax_c: encodeSeries(seriesOf(series, DAILY.tmax_c)),
      tmin_c: encodeSeries(seriesOf(series, DAILY.tmin_c)),
      precip_mm: encodeSeries(seriesOf(series, DAILY.precip_mm)),
    },
    monthly: { start: wind.start, wind_ms: wind.means, gwetroot: gwet.means },
    years: dailyCoverage.map((y) => {
      const missing = allCoverage.get(y.year)?.missing ?? {};
      return {
        year: y.year,
        days: y.days,
        complete: y.complete,
        excluded: y.excluded,
        missing: {
          tmax_c: missing[DAILY.tmax_c] ?? 0,
          tmin_c: missing[DAILY.tmin_c] ?? 0,
          precip_mm: missing[DAILY.precip_mm] ?? 0,
          wind_ms: missing[MONTHLY.wind_ms] ?? 0,
          gwetroot: missing[MONTHLY.gwetroot] ?? 0,
        },
      };
    }),
    units: { tmax_c: "°C", tmin_c: "°C", precip_mm: "mm/day", wind_ms: "m/s", gwetroot: "0–1 (fraction)" },
    power: { api_version: series.apiVersion, upstream: series.sources, time_standard: timeStandard },
  };
}

// ── Demo farms ───────────────────────────────────────────────────────────────

async function loadSubsets(files: readonly string[]): Promise<OrnlSubset[]> {
  return Promise.all(files.map((f) => readJson(f, ornlSubsetSchema)));
}

type SoilFallback = Awaited<ReturnType<typeof loadSoilFallback>>;
const loadSoilFallback = () => readJson(path.join(DATA_DIR, "manual", "soil_fallback.json"), soilFallbackSourceSchema);

async function buildFarm(farm: DemoFarmSource, soilFallback: SoilFallback): Promise<FarmFile> {
  const point = farm.point;
  if (point === null) throw new Error("no demo point yet (run npm run prefetch -- --farms-only)");
  const dir = path.join(RAW_DIR, "farms", farm.id);
  const sources: SourceRef[] = [];

  const power = await loadPower(dir);
  if (power === null) throw new Error(`no POWER data in ${relative(dir)}`);
  const climate = buildClimate(power.series, power.timeStandard, point.lat, point.lon);
  sources.push(sourceRef("nasa-power", power.retrieved));

  // Land cover window at the point (latest year) and NDVI composites masked to cropland pixels.
  const lcFile = (await listFiles(dir)).filter((f) => /mcd12q1_A\d{7}\.json$/.test(f)).sort().at(-1);
  if (lcFile === undefined) throw new Error("no MCD12Q1 window");
  const lc = await readJson(lcFile, ornlSubsetSchema);
  const lcData = lc.subset[0]?.data ?? [];
  const lcYear = Number(lc.subset[0]?.calendar_date.slice(0, 4));
  const lcSummary = summarizeClasses(lcData);

  const modisFiles = (await listFiles(path.join(dir, "mod13q1"))).filter((f) => f.endsWith(".json"));
  const subsets = await loadSubsets(modisFiles);
  const ndviSubsets = subsets.filter((s) => s.band === MOD13Q1.ndviBand);
  const reliabilitySubsets = subsets.filter((s) => s.band === MOD13Q1.reliabilityBand);
  const firstNdvi = ndviSubsets[0];
  if (firstNdvi === undefined) throw new Error("no MOD13Q1 NDVI data");
  const ndviGrid = gridOf(firstNdvi);
  if (subsets.some((s) => Math.abs(s.xllcorner - ndviGrid.xll) > 1 || Math.abs(s.yllcorner - ndviGrid.yll) > 1 || s.nrows !== ndviGrid.nrows)) {
    throw new Error("MOD13Q1 windows do not share one pixel grid");
  }
  // The farm's NDVI period (team decision 2026-11-14: some farms from 2016), recorded by prefetch.
  const ndviStart = (await readJsonIfValid(path.join(dir, "meta.json"), farmRawMetaSchema))?.ndvi_start ?? RECORD_START;
  // Refuse a partial download: every composite ORNL lists in that period must be present in both bands.
  const listed = (await readJson(path.join(dir, "mod13q1_dates.json"), ornlDatesSchema)).dates.filter((d) => d.calendar_date >= ndviStart);
  const have = (subsets: OrnlSubset[]) => new Set(subsets.flatMap((s) => s.subset.map((c) => c.modis_date)));
  const ndviHave = have(ndviSubsets);
  const reliabilityHave = have(reliabilitySubsets);
  const missing = listed.filter((d) => !ndviHave.has(d.modis_date) || !reliabilityHave.has(d.modis_date));
  if (missing.length > 0) {
    throw new Error(`MOD13Q1 incomplete: ${listed.length - missing.length}/${listed.length} composites downloaded (run npm run prefetch again)`);
  }
  const mask = classMask(ndviGrid, gridOf(lc), lcData, CROPLAND_CLASSES);
  const composites = ndviComposites(ndviSubsets, reliabilitySubsets, mask).filter((c) => c.date >= ndviStart);
  sources.push(sourceRef("modis-ornl", (await Promise.all([lcFile, ...modisFiles].map(fileDate))).sort().at(-1) ?? null));

  // Soil: SoilGrids (modelled) → team fallback (estimated) → unknown (SPEC §3.3).
  const soilFile = path.join(dir, "soilgrids.json");
  const soilGrids = await readJsonIfValid(soilFile, soilGridsResponseSchema);
  let soil: FarmFile["soil"] = {
    depth: "0-30 cm",
    status: "unknown",
    ph_h2o: null,
    soc_g_kg: null,
    clay_pct: null,
    sand_pct: null,
    silt_pct: null,
    source: null,
  };
  if (soilGrids !== null) {
    const t = topsoilValues(soilGrids);
    const expectedUnits = { phh2o: "-", soc: "g/kg", clay: "%", sand: "%", silt: "%" } as const;
    for (const property of ["phh2o", "soc", "clay", "sand", "silt"] as const) {
      const { value, unit } = t[property];
      if (value !== null && unit !== expectedUnits[property]) {
        throw new Error(`SoilGrids ${property} unit "${unit}", expected "${expectedUnits[property]}"`);
      }
    }
    if ([t.phh2o, t.soc, t.clay, t.sand, t.silt].every((v) => v.value !== null)) {
      soil = {
        depth: "0-30 cm",
        status: "modelled",
        ph_h2o: t.phh2o.value,
        soc_g_kg: t.soc.value,
        clay_pct: t.clay.value,
        sand_pct: t.sand.value,
        silt_pct: t.silt.value,
        source: "soilgrids",
      };
      sources.push(sourceRef("soilgrids", await fileDate(soilFile)));
    }
  }
  if (soil.status === "unknown") {
    const fallback = soilFallback.regions.find((r) => r.region === farm.region);
    const values = fallback === undefined ? [] : [fallback.ph_h2o, fallback.soc_g_kg, fallback.clay_pct, fallback.sand_pct, fallback.silt_pct];
    if (fallback !== undefined && fallback.source !== null && values.every((v) => v !== null)) {
      soil = { depth: "0-30 cm", status: "estimated", ph_h2o: fallback.ph_h2o, soc_g_kg: fallback.soc_g_kg, clay_pct: fallback.clay_pct, sand_pct: fallback.sand_pct, silt_pct: fallback.silt_pct, source: "team-soil" };
      sources.push(sourceRef("team-soil", null));
    } else {
      problems.push(`${farm.id}: soil unknown (SoilGrids incomplete and no sourced fallback) — shown as an information gap`);
    }
  }

  // Terrain: elevation of the point and slope from 4 neighbours.
  const elevationFile = path.join(dir, "elevation.json");
  const elevation = await readJson(elevationFile, elevationResponseSchema);
  if (elevation.elevation.length !== SLOPE_SAMPLE_ORDER.length || elevation.elevation.some((e) => !Number.isFinite(e))) {
    throw new Error("elevation response does not have 5 finite values");
  }
  const [centre = NaN, north = NaN, south = NaN, east = NaN, west = NaN] = elevation.elevation;
  const slope = slopeFromElevations({ centre, north, south, east, west });
  sources.push(sourceRef("copernicus-dem", await fileDate(elevationFile)));

  const majorityClass = lcSummary.majority;
  return farmFileSchema.parse({
    version: 1,
    id: farm.id,
    region: farm.region,
    names: farm.names,
    city: farm.city,
    point: { lat: point.lat, lon: point.lon, distance_km: point.distance_km },
    selection: { reason: point.reason, selected_on: point.selected_on },
    climate,
    ndvi: {
      product: "MOD13Q1",
      window_km: MODIS_WINDOW_KM,
      pixels: ndviGrid.nrows * ndviGrid.ncols,
      cropland_pixels: mask.filter(Boolean).length,
      mask_land_cover_year: lcYear,
      period: { start: ndviStart, end: composites.at(-1)?.date ?? ndviStart },
      composites,
    },
    land_cover: {
      product: "MCD12Q1",
      year: lcYear,
      majority_class: majorityClass,
      majority_class_name: majorityClass === null ? null : (IGBP_CLASSES[majorityClass] ?? null),
      majority_share: lcSummary.total === 0 ? 0 : Math.round((lcSummary.majorityCount / lcSummary.total) * 100) / 100,
      counts: lcSummary.counts,
    },
    soil,
    terrain: { elevation_m: centre, slope_pct: slope.slopePct, slope_deg: slope.slopeDeg, neighbour_distance_m: SLOPE_NEIGHBOUR_DISTANCE_M },
    sources,
  });
}

// ── Regions, boundaries, cells ───────────────────────────────────────────────

async function buildRegions(farms: readonly FarmFile[]): Promise<RegionsFile> {
  const source = await loadRegionsSource();
  const salinity = await readJson(path.join(DATA_DIR, "manual", "salinity_regions.json"), salinitySourceSchema);
  return regionsFileSchema.parse({
    version: 1,
    regions: source.regions.map((region) => {
      const entry = salinity.regions.find((s) => s.region === region.id);
      const shares = entry?.shares_pct ?? { none: null, slight: null, moderate: null, strong: null };
      const allShares = Object.values(shares).every((v) => v !== null);
      const explicit = entry?.dominant_class ?? null;
      const known = entry !== undefined && entry.source !== null && (allShares || explicit !== null);
      let dominant: "none" | "slight" | "moderate" | "strong" | null = known ? explicit : null;
      if (known && dominant === null) {
        const ranked = (["none", "slight", "moderate", "strong"] as const).map((cls) => ({ cls, share: shares[cls] ?? -1 }));
        dominant = ranked.reduce((best, next) => (next.share > best.share ? next : best)).cls;
      }
      return {
        id: region.id,
        names: region.names,
        salinity: {
          status: known ? "estimated" : "unknown",
          dominant_class: dominant,
          shares_pct: shares,
          year: entry?.year ?? null,
          source: known ? (entry?.source ?? null) : null,
        },
      };
    }),
    demo_farms: farms.map((f) => ({
      id: f.id,
      region: f.region,
      names: f.names,
      city: f.city.names,
      lat: f.point.lat,
      lon: f.point.lon,
      demo_rotation: source.demo_farms.find((d) => d.id === f.id)?.demo_rotation ?? "cotton_wheat",
      file: `farms/${f.id}.json`,
    })),
  });
}

async function buildBoundaries(): Promise<{ country: AreaGeometry; source: SourceRef } | null> {
  const dir = path.join(RAW_DIR, "boundaries");
  const adm0 = await readJsonIfValid(path.join(dir, "geoBoundaries-UZB-ADM0.geojson"), boundaryCollectionSchema);
  const adm1 = await readJsonIfValid(path.join(dir, "geoBoundaries-UZB-ADM1.geojson"), boundaryCollectionSchema);
  const countryFeature = adm0?.features[0];
  if (adm1 === null || countryFeature === undefined) {
    problems.push("boundaries: raw geoBoundaries files missing (run npm run prefetch)");
    return null;
  }
  const country = toAreaGeometry(countryFeature.geometry);
  const file = boundariesFileSchema.parse({
    version: 1,
    tolerance_deg: BOUNDARY_SIMPLIFY_TOLERANCE_DEG,
    country: simplifyGeometry(country, BOUNDARY_SIMPLIFY_TOLERANCE_DEG),
    regions: adm1.features
      .map((f) => ({ id: f.properties.shapeISO, geometry: simplifyGeometry(toAreaGeometry(f.geometry), BOUNDARY_SIMPLIFY_TOLERANCE_DEG) }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    source: sourceRef("geoboundaries", await fileDate(path.join(dir, "geoBoundaries-UZB-ADM0.geojson"))),
  });
  await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "boundaries.json"), file);
  return { country, source: file.source };
}

type CellIndicators = z.infer<typeof cellIndicatorsSchema>;

/** Map-layer summary of a cell (SPEC §4.2) from the climate engine, over usable years 2006–2025. */
function cellIndicators(data: ClimateData, lat: number): CellIndicators | null {
  const climate = decodeClimate(data, lat);
  const usable = data.years
    .filter((y) => y.complete && !y.excluded && y.year >= CLIMATOLOGY_FIRST_YEAR && y.year <= CLIMATOLOGY_LAST_YEAR)
    .map((y) => y.year);
  const annual = annualClimate(climate, dailyEt0(climate.dates, climate.tmax, climate.tmin, lat), usable);
  if (annual.length === 0) return null;
  const mean = (v: readonly number[]) => Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  const frostFree = annual.flatMap((a) => (a.frostFreeDays === null ? [] : [a.frostFreeDays]));
  const rain = climateTrends(annual).precipMm;
  return {
    years: annual.length,
    heat_days_35: mean(annual.map((a) => a.heatDays35)),
    heat_days_40: mean(annual.map((a) => a.heatDays40)),
    frost_free_days: frostFree.length === 0 ? null : mean(frostFree),
    aridity: Math.round((annual.reduce((s, a) => s + a.precipMm, 0) / annual.reduce((s, a) => s + a.et0Mm, 0)) * 1000) / 1000,
    precip_mm: mean(annual.map((a) => a.precipMm)),
    rain_trend: rain === null ? null : { mm_per_decade: Math.round(rain.slope * 100) / 10, p: Math.round(rain.p * 1000) / 1000, direction: rain.direction },
  };
}

async function buildCells(country: AreaGeometry | null): Promise<{ count: number; files: CellFile[] }> {
  const rawCells = (await listFiles(path.join(RAW_DIR, "cells"))).sort();
  const built: Array<{ id: string; lat: number; lon: number; indicators: CellIndicators | null }> = [];
  const files: CellFile[] = [];
  for (const dir of rawCells) {
    const id = path.basename(dir);
    const power = await loadPower(dir);
    if (power === null) {
      problems.push(`cell ${id}: no POWER data`);
      continue;
    }
    const match = /^y(\d+)x(\d+)$/.exec(id);
    if (match === null) {
      problems.push(`cells: unexpected directory ${relative(dir)}`);
      continue;
    }
    const cell = powerCellByIndex(Number(match[1]), Number(match[2]));
    const file = cellFileSchema.parse({
      version: 1,
      id,
      lat: cell.lat,
      lon: cell.lon,
      climate: buildClimate(power.series, power.timeStandard, cell.lat, cell.lon),
      sources: [sourceRef("nasa-power", power.retrieved)],
    });
    if (file.climate.cell.id !== id) throw new Error(`cell ${id} resolves to ${file.climate.cell.id}`);
    await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "cells", `${id}.json`), file);
    files.push(file);
    built.push({ id, lat: cell.lat, lon: cell.lon, indicators: cellIndicators(file.climate, cell.lat) });
  }
  if (country !== null && built.length > 0) {
    const expected = powerCellsCovering(country).map((c) => c.id);
    const missing = expected.filter((id) => !built.some((b) => b.id === id));
    if (missing.length > 0) problems.push(`cells: ${missing.length} of ${expected.length} cells not prefetched yet (${missing.slice(0, 5).join(", ")}…)`);
  }
  const grid = gridFileSchema.parse({
    version: 1,
    grid: { lat_step: POWER_GRID.latStep, lon_step: POWER_GRID.lonStep, lat_origin: POWER_GRID.latOrigin, lon_origin: POWER_GRID.lonOrigin },
    period: { from: CLIMATOLOGY_FIRST_YEAR, to: CLIMATOLOGY_LAST_YEAR },
    cells: built,
  });
  await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "grid.json"), grid);
  return { count: built.length, files };
}

/** meta.json: POWER API versions and the access-date range of every source (About page, SPEC §6 attribution). */
function buildMeta(farms: readonly FarmFile[], cells: readonly CellFile[], extra: readonly SourceRef[]): DataMeta {
  const refs: SourceRef[] = [...farms.flatMap((f) => f.sources), ...cells.flatMap((c) => c.sources), ...extra];
  const ranges = new Map<SourceId, { from: string; to: string }>();
  for (const ref of refs) {
    if (ref.retrieved === null) continue;
    const range = ranges.get(ref.id);
    ranges.set(ref.id, range === undefined ? { from: ref.retrieved, to: ref.retrieved } : { from: ref.retrieved < range.from ? ref.retrieved : range.from, to: ref.retrieved > range.to ? ref.retrieved : range.to });
  }
  const versions = [...new Set([...farms, ...cells].map((x) => x.climate.power.api_version))].sort();
  return dataMetaSchema.parse({
    version: 1,
    built: new Date().toISOString().slice(0, 10),
    power_api_versions: versions,
    retrieved: [...ranges.entries()].map(([id, range]) => ({ id, ...range })),
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const started = Date.now();
  const boundaries = await buildBoundaries();
  const source = await loadRegionsSource();
  const soilFallback = await loadSoilFallback();

  const farms: FarmFile[] = [];
  for (const farm of source.demo_farms) {
    try {
      const file = await buildFarm(farm, soilFallback);
      await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "farms", `${farm.id}.json`), file);
      farms.push(file);
      const valid = file.ndvi.composites.filter((c) => c.ndvi !== null).length;
      log(farm.id, `climate ${file.climate.start} → ${file.climate.end}, NDVI ${file.ndvi.period.start} → ${file.ndvi.period.end} (${valid}/${file.ndvi.composites.length} composites), soil ${file.soil.status}, slope ${file.terrain.slope_pct} %`);
    } catch (error) {
      problems.push(`${farm.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const regions = await buildRegions(farms);
  await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "regions.json"), regions);
  const unknownSalinity = regions.regions.filter((r) => r.salinity.status === "unknown").length;
  if (unknownSalinity > 0) problems.push(`salinity: ${unknownSalinity}/14 regions unknown (team task: data/manual/salinity_regions.json)`);

  const { count: cells, files: cellFiles } = await buildCells(boundaries?.country ?? null);
  await writeJsonAtomic(path.join(PUBLIC_DATA_DIR, "meta.json"), buildMeta(farms, cellFiles, boundaries === null ? [] : [boundaries.source]));
  log("build-data", `${farms.length} demo farms, ${cells} cells, regions and boundaries written to ${relative(PUBLIC_DATA_DIR)} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  log("build-data", `rule used: years/months with > ${MAX_MISSING_SHARE * 100} % missing days are flagged and excluded`);

  if (problems.length > 0) console.warn(`\nNotes (${problems.length}):\n  ${problems.join("\n  ")}`);
  return farms.length === source.demo_farms.length ? 0 : 1;
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
