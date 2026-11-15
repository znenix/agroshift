/**
 * Any point inside Uzbekistan (SPEC §2 step 1, §8). The app uses only data that is already prepared
 * (team decision 2026-11-15): the point's static POWER climate cell and its region's salinity estimate.
 * Soil, NDVI, land cover and slope exist for the demo farms only, so for a map point they are
 * information gaps — never values borrowed from another farm. /api/point (live ORNL/SoilGrids calls)
 * is kept for later but is not called by the app. Pure functions, shared by the browser and tests.
 */
import { z } from "zod";
import { CLIMATOLOGY_LAST_YEAR, CROPLAND_CLASSES, IGBP_CLASSES, MODIS_WINDOW_KM, NDVI_RECENT_YEARS } from "./constants";
import {
  landCoverSchema,
  ndviSchema,
  regionIdSchema,
  siteFileSchema,
  soilSchema,
  sourceRefSchema,
  terrainSchema,
  type CellFile,
  type SiteFile,
  type SourceRef,
} from "./datafiles";
import { haversineKm, pointInGeometry, powerCellFor, type AreaGeometry, type LatLon } from "./geo";
import { chunkDates, classMask, gridOf, ndviComposites, summarizeClasses, type OrnlSubset } from "./modis";
import { topsoilValues, type SoilGridsResponse } from "./soil";

/** Points are rounded to 0.001° (~100 m, less than one 250 m MODIS pixel) so repeated clicks share a cache entry. */
export const POINT_DECIMALS = 3;
export const roundCoord = (v: number): number => Math.round(v * 10 ** POINT_DECIMALS) / 10 ** POINT_DECIMALS;
export const pointSiteId = (lat: number, lon: number): string => `point_${roundCoord(lat).toFixed(POINT_DECIMALS)}_${roundCoord(lon).toFixed(POINT_DECIMALS)}`;

/**
 * What could not be fetched or used for this point; each becomes a visible information gap. The
 * `*_demo_only` gaps mean "not prepared for this point yet — available for the demo farms".
 */
export const pointGapSchema = z.enum([
  "land_cover",
  "ndvi",
  "not_cropland",
  "soil",
  "terrain",
  "ndvi_demo_only",
  "soil_demo_only",
  "terrain_demo_only",
]);
export type PointGap = z.infer<typeof pointGapSchema>;

export const pointDataSchema = z.object({
  version: z.literal(1),
  lat: z.number(),
  lon: z.number(),
  region: regionIdSchema,
  /** The POWER cell whose static file holds this point's climate. */
  cell: z.string(),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  land_cover: landCoverSchema.nullable(),
  ndvi: ndviSchema.nullable(),
  soil: soilSchema,
  terrain: terrainSchema.nullable(),
  sources: z.array(sourceRefSchema),
  gaps: z.array(pointGapSchema),
});
export type PointData = z.infer<typeof pointDataSchema>;

const COMPOSITES_PER_YEAR = 23;
const COMPOSITE_DAYS = 16;

/** MOD13Q1 composites (AYYYYDDD) of the last complete years, in request runs of ≤ 10 consecutive composites. */
export function recentCompositeRuns(lastYear = CLIMATOLOGY_LAST_YEAR, years = NDVI_RECENT_YEARS): Array<{ start: string; end: string }> {
  const ids: string[] = [];
  for (let year = lastYear - years + 1; year <= lastYear; year++) {
    for (let k = 0; k < COMPOSITES_PER_YEAR; k++) ids.push(`A${year}${String(1 + COMPOSITE_DAYS * k).padStart(3, "0")}`);
  }
  return chunkDates(ids).map((run) => ({ start: run[0] ?? "", end: run.at(-1) ?? "" }));
}

export function landCoverOf(lc: OrnlSubset): NonNullable<PointData["land_cover"]> | null {
  const first = lc.subset[0];
  if (first === undefined) return null;
  const summary = summarizeClasses(first.data);
  const majority = summary.majority;
  return {
    product: "MCD12Q1",
    year: Number(first.calendar_date.slice(0, 4)),
    majority_class: majority,
    majority_class_name: majority === null ? null : (IGBP_CLASSES[majority] ?? null),
    majority_share: summary.total === 0 ? 0 : Math.round((summary.majorityCount / summary.total) * 100) / 100,
    counts: summary.counts,
  };
}

/**
 * NDVI composites of the cropland pixels in the window, as for the demo farms (SPEC §5.3). No cropland
 * pixel in the window → `not_cropland` gap and no curve (the tool compares crop rotations only).
 */
export function pointNdvi(
  lc: OrnlSubset,
  ndvi: readonly OrnlSubset[],
  reliability: readonly OrnlSubset[],
  period: { start: string; end: string },
): { ndvi: PointData["ndvi"]; gap: PointGap | null } {
  const first = ndvi[0];
  const lcData = lc.subset[0]?.data;
  if (first === undefined || lcData === undefined) return { ndvi: null, gap: "ndvi" };
  const grid = gridOf(first);
  const mask = classMask(grid, gridOf(lc), lcData, CROPLAND_CLASSES);
  const cropland = mask.filter(Boolean).length;
  if (cropland === 0) return { ndvi: null, gap: "not_cropland" };
  const composites = ndviComposites(ndvi, reliability, mask).filter((c) => c.date >= period.start && c.date <= period.end);
  if (!composites.some((c) => c.ndvi !== null)) return { ndvi: null, gap: "ndvi" };
  return {
    ndvi: {
      product: "MOD13Q1",
      window_km: MODIS_WINDOW_KM,
      pixels: grid.nrows * grid.ncols,
      cropland_pixels: cropland,
      mask_land_cover_year: Number(lc.subset[0]?.calendar_date.slice(0, 4)),
      period,
      composites,
    },
    gap: null,
  };
}

