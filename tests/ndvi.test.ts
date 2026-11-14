import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import {
  barePeriods,
  compositeSlot,
  expectedCover,
  growingSeasonMeans,
  ndviTrend,
  satelliteCheck,
  seasonalCurve,
  type NdviPoint,
} from "@/lib/ndvi";
import type { TimelineSlot } from "@/lib/rotations";
import { CROPS } from "./fixtures/synthetic";

/** 23 composites per year; NDVI from a function of the composite's middle day of the year (0-based). */
function composites(years: readonly number[], ndviAt: (year: number, midDay: number) => number | null): NdviPoint[] {
  return years.flatMap((year) =>
    Array.from({ length: 23 }, (_, k) => {
      const date = addDays(`${year}-01-01`, k * 16);
      return { date, ndvi: ndviAt(year, k * 16 + 8), n: 40 };
    }),
  );
}

describe("seasonal curve and bare periods (SPEC §5.3)", () => {
  it("numbers the 16-day periods 1–23", () => {
    expect(compositeSlot("2025-01-01")).toBe(1);
    expect(compositeSlot("2025-01-17")).toBe(2);
    expect(compositeSlot("2025-12-19")).toBe(23);
  });

  it("takes the median per period over the chosen years", () => {
    const series = composites([2023, 2024, 2025], (year, day) => (day > 150 && day < 250 ? 0.5 + (year - 2023) * 0.1 : 0.1));
    const curve = seasonalCurve(series, 2023, 2025);
    expect(curve).toHaveLength(23);
    expect(curve[11]).toMatchObject({ slot: 12, median: 0.6, years: 3 }); // middle of the green season
    expect(curve[0]).toMatchObject({ median: 0.1, years: 3 });
    expect(seasonalCurve(series, 2025, 2025)[11]?.median).toBeCloseTo(0.7, 10);
  });

  it("finds the bare period and joins it across New Year", () => {
    const curve = seasonalCurve(composites([2024], (_, day) => (day > 90 && day < 290 ? 0.6 : 0.12)), 2024, 2024);
    expect(barePeriods(curve)).toEqual([{ fromSlot: 19, toSlot: 6, fromDoy: 289, toDoy: 96 }]);
  });
});

describe("growing-season NDVI trend", () => {
  it("averages April–September and detects a steady rise", () => {
    const years = Array.from({ length: 10 }, (_, i) => 2016 + i);
    const series = composites(years, (year) => 0.3 + (year - 2016) * 0.02);
    const means = growingSeasonMeans(series);
    expect(means[0]).toEqual({ t: 2016, value: 0.3 });
    expect(ndviTrend(series, 2025)?.direction).toBe("rising");
  });

  it("gives no mean when too few composites have a value", () => {
    const sparse = composites([2020], (_, day) => (day < 140 ? 0.4 : null));
    expect(growingSeasonMeans(sparse)).toEqual([{ t: 2020, value: null }]);
  });
});

describe("what the satellite saw (SPEC §5.3)", () => {
  // Cotton → winter wheat: cotton in cycle year 1; wheat sown in year 1's autumn, harvested in June of year 2.
  const timeline: TimelineSlot[] = [
    { year: 1, role: "main", cropId: "cotton", start: 100, end: 274 },
    { year: 2, role: "main", cropId: "winter_wheat", start: 285, end: 525 },
  ];
  const expected = expectedCover(timeline, CROPS, 2);
  const cottonYear = (day: number) => (day >= 150 && day <= 225 ? 0.7 : day <= 90 || day >= 290 ? 0.1 : 0.25);
  const wheatYear = (day: number) => (day < 60 ? 0.15 : day <= 125 ? 0.6 : day >= 175 && day <= 350 ? 0.1 : 0.25);

  it("marks a crop green from mid-development to the end of mid-season, and fallow days bare", () => {
    expect(expected[180]).toBe("green"); // cotton in July
    expect(expected[50]).toBe("bare"); // February before cotton
    expect(expected[365 + 90]).toBe("green"); // wheat in April
    expect(expected[365 + 250]).toBe("bare"); // after the wheat harvest
    expect(expected[105]).toBe("unknown"); // just after sowing
  });

  it("finds the matching phase and no mismatch when the field behaves as the farmer says", () => {
    const series = composites([2023, 2024, 2025], (year, day) => (year === 2024 ? wheatYear(day) : cottonYear(day)));
    const check = satelliteCheck(series, expected, 2, [2023, 2024, 2025]);
    expect(check?.phase).toBe(0);
    expect(check?.mismatches).toEqual([]);
    expect(check?.agree).toBeGreaterThan(10);
  });

  it("reports a green summer where the farmer's rotation leaves the field bare after wheat", () => {
    const series = composites([2023, 2024, 2025], (year, day) =>
      year === 2024 ? (day >= 185 && day <= 260 ? 0.7 : wheatYear(day)) : cottonYear(day),
    );
    const check = satelliteCheck(series, expected, 2, [2023, 2024, 2025]);
    expect(check?.phase).toBe(0);
    expect(check?.mismatches).toEqual([
      { year: 2024, kind: "green_where_bare_expected", from: "2024-07-11", to: "2024-09-12", composites: 4 },
    ]);
  });
});
