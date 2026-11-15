/**
 * The "forecast unavailable" path: when Open-Meteo fails or exceeds the 8 s limit, /api/forecast answers
 * 502 "forecast_unavailable" (not cached), and the browser loader throws so step 6 shows its message.
 * The 8 s timeout is simulated by handing out an already-expired timeout signal, so the test stays fast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { FORECAST_UPSTREAM_TIMEOUT_MS } from "@/lib/constants";
import { loadForecast } from "@/lib/staticdata";
import raw from "./fixtures/open-meteo-karshi-2026-11-15.json";

const request = (lat: number, lon: number) => ({ nextUrl: new URL(`http://localhost/api/forecast?lat=${lat}&lon=${lon}`) }) as unknown as NextRequest;
const errorCode = async (response: Response) => ((await response.json()) as { error?: { code?: string } }).error?.code;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("forecast unavailable", () => {
  it("answers 502 forecast_unavailable when the upstream request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(38.81, 65.71));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("forecast_unavailable");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1); // one try, no retry
  });

  it("gives Open-Meteo 8 s and answers 502 when that time runs out", async () => {
    expect(FORECAST_UPSTREAM_TIMEOUT_MS).toBe(8_000);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError")));
    // Like the real fetch: rejects with the signal's reason once the signal is aborted.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.signal?.aborted === true ? Promise.reject(init.signal.reason) : new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(38.82, 65.72));
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("forecast_unavailable");
  });

  it("does not cache a failure: the next request for the same point can succeed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await GET(request(38.83, 65.73))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(raw)));
    const ok = await GET(request(38.83, 65.73));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { days: unknown[] }).days).toHaveLength(14);
  });

  it("the browser loader throws on a 502 or on an unexpected body, so step 6 shows 'forecast unavailable'", async () => {
    const unavailable = vi.fn().mockResolvedValue(Response.json({ error: { code: "forecast_unavailable", message: "x" } }, { status: 502 }));
    await expect(loadForecast(38.87, 65.73, unavailable)).rejects.toThrow("HTTP 502");
    const garbage = vi.fn().mockResolvedValue(Response.json({ days: "nope" }));
    await expect(loadForecast(38.87, 65.73, garbage)).rejects.toThrow("unexpected response format");
  });
});
