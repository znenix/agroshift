/**
 * Rotations (SPEC §5.8): schema of data/rotations.json and structural checks shared by the templates
 * and the farmer's own year-by-year rotation.
 *
 * Convention: year i is the crop year in which its main crop is harvested, so an autumn-sown main crop
 * (winter wheat) is sown in the previous calendar year. The cycle repeats, so a perennial run may wrap
 * from the last year back to the first.
 */
import { z } from "zod";
import type { FrostStats } from "./climate";
import {
  EROSION_REFERENCE_WIND_MS,
  EROSION_SLOPE_DIVISOR_PCT,
  EROSION_WIND_FACTOR_RANGE,
  IRRIGATION_EFFICIENCY,
  ORGANIC_MATTER_POINTS,
  type IrrigationMethod,
} from "./constants";
import {
  dayFromJan1,
  frostHit,
  harvestRainHit,
  heatHit,
  kcCurveFor,
  maasHoffmanLossPct,
  mainSeason,
  secondSeason,
  shareTrue,
  type CalendarContext,
  type Crop,
  type CropRole,
  type CropSeason,
  type Reason,
  type SoilConditions,
} from "./crops";
import { averageAndDryYear, grossNeedMm, m3PerHa, seasonWaterNeed } from "./water";

export const rotationYearSchema = z.object({ main: z.string(), second: z.string().nullable() });
export type RotationYear = z.infer<typeof rotationYearSchema>;

export const rotationSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  years: z.array(rotationYearSchema).min(1).max(10),
  /** i18n key of the "Why suggested" text. */
  why_key: z.string().regex(/^rotation\.why\.[a-z_]+$/),
  tags: z.array(z.string()),
  conditions: z.object({
    mode: z.enum(["irrigated", "rainfed"]),
    suited_for: z.array(z.enum(["saline", "water_short", "livestock"])),
  }),
  sources: z.array(z.object({ fields: z.array(z.string()).min(1), source: z.string().min(1) })).min(1),
  verified: z.boolean(),
});
export type Rotation = z.infer<typeof rotationSchema>;

export const rotationsFileSchema = z
  .object({ about: z.string(), rotations: z.array(rotationSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const r of file.rotations) {
      if (seen.has(r.id)) ctx.addIssue({ code: "custom", message: `duplicate rotation id ${r.id}` });
      seen.add(r.id);
    }
  });

export type RotationIssue =
  | { code: "unknown_crop"; year: number; crop: string }
  | { code: "not_a_main_crop"; year: number; crop: string }
  | { code: "not_a_second_crop"; year: number; crop: string }
  | { code: "second_in_perennial_year"; year: number; crop: string }
  | { code: "perennial_run_length"; year: number; crop: string; length: number; min: number; max: number };

/** Runs of the same perennial main crop in consecutive years, joined across the end of the cycle. */
export function perennialRuns(
  years: readonly RotationYear[],
  crops: ReadonlyMap<string, Crop>,
): Array<{ crop: string; startYear: number; length: number }> {
  const n = years.length;
  const keys = years.map((y) => (crops.get(y.main)?.perennial === true ? y.main : null));
  const first = keys[0];
  if (n === 0 || keys.every((k) => k === null)) return [];
  if (first !== null && first !== undefined && keys.every((k) => k === first)) {
    return [{ crop: first, startYear: 1, length: Number.POSITIVE_INFINITY }]; // the perennial never ends
  }
  let start = 0;
  while (keys[start] === keys[(start - 1 + n) % n]) start++;
  const runs: Array<{ crop: string; startYear: number; length: number }> = [];
  for (let i = 0; i < n; ) {
    const index = (start + i) % n;
    const key = keys[index] ?? null;
    let length = 1;
    while (i + length < n && keys[(start + i + length) % n] === key) length++;
    if (key !== null) runs.push({ crop: key, startYear: index + 1, length });
    i += length;
  }
  return runs;
}

