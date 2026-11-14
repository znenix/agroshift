import { describe, expect, it } from "vitest";
import { completeYears, frostStats } from "@/lib/climate";
import { calendarContext, cropFit, fitCategory, maasHoffmanLossPct, mainSeason, trapezoid, type SoilConditions } from "@/lib/crops";
import { crop, syntheticClimate } from "./fixtures/synthetic";

describe("Maas–Hoffman yield loss (SPEC §9)", () => {
  it("loses b·(ECe − a) % above the threshold a, never below 0 or above 100", () => {
    expect(maasHoffmanLossPct(5, 7.7, 5.2)).toBe(0);
    expect(maasHoffmanLossPct(10, 7.7, 5.2)).toBeCloseTo(11.96, 6); // cotton at 10 dS/m
    expect(maasHoffmanLossPct(20, 1.7, 12)).toBe(100);
  });
});

describe("crop-fit categories at the boundaries (SPEC §5.7, §9)", () => {
  it("uses ≥ 70 recommended, 40–69 risky, < 40 not suitable, and lets blockers override", () => {
    expect(fitCategory(39.9, 0, 0)).toBe("not_suitable");
    expect(fitCategory(40, 0, 0)).toBe("risky");
    expect(fitCategory(69.9, 0, 0)).toBe("risky");
    expect(fitCategory(70, 0, 0)).toBe("recommended");
    expect(fitCategory(90, 0, 1)).toBe("risky");
    expect(fitCategory(95, 1, 0)).toBe("not_suitable");
  });

  it("scores a trapezoid: 0 outside the absolute range, 100 in the optimal range, linear between", () => {
    expect(trapezoid(25, 15, 21, 30, 40)).toBe(100);
    expect(trapezoid(18, 15, 21, 30, 40)).toBeCloseTo(50, 10);
    expect(trapezoid(35, 15, 21, 30, 40)).toBeCloseTo(50, 10);
    expect(trapezoid(14, 15, 21, 30, 40)).toBe(0);
  });
});

describe("crop fit on a synthetic field", () => {
  const climate = syntheticClimate();
  const ctx = calendarContext(climate);
  const years = completeYears(climate).filter((y) => y >= 2006 && y <= 2025);
  const frost = frostStats(climate, years);
  const soil = (ece: number | null): SoilConditions => ({ ph: 7.5, ece, eceSource: ece === null ? null : "soil_test", slopePct: 0.5 });

  it("recommends cotton where it fits, with the harvest well before the first frost", () => {
    const fit = cropFit(crop("cotton"), ctx, years, frost, soil(3));
    expect(fit.category).toBe("recommended");
    expect(fit.hardBlockers).toEqual([]);
    expect(fit.softBlockers).toEqual([]);
    expect(fit.stats.frostMarginDays).toBeGreaterThanOrEqual(20);
  });

  it("blocks maize on saline soil and explains why with a reason key and numbers", () => {
    const fit = cropFit(crop("maize_grain"), ctx, years, frost, soil(8));
    expect(fit.category).toBe("not_suitable");
    expect(fit.hardBlockers).toContainEqual({ key: "crop.reason.salinity_loss", params: { crop: "maize_grain", loss: 76 } });
  });

  it("marks a salt-sensitive crop 'needs soil test' when salinity is unknown instead of guessing", () => {
    const maize = cropFit(crop("maize_grain"), ctx, years, frost, soil(null));
    expect(maize.needsSoilTest).toBe(true);
    expect(maize.subFits.salinity).toBeNull();
    expect(maize.gaps.map((g) => g.key)).toContain("crop.gap.salinity_unknown");
    expect(cropFit(crop("cotton"), ctx, years, frost, soil(null)).needsSoilTest).toBe(false);
  });

  it("counts frost after sowing only while the crop is young; a late frost is the season check's job", () => {
    const springFrost = syntheticClimate({ extraFrostDoy: 130 }); // 10 May, after cotton is sown (~day 112)
    const spring = cropFit(crop("cotton"), calendarContext(springFrost), years, frostStats(springFrost, years), soil(3));
    expect(spring.stats.frostShare).toBe(1);
    expect(spring.softBlockers.map((b) => b.key)).toContain("crop.reason.frost_after_sowing");
    const lateFrost = syntheticClimate({ extraFrostDoy: 240 }); // 28 August, near the cotton harvest
    const late = cropFit(crop("cotton"), calendarContext(lateFrost), years, frostStats(lateFrost, years), soil(3));
    expect(late.stats.frostShare).toBe(0);
    expect(late.hardBlockers.map((b) => b.key)).toContain("crop.reason.season_too_long");
  });

  it("treats heat as a warning only, never a blocker (team decision 2026-11-14)", () => {
    const hot = syntheticClimate({ mean: 18 }); // Tmax peaks at 41 °C, above cotton's 38 °C
    const fit = cropFit(crop("cotton"), calendarContext(hot), years, frostStats(hot, years), soil(3));
    expect(fit.warnings.map((w) => w.key)).toEqual(["crop.warning.heat_window"]);
    expect([...fit.softBlockers, ...fit.hardBlockers].map((b) => b.key)).not.toContain("crop.warning.heat_window");
  });

  it("never sows cotton before 15 April, even in a warm spring (local practice)", () => {
    const warm = syntheticClimate({ mean: 20 });
    const season = mainSeason(crop("cotton"), calendarContext(warm), 2010);
    expect(warm.dates[season?.sow ?? -1]).toBe("2010-04-15");
  });

  it("blocks a frost-sensitive crop whose season runs past the first autumn frost", () => {
    const shortSummer = syntheticClimate({ extraFrostDoy: 240 }); // frost every 28 August
    const c = calendarContext(shortSummer);
    const fit = cropFit(crop("cotton"), c, years, frostStats(shortSummer, years), soil(3));
    expect(fit.category).toBe("not_suitable");
    expect(fit.hardBlockers.map((b) => b.key)).toContain("crop.reason.season_too_long");
  });
});
