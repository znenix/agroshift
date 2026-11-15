/**
 * Loading the app's own static files (public/data, SPEC §4.2) with validation. The browser only ever
 * fetches these and our own /api/* routes (CLAUDE.md §1.8).
 */
import { z } from "zod";
import {
  boundariesFileSchema,
  cellFileSchema,
  farmFileSchema,
  regionsFileSchema,
  type BoundariesFile,
  type CellFile,
  type FarmFile,
  type RegionsFile,
} from "./datafiles";
import { forecastFailureSchema, forecastResponseSchema, roundForecastCoord, type ForecastFailure, type ForecastResponse } from "./forecast";
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

/** Simplified country and region outlines, used to locate map points in the browser. */
export const loadBoundaries = (fetchImpl?: typeof fetch): Promise<BoundariesFile> =>
  fetchStatic("/data/boundaries.json", boundariesFileSchema, fetchImpl);

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

/**
 * Land cover, NDVI, soil and slope for a map point, from our own route (never upstream from the browser).
 * Not used by the app since 2026-11-15: map points use prepared data only (see lib/point.ts).
 */
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

/** Browser-side limit for /api/forecast: the route gives each upstream try 8 s and may retry once. */
const FORECAST_CLIENT_TIMEOUT_MS = 22_000;

/** A failed forecast load; `reason` is the route's explanation when it gave one. */
export class ForecastError extends Error {
  constructor(
    readonly reason: ForecastFailure | "client_timeout" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "ForecastError";
  }
}

const forecastErrorBodySchema = z.object({ error: z.object({ reason: forecastFailureSchema.optional() }) });

/**
 * The 14-day Open-Meteo forecast for a point, from our own route; any failure throws a ForecastError (the UI
 * says "unavailable"). Coordinates are rounded like the route, so every visitor of a farm shares one CDN entry.
 */
export async function loadForecast(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<ForecastResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/forecast?lat=${roundForecastCoord(lat)}&lon=${roundForecastCoord(lon)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FORECAST_CLIENT_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ForecastError(timeout ? "client_timeout" : "unknown", error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const body = forecastErrorBodySchema.safeParse(await response.json().catch(() => null));
    throw new ForecastError(body.success ? (body.data.error.reason ?? "unknown") : "unknown", `/api/forecast: HTTP ${response.status}`);
  }
  const parsed = forecastResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("/api/forecast: unexpected response format");
  return parsed.data;
}