const SOIL_UNITS = { phh2o: "-", soc: "g/kg", clay: "%", sand: "%", silt: "%" } as const;

/** SoilGrids 0–30 cm means; anything incomplete or in unexpected units is an information gap, never a guess. */
export function pointSoil(response: SoilGridsResponse | null): PointData["soil"] {
  const unknown: PointData["soil"] = { depth: "0-30 cm", status: "unknown", ph_h2o: null, soc_g_kg: null, clay_pct: null, sand_pct: null, silt_pct: null, source: null };
  if (response === null) return unknown;
  const t = topsoilValues(response);
  const props = ["phh2o", "soc", "clay", "sand", "silt"] as const;
  if (props.some((p) => t[p].value === null || t[p].unit !== SOIL_UNITS[p])) return unknown;
  return {
    depth: "0-30 cm",
    status: "modelled",
    ph_h2o: t.phh2o.value,
    soc_g_kg: t.soc.value,
    clay_pct: t.clay.value,
    sand_pct: t.sand.value,
    silt_pct: t.silt.value,
    source: "soilgrids",
  };
}

const MAP_POINT_REASON = "map point";

/** True for a site assembled from a map point (rather than a prepared demo farm). */
export const isPointSite = (site: SiteFile): boolean => site.selection.reason === MAP_POINT_REASON;

/** Joins the point data with its climate cell into the shape the engines analyse. */
export function pointSite(data: PointData, cell: CellFile, regionNames: SiteFile["names"]): SiteFile {
  const label = `${data.lat.toFixed(POINT_DECIMALS)}° N, ${data.lon.toFixed(POINT_DECIMALS)}° E`;
  const firstYear = CLIMATOLOGY_LAST_YEAR - NDVI_RECENT_YEARS + 1;
  const sources: SourceRef[] = [];
  for (const s of [...cell.sources, ...data.sources]) if (!sources.some((x) => x.id === s.id)) sources.push(s);
  return siteFileSchema.parse({
    version: 1,
    id: pointSiteId(data.lat, data.lon),
    region: data.region,
    names: { uz: label, ru: label, en: label },
    city: { names: regionNames, lat: data.lat, lon: data.lon },
    point: { lat: data.lat, lon: data.lon, distance_km: 0 },
    selection: { reason: MAP_POINT_REASON, selected_on: data.retrieved },
    climate: cell.climate,
    ndvi: data.ndvi ?? {
      product: "MOD13Q1",
      window_km: MODIS_WINDOW_KM,
      pixels: 0,
      cropland_pixels: 0,
      mask_land_cover_year: data.land_cover?.year ?? 0,
      period: { start: `${firstYear}-01-01`, end: `${CLIMATOLOGY_LAST_YEAR}-12-31` },
      composites: [],
    },
    land_cover: data.land_cover,
    soil: data.soil,
    terrain: data.terrain,
    sources,
  });
}


/** The outlines a point is located with (public/data/boundaries.json). */
export interface PointOutlines {
  country: AreaGeometry;
  regions: ReadonlyArray<{ id: string; geometry: AreaGeometry }>;
}

/**
 * The ADM1 region containing the point, or `null` when it is outside Uzbekistan (or in a sliver of the
 * simplified outline that no region covers, which is treated the same way).
 */
export function regionOfPoint(p: LatLon, outlines: PointOutlines): string | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !pointInGeometry(p, outlines.country)) return null;
  return outlines.regions.find((r) => pointInGeometry(p, r.geometry))?.id ?? null;
}

/** Distance from the point to the centre of its native NASA POWER cell (the point's climate is that cell's). */
export const cellDistanceKm = (p: LatLon): number => haversineKm(p, powerCellFor(p));

/** The gaps every map point has: only the demo farms have prepared soil, NDVI and slope. */
export const PREPARED_ONLY_GAPS: readonly PointGap[] = ["ndvi_demo_only", "soil_demo_only", "terrain_demo_only"];

/**
 * A map point from prepared data only: its climate cell and region; soil, land cover, NDVI and slope are
 * gaps. No network call is made, and nothing is copied from a nearby demo farm.
 */
export function preparedPointData(p: LatLon, region: string, today: string): PointData {
  const lat = roundCoord(p.lat);
  const lon = roundCoord(p.lon);
  return pointDataSchema.parse({
    version: 1,
    lat,
    lon,
    region,
    cell: powerCellFor({ lat, lon }).id,
    retrieved: today,
    land_cover: null,
    ndvi: null,
    soil: pointSoil(null),
    terrain: null,
    sources: [],
    gaps: [...PREPARED_ONLY_GAPS],
  });
}

/** True when this site's satellite data is a "demo farms only" gap (a map point, not a failed download). */
export const ndviDemoOnly = (site: SiteFile): boolean => isPointSite(site) && site.ndvi.composites.length === 0;
