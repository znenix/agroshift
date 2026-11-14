import { describe, expect, it } from "vitest";
import { analyze, buildProfile, type FarmAnswers } from "@/lib/analysis";
import { NORMAL_SCENARIO } from "@/lib/climate";
import { CROPS, ROTATIONS, template } from "./fixtures/synthetic";
import { syntheticFarm } from "./fixtures/farm";

const profile = buildProfile(syntheticFarm(), null);
const answers: FarmAnswers = {
  current: { id: "cotton_mono", years: template("cotton_mono").years },
  priorities: { water_saving: 3, soil_health: 3, forage: 0, income_market: 0, low_risk: 0, simplicity: 0 },
  reliability: "often_short",
  farmer: { mode: "irrigated", irrigation: "furrow", waterAllocationM3PerHa: null, requiredShare: null, unavailableCrops: [], marketRating: {} },
  soilTest: { ece: null, ph: null },
};
const normal = analyze(profile, CROPS, ROTATIONS, answers, NORMAL_SCENARIO);
const cottonSowing = (a: typeof normal) => a.fits.find((f) => f.cropId === "cotton")?.stats.sowDayMedian ?? null;

describe("field analysis and stress test (SPEC §4.3, §5.11)", () => {
  it("evaluates the farmer's rotation, ranks the alternatives and compares with the satellite", () => {
    expect(normal.current.id).toBe("cotton_mono");
    expect(normal.ranking.current?.evaluation.id).toBe("cotton_mono");
    expect(normal.ranking.top.length).toBeGreaterThan(0);
    expect(normal.satellite).not.toBeNull();
    expect(normal.climate.et0Mm).toBeGreaterThan(0);
  });

  it("re-runs the whole engine under +2 °C: earlier sowing, more ET0, the observed satellite check unchanged", () => {
    const hot = analyze(profile, CROPS, ROTATIONS, answers, { deltaT: 2, rainFactor: 1 });
    const before = cottonSowing(normal);
    const after = cottonSowing(hot);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after ?? 0).toBeLessThan(before ?? 0);
    expect(hot.climate.et0Mm ?? 0).toBeGreaterThan(normal.climate.et0Mm ?? 0);
    expect(hot.climate.heatDays35 ?? 0).toBeGreaterThan(normal.climate.heatDays35 ?? 0);
    expect(hot.satellite).toEqual(normal.satellite);
  });

  it("dry year (rain −30 %) lowers rain and does not lower the irrigation need", () => {
    const dry = analyze(profile, CROPS, ROTATIONS, answers, { deltaT: 0, rainFactor: 0.7 });
    expect(dry.climate.precipMm ?? 0).toBeCloseTo((normal.climate.precipMm ?? 0) * 0.7, 0);
    expect(dry.current.metrics.water.averageM3PerHa ?? 0).toBeGreaterThanOrEqual(normal.current.metrics.water.averageM3PerHa ?? 0);
  });
});
