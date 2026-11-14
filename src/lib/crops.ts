/**
 * Crop parameters (SPEC §5.6): schema of data/crops.json and lookups. Each crop lists, per group of
 * fields, where its values come from; "TODO" marks values without a checked source. While any crop has
 * `verified: false` the UI shows "values pending agronomist review".
 */
import { z } from "zod";
import { dailyTmean, indexOfDate, trailingMean, type DailyClimate, type FrostStats } from "./climate";
import {
  ACTIVE_GROWTH_MIN_TMEAN_C,
  AUTUMN_SOWING_WINDOW,
  EXTREME_RAIN_MM,
  FIT_RECOMMENDED_MIN,
  FIT_RISKY_MIN,
  FROST_AFTER_SOWING_SOFT_SHARE,
  FROST_MARGIN_FULL_FIT_DAYS,
  FROST_TMIN_C,
  HARVEST_WINDOW_DAYS,
  HEAT_WINDOW_SOFT_SHARE,
  LIGHT_FROST_TMIN_C,
  SALINITY_LOSS_HARD_PCT,
  SALINITY_LOSS_SOFT_PCT,
  SALT_SENSITIVE_THRESHOLD_DSM,
  SOWING_SMOOTHING_DAYS,
  SPRING_SOWING_WINDOW,
  STEEP_SLOPE_PCT,
} from "./constants";
import type { MessageKey } from "./i18n";
import type { KcCurve } from "./water";

const int = z.number().int();
const localizedName = z.object({ uz: z.string().min(1), ru: z.string().min(1), en: z.string().min(1) });

const mainSowingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("spring"),
    tmean_above_c: z.number(),
    /** Earliest sowing date ("MM-DD") from local practice, whatever the weather. */
    not_before: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  }),
  z.object({ type: z.literal("autumn"), tmean_below_c: z.number() }),
]);
const secondSowingSchema = z.object({ type: z.literal("after_previous"), gap_days: int.min(0) });

/** Field groups that must each be covered by a `sources` entry. */
export const CROP_SOURCED_FIELDS = [
  "family",
  "n_fixing",
  "sowing",
  "season_days",
  "kc_ini",
  "kc_mid",
  "kc_end",
  "stage_fractions",
  "temperature",
  "heat_threshold_c",
  "heat_sensitive_window",
  "frost_tolerance",
  "salinity",
  "ph",
  "root_depth",
  "residue",
  "forage_value",
  "drought_tolerance",
] as const;

export const cropSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+$/),
    names: localizedName,
    family: z.string().min(1),
    perennial: z.boolean(),
    years: z.object({ min: int.positive(), max: int.positive(), default: int.positive() }).nullable(),
    /** How the crop is sown as a main crop and as a second crop after another harvest (null = not used so). */
    sowing: z.object({ main: mainSowingSchema.nullable(), second: secondSowingSchema.nullable() }),
    season_days: z.object({ main: int.positive().nullable(), second: int.positive().nullable() }),
    kc_ini: z.number().min(0.1).max(1.5),
    kc_mid: z.number().min(0.1).max(1.5),
    kc_end: z.number().min(0.1).max(1.5),
    stage_fractions: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]),
    temperature: z.object({ opt_min_c: z.number(), opt_max_c: z.number(), abs_min_c: z.number(), abs_max_c: z.number() }),
    heat_threshold_c: z.number().nullable(),
    /** Days after sowing (day 1 = sowing) when heat above the threshold hurts most, e.g. flowering. */
    heat_sensitive_window: z.object({ from_day: int.positive(), to_day: int.positive() }).nullable(),
    frost_tolerance: z.enum(["none", "light", "hardy"]),
    /** Maas–Hoffman: no yield loss up to `ece_threshold` (dS/m), then `slope_pct_per_dsm` % per dS/m. */
    salinity: z.object({
      ece_threshold: z.number().positive().nullable(),
      slope_pct_per_dsm: z.number().positive().nullable(),
    }),
    ph: z.object({ opt_min: z.number(), opt_max: z.number(), abs_min: z.number(), abs_max: z.number() }),
    root_depth: z.enum(["shallow", "medium", "deep"]),
    n_fixing: z.boolean(),
    residue: z.enum(["low", "med", "high"]),
    forage_value: z.enum(["none", "low", "med", "high"]),
    drought_tolerance: z.enum(["low", "med", "high"]),
    sources: z.array(z.object({ fields: z.array(z.string()).min(1), source: z.string().min(1) })).min(1),
    notes: z.array(z.string()),
    verified: z.boolean(),
  })
  .superRefine((crop, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message: `${crop.id}: ${message}` });
    const sum = crop.stage_fractions.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.011) issue(`stage fractions sum to ${sum.toFixed(3)}, not 1`);
    if (crop.perennial !== (crop.years !== null)) issue("perennial crops need `years`; annual crops must not have it");
    if (crop.years !== null && !(crop.years.min <= crop.years.default && crop.years.default <= crop.years.max)) {
      issue("years must satisfy min ≤ default ≤ max");
    }
    if (crop.sowing.main === null && crop.sowing.second === null) issue("needs a main or a second-crop sowing rule");
    if ((crop.sowing.main === null) !== (crop.season_days.main === null)) issue("main sowing rule and main season length go together");
    if ((crop.sowing.second === null) !== (crop.season_days.second === null)) issue("second-crop rule and its season length go together");
    const t = crop.temperature;
    if (!(t.abs_min_c <= t.opt_min_c && t.opt_min_c <= t.opt_max_c && t.opt_max_c <= t.abs_max_c)) issue("temperature ranges out of order");
    const ph = crop.ph;
    if (!(ph.abs_min <= ph.opt_min && ph.opt_min <= ph.opt_max && ph.opt_max <= ph.abs_max)) issue("pH ranges out of order");
    if ((crop.salinity.ece_threshold === null) !== (crop.salinity.slope_pct_per_dsm === null)) issue("salinity threshold and slope go together");
    if ((crop.heat_threshold_c === null) !== (crop.heat_sensitive_window === null)) issue("heat threshold and window go together");
    const window = crop.heat_sensitive_window;
    const shortest = Math.min(...[crop.season_days.main, crop.season_days.second].filter((d): d is number => d !== null));
    if (window !== null && (window.from_day > window.to_day || window.to_day > shortest)) issue("heat window must lie inside the season");
    const covered = new Set(crop.sources.flatMap((s) => s.fields));
    const uncovered = CROP_SOURCED_FIELDS.filter((f) => !covered.has(f));
    if (uncovered.length > 0) issue(`no source entry for ${uncovered.join(", ")}`);
  });