/** Structural problems of a rotation; an empty list means it can be laid out. Years are 1-based. */
export function rotationIssues(years: readonly RotationYear[], crops: ReadonlyMap<string, Crop>): RotationIssue[] {
  const issues: RotationIssue[] = [];
  years.forEach((y, index) => {
    const year = index + 1;
    const main = crops.get(y.main);
    if (main === undefined) issues.push({ code: "unknown_crop", year, crop: y.main });
    else if (!main.perennial && main.sowing.main === null) issues.push({ code: "not_a_main_crop", year, crop: y.main });
    if (y.second !== null) {
      const second = crops.get(y.second);
      if (second === undefined) issues.push({ code: "unknown_crop", year, crop: y.second });
      else if (second.sowing.second === null) issues.push({ code: "not_a_second_crop", year, crop: y.second });
      if (main?.perennial === true) issues.push({ code: "second_in_perennial_year", year, crop: y.second });
    }
  });
  for (const run of perennialRuns(years, crops)) {
    const limits = crops.get(run.crop)?.years;
    if (limits && (run.length < limits.min || run.length > limits.max)) {
      issues.push({ code: "perennial_run_length", year: run.startYear, crop: run.crop, length: run.length, min: limits.min, max: limits.max });
    }
  }
  return issues;
}

// ── Rotation evaluation (SPEC §5.8, §5.9) ────────────────────────────────────

export type Confidence = "high" | "medium" | "low" | "farmer";

export interface FarmerInputs {
  mode: "irrigated" | "rainfed";
  irrigation: IrrigationMethod;
  /** Annual water allocation in m³/ha, if the farmer knows it. */
  waterAllocationM3PerHa: number | null;
  /** Cotton cluster contract: the minimum share (0–1) of years with this main crop. */
  requiredShare: { crop: string; minShare: number } | null;
  /** Crops the farmer cannot sell or cannot harvest (equipment or market constraint). */
  unavailableCrops: readonly string[];
  /** Optional market rating per crop id, 1–5. Never invented: absent ratings stay absent. */
  marketRating: Readonly<Record<string, number>>;
}

export interface EvaluationContext {
  calendar: CalendarContext;
  et0: ReadonlyArray<number | null>;
  /** Crop years (harvest years) to evaluate, e.g. the complete years of the record. */
  years: readonly number[];
  frost: FrostStats;
  crops: ReadonlyMap<string, Crop>;
  soil: SoilConditions;
  /** Climatological mean wind (WS2M) per calendar month, January first; `null` if unknown. */
  monthlyWindMs: ReadonlyArray<number | null> | null;
  farmer: FarmerInputs;
}

/** A crop on the typical-year timeline; days count from 1 January of cycle year 1 (start < 0 = sown in the last year). */
export interface TimelineSlot {
  year: number;
  role: CropRole | "perennial";
  cropId: string;
  start: number;
  end: number;
  /** Perennial years only: the active growing season (the field stays covered all year). */
  active?: { start: number; end: number };
}

export interface RotationMetrics {
  water: { averageM3PerHa: number | null; dryYearM3PerHa: number | null; years: number; gross: boolean };
  bareDaysPerYear: number;
  /** Bare spells on the cycle, in cycle days (`to` may run past the end of the cycle when a spell wraps). */
  bareSpells: Array<{ from: number; to: number }>;
  erosionIndex: number | null;
  nFixingShare: number;
  organicMatter: number;
  /** Longest run of crop seasons from one plant family; Infinity when the cycle never leaves the family. */
  longestFamilyRun: number;
  vulnerability: { heat: number | null; frost: number | null; harvestRain: number | null; mean: number | null };
  salinityLossPct: number | null;
  forage: number;
  marketRating: number | null;
  distinctCrops: number;
}

export interface RotationEvaluation {
  id: string;
  years: readonly RotationYear[];
  timeline: TimelineSlot[];
  feasible: boolean;
  exclusions: Reason[];
  metrics: RotationMetrics;
  confidence: {
    water: Confidence;
    bareDays: Confidence;
    erosion: Confidence;
    soil: Confidence;
    vulnerability: Confidence;
    salinity: Confidence | null;
    forage: Confidence;
    market: Confidence;
  };
}

const CYCLE_YEAR_DAYS = 365;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const FORAGE_LEVEL: Readonly<Record<Crop["forage_value"], number>> = { none: 0, low: 1, med: 2, high: 3 };

const mod = (value: number, length: number) => ((value % length) + length) % length;
const meanOf = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const roundTo = (value: number | null, digits = 2) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function monthOfCycleDay(day: number): number {
  let d = mod(day, CYCLE_YEAR_DAYS);
  for (let m = 0; m < 12; m++) {
    const length = MONTH_DAYS[m] ?? 30;
    if (d < length) return m;
    d -= length;
  }
  return 11;
}

