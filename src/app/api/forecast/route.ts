/**
 * GET /api/forecast?lat&lon (SPEC §8, stretch): the Open-Meteo 14-day forecast for a point inside
 * Uzbekistan, condensed to one row per local day. Weather models, not NASA. One upstream request with an
 * 8 s timeout and no retry; on any failure the answer is 502 "forecast_unavailable" and the app shows a
 * short message. Cached for 1 hour.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import boundariesJson from "../../../../public/data/boundaries.json";
import { FORECAST_UPSTREAM_TIMEOUT_MS } from "@/lib/constants";
import { boundariesFileSchema } from "@/lib/datafiles";
import { forecastDays, openMeteoForecastSchema, openMeteoForecastUrl, roundForecastCoord, type ForecastResponse } from "@/lib/forecast";
import { pointInGeometry } from "@/lib/geo";
import { fetchJson } from "@/lib/http";

export const maxDuration = 15;

const CACHE_SECONDS = 3600;
const boundaries = boundariesFileSchema.parse(boundariesJson);
const memory = new Map<string, { data: ForecastResponse; expires: number }>();

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse({ lat: request.nextUrl.searchParams.get("lat"), lon: request.nextUrl.searchParams.get("lon") });
  if (!parsed.success) return error(400, "invalid_point", "lat and lon must be decimal degrees.");
  const p = { lat: roundForecastCoord(parsed.data.lat), lon: roundForecastCoord(parsed.data.lon) };
  if (!pointInGeometry(p, boundaries.country)) return error(400, "outside_uzbekistan", "The point is outside Uzbekistan.");

  const key = `${p.lat},${p.lon}`;
  const cached = memory.get(key);
  let data: ForecastResponse;
  if (cached !== undefined && cached.expires > Date.now()) data = cached.data;
  else {
    try {
      const raw = await fetchJson(openMeteoForecastUrl(p.lat, p.lon), { schema: openMeteoForecastSchema, timeoutMs: FORECAST_UPSTREAM_TIMEOUT_MS, retries: 0 });
      data = {
        version: 1,
        lat: p.lat,
        lon: p.lon,
        grid: { lat: raw.latitude, lon: raw.longitude, elevation_m: raw.elevation ?? null },
        retrieved: new Date().toISOString(),
        days: forecastDays(raw),
      };
    } catch {
      return error(502, "forecast_unavailable", "The weather forecast service did not answer in time.");
    }
    memory.set(key, { data, expires: Date.now() + CACHE_SECONDS * 1000 });
  }
  return Response.json(data, { headers: { "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600` } });
}
