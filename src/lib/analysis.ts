/**
 * Composition for the field flow (SPEC §2, §4.3): from one farm file to everything the four steps show.
 * Pure and framework-free, so it runs in the browser (fast, offline) and in tests.
 */
import {
  annualClimate,
  annualMeansOfMonthly,
  applyScenario,
  calendarMonthMeans,
  climateTrends,
  completeYears,
  decodeClimate,
  frostStats,
  monthlyExtremeDays,
  monthlyNormals,
  NORMAL_SCENARIO,
  type AnnualClimate,
  type DailyClimate,
  type FrostStats,
  type MonthlyExtremeDays,
  type MonthlyNormal,
  type Scenario,
} from "./climate";
import { CLIMATOLOGY_FIRST_YEAR, CLIMATOLOGY_LAST_YEAR, NDVI_RECENT_YEARS, SALINITY_CLASS_ECE } from "./constants";
import { calendarContext, cropFit, type Crop, type CropFit, type SoilConditions } from "./crops";
import type { FarmFile, RegionsFile } from "./datafiles";
import {
  barePeriods,
  expectedCover,
  ndviTrend,
  satelliteCheck,
  seasonalCurve,
  type BarePeriod,
  type CurvePoint,
  type SatelliteCheck,
} from "./ndvi";
import { effectiveWeights, rankRotations, type PriorityWeights, type Ranking, type WaterReliability } from "./ranking";
import { evaluateRotation, type FarmerInputs, type Rotation, type RotationEvaluation, type RotationYear } from "./rotations";
import { trend, type TrendResult } from "./trends";
import { dailyEt0 } from "./water";

export type RegionSalinity = RegionsFile["regions"][number]["salinity"];

export interface FieldProfile {
  farm: FarmFile;
  climate: DailyClimate;
  et0: (number | null)[];
  /** Complete, non-excluded years 2006–2025 used for statistics. */
  years: number[];
  frost: FrostStats;
  annual: AnnualClimate[];
  normals: MonthlyNormal[];
  extremes: MonthlyExtremeDays[];
  trends: ReturnType<typeof climateTrends> & { soilWetness: TrendResult | null; ndvi: TrendResult | null };
  ndvi: { recent: CurvePoint[]; record: CurvePoint[]; bare: BarePeriod[]; recentYears: number[] };
  monthlyWindMs: (number | null)[];
  salinity: RegionSalinity | null;
}

export function recentYears(): number[] {
  return Array.from({ length: NDVI_RECENT_YEARS }, (_, i) => CLIMATOLOGY_LAST_YEAR - NDVI_RECENT_YEARS + 1 + i);
}

/** Everything about the field that does not depend on the farmer's answers (step 2). */
export function buildProfile(farm: FarmFile, salinity: RegionSalinity | null): FieldProfile {
  const climate = decodeClimate(farm.climate, farm.point.lat);
  const usable = new Set(farm.climate.years.filter((y) => y.complete && !y.excluded).map((y) => y.year));
  const years = completeYears(climate).filter((y) => y >= CLIMATOLOGY_FIRST_YEAR && y <= CLIMATOLOGY_LAST_YEAR && usable.has(y));
  const et0 = dailyEt0(climate.dates, climate.tmax, climate.tmin, climate.lat);
  const annual = annualClimate(climate, et0, years);
  const recent = recentYears();
  const ndviRecord = seasonalCurve(farm.ndvi.composites, Number(farm.ndvi.period.start.slice(0, 4)), CLIMATOLOGY_LAST_YEAR);
  const ndviRecent = seasonalCurve(farm.ndvi.composites, recent[0] ?? CLIMATOLOGY_LAST_YEAR, CLIMATOLOGY_LAST_YEAR);
  const wetness = annualMeansOfMonthly(farm.climate.monthly.start, farm.climate.monthly.gwetroot).filter(
    (p) => p.t >= CLIMATOLOGY_FIRST_YEAR && p.t <= CLIMATOLOGY_LAST_YEAR,
  );
  return {
    farm,
    climate,
    et0,
    years,
    frost: frostStats(climate, years),
    annual,
    normals: monthlyNormals(climate, et0, years),
    extremes: monthlyExtremeDays(climate, years),
    trends: { ...climateTrends(annual), soilWetness: trend(wetness), ndvi: ndviTrend(farm.ndvi.composites, CLIMATOLOGY_LAST_YEAR) },
    ndvi: { recent: ndviRecent, record: ndviRecord, bare: barePeriods(ndviRecent), recentYears: recent },
    monthlyWindMs: calendarMonthMeans(farm.climate.monthly.start, farm.climate.monthly.wind_ms),
    salinity,
  };
}