export type Crop = z.infer<typeof cropSchema>;
export type CropRole = "main" | "second";

export const cropsFileSchema = z
  .object({ about: z.string(), crops: z.array(cropSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const crop of file.crops) {
      if (seen.has(crop.id)) ctx.addIssue({ code: "custom", message: `duplicate crop id ${crop.id}` });
      seen.add(crop.id);
    }
  });

export function indexCrops(crops: readonly Crop[]): ReadonlyMap<string, Crop> {
  return new Map(crops.map((c) => [c.id, c]));
}

/** The FAO-56 Kc curve of a crop in a role, or `null` if the crop is not grown in that role. */
export function kcCurveFor(crop: Crop, role: CropRole): KcCurve | null {
  const seasonDays = crop.season_days[role];
  if (seasonDays === null) return null;
  return { kcIni: crop.kc_ini, kcMid: crop.kc_mid, kcEnd: crop.kc_end, stageFractions: crop.stage_fractions, seasonDays };
}

/** Fields whose values have no checked source yet ("TODO"), for the "pending agronomist review" notice. */
export function unverifiedFields(crop: Crop): string[] {
  return crop.sources.filter((s) => s.source.startsWith("TODO")).flatMap((s) => s.fields);
}

// ── Crop calendar ────────────────────────────────────────────────────────────

/** A crop season on the climate series: indices of the sowing and harvest days. */
export interface CropSeason {
  cropId: string;
  role: CropRole;
  sow: number;
  harvest: number;
}

/** Per-climate inputs of the calendar, computed once (and again for each scenario). */
export interface CalendarContext {
  climate: DailyClimate;
  /** Trailing 7-day mean of daily Tmean, which the sowing rules test. */
  tmean7: ReadonlyArray<number | null>;
  tmean: ReadonlyArray<number | null>;
}

export function calendarContext(climate: DailyClimate): CalendarContext {
  const tmean = dailyTmean(climate);
  return { climate, tmean, tmean7: trailingMean(tmean, SOWING_SMOOTHING_DAYS) };
}

/**
 * Main-crop season of the crop year `harvestYear`: a spring crop is sown in that year once the 7-day
 * mean temperature reaches its threshold; an autumn crop is sown the year before once it drops below.
 * `null` when the condition is never met in the window or the season leaves the data.
 */