/** Longest run of equal values around a cycle; Infinity when every value is the same. */
export function longestCyclicRun(values: readonly string[]): number {
  if (values.length === 0) return 0;
  if (values.every((v) => v === values[0])) return Number.POSITIVE_INFINITY;
  let best = 1;
  let run = 1;
  for (let i = 1; i < values.length * 2; i++) {
    run = values[i % values.length] === values[(i - 1) % values.length] ? run + 1 : 1;
    best = Math.max(best, Math.min(run, values.length));
  }
  return best;
}

const EMPTY_METRICS: RotationMetrics = {
  water: { averageM3PerHa: null, dryYearM3PerHa: null, years: 0, gross: false },
  bareDaysPerYear: 0,
  bareSpells: [],
  erosionIndex: null,
  nFixingShare: 0,
  organicMatter: 0,
  longestFamilyRun: 0,
  vulnerability: { heat: null, frost: null, harvestRain: null, mean: null },
  salinityLossPct: null,
  forage: 0,
  marketRating: null,
  distinctCrops: 0,
};

/**
 * Evaluates a rotation over every crop year of the record, under the climate in `ctx` (which already
 * includes any scenario): feasibility with reasons, the typical-year timeline and the SPEC §5.9 metrics.
 */
export function evaluateRotation(
  rotation: { id: string; years: readonly RotationYear[]; conditions?: Rotation["conditions"] },
  ctx: EvaluationContext,
): RotationEvaluation {
  const n = rotation.years.length;
  const exclusions: Reason[] = [];
  const confidence: RotationEvaluation["confidence"] = {
    water: "medium",
    bareDays: "high",
    erosion: "low",
    soil: "low",
    vulnerability: "medium",
    salinity: ctx.soil.ece === null ? null : ctx.soil.eceSource === "soil_test" ? "medium" : "low",
    forage: "low",
    market: "farmer",
  };

  if (rotation.conditions !== undefined && rotation.conditions.mode !== ctx.farmer.mode) {
    exclusions.push({
      key: rotation.conditions.mode === "rainfed" ? "rotation.excluded.rainfed_only" : "rotation.excluded.irrigated_only",
      params: {},
    });
  }
  for (const issue of rotationIssues(rotation.years, ctx.crops)) {
    exclusions.push({ key: "rotation.excluded.invalid", params: { year: issue.year, crop: issue.crop } });
  }
  const resolved: Array<{ main: Crop; second: Crop | null }> = [];
  for (const y of rotation.years) {
    const main = ctx.crops.get(y.main);
    const second = y.second === null ? null : ctx.crops.get(y.second);
    if (main === undefined || second === undefined) {
      return { id: rotation.id, years: rotation.years, timeline: [], feasible: false, exclusions, metrics: EMPTY_METRICS, confidence };
    }
    resolved.push({ main, second });
  }

  const cropIds = [...new Set(resolved.flatMap((r) => (r.second === null ? [r.main.id] : [r.main.id, r.second.id])))];
  for (const id of cropIds) {
    if (ctx.farmer.unavailableCrops.includes(id)) exclusions.push({ key: "rotation.excluded.unavailable_crop", params: { crop: id } });
  }
  const required = ctx.farmer.requiredShare;
  if (required !== null) {
    const share = resolved.filter((r) => r.main.id === required.crop).length / n;
    if (share + 1e-9 < required.minShare) {
      exclusions.push({
        key: "rotation.excluded.crop_share",
        params: { crop: required.crop, share: Math.round(share * 100), required: Math.round(required.minShare * 100) },
      });
    }
  }

  // Seasons of every cycle position in every crop year.
  const climate = ctx.calendar.climate;
  const seasonsByYear = ctx.years.map((year) => ({
    year,
    positions: resolved.map(({ main, second }) => {
      const m = mainSeason(main, ctx.calendar, year);
      return { main: m, second: m !== null && second !== null ? secondSeason(second, ctx.calendar, m.harvest) : null };
    }),
  }));
  const dayOf = (index: number, year: number) => (dayFromJan1(climate, index, year) ?? 1) - 1;

  // Typical-year timeline from median dates.
  const timeline: TimelineSlot[] = [];
  resolved.forEach(({ main, second }, k) => {
    const offset = CYCLE_YEAR_DAYS * k;
    if (main.perennial) {
      const seasons = seasonsByYear.flatMap(({ year, positions }) => {
        const s = positions[k]?.main;
        return s ? [{ start: dayOf(s.sow, year), end: dayOf(s.harvest, year) }] : [];
      });
      const activeStart = medianOf(seasons.map((s) => s.start));
      const activeEnd = medianOf(seasons.map((s) => s.end));
      timeline.push({
        year: k + 1,
        role: "perennial",
        cropId: main.id,
        start: offset,
        end: offset + CYCLE_YEAR_DAYS - 1,
        ...(activeStart === null || activeEnd === null
          ? {}
          : { active: { start: offset + Math.round(activeStart), end: offset + Math.round(activeEnd) } }),
      });
    } else {
      const mains = seasonsByYear.flatMap(({ year, positions }) => {
        const s = positions[k]?.main;
        return s ? [{ start: dayOf(s.sow, year), end: dayOf(s.harvest, year) }] : [];
      });
      const start = medianOf(mains.map((m) => m.start));
      const end = medianOf(mains.map((m) => m.end));
      if (start === null || end === null) exclusions.push({ key: "rotation.excluded.no_sowing_window", params: { crop: main.id } });
      else timeline.push({ year: k + 1, role: "main", cropId: main.id, start: offset + Math.round(start), end: offset + Math.round(end) });
    }
    if (second === null) return;
    const seconds = seasonsByYear.flatMap(({ year, positions }) => {
      const s = positions[k]?.second;
      return s ? [{ start: dayOf(s.sow, year), end: dayOf(s.harvest, year) }] : [];
    });
    const start = medianOf(seconds.map((s) => s.start));
    const end = medianOf(seconds.map((s) => s.end));
    if (start === null || end === null) {
      exclusions.push({ key: "rotation.excluded.no_sowing_window", params: { crop: second.id } });
      return;
    }
    timeline.push({ year: k + 1, role: "second", cropId: second.id, start: offset + Math.round(start), end: offset + Math.round(end) });
    // A frost-sensitive second crop must be harvested before the date that is frost-free in 80 % of years (SPEC §5.8).
    const harvestDay = end + 1;
    if (second.frost_tolerance !== "hardy" && ctx.frost.firstAutumnSafe !== null && harvestDay > ctx.frost.firstAutumnSafe) {
      exclusions.push({ key: "rotation.excluded.second_crop_frost", params: { crop: second.id } });
    }
  });

  // Bare soil on the cycle (calendar), with wrap-around.
  const length = CYCLE_YEAR_DAYS * n;
  const covered = new Array<boolean>(length).fill(false);
  for (const slot of timeline) {
    if (slot.end - slot.start + 1 >= length) covered.fill(true);
    else for (let d = slot.start; d <= slot.end; d++) covered[mod(d, length)] = true;
  }
  const bareDays = covered.filter((c) => !c).length;
  const bareSpells: Array<{ from: number; to: number }> = [];
  const firstCovered = covered.indexOf(true);
  if (firstCovered >= 0) {
    let spellStart: number | null = null;
    for (let i = 1; i <= length; i++) {
      const day = firstCovered + i;
      const isCovered = covered[mod(day, length)] === true;
      if (!isCovered && spellStart === null) spellStart = day;
      if (isCovered && spellStart !== null) {
        bareSpells.push({ from: mod(spellStart, length), to: mod(spellStart, length) + (day - spellStart) - 1 });
        spellStart = null;
      }
    }
  }

  // Erosion exposure: bare days weighted by monthly wind and by slope (indicative).
  let erosionIndex: number | null = null;
  const wind = ctx.monthlyWindMs;
  if (wind !== null && wind.length === 12 && wind.every((w) => typeof w === "number")) {
    const slopeFactor = 1 + (ctx.soil.slopePct ?? 0) / EROSION_SLOPE_DIVISOR_PCT;
    let sum = 0;
    covered.forEach((isCovered, day) => {
      if (isCovered) return;
      const w = wind[monthOfCycleDay(day)] ?? EROSION_REFERENCE_WIND_MS;
      const factor = Math.min(EROSION_WIND_FACTOR_RANGE.max, Math.max(EROSION_WIND_FACTOR_RANGE.min, w / EROSION_REFERENCE_WIND_MS));
      sum += factor * slopeFactor;
    });
    erosionIndex = Math.round(sum / n);
  }

  // Irrigation need per crop year: average over the cycle positions, then average and dry year (P90).
  const efficiency = IRRIGATION_EFFICIENCY[ctx.farmer.irrigation];
  const gross = ctx.farmer.mode === "irrigated";
  const yearly: number[] = [];
  for (const { positions } of seasonsByYear) {
    let total = 0;
    let complete = true;
    positions.forEach(({ main: m, second: s }, k) => {
      const crops = resolved[k];
      if (!complete || crops === undefined) return;
      const parts: Array<[CropSeason | null, Crop, CropRole]> = [[m, crops.main, "main"]];
      if (crops.second !== null) parts.push([s, crops.second, "second"]);
      for (const [season, crop, role] of parts) {
        const curve = kcCurveFor(crop, role);
        const need =
          season === null || curve === null
            ? null
            : seasonWaterNeed({ dates: climate.dates, et0: ctx.et0, precip: climate.precip, start: season.sow, curve });
        if (need === null) complete = false;
        else total += need.netMm;
      }
    });
    if (complete) yearly.push(m3PerHa(gross ? grossNeedMm(total / n, efficiency) : total / n));
  }
  const water = averageAndDryYear(yearly);
  if (water !== null && ctx.farmer.waterAllocationM3PerHa !== null && water.dryYear > ctx.farmer.waterAllocationM3PerHa) {
    exclusions.push({
      key: "rotation.excluded.water_allocation",
      params: { need: Math.round(water.dryYear), allocation: Math.round(ctx.farmer.waterAllocationM3PerHa) },
    });
  }

  // Stress inside each crop's sensitive window, as shares of crop years (SPEC §5.9).
  const slotShares = (test: (crop: Crop, season: CropSeason) => boolean | null) =>
    resolved.flatMap(({ main, second }, k) => {
      const share = (crop: Crop, pick: "main" | "second") =>
        shareTrue(
          seasonsByYear.map(({ positions }) => {
            const season = positions[k]?.[pick];
            return season ? test(crop, season) : null;
          }),
        );
      return [share(main, "main"), ...(second === null ? [] : [share(second, "second")])].filter((v): v is number => v !== null);
    });
  const heat = meanOf(slotShares((crop, season) => heatHit(crop, season, climate)));
  const frost = meanOf(slotShares((crop, season) => frostHit(crop, season, climate)));
  const harvestRain = meanOf(slotShares((_, season) => harvestRainHit(season, climate)));
  const vulnerabilityParts = [heat, frost, harvestRain].filter((v): v is number => v !== null);

  // Soil and crop-property metrics (indicative).
  const cropSeasons = resolved.flatMap(({ main, second }) => (second === null ? [main] : [main, second]));
  const organicPoints = resolved.map(({ main, second }) =>
    main.perennial
      ? ORGANIC_MATTER_POINTS.perennialYear
      : Math.min(
          1,
          [main, ...(second === null ? [] : [second])].reduce(
            (sum, c) => sum + ORGANIC_MATTER_POINTS.residue[c.residue] + (c.root_depth === "deep" ? ORGANIC_MATTER_POINTS.deepRootBonus : 0),
            0,
          ),
        ),
  );
  const ece = ctx.soil.ece;
  const losses =
    ece === null
      ? []
      : cropSeasons.flatMap((c) =>
          c.salinity.ece_threshold === null || c.salinity.slope_pct_per_dsm === null
            ? []
            : [maasHoffmanLossPct(ece, c.salinity.ece_threshold, c.salinity.slope_pct_per_dsm)],
        );
  const ratings = cropSeasons.flatMap((c) => {
    const r = ctx.farmer.marketRating[c.id];
    return typeof r === "number" ? [r] : [];
  });

  const metrics: RotationMetrics = {
    water: { averageM3PerHa: water?.average ?? null, dryYearM3PerHa: water?.dryYear ?? null, years: water?.years ?? 0, gross },
    bareDaysPerYear: Math.round(bareDays / n),
    bareSpells,
    erosionIndex,
    nFixingShare: roundTo(cropSeasons.filter((c) => c.n_fixing).length / cropSeasons.length) ?? 0,
    organicMatter: roundTo(meanOf(organicPoints)) ?? 0,
    longestFamilyRun: longestCyclicRun(cropSeasons.map((c) => c.family)),
    vulnerability: { heat: roundTo(heat), frost: roundTo(frost), harvestRain: roundTo(harvestRain), mean: roundTo(meanOf(vulnerabilityParts)) },
    salinityLossPct: losses.length === 0 ? null : roundTo(meanOf(losses), 1),
    forage: roundTo(meanOf(cropSeasons.map((c) => FORAGE_LEVEL[c.forage_value]))) ?? 0,
    marketRating: roundTo(meanOf(ratings), 1),
    distinctCrops: cropIds.length,
  };
  return { id: rotation.id, years: rotation.years, timeline, feasible: exclusions.length === 0, exclusions, metrics, confidence };
}
