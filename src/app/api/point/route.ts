/**
 * GET /api/point?lat&lon (SPEC §8): land cover, the last 3 seasons of NDVI, soil and slope for any
 * point inside Uzbekistan. Every upstream has an 8 s timeout; whatever fails becomes an information gap
 * (partial results are allowed). Climate is not fetched here: the browser loads the point's static cell.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import boundariesJson from "../../../../public/data/boundaries.json";
import { CLIMATOLOGY_LAST_YEAR, MCD12Q1, MOD13Q1, NDVI_RECENT_YEARS, SLOPE_NEIGHBOUR_DISTANCE_M } from "@/lib/constants";
import { boundariesFileSchema, type SourceRef } from "@/lib/datafiles";
import { sourceRef } from "@/lib/datasources";
import { elevationResponseSchema, elevationUrl, slopeFromElevations, slopeSamplePoints } from "@/lib/elevation";
import { pointInGeometry, powerCellFor, type LatLon } from "@/lib/geo";
import { createLimiter, fetchJson } from "@/lib/http";
import { ornlDatesSchema, ornlDatesUrl, ornlSubsetSchema, ornlSubsetUrl, type OrnlSubset } from "@/lib/modis";
import { landCoverOf, pointNdvi, pointSoil, recentCompositeRuns, roundCoord, type PointData, type PointGap } from "@/lib/point";
import { soilGridsResponseSchema, soilGridsUrl } from "@/lib/soil";

export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 8_000;
/** The whole request answers within this time with whatever has arrived (partial results). */
const DEADLINE_MS = 40_000;
const CACHE_COMPLETE = "public, max-age=0, s-maxage=604800, stale-while-revalidate=86400"; // 7 days (SPEC §8)
const CACHE_PARTIAL = "public, max-age=0, s-maxage=300"; // missing parts can be retried after 5 minutes
const MEMORY_TTL_COMPLETE_MS = 7 * 86_400_000;
const MEMORY_TTL_PARTIAL_MS = 5 * 60_000;

const boundaries = boundariesFileSchema.parse(boundariesJson);
/** ORNL is shared with the demo-farm prefetch and often degraded: a few requests at a time. */
const ornlLimit = createLimiter(4);
const memory = new Map<string, { data: PointData; expires: number }>();

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Resolves to `null` instead of throwing, and to `null` once the deadline passes. */
function settle<T>(promise: Promise<T>, deadline: Promise<null>): Promise<T | null> {
  return Promise.race([promise.catch(() => null), deadline]);
}

function get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  return fetchJson(url, { schema, timeoutMs: UPSTREAM_TIMEOUT_MS, retries: 1, backoffMs: 500 });
}

async function fetchPoint(p: LatLon, region: string): Promise<PointData> {
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), DEADLINE_MS));
  const today = new Date().toISOString().slice(0, 10);
  const firstYear = CLIMATOLOGY_LAST_YEAR - NDVI_RECENT_YEARS + 1;
  const period = { start: `${firstYear}-01-01`, end: `${CLIMATOLOGY_LAST_YEAR}-12-31` };
  const ornl = <T>(url: string, schema: z.ZodType<T>) => ornlLimit(() => get(url, schema));

  const soilTask = settle(get(soilGridsUrl(p), soilGridsResponseSchema), deadline);
  const elevationTask = settle(get(elevationUrl(slopeSamplePoints(p)), elevationResponseSchema), deadline);
  const landCoverTask = settle(
    ornl(ornlDatesUrl(MCD12Q1.product, p), ornlDatesSchema).then((d) => {
      const latest = d.dates.at(-1);
      if (latest === undefined) throw new Error("no MCD12Q1 dates");
      return ornl(
        ornlSubsetUrl({ product: MCD12Q1.product, band: MCD12Q1.band, point: p, startDate: latest.modis_date, endDate: latest.modis_date }),
        ornlSubsetSchema,
      );
    }),
    deadline,
  );
  const runs = recentCompositeRuns();
  const subsetTasks = (band: string) =>
    runs.map((run) =>
      settle(ornl(ornlSubsetUrl({ product: MOD13Q1.product, band, point: p, startDate: run.start, endDate: run.end }), ornlSubsetSchema), deadline),
    );
  const ndviTasks = subsetTasks(MOD13Q1.ndviBand);
  const reliabilityTasks = subsetTasks(MOD13Q1.reliabilityBand);

  const [soilResponse, elevation, lc, ndviSubsets, reliabilitySubsets] = await Promise.all([
    soilTask,
    elevationTask,
    landCoverTask,
    Promise.all(ndviTasks),
    Promise.all(reliabilityTasks),
  ]);
  const present = (subsets: Array<OrnlSubset | null>) => subsets.filter((s): s is OrnlSubset => s !== null);

  const gaps: PointGap[] = [];
  const sources: SourceRef[] = [];
  const soil = pointSoil(soilResponse);
  if (soil.status === "unknown") gaps.push("soil");
  else sources.push(sourceRef("soilgrids", today));

  let terrain: PointData["terrain"] = null;
  const e = elevation?.elevation;
  if (e !== undefined && e.length === 5 && e.every(Number.isFinite)) {
    const [centre = NaN, north = NaN, south = NaN, east = NaN, west = NaN] = e;
    const slope = slopeFromElevations({ centre, north, south, east, west });
    terrain = { elevation_m: centre, slope_pct: slope.slopePct, slope_deg: slope.slopeDeg, neighbour_distance_m: SLOPE_NEIGHBOUR_DISTANCE_M };
    sources.push(sourceRef("copernicus-dem", today));
  } else gaps.push("terrain");

  const landCover = lc === null ? null : landCoverOf(lc);
  if (landCover === null) gaps.push("land_cover");
  let ndvi: PointData["ndvi"] = null;
  if (lc !== null) {
    const result = pointNdvi(lc, present(ndviSubsets), present(reliabilitySubsets), period);
    ndvi = result.ndvi;
    if (result.gap !== null) gaps.push(result.gap);
  } else gaps.push("ndvi");
  if (landCover !== null || ndvi !== null) sources.push(sourceRef("modis-ornl", today));

  return { version: 1, lat: p.lat, lon: p.lon, region, cell: powerCellFor(p).id, retrieved: today, land_cover: landCover, ndvi, soil, terrain, sources, gaps };
}

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse({ lat: request.nextUrl.searchParams.get("lat"), lon: request.nextUrl.searchParams.get("lon") });
  if (!parsed.success) return error(400, "invalid_point", "lat and lon must be decimal degrees.");
  const p = { lat: roundCoord(parsed.data.lat), lon: roundCoord(parsed.data.lon) };
  if (!pointInGeometry(p, boundaries.country)) return error(400, "outside_uzbekistan", "The point is outside Uzbekistan.");
  const region = boundaries.regions.find((r) => pointInGeometry(p, r.geometry))?.id;
  if (region === undefined) return error(400, "outside_uzbekistan", "The point is not inside any region of Uzbekistan.");

  const key = `${p.lat},${p.lon}`;
  const cached = memory.get(key);
  let data: PointData;
  if (cached !== undefined && cached.expires > Date.now()) data = cached.data;
  else {
    data = await fetchPoint(p, region);
    const ttlMs = data.gaps.length === 0 ? MEMORY_TTL_COMPLETE_MS : MEMORY_TTL_PARTIAL_MS;
    memory.set(key, { data, expires: Date.now() + ttlMs });
  }
  return Response.json(data, { headers: { "Cache-Control": data.gaps.length === 0 ? CACHE_COMPLETE : CACHE_PARTIAL } });
}