/** The farmer's soil test (EC in dS/m, pH) overrides the regional estimate and the modelled pH (SPEC §3.4). */
export interface SoilTest {
  ece: number | null;
  ph: number | null;
}

export function soilConditions(profile: FieldProfile, test: SoilTest): SoilConditions {
  const regional =
    profile.salinity?.status === "estimated" && profile.salinity.dominant_class !== null
      ? SALINITY_CLASS_ECE[profile.salinity.dominant_class]
      : null;
  const ece = test.ece ?? regional;
  return {
    ph: test.ph ?? profile.farm.soil.ph_h2o,
    ece,
    eceSource: test.ece !== null ? "soil_test" : regional !== null ? "regional_estimate" : null,
    slopePct: profile.farm.terrain.slope_pct,
  };
}

export interface FarmAnswers {
  /** The farmer's current rotation, year by year (from a template or the builder). */
  current: { id: string; years: RotationYear[] };
  priorities: PriorityWeights;
  reliability: WaterReliability;
  farmer: FarmerInputs;
  soilTest: SoilTest;
}

/** Long-term means of the (scenario) climate over the usable years, for the stress-test summary. */
export interface ScenarioClimate {
  precipMm: number | null;
  et0Mm: number | null;
  heatDays35: number | null;
  frostFreeDaysMean: number | null;
  lastSpringSafe: number | null;
  firstAutumnSafe: number | null;
}

function climateSummary(annual: readonly AnnualClimate[], frost: FrostStats): ScenarioClimate {
  const mean = (values: number[]) => (values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);
  return {
    precipMm: mean(annual.map((a) => a.precipMm)),
    et0Mm: mean(annual.map((a) => a.et0Mm)),
    heatDays35: mean(annual.map((a) => a.heatDays35)),
    frostFreeDaysMean: frost.frostFreeDaysMean,
    lastSpringSafe: frost.lastSpringSafe,
    firstAutumnSafe: frost.firstAutumnSafe,
  };
}

export interface Analysis {
  scenario: Scenario;
  climate: ScenarioClimate;
  soil: SoilConditions;
  fits: CropFit[];
  evaluations: RotationEvaluation[];
  current: RotationEvaluation;
  ranking: Ranking;
  /** What the satellite saw versus the farmer's current rotation (last 3 complete years). */
  satellite: SatelliteCheck | null;
}

/**
 * Crop fit, rotation evaluation, ranking and the satellite check for the farmer's answers. The whole
 * engine re-runs on the scenario climate (SPEC §5.11); the satellite check always uses what was observed.
 */
export function analyze(
  profile: FieldProfile,
  crops: ReadonlyMap<string, Crop>,
  templates: readonly Rotation[],
  answers: FarmAnswers,
  scenario: Scenario = NORMAL_SCENARIO,
): Analysis {
  const climate = applyScenario(profile.climate, scenario);
  const et0 = scenario === NORMAL_SCENARIO ? profile.et0 : dailyEt0(climate.dates, climate.tmax, climate.tmin, climate.lat);
  const frost = scenario === NORMAL_SCENARIO ? profile.frost : frostStats(climate, profile.years);
  const calendar = calendarContext(climate);
  const soil = soilConditions(profile, answers.soilTest);
  const ctx = {
    calendar,
    et0,
    years: profile.years,
    frost,
    crops,
    soil,
    monthlyWindMs: profile.monthlyWindMs,
    farmer: answers.farmer,
  };
  const fits = [...crops.values()].map((crop) => cropFit(crop, calendar, profile.years, frost, soil));
  const templateIds = new Set(templates.map((t) => t.id));
  const current = evaluateRotation({ id: answers.current.id, years: answers.current.years }, ctx);
  const evaluations = [
    ...templates.map((t) => (t.id === answers.current.id ? current : evaluateRotation(t, ctx))),
    ...(templateIds.has(answers.current.id) ? [] : [current]),
  ];
  const ranking = rankRotations(evaluations, effectiveWeights(answers.priorities, answers.reliability), answers.current.id);
  // Expected cover from the observed climate's calendar, compared with what was observed.
  const observed = scenario === NORMAL_SCENARIO ? current : evaluateRotation({ id: current.id, years: current.years }, { ...ctx, calendar: calendarContext(profile.climate), et0: profile.et0, frost: profile.frost });
  const satellite = satelliteCheck(
    profile.farm.ndvi.composites,
    expectedCover(observed.timeline, crops, current.years.length),
    current.years.length,
    profile.ndvi.recentYears,
  );
  const annual = scenario === NORMAL_SCENARIO ? profile.annual : annualClimate(climate, et0, profile.years);
  return { scenario, climate: climateSummary(annual, frost), soil, fits, evaluations, current, ranking, satellite };
}
