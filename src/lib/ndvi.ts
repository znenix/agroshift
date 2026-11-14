/**
 * Vegetation engine (SPEC §5.3): the seasonal NDVI curve, bare periods, the growing-season trend and
 * "what the satellite saw" compared with the farmer's rotation. Pure functions on 16-day composites.
 *
 * Note for the UI: a 250 m MODIS pixel can mix several fields, and the check never corrects the
 * farmer's answer — it only says "the satellite and your answer differ, please check".
 */
import {
  GROWING_SEASON_MONTHS,
  NDVI_BARE_MAX,
  NDVI_GREEN_MIN,
  NDVI_MIN_SEASON_COMPOSITES,
  NDVI_WINTER_MONTHS,
  SATELLITE_MIN_JUDGED_COMPOSITES,
  SATELLITE_MISMATCH_MIN_COMPOSITES,
} from "./constants";
import type { Crop } from "./crops";
import { addDays } from "./dates";
import type { TimelineSlot } from "./rotations";
import { trend, type TrendResult } from "./trends";
import { dayOfYear } from "./water";

export interface NdviPoint {
  /** Start date of the 16-day composite. */
  date: string;
  ndvi: number | null;
  n: number;
}

const COMPOSITE_DAYS = 16;
const SLOTS_PER_YEAR = 23;
const CYCLE_YEAR_DAYS = 365;

/** MOD13Q1 16-day period of the year, 1–23 (periods start on day 1, 17, 33, …, 353). */
export function compositeSlot(date: string): number {
  return Math.min(SLOTS_PER_YEAR, Math.floor((dayOfYear(date) - 1) / COMPOSITE_DAYS) + 1);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface CurvePoint {
  slot: number;
  /** First day of the year of the 16-day period. */
  startDoy: number;
  median: number | null;
  /** Years with a value for this period. */
  years: number;
}

/** Median NDVI of each 16-day period over the years `fromYear`–`toYear` (SPEC §5.3). */
export function seasonalCurve(composites: readonly NdviPoint[], fromYear: number, toYear: number): CurvePoint[] {
  const bySlot = Array.from({ length: SLOTS_PER_YEAR }, () => [] as number[]);
  for (const c of composites) {
    const year = Number(c.date.slice(0, 4));
    if (year < fromYear || year > toYear || c.ndvi === null) continue;
    bySlot[compositeSlot(c.date) - 1]?.push(c.ndvi);
  }
  return bySlot.map((values, i) => {
    const value = median(values);
    return { slot: i + 1, startDoy: i * COMPOSITE_DAYS + 1, median: value === null ? null : Math.round(value * 1000) / 1000, years: values.length };
  });
}

export interface BarePeriod {
  fromSlot: number;
  toSlot: number;
  /** First and last day of the year of the bare period ("field typically bare from … to …"). */
  fromDoy: number;
  toDoy: number;
}

/** Runs of periods whose median NDVI is below 0.2, joined across New Year; unknown periods break a run. */
export function barePeriods(curve: readonly CurvePoint[], threshold = NDVI_BARE_MAX): BarePeriod[] {
  const n = curve.length;
  const bare = curve.map((p) => p.median !== null && p.median < threshold);
  if (n === 0 || !bare.some(Boolean)) return [];
  if (bare.every(Boolean)) return [{ fromSlot: 1, toSlot: n, fromDoy: 1, toDoy: 365 }];
  const start = bare.findIndex((b, i) => !b && bare[(i + 1) % n] === true); // a non-bare period followed by a bare one
  const periods: BarePeriod[] = [];
  let run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (bare[i] === true) run.push(i);
    if ((bare[i] !== true || k === n) && run.length > 0) {
      const first = run[0] ?? 0;
      const last = run[run.length - 1] ?? 0;
      periods.push({
        fromSlot: first + 1,
        toSlot: last + 1,
        fromDoy: first * COMPOSITE_DAYS + 1,
        toDoy: Math.min(365, (last + 1) * COMPOSITE_DAYS),
      });
      run = [];
    }
  }
  return periods;
}

/** Mean NDVI of the April–September composites of each year (SPEC §5.3), `null` with too few composites. */
export function growingSeasonMeans(composites: readonly NdviPoint[]): Array<{ t: number; value: number | null }> {
  const years = new Map<number, number[]>();
  for (const c of composites) {
    if (!GROWING_SEASON_MONTHS.includes(Number(c.date.slice(5, 7)))) continue;
    const year = Number(c.date.slice(0, 4));
    const list = years.get(year) ?? [];
    if (c.ndvi !== null) list.push(c.ndvi);
    years.set(year, list);
  }
  return [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, values]) => ({
      t,
      value: values.length < NDVI_MIN_SEASON_COMPOSITES ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
    }));
}

/** Long-term trend of growing-season NDVI over complete years (Sen's slope + Mann–Kendall, SPEC §5.4). */
export function ndviTrend(composites: readonly NdviPoint[], lastCompleteYear: number): TrendResult | null {
  return trend(growingSeasonMeans(composites).filter((p) => p.t <= lastCompleteYear));
}

// ── What the satellite saw (SPEC §5.3) ───────────────────────────────────────

export type ExpectedCover = "green" | "bare" | "unknown";

