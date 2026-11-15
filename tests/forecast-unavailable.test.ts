/**
 * /api/forecast when Open-Meteo misbehaves: errors, the 8 s timeout, 400 (drop unsupported hourly
 * variables and retry), 429 (retry once after 1 s), the 1-hour cache, and the last good forecast standing in
 * for a failure. Also the browser loader's errors, which step 6 turns into "forecast unavailable".
 * The 8 s timeout is simulated with an already-expired signal, so the test stays fast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { FORECAST_UPSTREAM_TIMEOUT_MS } from "@/lib/constants";
import { ForecastError, loadForecast } from "@/lib/staticdata";
import raw from "./fixtures/open-meteo-karshi-2026-11-15.json";

const request = (lat: number, lon: number) => ({ nextUrl: new URL(`http://localhost/api/forecast?lat=${lat}&lon=${lon}`) }) as unknown as NextRequest;
const body = async (response: Response) => (await response.json()) as { error?: { code?: string; reason?: string }; days?: unknown[]; stale?: boolean; unavailable?: string[] };
const ok = () => new Response(JSON.stringify(raw), { status: 200 });
const withoutSoil = () => {
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("soil_moisture")));
  return new Response(JSON.stringify({ ...raw, hourly: strip(raw.hourly), hourly_units: strip(raw.hourly_units) }), { status: 200 });
};
const status = (code: number, text: string) => new Response(text, { status: code });
const urlOf = (call: unknown[]) => String(call[0]);

let point = 0;
/** A new point inside Uzbekistan for each test, so the route's cache never leaks between tests. */
const nextPoint = () => {
  point++;
  return { lat: 39 + point * 0.05, lon: 66 + point * 0.05 };
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("/api/forecast when Open-Meteo fails", () => {
  it("network error: 502 forecast_unavailable (reason upstream_error), no retry, not cached, logged", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const response = await GET(request(p.lat, p.lon));
    expect(response.status).toBe(502);
    expect((await body(response)).error).toMatchObject({ code: "forecast_unavailable", reason: "upstream_error" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("upstream_network_error"));
  });

  it("timeout: gives each request 8 s, then 502 with reason timeout and no retry", async () => {
    expect(FORECAST_UPSTREAM_TIMEOUT_MS).toBe(8_000);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError")));
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.signal?.aborted === true ? Promise.reject(init.signal.reason) : new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const response = await GET(request(p.lat, p.lon));
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(response.status).toBe(502);
    expect((await body(response)).error?.reason).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("upstream_timeout"));
  });

  it("400 bad parameter: logs status and body, retries once without the soil-moisture variables, marks them not available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(400, JSON.stringify({ error: true, reason: "Cannot initialize ... from invalid String value soil_moisture_0_to_1cm" })))
      .mockResolvedValueOnce(withoutSoil());
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const response = await GET(request(p.lat, p.lon));
    expect(response.status).toBe(200);
    const b = await body(response);
    expect(b.days).toHaveLength(14);
    expect(b.unavailable).toEqual(["soil_moisture"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[0] ?? [])).toContain("soil_moisture_0_to_1cm");
    expect(urlOf(fetchMock.mock.calls[1] ?? [])).not.toContain("soil_moisture_0_to_1cm");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/"status":400.*soil_moisture_0_to_1cm/));
  });

  it("400 that no variable explains: one retry without soil moisture, then 502 bad_request", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(status(400, JSON.stringify({ error: true, reason: "Latitude must be in range" }))));
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const response = await GET(request(p.lat, p.lon));
    expect(response.status).toBe(502);
    expect((await body(response)).error?.reason).toBe("bad_request");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 rate limit: waits 1 s, retries once, succeeds and caches the forecast for the hour", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(status(429, JSON.stringify({ error: true, reason: "Minutely API request limit exceeded" }))).mockImplementation(() => Promise.resolve(ok()));
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const started = Date.now();
    const response = await GET(request(p.lat, p.lon));
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Same farm again within the hour: served from the cache, Open-Meteo is not called.
    const again = await GET(request(p.lat + 0.001, p.lon - 0.001));
    expect(again.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });

  it("429 twice: 502 with reason rate_limited", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(status(429, "{}")));
    vi.stubGlobal("fetch", fetchMock);
    const p = nextPoint();
    const response = await GET(request(p.lat, p.lon));
    expect(response.status).toBe(502);
    expect((await body(response)).error?.reason).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("after the hour, a failure serves the last good forecast marked stale instead of 'unavailable'", async () => {
    const p = nextPoint();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok())));
    expect((await GET(request(p.lat, p.lon))).status).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * 3600 * 1000);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const response = await GET(request(p.lat, p.lon));
    expect(response.status).toBe(200);
    const b = await body(response);
    expect(b.stale).toBe(true);
    expect(b.days).toHaveLength(14);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=60");
  });
});

describe("browser loader", () => {
  it("rounds the farm point to 0.01° so all visitors of a farm share one cache entry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: { code: "forecast_unavailable", reason: "rate_limited" } }, { status: 502 }));
    await expect(loadForecast(42.510417, 59.539192, fetchImpl)).rejects.toThrow(ForecastError);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/api/forecast?lat=42.51&lon=59.54");
  });

  it("keeps the route's reason, and throws on an unexpected body, so step 6 shows 'forecast unavailable'", async () => {
    const limited = vi.fn().mockResolvedValue(Response.json({ error: { code: "forecast_unavailable", reason: "rate_limited" } }, { status: 502 }));
    await expect(loadForecast(38.87, 65.73, limited)).rejects.toMatchObject({ reason: "rate_limited" });
    const garbage = vi.fn().mockResolvedValue(Response.json({ days: "nope" }));
    await expect(loadForecast(38.87, 65.73, garbage)).rejects.toThrow("unexpected response format");
    const offline = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(loadForecast(38.87, 65.73, offline)).rejects.toMatchObject({ reason: "client_timeout" });
  });
});
