import { describe, expect, it } from "vitest";
import { METRIC_RANGES } from "@/lib/constants";
import { cardConfidence, effectiveWeights, normalize, rankRotations, scoreRotation, type PriorityWeights } from "@/lib/ranking";
import type { RotationEvaluation, RotationMetrics } from "@/lib/rotations";

const weights = (w: Partial<PriorityWeights>): PriorityWeights => ({
  water_saving: 0,
  soil_health: 0,
  forage: 0,
  income_market: 0,
  low_risk: 0,
  simplicity: 0,
  ...w,
});

const BASE: RotationMetrics = {
  water: { averageM3PerHa: 6000, dryYearM3PerHa: 7000, years: 20, gross: true },
  bareDaysPerYear: 100,
  bareSpells: [],
  erosionIndex: null,
  nFixingShare: 0,
  organicMatter: 0.5,
  longestFamilyRun: 2,
  vulnerability: { heat: 0.1, frost: 0, harvestRain: 0, mean: 0.03 },
  salinityLossPct: null,
  forage: 1,
  marketRating: null,
  distinctCrops: 2,
};

function evaluation(id: string, metrics: Partial<RotationMetrics>, feasible = true): RotationEvaluation {
  return {
    id,
    years: [],
    timeline: [],
    feasible,
    exclusions: [],
    metrics: { ...BASE, ...metrics },
    confidence: { water: "medium", bareDays: "high", erosion: "low", soil: "low", vulnerability: "medium", salinity: null, forage: "low", market: "farmer" },
  };
}

// Needs a lot of water but is good for the soil, versus frugal with water but poor for the soil.
const thirsty = evaluation("thirsty", {
  water: { averageM3PerHa: 9000, dryYearM3PerHa: 12000, years: 20, gross: true },
  bareDaysPerYear: 20,
  organicMatter: 0.9,
  nFixingShare: 0.4,
  longestFamilyRun: 1,
});
const frugal = evaluation("frugal", {
  water: { averageM3PerHa: 3000, dryYearM3PerHa: 4000, years: 20, gross: true },
  bareDaysPerYear: 250,
  organicMatter: 0.2,
  nFixingShare: 0,
  longestFamilyRun: Number.POSITIVE_INFINITY,
});

describe("ranking by farmer priorities (SPEC §5.10, §9)", () => {
  it("changes the order when the water weight changes", () => {
    const order = (w: PriorityWeights) => rankRotations([thirsty, frugal], w, null).top.map((r) => r.evaluation.id);
    expect(order(weights({ soil_health: 3 }))).toEqual(["thirsty", "frugal"]);
    expect(order(weights({ water_saving: 3, soil_health: 1 }))).toEqual(["frugal", "thirsty"]);
  });

  it("raises the water-saving weight when water is short, capped at 3", () => {
    expect(effectiveWeights(weights({ water_saving: 1 }), "often_short").water_saving).toBe(3);
    expect(effectiveWeights(weights({ water_saving: 1 }), "sometimes_short").water_saving).toBe(2);
    expect(effectiveWeights(weights({ water_saving: 3 }), "sometimes_short").water_saving).toBe(3);
    expect(effectiveWeights(weights({}), "reliable").water_saving).toBe(0);
  });

  it("normalises on fixed ranges, so other options never change a rotation's score", () => {
    expect(normalize(25000, METRIC_RANGES.dryYearGrossM3)).toBe(0);
    expect(normalize(0, METRIC_RANGES.dryYearGrossM3)).toBe(1);
    expect(normalize(12500, METRIC_RANGES.dryYearGrossM3)).toBeCloseTo(0.5, 10);
    expect(normalize(Number.POSITIVE_INFINITY, METRIC_RANGES.longestFamilyRunSeasons)).toBe(0);
    const w = weights({ water_saving: 2, soil_health: 1 });
    const alone = rankRotations([thirsty], w, null).top[0]?.score.total;
    const together = rankRotations([thirsty, frugal, evaluation("other", {})], w, null).top.find((r) => r.evaluation.id === "thirsty")?.score.total;
    expect(together).toBe(alone);
  });

  it("keeps the current rotation apart, shows the best 3 feasible alternatives and lists the excluded", () => {
    const options = [thirsty, frugal, evaluation("a", {}), evaluation("b", {}), evaluation("c", {}, false), evaluation("current", {})];
    const ranking = rankRotations(options, weights({ water_saving: 1 }), "current");
    expect(ranking.current?.evaluation.id).toBe("current");
    expect(ranking.top).toHaveLength(3);
    expect(ranking.more).toHaveLength(1);
    expect(ranking.excluded.map((e) => e.id)).toEqual(["c"]);
  });

  it("returns no total without any weighted priority, and the lowest confidence of what is weighted", () => {
    expect(scoreRotation(thirsty, weights({})).total).toBeNull();
    expect(cardConfidence(thirsty, weights({ water_saving: 3 }))).toBe("medium");
    expect(cardConfidence(thirsty, weights({ water_saving: 3, soil_health: 1 }))).toBe("low");
    expect(cardConfidence(thirsty, weights({ simplicity: 2 }))).toBe("high");
  });
});