/**
 * Expected cover on every day of the rotation cycle from its typical-year timeline. A crop counts as
 * green from the middle of its development stage to the end of its mid-season stage; the rest of its
 * season (emergence, ripening) is not judged; days without a crop are bare.
 */
export function expectedCover(timeline: readonly TimelineSlot[], crops: ReadonlyMap<string, Crop>, cycleYears: number): ExpectedCover[] {
  const length = CYCLE_YEAR_DAYS * cycleYears;
  const states = new Array<ExpectedCover>(length).fill("bare");
  const mod = (d: number) => ((d % length) + length) % length;
  const mark = (from: number, to: number, state: ExpectedCover) => {
    for (let d = from; d <= to; d++) states[mod(d)] = state;
  };
  for (const slot of timeline) mark(slot.start, slot.end, "unknown");
  for (const slot of timeline) {
    const crop = crops.get(slot.cropId);
    if (crop === undefined) continue;
    const season = slot.role === "perennial" ? slot.active : { start: slot.start, end: slot.end };
    if (season === undefined) continue;
    const [fIni, fDev, fMid] = crop.stage_fractions;
    const days = season.end - season.start + 1;
    mark(Math.round(season.start + (fIni + fDev / 2) * days), Math.round(season.start + (fIni + fDev + fMid) * days) - 1, "green");
  }
  return states;
}

export type MismatchKind = "green_where_bare_expected" | "bare_where_crop_expected";

export interface SatelliteMismatch {
  year: number;
  kind: MismatchKind;
  /** First day of the first composite and last day of the last composite of the run. */
  from: string;
  to: string;
  composites: number;
}

export interface SatelliteCheck {
  years: number[];
  /** Cycle position of the first checked year (0-based) that matches the satellite best. */
  phase: number;
  agree: number;
  disagree: number;
  mismatches: SatelliteMismatch[];
}

/**
 * Compares observed green/bare composites of the given years with the rotation's expected cover. The
 * rotation's phase (which cycle year the first checked year was) is not asked: the best-matching phase
 * is used. Runs of at least 3 disagreeing composites are reported as mismatches.
 */
export function satelliteCheck(
  composites: readonly NdviPoint[],
  expected: readonly ExpectedCover[],
  cycleYears: number,
  years: readonly number[],
): SatelliteCheck | null {
  if (years.length === 0 || expected.length !== CYCLE_YEAR_DAYS * cycleYears) return null;
  const sortedYears = [...years].sort((a, b) => a - b);
  const firstYear = sortedYears[0] ?? 0;
  type Judged = { year: number; date: string; kind: MismatchKind | null };
  const judge = (phase: number): Judged[] => {
    const result: Judged[] = [];
    for (const c of composites) {
      const year = Number(c.date.slice(0, 4));
      if (!sortedYears.includes(year) || c.ndvi === null) continue;
      const observed = c.ndvi >= NDVI_GREEN_MIN ? "green" : c.ndvi < NDVI_BARE_MAX ? "bare" : null;
      if (observed === null) continue;
      const position = (((year - firstYear + phase) % cycleYears) + cycleYears) % cycleYears;
      const day = Math.min(CYCLE_YEAR_DAYS - 1, dayOfYear(c.date) - 1 + COMPOSITE_DAYS / 2);
      const wanted = expected[position * CYCLE_YEAR_DAYS + day];
      if (wanted === undefined || wanted === "unknown") continue;
      if (wanted === observed) {
        result.push({ year, date: c.date, kind: null });
      } else if (observed === "green") {
        result.push({ year, date: c.date, kind: "green_where_bare_expected" });
      } else if (!NDVI_WINTER_MONTHS.includes(Number(c.date.slice(5, 7)))) {
        result.push({ year, date: c.date, kind: "bare_where_crop_expected" });
      }
    }
    return result.sort((a, b) => (a.date < b.date ? -1 : 1));
  };

  let best: { phase: number; judged: Judged[]; score: number } | null = null;
  for (let phase = 0; phase < cycleYears; phase++) {
    const judged = judge(phase);
    const score = judged.filter((j) => j.kind === null).length - judged.filter((j) => j.kind !== null).length;
    if (best === null || score > best.score) best = { phase, judged, score };
  }
  // Too little observed to say anything: "not enough satellite data", never a silent "agrees".
  if (best === null || best.judged.length < SATELLITE_MIN_JUDGED_COMPOSITES) return null;

  const mismatches: SatelliteMismatch[] = [];
  let run: Judged[] = [];
  const flush = () => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined && first.kind !== null && run.length >= SATELLITE_MISMATCH_MIN_COMPOSITES) {
      mismatches.push({ year: first.year, kind: first.kind, from: first.date, to: addDays(last.date, COMPOSITE_DAYS - 1), composites: run.length });
    }
    run = [];
  };
  for (const j of best.judged) {
    const previous = run[run.length - 1];
    if (previous !== undefined && (j.kind !== previous.kind || j.year !== previous.year)) flush();
    if (j.kind !== null) run.push(j);
    else flush();
  }
  flush();
  return {
    years: sortedYears,
    phase: best.phase,
    agree: best.judged.filter((j) => j.kind === null).length,
    disagree: best.judged.filter((j) => j.kind !== null).length,
    mismatches,
  };
}