export function mainSeason(crop: Crop, ctx: CalendarContext, harvestYear: number): CropSeason | null {
  const rule = crop.sowing.main;
  const days = crop.season_days.main;
  if (rule === null || days === null) return null;
  const window = rule.type === "spring" ? SPRING_SOWING_WINDOW : AUTUMN_SOWING_WINDOW;
  const year = rule.type === "spring" ? harvestYear : harvestYear - 1;
  const earliest = rule.type === "spring" && rule.not_before !== undefined && rule.not_before > window.from ? rule.not_before : window.from;
  const from = indexOfDate(ctx.climate, `${year}-${earliest}`);
  const to = indexOfDate(ctx.climate, `${year}-${window.to}`);
  if (from < 0 || to < 0) return null;
  for (let i = from; i <= to; i++) {
    const t = ctx.tmean7[i];
    if (typeof t !== "number") continue;
    if (rule.type === "spring" ? t >= rule.tmean_above_c : t <= rule.tmean_below_c) {
      const harvest = i + days - 1;
      return harvest < ctx.climate.dates.length ? { cropId: crop.id, role: "main", sow: i, harvest } : null;
    }
  }
  return null;
}

/** Second-crop season sown `gap_days` after the previous harvest (that many bare days in between). */
export function secondSeason(crop: Crop, ctx: CalendarContext, previousHarvest: number): CropSeason | null {
  const rule = crop.sowing.second;
  const days = crop.season_days.second;
  if (rule === null || days === null) return null;
  const sow = previousHarvest + rule.gap_days + 1;
  const harvest = sow + days - 1;
  return harvest < ctx.climate.dates.length ? { cropId: crop.id, role: "second", sow, harvest } : null;
}

/** Heat above the crop's threshold on any day of its sensitive window; `null` if not applicable or data missing. */
export function heatHit(crop: Crop, season: CropSeason, climate: DailyClimate): boolean | null {
  const window = crop.heat_sensitive_window;
  if (window === null || crop.heat_threshold_c === null) return null;
  const last = Math.min(season.harvest, season.sow + window.to_day - 1);
  for (let i = season.sow + window.from_day - 1; i <= last; i++) {
    const tmax = climate.tmax[i];
    if (typeof tmax !== "number") return null;
    if (tmax >= crop.heat_threshold_c) return true;
  }
  return false;
}

/**
 * A damaging frost after sowing while the crop is young — from sowing to the end of its development
 * stage (FAO-56 stages) — with Tmin ≤ 0 °C, or ≤ −2 °C for light tolerance; `null` for hardy crops.
 * Frost late in the season is judged separately, against the safe first-frost date (season fit).
 */
export function frostHit(crop: Crop, season: CropSeason, climate: DailyClimate): boolean | null {
  if (crop.frost_tolerance === "hardy") return null;
  const limit = crop.frost_tolerance === "light" ? LIGHT_FROST_TMIN_C : FROST_TMIN_C;
  const [fIni, fDev] = crop.stage_fractions;
  const youngDays = Math.max(1, Math.round((fIni + fDev) * (season.harvest - season.sow + 1)));
  const last = Math.min(season.harvest, season.sow + youngDays - 1);
  for (let i = season.sow; i <= last; i++) {
    const tmin = climate.tmin[i];
    if (typeof tmin !== "number") return null;
    if (tmin <= limit) return true;
  }
  return false;
}

/** An extreme rain day (≥ 20 mm) in the last 14 days of the season (harvest risk). */
export function harvestRainHit(season: CropSeason, climate: DailyClimate): boolean | null {
  for (let i = Math.max(season.sow, season.harvest - HARVEST_WINDOW_DAYS + 1); i <= season.harvest; i++) {
    const p = climate.precip[i];
    if (typeof p !== "number") return null;
    if (p >= EXTREME_RAIN_MM) return true;
  }
  return false;
}

/** Share of `true` among known values, or `null` when nothing is known. */
export function shareTrue(values: ReadonlyArray<boolean | null>): number | null {
  const known = values.filter((v): v is boolean => v !== null);
  return known.length === 0 ? null : known.filter(Boolean).length / known.length;
}

/** Day counted from 1 January of `year` (negative in the year before, above 365 in the year after). */
export function dayFromJan1(climate: DailyClimate, index: number, year: number): number | null {
  const jan1 = indexOfDate(climate, `${year}-01-01`);
  return jan1 < 0 ? null : index - jan1 + 1;
}

// ── Crop fit (SPEC §5.7) ─────────────────────────────────────────────────────

/**
 * An explanation: an i18n key and the values it needs. A `crop` parameter holds a crop id; the UI swaps
 * it for the crop's name in the reader's language before formatting.
 */
export interface Reason {
  key: MessageKey;
  params: Readonly<Record<string, string | number>>;
}

export type FitCategory = "recommended" | "risky" | "not_suitable";

