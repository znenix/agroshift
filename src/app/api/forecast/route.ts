/**
 * GET /api/forecast?lat&lon (SPEC §8, stretch): the Open-Meteo 14-day forecast for a point inside
 * Uzbekistan, condensed to one row per local day. Weather models, not NASA.
 *
 * Upstream handling (each case is logged with status and a short body, so Vercel logs show the reason):
 * - 400 bad parameter: drop the hourly variables it names (or soil moisture) and retry once; the dropped
 *   groups are returned as `unavailable` and shown as "not available".
 * - 429 rate limit: wait 1 s and retry once.
 * - timeout (8 s per request): no retry.
 * A good forecast is cached for 1 hour per rounded point (memory and CDN). When the upstream fails, the
 * last good forecast of the last 6 hours is served with `stale: true`; otherwise 502 with the reason.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import boundariesJson from "../../../../public/data/boundaries.json";
import { FORECAST_UPSTREAM_TIMEOUT_MS } from "@/lib/constants";
import { boundariesFileSchema } from "@/lib/datafiles";
import {
  forecastDays,
  HOURLY_VARIABLES,
  openMeteoErrorSchema,
  openMeteoForecastSchema,
  openMeteoForecastUrl,
  receivedHourly,
  roundForecastCoord,
  unavailableGroups,
  variablesToDrop,
  type ForecastFailure,
  type ForecastResponse,
  type HourlyVariable,
  type OpenMeteoForecast,
} from "@/lib/forecast";
import { pointInGeometry } from "@/lib/geo";
import { USER_AGENT } from "@/lib/http";

export const maxDuration = 25;

const CACHE_SECONDS = 3600;
/** How old a forecast may be to stand in when the service fails just now. */
const STALE_MAX_MS = 6 * 3600 * 1000;
const RATE_LIMIT_RETRY_MS = 1000;
const LOG_BODY_CHARS = 300;

const boundaries = boundariesFileSchema.parse(boundariesJson);
const memory = new Map<string, { data: ForecastResponse; fetchedAt: number }>();

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

type Upstream =
  | { kind: "ok"; raw: OpenMeteoForecast }
  | { kind: "http"; status: number; body: string }
  | { kind: "timeout" }
  | { kind: "network"; message: string }
  | { kind: "invalid"; message: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function log(event: string, details: Record<string, unknown>): void {
  // Vercel keeps function logs; nothing secret is logged (the request has no key).
  console.warn(JSON.stringify({ route: "/api/forecast", event, ...details }));
}

async function callOpenMeteo(lat: number, lon: number, hourly: readonly HourlyVariable[]): Promise<Upstream> {
  const started = Date.now();
  try {
    const response = await fetch(openMeteoForecastUrl(lat, lon, hourly), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FORECAST_UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      log("upstream_http_error", { lat, lon, status: response.status, ms: Date.now() - started, body: text.slice(0, LOG_BODY_CHARS) });
      return { kind: "http", status: response.status, body: text };
    }
    const parsed = openMeteoForecastSchema.safeParse(parseJson(text));
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      log("upstream_invalid", { lat, lon, ms: Date.now() - started, issues: message.slice(0, LOG_BODY_CHARS) });
      return { kind: "invalid", message };
    }
    return { kind: "ok", raw: parsed.data };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      log("upstream_timeout", { lat, lon, ms: Date.now() - started, limit_ms: FORECAST_UPSTREAM_TIMEOUT_MS });
      return { kind: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    log("upstream_network_error", { lat, lon, ms: Date.now() - started, message: message.slice(0, LOG_BODY_CHARS) });
    return { kind: "network", message };
  }
}

/** One call, plus at most one retry: after a 400 with fewer hourly variables, after a 429 a second later. */
async function fetchForecast(lat: number, lon: number): Promise<{ raw: OpenMeteoForecast; requested: HourlyVariable[] } | { failure: ForecastFailure }> {
  let requested: HourlyVariable[] = [...HOURLY_VARIABLES];
  let result = await callOpenMeteo(lat, lon, requested);
  if (result.kind === "http" && result.status === 400) {
    const reason = openMeteoErrorSchema.safeParse(parseJson(result.body));
    const drop = variablesToDrop(reason.success ? reason.data.reason : result.body, requested);
    if (drop.length === 0) return { failure: "bad_request" };
    requested = requested.filter((v) => !drop.includes(v));
    log("retry_without_variables", { lat, lon, dropped: drop });
    result = await callOpenMeteo(lat, lon, requested);
  } else if (result.kind === "http" && result.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    log("retry_after_rate_limit", { lat, lon, wait_ms: RATE_LIMIT_RETRY_MS });
    result = await callOpenMeteo(lat, lon, requested);
  }
  switch (result.kind) {
    case "ok":
      return { raw: result.raw, requested };
    case "timeout":
      return { failure: "timeout" };
    case "invalid":
      return { failure: "invalid_response" };
    case "network":
      return { failure: "upstream_error" };
    case "http":
      return { failure: result.status === 429 ? "rate_limited" : result.status === 400 ? "bad_request" : "upstream_error" };
  }
}

function error(status: number, code: string, message: string, reason?: ForecastFailure): Response {
  return Response.json({ error: { code, message, ...(reason === undefined ? {} : { reason }) } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse({ lat: request.nextUrl.searchParams.get("lat"), lon: request.nextUrl.searchParams.get("lon") });
  if (!parsed.success) return error(400, "invalid_point", "lat and lon must be decimal degrees.");
  const p = { lat: roundForecastCoord(parsed.data.lat), lon: roundForecastCoord(parsed.data.lon) };
  if (!pointInGeometry(p, boundaries.country)) return error(400, "outside_uzbekistan", "The point is outside Uzbekistan.");

  const key = `${p.lat},${p.lon}`;
  const cached = memory.get(key);
  const age = cached === undefined ? Infinity : Date.now() - cached.fetchedAt;
  if (cached !== undefined && age < CACHE_SECONDS * 1000) {
    return Response.json(cached.data, { headers: { "Cache-Control": `public, max-age=0, s-maxage=${Math.max(60, CACHE_SECONDS - Math.round(age / 1000))}` } });
  }

  const result = await fetchForecast(p.lat, p.lon);
  if ("failure" in result) {
    if (cached !== undefined && age < STALE_MAX_MS) {
      log("served_stale", { lat: p.lat, lon: p.lon, reason: result.failure, age_min: Math.round(age / 60000) });
      // Short CDN life, so a fresh forecast replaces it as soon as the service answers again.
      return Response.json({ ...cached.data, stale: true }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } });
    }
    return error(502, "forecast_unavailable", "The weather forecast service did not answer.", result.failure);
  }
  const received = receivedHourly(result.raw).filter((v) => result.requested.includes(v));
  const data: ForecastResponse = {
    version: 1,
    lat: p.lat,
    lon: p.lon,
    grid: { lat: result.raw.latitude, lon: result.raw.longitude, elevation_m: result.raw.elevation ?? null },
    retrieved: new Date().toISOString(),
    stale: false,
    unavailable: unavailableGroups(received),
    days: forecastDays(result.raw),
  };
  memory.set(key, { data, fetchedAt: Date.now() });
  return Response.json(data, { headers: { "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600` } });
}
