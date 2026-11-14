import { describe, expect, it } from "vitest";
import { dateRange } from "@/lib/dates";
import {
  mergeDailySeries,
  monthlyMeans,
  parsePowerDaily,
  powerDailyUrl,
  yearCoverage,
  type DailySeries,
  type PowerDailyResponse,
} from "@/lib/power";

function response(start: string, end: string, parameter: Record<string, Record<string, number>>): PowerDailyResponse {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [59.6, 42.46, 71] },
    properties: { parameter },
    header: {
      title: "synthetic test response",
      api: { version: "v2.10.3", name: "POWER Daily API" },
      sources: ["MERRA2"],
      fill_value: -999,
      time_standard: "LST",
      start,
      end,
    },
    messages: [],
    parameters: Object.fromEntries(Object.keys(parameter).map((k) => [k, { units: "C", longname: k }])),
  };
}

function series(dates: string[], values: (number | null)[]): DailySeries {
  return { dates, values: { T2M_MAX: values }, units: { T2M_MAX: "C" }, sources: [], apiVersion: "test" };
}

describe("POWER parser (SPEC §3.1, §9)", () => {
  it("turns −999 and absent days into null and drops trailing days that are not available yet", () => {
    const parsed = parsePowerDaily(
      response("20251229", "20260102", {
        T2M_MAX: { "20251229": 1.5, "20251230": -999, "20251231": 2, "20260101": -999, "20260102": -999 },
        PRECTOTCORR: { "20251229": 0, "20251231": -999, "20260101": -999, "20260102": -999 },
      }),
      ["T2M_MAX", "PRECTOTCORR"],
    );
    expect(parsed.dates).toEqual(["2025-12-29", "2025-12-30", "2025-12-31"]);
    expect(parsed.values.T2M_MAX).toEqual([1.5, null, 2]);
    expect(parsed.values.PRECTOTCORR).toEqual([0, null, null]);
  });

  it("rejects a response that lacks a requested parameter", () => {
    expect(() => parsePowerDaily(response("20250101", "20250101", { T2M_MAX: { "20250101": 1 } }), ["WS2M"])).toThrow(/WS2M/);
  });

  it("excludes years with more than 10 % missing days and marks partial years", () => {
    const dates = dateRange("2006-01-01", "2008-03-31");
    // 2006: 36 of 365 missing (9.9 %) → kept. 2007: 37 of 365 (10.1 %) → excluded. 2008: partial year.
    const values = dates.map((d) => {
      const dayOfYear = Math.round((Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 86_400_000);
      const missing = d.startsWith("2006") ? dayOfYear < 36 : d.startsWith("2007") ? dayOfYear < 37 : false;
      return missing ? null : 20;
    });
    const coverage = yearCoverage(series(dates, values), ["T2M_MAX"]);
    expect(coverage.map((y) => [y.year, y.days, y.complete, y.missing.T2M_MAX, y.excluded])).toEqual([
      [2006, 365, true, 36, false],
      [2007, 365, true, 37, true],
      [2008, 91, false, 0, false],
    ]);
  });

  it("averages complete months only and nulls months with more than 10 % missing", () => {
    const dates = dateRange("2006-01-01", "2006-03-15");
    const values = dates.map((d) => {
      const day = Number(d.slice(8, 10));
      if (d.startsWith("2006-01")) return day <= 3 ? null : 2; // 3/31 missing → mean 2
      if (d.startsWith("2006-02")) return day <= 3 ? null : 4; // 3/28 missing (10.7 %) → null
      return 9; // March is incomplete → no value
    });
    expect(monthlyMeans(dates, values)).toEqual({ start: "2006-01", means: [2, null] });
  });

  it("merges consecutive 5-year blocks and refuses gaps", () => {
    const a = series(["2006-01-01", "2006-01-02"], [1, 2]);
    const b = series(["2006-01-03"], [3]);
    expect(mergeDailySeries([b, a]).values.T2M_MAX).toEqual([1, 2, 3]);
    expect(() => mergeDailySeries([a, series(["2006-01-05"], [5])])).toThrow(/not consecutive/);
  });

  it("builds the SPEC §3.1 request URL", () => {
    expect(powerDailyUrl({ lat: 42.33, lon: 59.45 }, "2006-01-01", "2026-11-14", ["T2M_MAX", "PRECTOTCORR"])).toBe(
      "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,PRECTOTCORR&community=AG" +
        "&latitude=42.3300&longitude=59.4500&start=20060101&end=20261114&format=JSON",
    );
  });
});