export interface SoilConditions {
  ph: number | null;
  /** Soil salinity ECe in dS/m: the farmer's soil test, or the regional class value; `null` if unknown. */
  ece: number | null;
  eceSource: "soil_test" | "regional_estimate" | null;
  slopePct: number | null;
}

export interface CropFit {
  cropId: string;
  /** Minimum of the known sub-fits (limiting factor, EcoCrop style), 0–100. */
  score: number | null;
  category: FitCategory;
  subFits: { temperature: number | null; ph: number | null; salinity: number | null; season: number | null };
  hardBlockers: Reason[];
  softBlockers: Reason[];
  /** Warnings that never change the category (heat from regional air temperature, confidence low). */
  warnings: Reason[];
  /** Limiting factors worth explaining even when not blocking. */
  limits: Reason[];
  gaps: Reason[];
  /** Salt-sensitive crop on a field whose salinity is unknown: "needs soil test" instead of a guess (SPEC §3.4). */
  needsSoilTest: boolean;
  stats: {
    seasons: number;
    sowDayMedian: number | null;
    harvestDayMedian: number | null;
    seasonTmean: number | null;
    heatShare: number | null;
    frostShare: number | null;
    frostMarginDays: number | null;
    salinityLossPct: number | null;
  };
}

/** EcoCrop-style trapezoid: 0 outside the absolute range, 100 inside the optimal range, linear between. */
export function trapezoid(value: number, absMin: number, optMin: number, optMax: number, absMax: number): number {
  if (value >= optMin && value <= optMax) return 100;
  if (value <= absMin || value >= absMax) return 0;
  return value < optMin ? (100 * (value - absMin)) / (optMin - absMin) : (100 * (absMax - value)) / (absMax - optMax);
}

/** Maas–Hoffman relative yield loss in % for soil salinity ECe (dS/m): b · (ECe − a) above the threshold a. */
export function maasHoffmanLossPct(ece: number, thresholdDsM: number, slopePctPerDsM: number): number {
  return Math.min(100, Math.max(0, slopePctPerDsM * (ece - thresholdDsM)));
}

