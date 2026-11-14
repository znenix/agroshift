/**
 * Ranking by the farmer's priorities (SPEC §5.10). Every metric is mapped to 0–1 on a fixed, documented
 * range (src/lib/constants.ts METRIC_RANGES), never relative to the other rotations; the farmer's
 * weights combine them; the raw metrics are always shown next to the total.
 */
import { METRIC_RANGES, PRIORITY_MAX, TOP_ALTERNATIVES, WATER_RELIABILITY_BONUS } from "./constants";
import type { Confidence, RotationEvaluation, RotationMetrics } from "./rotations";

export const PRIORITIES = ["water_saving", "soil_health", "forage", "income_market", "low_risk", "simplicity"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type PriorityWeights = Readonly<Record<Priority, number>>;
export type WaterReliability = keyof typeof WATER_RELIABILITY_BONUS;

/** The farmer's weights (0–3) with the water-saving weight raised when water is unreliable, capped at 3. */
export function effectiveWeights(weights: PriorityWeights, reliability: WaterReliability): PriorityWeights {
  const clamp = (w: number) => Math.min(PRIORITY_MAX, Math.max(0, w));
  return {
    water_saving: clamp(weights.water_saving + WATER_RELIABILITY_BONUS[reliability]),
    soil_health: clamp(weights.soil_health),
    forage: clamp(weights.forage),
    income_market: clamp(weights.income_market),
    low_risk: clamp(weights.low_risk),
    simplicity: clamp(weights.simplicity),
  };
}

/** Maps a value to 0–1 (1 = best) on a fixed range, clamped; Infinity lands on the matching end. */
export function normalize(value: number, range: { best: number; worst: number }): number {
  const x = (value - range.worst) / (range.best - range.worst);
  return Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x));
}

export interface NormalizedMetrics {
  water: number | null;
  bareDays: number;
  erosion: number | null;
  organicMatter: number;
  nFixing: number;
  pestBreak: number;
  vulnerability: number | null;
  salinity: number | null;
  forage: number;
  market: number | null;
  simplicity: number;
}

export function normalizeMetrics(m: RotationMetrics): NormalizedMetrics {
  const r = METRIC_RANGES;
  return {
    water: m.water.dryYearM3PerHa === null ? null : normalize(m.water.dryYearM3PerHa, r.dryYearGrossM3),
    bareDays: normalize(m.bareDaysPerYear, r.bareDays),
    erosion: m.erosionIndex === null ? null : normalize(m.erosionIndex, r.erosionIndex),
    organicMatter: normalize(m.organicMatter, r.organicMatter),
    nFixing: normalize(m.nFixingShare, r.nFixingShare),
    pestBreak: normalize(m.longestFamilyRun, r.longestFamilyRunSeasons),
    vulnerability: m.vulnerability.mean === null ? null : normalize(m.vulnerability.mean, r.vulnerabilityShare),
    salinity: m.salinityLossPct === null ? null : normalize(m.salinityLossPct, r.salinityLossPct),
    forage: normalize(m.forage, r.forage),
    market: m.marketRating === null ? null : normalize(m.marketRating, r.marketRating),
    simplicity: normalize(m.distinctCrops, r.distinctCrops),
  };
}

/** Which metrics each priority looks at. Income is not ranked: it needs the farmer's own yields and prices. */
const GROUPS: Readonly<Record<Priority, ReadonlyArray<keyof NormalizedMetrics>>> = {
  water_saving: ["water"],
  soil_health: ["bareDays", "erosion", "organicMatter", "nFixing", "pestBreak"],
  forage: ["forage"],
  income_market: ["market"],
  low_risk: ["vulnerability", "salinity"],
  simplicity: ["simplicity"],
};

function groupConfidence(priority: Priority, c: RotationEvaluation["confidence"]): Confidence[] {
  switch (priority) {
    case "water_saving":
      return [c.water];
    case "soil_health":
      return [c.bareDays, c.erosion, c.soil];
    case "forage":
      return [c.forage];
    case "income_market":
      return [c.market];
    case "low_risk":
      return c.salinity === null ? [c.vulnerability] : [c.vulnerability, c.salinity];
    case "simplicity":
      return ["high"];
  }
}

export interface Score {
  /** Weighted total, 0–100; `null` when no weighted priority has data. */
  total: number | null;
  /** Each priority's part, 0–1; `null` when its metrics are unknown. */
  parts: Readonly<Record<Priority, number | null>>;
  normalized: NormalizedMetrics;
}

export function scoreRotation(evaluation: RotationEvaluation, weights: PriorityWeights): Score {
  const normalized = normalizeMetrics(evaluation.metrics);
  const part = (priority: Priority): number | null => {
    const values = GROUPS[priority].map((key) => normalized[key]).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  };
  const parts: Record<Priority, number | null> = {
    water_saving: part("water_saving"),
    soil_health: part("soil_health"),
    forage: part("forage"),
    income_market: part("income_market"),
    low_risk: part("low_risk"),
    simplicity: part("simplicity"),
  };
  let weighted = 0;
  let weightSum = 0;
  for (const priority of PRIORITIES) {
    const value = parts[priority];
    const weight = weights[priority];
    if (value === null || weight <= 0) continue;
    weighted += weight * value;
    weightSum += weight;
  }
  return { total: weightSum === 0 ? null : Math.round((1000 * weighted) / weightSum) / 10, parts, normalized };
}

const CONFIDENCE_ORDER: ReadonlyArray<Exclude<Confidence, "farmer">> = ["low", "medium", "high"];

/** Card confidence: the lowest confidence among the metrics of weighted priorities (farmer inputs excluded). */
export function cardConfidence(evaluation: RotationEvaluation, weights: PriorityWeights): Exclude<Confidence, "farmer"> {
  const levels = PRIORITIES.filter((p) => weights[p] > 0)
    .flatMap((p) => groupConfidence(p, evaluation.confidence))
    .filter((c): c is Exclude<Confidence, "farmer"> => c !== "farmer");
  if (levels.length === 0) return "medium";
  return CONFIDENCE_ORDER.find((level) => levels.includes(level)) ?? "medium";
}

export interface RankedRotation {
  evaluation: RotationEvaluation;
  score: Score;
  confidence: Exclude<Confidence, "farmer">;
}

export interface Ranking {
  /** The farmer's current rotation, always shown (with its exclusions as warnings). */
  current: RankedRotation | null;
  /** The best feasible alternatives (SPEC §5.10: 3). */
  top: RankedRotation[];
  /** Other feasible alternatives ("more options"). */
  more: RankedRotation[];
  /** Alternatives that failed a feasibility check, with their reasons. */
  excluded: RotationEvaluation[];
}

export function rankRotations(evaluations: readonly RotationEvaluation[], weights: PriorityWeights, currentId: string | null): Ranking {
  const ranked = evaluations.map((evaluation) => ({
    evaluation,
    score: scoreRotation(evaluation, weights),
    confidence: cardConfidence(evaluation, weights),
  }));
  const alternatives = ranked
    .filter((r) => r.evaluation.id !== currentId && r.evaluation.feasible)
    .sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1) || a.evaluation.id.localeCompare(b.evaluation.id));
  return {
    current: ranked.find((r) => r.evaluation.id === currentId) ?? null,
    top: alternatives.slice(0, TOP_ALTERNATIVES),
    more: alternatives.slice(TOP_ALTERNATIVES),
    excluded: evaluations.filter((e) => e.id !== currentId && !e.feasible),
  };
}
