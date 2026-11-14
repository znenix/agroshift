import { describe, expect, it } from "vitest";
import { applyScenario, completeYears, firstAutumnFrost, frostStats, lastSpringFrost, trailingMean } from "@/lib/climate";
import { calendarContext, mainSeason } from "@/lib/crops";
import { dailyEt0 } from "@/lib/water";
import { crop, syntheticClimate } from "./fixtures/synthetic";

describe("frost dates (SPEC §5.1, §9)", () => {
  const climate = syntheticClimate();

  it("finds the last spring frost and the first autumn frost on a synthetic series", () => {
    expect(lastSpringFrost(climate, 2010)).toBe(82);
    expect(firstAutumnFrost(climate, 2010)).toEqual({ doy: 318, frost: true });
  });

  it("summarises the years: mean, safe-in-80%-of-years dates and frost-free season", () => {
    const stats = frostStats(climate, completeYears(climate));
    // 2026 has no data for its winter, so it is left out.
    expect(stats).toMatchObject({ years: 21, lastSpringMean: 82, lastSpringSafe: 82, firstAutumnMean: 318, firstAutumnSafe: 318, frostFreeDaysMean: 235 });
  });

  it("never lets a frost-free winter make the safe first-frost date earlier", () => {
    const warm = syntheticClimate({ mean: 22, amplitude: 8 }); // coldest Tmin = 22 − 8 − 7 = 7 °C
    const stats = frostStats(warm, completeYears(warm));
    expect(stats.lastSpringSafe).toBe(0);
    expect(stats.firstAutumnMean).toBeNull();
    expect(stats.firstAutumnSafe).toBeGreaterThan(365);
  });

  it("averages only complete windows", () => {
    expect(trailingMean([1, 2, 3, null, 5, 6, 7], 3)).toEqual([null, null, 2, null, null, null, 6]);
  });
});

describe("scenarios (SPEC §5.11, §9)", () => {
  const base = syntheticClimate();
  const year = 2010;

  it("+2 °C sows a spring crop earlier and raises ET0 over its season", () => {
    const hot = applyScenario(base, { deltaT: 2, rainFactor: 1 });
    const normal = mainSeason(crop("cotton"), calendarContext(base), year);
    const warmer = mainSeason(crop("cotton"), calendarContext(hot), year);
    expect(normal).not.toBeNull();
    expect(warmer).not.toBeNull();
    if (normal === null || warmer === null) return;
    expect(warmer.sow).toBeLessThan(normal.sow);
    const seasonEt0 = (c: typeof base) =>
      dailyEt0(c.dates, c.tmax, c.tmin, c.lat)
        .slice(normal.sow, normal.harvest + 1)
        .reduce<number>((sum, v) => sum + (v ?? 0), 0);
    expect(seasonEt0(hot)).toBeGreaterThan(seasonEt0(base));
  });

  it("dry-year preset scales every day's rain by 0.7 (team decision 2026-11-14)", () => {
    const dry = applyScenario(base, { deltaT: 0, rainFactor: 0.7 });
    expect(dry.precip[100]).toBeCloseTo(0.35, 10);
    expect(dry.tmax[100]).toBe(base.tmax[100]);
  });
});