/** SPEC §5.7: recommended ≥ 70 without blockers; risky 40–69 or a soft blocker; not suitable < 40 or a hard blocker. */
export function fitCategory(score: number | null, hardBlockers: number, softBlockers: number): FitCategory {
  if (hardBlockers > 0 || (score !== null && score < FIT_RISKY_MIN)) return "not_suitable";
  if (softBlockers > 0 || score === null || score < FIT_RECOMMENDED_MIN) return "risky";
  return "recommended";
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (share: number) => Math.round(share * 100);

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Crop fit of a main crop on a field, over every crop year of the record (SPEC §5.7). */
export function cropFit(
  crop: Crop,
  ctx: CalendarContext,
  years: readonly number[],
  frost: FrostStats,
  soil: SoilConditions,
): CropFit {
  const name = crop.id;
  const hardBlockers: Reason[] = [];
  const softBlockers: Reason[] = [];
  const warnings: Reason[] = [];
  const limits: Reason[] = [];
  const gaps: Reason[] = [];

  const seasons = years
    .map((year) => ({ year, season: mainSeason(crop, ctx, year) }))
    .filter((s): s is { year: number; season: CropSeason } => s.season !== null);
  if (seasons.length === 0) hardBlockers.push({ key: "crop.reason.no_sowing_window", params: { crop: name } });

  // Temperature over active-growth days (winter rest excluded).
  let sum = 0;
  let count = 0;
  for (const { season } of seasons) {
    for (let i = season.sow; i <= season.harvest; i++) {
      const t = ctx.tmean[i];
      if (typeof t === "number" && t >= ACTIVE_GROWTH_MIN_TMEAN_C) {
        sum += t;
        count++;
      }
    }
  }
  const seasonTmean = count === 0 ? null : sum / count;
  const t = crop.temperature;
  const temperature = seasonTmean === null ? null : trapezoid(seasonTmean, t.abs_min_c, t.opt_min_c, t.opt_max_c, t.abs_max_c);
  if (temperature !== null && seasonTmean !== null && temperature < FIT_RECOMMENDED_MIN) {
    limits.push({ key: "crop.reason.temperature_limit", params: { crop: name, temp: round1(seasonTmean) } });
  }

  // Season length against the safe first-frost date, for crops that frost would kill.
  const harvestDays = seasons.map(({ year, season }) => dayFromJan1(ctx.climate, season.harvest, year)).filter((d): d is number => d !== null);
  const sowDays = seasons.map(({ year, season }) => dayFromJan1(ctx.climate, season.sow, year)).filter((d): d is number => d !== null);
  const harvestDayMedian = medianOf(harvestDays);
  let seasonFit: number | null = null;
  let frostMarginDays: number | null = null;
  if (crop.frost_tolerance !== "hardy" && harvestDayMedian !== null && frost.firstAutumnSafe !== null) {
    frostMarginDays = Math.round(frost.firstAutumnSafe - harvestDayMedian);
    if (frostMarginDays < 0) {
      seasonFit = 0;
      hardBlockers.push({ key: "crop.reason.season_too_long", params: { crop: name, days: -frostMarginDays } });
    } else {
      seasonFit = frostMarginDays >= FROST_MARGIN_FULL_FIT_DAYS ? 100 : 40 + (60 * frostMarginDays) / FROST_MARGIN_FULL_FIT_DAYS;
    }
  }

  // Soil pH.
  let ph: number | null = null;
  if (soil.ph === null) {
    gaps.push({ key: "crop.gap.ph_unknown", params: {} });
  } else {
    ph = trapezoid(soil.ph, crop.ph.abs_min, crop.ph.opt_min, crop.ph.opt_max, crop.ph.abs_max);
    if (ph < FIT_RECOMMENDED_MIN) limits.push({ key: "crop.reason.ph_limit", params: { crop: name, ph: soil.ph } });
  }

  // Salinity (Maas–Hoffman); a farmer's soil test overrides the regional estimate (SPEC §3.4).
  let salinity: number | null = null;
  let salinityLossPct: number | null = null;
  let needsSoilTest = false;
  const threshold = crop.salinity.ece_threshold;
  const slope = crop.salinity.slope_pct_per_dsm;
  if (soil.ece === null) {
    gaps.push({ key: "crop.gap.salinity_unknown", params: {} });
    needsSoilTest = threshold === null || threshold < SALT_SENSITIVE_THRESHOLD_DSM;
  } else if (threshold === null || slope === null) {
    gaps.push({ key: "crop.gap.salt_tolerance_unknown", params: { crop: name } });
  } else {
    salinityLossPct = round1(maasHoffmanLossPct(soil.ece, threshold, slope));
    salinity = 100 - salinityLossPct;
    const reason: Reason = { key: "crop.reason.salinity_loss", params: { crop: name, loss: Math.round(salinityLossPct) } };
    if (salinityLossPct >= SALINITY_LOSS_HARD_PCT) hardBlockers.push(reason);
    else if (salinityLossPct >= SALINITY_LOSS_SOFT_PCT) softBlockers.push(reason);
  }

  // Heat in the sensitive window and frost after sowing, as shares of years.
  const heatShare = shareTrue(seasons.map(({ season }) => heatHit(crop, season, ctx.climate)));
  // Heat is a warning only, never a blocker (team decision 2026-11-14): POWER gives regional air
  // temperature without irrigation, and irrigated fields are usually cooler. Confidence: low.
  if (heatShare !== null && heatShare >= HEAT_WINDOW_SOFT_SHARE) {
    warnings.push({ key: "crop.warning.heat_window", params: { crop: name, share: pct(heatShare), threshold: crop.heat_threshold_c ?? "" } });
  }
  const frostShare = shareTrue(seasons.map(({ season }) => frostHit(crop, season, ctx.climate)));
  if (frostShare !== null && frostShare >= FROST_AFTER_SOWING_SOFT_SHARE) {
    softBlockers.push({ key: "crop.reason.frost_after_sowing", params: { crop: name, share: pct(frostShare) } });
  }

  if (!crop.perennial && soil.slopePct !== null && soil.slopePct > STEEP_SLOPE_PCT) {
    hardBlockers.push({ key: "crop.reason.steep_slope", params: { crop: name, slope: soil.slopePct } });
  }

  const subFits = { temperature, ph, salinity, season: seasonFit };
  const known = Object.values(subFits).filter((v): v is number => v !== null);
  const score = known.length === 0 ? null : round1(Math.min(...known));
  return {
    cropId: crop.id,
    score,
    category: fitCategory(score, hardBlockers.length, softBlockers.length),
    subFits: {
      temperature: temperature === null ? null : round1(temperature),
      ph: ph === null ? null : round1(ph),
      salinity: salinity === null ? null : round1(salinity),
      season: seasonFit === null ? null : round1(seasonFit),
    },
    hardBlockers,
    softBlockers,
    warnings,
    limits,
    gaps,
    needsSoilTest,
    stats: {
      seasons: seasons.length,
      sowDayMedian: medianOf(sowDays),
      harvestDayMedian,
      seasonTmean: seasonTmean === null ? null : round1(seasonTmean),
      heatShare,
      frostShare,
      frostMarginDays,
      salinityLossPct,
    },
  };
}
