import { describe, expect, it } from "vitest";
import { completeYears, frostStats, type DailyClimate } from "@/lib/climate";
import { calendarContext, type SoilConditions } from "@/lib/crops";
import { evaluateRotation, longestCyclicRun, type EvaluationContext, type FarmerInputs } from "@/lib/rotations";
import { dailyEt0 } from "@/lib/water";
import { CROPS, syntheticClimate, template } from "./fixtures/synthetic";

const FARMER: FarmerInputs = {
  mode: "irrigated",
  irrigation: "furrow",
  waterAllocationM3PerHa: null,
  requiredShare: null,
  unavailableCrops: [],
  marketRating: {},
};
const SOIL: SoilConditions = { ph: 7.5, ece: 3, eceSource: "soil_test", slopePct: 0.5 };

function context(climate: DailyClimate, farmer: Partial<FarmerInputs> = {}): EvaluationContext {
  const years = completeYears(climate).filter((y) => y >= 2006 && y <= 2025);
  return {
    calendar: calendarContext(climate),
    et0: dailyEt0(climate.dates, climate.tmax, climate.tmin, climate.lat),
    years,
    frost: frostStats(climate, years),
    crops: CROPS,
    soil: SOIL,
    monthlyWindMs: Array.from({ length: 12 }, () => 3),
    farmer: { ...FARMER, ...farmer },
  };
}

const climate = syntheticClimate();
const ctx = context(climate);

describe("rotation timelines (SPEC §5.8, §9)", () => {
  it("places winter wheat in the autumn before its harvest year and wraps it around the cycle", () => {
    const wheat = evaluateRotation({ id: "wheat_every_year", years: [{ main: "winter_wheat", second: null }] }, ctx);
    const slot = wheat.timeline[0];
    expect(slot?.start).toBeLessThan(0); // sown in the year before
    expect(slot?.end).toBeGreaterThan(150); // harvested in June
    expect(wheat.metrics.bareSpells).toHaveLength(1);
    const spell = wheat.metrics.bareSpells[0];
    expect(spell?.from).toBeGreaterThan(150); // the bare spell is the summer between harvest and sowing
    expect(spell?.to).toBeLessThan(300);
  });

  it("leaves the field bare much longer under cotton monoculture than with wheat + mung bean", () => {
    const mono = evaluateRotation(template("cotton_mono"), ctx);
    const double = evaluateRotation({ id: "wheat_mung", years: [{ main: "winter_wheat", second: "mung_bean" }] }, ctx);
    expect(mono.metrics.bareDaysPerYear).toBe(365 - 175);
    expect(double.metrics.bareDaysPerYear).toBeLessThan(60);
    expect(mono.metrics.longestFamilyRun).toBe(Number.POSITIVE_INFINITY);
    expect(double.metrics.nFixingShare).toBe(0.5);
  });

  it("computes water need for every crop year, with the dry year at least the average", () => {
    const water = evaluateRotation(template("cotton_wheat_mung"), ctx).metrics.water;
    expect(water.years).toBeGreaterThan(15);
    expect(water.averageM3PerHa).toBeGreaterThan(0);
    expect(water.dryYearM3PerHa ?? 0).toBeGreaterThanOrEqual(water.averageM3PerHa ?? Infinity);
  });
});

describe("feasibility checks (SPEC §5.8)", () => {
  it("excludes a second crop that cannot mature before the first autumn frost (SPEC §9)", () => {
    expect(evaluateRotation(template("cotton_wheat_mung"), ctx).feasible).toBe(true);
    const earlyFrost = evaluateRotation(template("cotton_wheat_mung"), context(syntheticClimate({ extraFrostDoy: 240 })));
    expect(earlyFrost.feasible).toBe(false);
    expect(earlyFrost.exclusions).toContainEqual({ key: "rotation.excluded.second_crop_frost", params: { crop: "mung_bean" } });
  });

  it("applies the water allocation, the cotton contract share, unavailable crops and the field mode", () => {
    const keys = (farmer: Partial<FarmerInputs>, id: string) =>
      evaluateRotation(template(id), context(climate, farmer)).exclusions.map((e) => e.key);
    expect(keys({ waterAllocationM3PerHa: 1000 }, "cotton_mono")).toContain("rotation.excluded.water_allocation");
    expect(evaluateRotation(template("cotton_wheat"), context(climate, { requiredShare: { crop: "cotton", minShare: 0.7 } })).exclusions).toContainEqual({
      key: "rotation.excluded.crop_share",
      params: { crop: "cotton", share: 50, required: 70 },
    });
    expect(keys({ unavailableCrops: ["mung_bean"] }, "cotton_wheat_mung")).toContain("rotation.excluded.unavailable_crop");
    expect(keys({}, "rainfed_wheat_chickpea")).toContain("rotation.excluded.rainfed_only");
  });
});

describe("pest-cycle breaks", () => {
  it("finds the longest run of one plant family around the cycle", () => {
    expect(longestCyclicRun(["Poaceae", "Malvaceae", "Poaceae", "Poaceae"])).toBe(3);
    expect(longestCyclicRun(["Malvaceae", "Poaceae"])).toBe(1);
    expect(longestCyclicRun(["Poaceae", "Poaceae"])).toBe(Number.POSITIVE_INFINITY);
  });
});
