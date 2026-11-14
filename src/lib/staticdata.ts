/**
 * Loading the app's own static files (public/data, SPEC §4.2) with validation. The browser only ever
 * fetches these and our own /api/* routes (CLAUDE.md §1.8).
 */
import { z } from "zod";
import { cellFileSchema, farmFileSchema, regionsFileSchema, type CellFile, type FarmFile, type RegionsFile } from "./datafiles";
import { pointDataSchema, type PointData } from "./point";

export async function fetchStatic<T>(path: string, schema: z.ZodType<T>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${path}: unexpected file format`);
  return parsed.data;
}

/** Regions and the demo farms whose data is built (farms still downloading are simply not listed yet). */
export const loadRegions = (fetchImpl?: typeof fetch): Promise<RegionsFile> =>
  fetchStatic("/data/regions.json", regionsFileSchema, fetchImpl);

export const loadFarm = (id: string, fetchImpl?: typeof fetch): Promise<FarmFile> =>
  fetchStatic(`/data/farms/${encodeURIComponent(id)}.json`, farmFileSchema, fetchImpl);

export const loadCell = (id: string, fetchImpl?: typeof fetch): Promise<CellFile> =>
  fetchStatic(`/data/cells/${encodeURIComponent(id)}.json`, cellFileSchema, fetchImpl);

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** An /api/* error with its machine-readable code (e.g. "outside_uzbekistan"). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Land cover, NDVI, soil and slope for a map point, from our own route (never upstream from the browser). */
export async function loadPoint(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<PointData> {
  const response = await fetchImpl(`/api/point?lat=${lat}&lon=${lon}`, { headers: { Accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw error.success ? new ApiError(error.data.error.code, error.data.error.message) : new Error(`/api/point: HTTP ${response.status}`);
  }
  const parsed = pointDataSchema.safeParse(body);
  if (!parsed.success) throw new Error("/api/point: unexpected response format");
  return parsed.data;
}
