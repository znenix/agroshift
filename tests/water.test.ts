import { describe, expect, it } from "vitest";
import { MJ_TO_MM } from "@/lib/constants";
import { dateRange } from "@/lib/dates";
import {
  averageAndDryYear,
  dailyEt0,
  dayOfYear,
  effectiveRainfall,
  et0Hargreaves,
  extraterrestrialRadiation,
  grossNeedMm,
  kcOnDay,
  m3PerHa,
  percentile,
  seasonWaterNeed,
  type KcCurve,
} from "@/lib/water";

describe("radiation and ET0 (FAO-56, SPEC §9)", () => {
  it("matches FAO-56 Example 8: Ra on 3 September at 20° S = 32.2 MJ m⁻² day⁻¹ (13.1 mm/day)", () => {
    expect(dayOfYear("2025-09-03")).toBe(246);
    const ra = extraterrestrialRadiation(-20, 246);
    expect(ra).toBeCloseTo(32.2, 1);
    expect(ra * MJ_TO_MM).toBeCloseTo(13.1, 1);
  });

  it("computes Hargreaves ET0 for a hand-checked case", () => {
    // 0.0023 × (27.5 + 17.8) × √15 × 16 = 6.4564 mm/day
    expect(et0Hargreaves(35, 20, 16)).toBeCloseTo(6.4564, 4);
  });

  it("raises ET0 when the whole day is 2 °C warmer (scenario ΔT)", () => {
    expect(et0Hargreaves(37, 22, 16)).toBeGreaterThan(et0Hargreaves(35, 20, 16));
  });

  it("never returns negative ET0 and skips days without temperature", () => {
    expect(et0Hargreaves(-25, -30, 2)).toBe(0);
    const et0 = dailyEt0(["2025-07-01", "2025-07-02"], [35, null], [20, 21], 41.3);
    expect(et0[0]).toBeGreaterThan(0);
    expect(et0[1]).toBeNull();
  });
});

describe("effective rainfall (Brouwer & Heibloem 1986)", () => {
  it("uses 0.8 P − 25 above 75 mm, 0.6 P − 10 otherwise, never below zero", () => {
    expect(effectiveRainfall(100)).toBeCloseTo(55, 10);
    expect(effectiveRainfall(75)).toBeCloseTo(35, 10);
    expect(effectiveRainfall(75.0001)).toBeCloseTo(35, 3); // the two branches meet at 75 mm
    expect(effectiveRainfall(50)).toBeCloseTo(20, 10);
    expect(effectiveRainfall(10)).toBe(0);
    expect(effectiveRainfall(0)).toBe(0);
  });
});

describe("FAO-56 crop coefficient curve", () => {
  const curve: KcCurve = { kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, stageFractions: [0.2, 0.3, 0.3, 0.2], seasonDays: 100 };

  it("is flat in the initial and mid stages and linear in development and late stages", () => {
    expect(kcOnDay(curve, 1)).toBe(0.3);
    expect(kcOnDay(curve, 20)).toBe(0.3);
    expect(kcOnDay(curve, 35)).toBeCloseTo(0.75, 10);
    expect(kcOnDay(curve, 50)).toBeCloseTo(1.2, 10);
    expect(kcOnDay(curve, 65)).toBe(1.2);
    expect(kcOnDay(curve, 90)).toBeCloseTo(0.9, 10);
    expect(kcOnDay(curve, 100)).toBeCloseTo(0.6, 10);
  });
});

describe("seasonal irrigation need (SPEC §5.2)", () => {
  const dates = dateRange("2025-06-01", "2025-07-31");
  const et0 = dates.map(() => 5);
  const precip = dates.map((d) => (d.startsWith("2025-06") ? 100 / 30 : 20 / 31)); // June 100 mm, July 20 mm
  const flat = (seasonDays: number): KcCurve => ({ kcIni: 1, kcMid: 1, kcEnd: 1, stageFractions: [0.25, 0.25, 0.25, 0.25], seasonDays });

  it("balances whole months: ETc minus effective rain, deficits summed", () => {
    // June: ETc 150, Peff(100 mm) = 55 → 95. July: ETc 155, Peff(20 mm) = 2 → 153.
    expect(seasonWaterNeed({ dates, et0, precip, start: 0, curve: flat(61) })).toEqual({ days: 61, etcMm: 305, peffMm: 57, netMm: 248 });
  });

  it("prorates a month's effective rain by the season days inside it", () => {
    // 16 June – 15 July: June 75 − 55 × 15/30 = 47.5; July 75 − 2 × 15/31 = 74.03 → 121.5
    expect(seasonWaterNeed({ dates, et0, precip, start: 15, curve: flat(30) })).toEqual({ days: 30, etcMm: 150, peffMm: 28.5, netMm: 121.5 });
  });

  it("does not let a wet month's surplus cover a later deficit", () => {
    const wetJune = dates.map((d) => (d.startsWith("2025-06") ? 400 / 30 : 0));
    // June: Peff(400 mm) = 295 > ETc 150 → no deficit. July: ETc 155, no rain → 155.
    expect(seasonWaterNeed({ dates, et0, precip: wetJune, start: 0, curve: flat(61) })?.netMm).toBe(155);
  });

  it("leaves out a season with a missing day or one that runs past the data", () => {
    const gap = et0.map((v, i) => (i === 10 ? null : v));
    expect(seasonWaterNeed({ dates, et0: gap, precip, start: 0, curve: flat(30) })).toBeNull();
    expect(seasonWaterNeed({ dates, et0, precip, start: 40, curve: flat(30) })).toBeNull();
  });

  it("converts to gross need and m³/ha, and finds the dry year (P90)", () => {
    expect(grossNeedMm(248, 0.6)).toBe(413.3);
    expect(m3PerHa(248)).toBe(2480);
    expect(() => grossNeedMm(100, 0)).toThrow(RangeError);
    const yearly = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(yearly, 0.9)).toBeCloseTo(910, 10);
    expect(averageAndDryYear(yearly)).toEqual({ average: 550, dryYear: 910, years: 10 });
    expect(averageAndDryYear([])).toBeNull();
  });
});
