import { describe, expect, it } from "vitest";
import {
  annualClimate,
  annualMeansOfMonthly,
  climateTrends,
  monthlyAnomalies,
  monthlyNormals,
  type AnnualClimate,
} from "@/lib/climate";
import { dailyEt0 } from "@/lib/water";
import { syntheticClimate } from "./fixtures/synthetic";

const climate = syntheticClimate();
const et0 = dailyEt0(climate.dates, climate.tmax, climate.tmin, climate.lat);

describe("annual climate statistics (SPEC §5.1)", () => {
  const [y2010] = annualClimate(climate, et0, [2010]);

  it("counts heat, frost and extreme-rain days", () => {
    // Tmax = Tmean + 7 ≥ 35 °C exactly on days 171–229; the synthetic maximum is 37 °C.
    expect(y2010?.heatDays35).toBe(59);
    expect(y2010?.heatDays40).toBe(0);
    // Tmin ≤ 0 °C up to day 82 and from day 318: 82 + 48 days.
    expect(y2010?.frostDays).toBe(130);
    expect(y2010?.extremeRainDays).toBe(0);
    expect(y2010?.frostFreeDays).toBe(235);
  });

  it("gives annual rain, ET0, aridity and the June–August mean Tmax", () => {
    expect(y2010?.precipMm).toBeCloseTo(182.5, 6);
    expect(y2010?.aridity).toBeCloseTo((y2010?.precipMm ?? 0) / (y2010?.et0Mm ?? 1), 3);
    expect(y2010?.summerTmaxC).toBeCloseTo(35.4, 0);
  });

  it("leaves out a year with a missing day", () => {
    const gap = { ...climate, tmax: climate.tmax.map((v, i) => (climate.dates[i] === "2010-05-05" ? null : v)) };
    expect(annualClimate(gap, et0, [2009, 2010, 2011]).map((a) => a.year)).toEqual([2009, 2011]);
  });
});

describe("12-month climatology", () => {
  it("averages temperatures and monthly totals over the years", () => {
    const normals = monthlyNormals(climate, et0, [2006, 2007, 2008]);
    expect(normals).toHaveLength(12);
    const july = normals[6];
    expect(july?.precipMm).toBeCloseTo(15.5, 6); // 0.5 mm × 31 days
    expect(july?.tmeanC).toBeCloseTo(29.4, 0);
    expect((july?.tmaxC ?? 0) - (july?.tminC ?? 0)).toBeCloseTo(14, 6);
    expect(normals[0]?.et0Mm).toBeLessThan(july?.et0Mm ?? 0);
  });
});

describe("soil-moisture anomaly and trends (SPEC §5.1, §5.4)", () => {
  it("gives each month's z-score against the same calendar month", () => {
    const values = Array.from({ length: 24 }, (_, i) => (i === 0 ? 1 : i === 12 ? 3 : 0.5));
    const z = monthlyAnomalies("2006-01", values, 2006, 2007);
    expect(z[0]).toBeCloseTo(-0.71, 2);
    expect(z[12]).toBeCloseTo(0.71, 2);
    expect(z[1]).toBeNull(); // February never varies, so no z-score
  });

  it("computes yearly means of a monthly series only for complete years", () => {
    const means = annualMeansOfMonthly("2006-01", [...Array.from({ length: 12 }, () => 0.4), ...Array.from({ length: 6 }, () => 0.2)]);
    expect(means).toEqual([
      { t: 2006, value: expect.closeTo(0.4, 10) },
      { t: 2007, value: null },
    ]);
  });

  it("reports rising rain and no clear trend for a flat series", () => {
    const flat = annualClimate(climate, et0, Array.from({ length: 20 }, (_, i) => 2006 + i));
    const rising: AnnualClimate[] = flat.map((a, i) => ({ ...a, precipMm: 150 + 5 * i }));
    expect(climateTrends(rising).precipMm?.direction).toBe("rising");
    expect(climateTrends(flat).heatDays35?.direction).toBe("no_clear_trend");
  });
});
