/**
 * Climate engine (SPEC §5.1, §5.11): scenarios, daily mean temperature, frost dates and the "safe in
 * 80 % of years" frost dates used by the crop calendar. Pure functions on a daily series.
 */
import { EXTREME_RAIN_MM, FROST_SAFE_PROBABILITY, FROST_TMIN_C, HEAT_DAY_THRESHOLDS_C, SUMMER_MONTHS } from "./constants";
import type { ClimateData } from "./datafiles";
import { dateRange, isoToUtcMs } from "./dates";
import { decodeSeries } from "./encode";
import { trend, type TrendResult } from "./trends";
import { percentile } from "./water";

const DAY_MS = 86_400_000;

/** Daily climate from a farm or cell file (SPEC §4.2): decodes the Int16 × 10 series. */
export function decodeClimate(data: ClimateData, lat: number): DailyClimate {
  const dates = dateRange(data.start, data.end);
  const series = [decodeSeries(data.daily.tmax_c), decodeSeries(data.daily.tmin_c), decodeSeries(data.daily.precip_mm)];
  if (series.some((s) => s.length !== dates.length)) throw new Error("climate series length does not match its period");
  const [tmax = [], tmin = [], precip = []] = series;
  return { dates, tmax, tmin, precip, lat };
}

/**
 * Mean per calendar month (12 values, January first) of a monthly series starting at `startMonth`
 * ("YYYY-MM"); missing months are skipped and a month with no values at all is `null`.
 */
export function calendarMonthMeans(startMonth: string, values: ReadonlyArray<number | null>): (number | null)[] {
  const sums = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);
  const firstMonth = Number(startMonth.slice(5, 7)) - 1;
  values.forEach((value, i) => {
    if (typeof value !== "number") return;
    const month = (firstMonth + i) % 12;
    sums[month] = (sums[month] ?? 0) + value;
    counts[month] = (counts[month] ?? 0) + 1;
  });
  return sums.map((sum, m) => ((counts[m] ?? 0) === 0 ? null : sum / (counts[m] ?? 1)));
}

/** Daily climate on consecutive dates; missing values are `null`. */
export interface DailyClimate {
  dates: readonly string[];
  tmax: ReadonlyArray<number | null>;
  tmin: ReadonlyArray<number | null>;
  precip: ReadonlyArray<number | null>;
  /** Latitude in degrees (for extraterrestrial radiation). */
  lat: number;
}

/** Delta-change scenario (SPEC §5.11): +ΔT on every Tmax and Tmin, daily rain × rainFactor. */
export interface Scenario {
  deltaT: number;
  rainFactor: number;
}
export const NORMAL_SCENARIO: Scenario = { deltaT: 0, rainFactor: 1 };

export function applyScenario(climate: DailyClimate, scenario: Scenario): DailyClimate {
  if (scenario.deltaT === 0 && scenario.rainFactor === 1) return climate;
  const shift = (v: number | null) => (v === null ? null : v + scenario.deltaT);
  return {
    ...climate,
    tmax: climate.tmax.map(shift),
    tmin: climate.tmin.map(shift),
    precip: climate.precip.map((p) => (p === null ? null : p * scenario.rainFactor)),
  };
}

/** Daily mean temperature (Tmax + Tmin) / 2 (FAO-56 eq. 9). */
export function dailyTmean(climate: DailyClimate): (number | null)[] {
  return climate.tmax.map((hi, i) => {
    const lo = climate.tmin[i];
    return typeof hi === "number" && typeof lo === "number" ? (hi + lo) / 2 : null;
  });
}

/** Trailing mean over `window` days; `null` while the window is incomplete or has a missing day. */
export function trailingMean(values: ReadonlyArray<number | null>, window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k++) {
      const v = values[k];
      if (typeof v !== "number") return null;
      sum += v;
    }
    return sum / window;
  });
}

/** Index of an ISO date in the series, or −1 when it lies outside. */
export function indexOfDate(climate: DailyClimate, iso: string): number {
  const first = climate.dates[0];
  if (first === undefined) return -1;
  const index = Math.round((isoToUtcMs(iso) - isoToUtcMs(first)) / DAY_MS);
  return index >= 0 && index < climate.dates.length ? index : -1;
}

/** Calendar years fully inside the series. */
export function completeYears(climate: DailyClimate): number[] {
  const first = climate.dates[0];
  const last = climate.dates.at(-1);
  if (first === undefined || last === undefined) return [];
  const years: number[] = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
    if (indexOfDate(climate, `${y}-01-01`) >= 0 && indexOfDate(climate, `${y}-12-31`) >= 0) years.push(y);
  }
  return years;
}

/**
 * Last spring frost of `year`: day of year of the last day from 1 January to 30 June with
 * Tmin ≤ 0 °C; 0 when the spring had no frost; `null` when the window is not fully covered by data.
 */
export function lastSpringFrost(climate: DailyClimate, year: number, frostAt = FROST_TMIN_C): number | null {
  const start = indexOfDate(climate, `${year}-01-01`);
  const end = indexOfDate(climate, `${year}-06-30`);
  if (start < 0 || end < 0) return null;
  let last = 0;
  for (let i = start; i <= end; i++) {
    const tmin = climate.tmin[i];
    if (typeof tmin !== "number") return null;
    if (tmin <= frostAt) last = i - start + 1;
  }
  return last;
}

/**
 * First autumn frost after the summer of `year`, searched from 1 July to 30 June of the next year.
 * `doy` counts from 1 January of `year` (a January frost is 366 or more). Without a frost, `frost` is
 * false and `doy` is the day after the window. `null` when the window is not fully covered by data.
 */
export function firstAutumnFrost(
  climate: DailyClimate,
  year: number,
  frostAt = FROST_TMIN_C,
): { doy: number; frost: boolean } | null {
  const jan1 = indexOfDate(climate, `${year}-01-01`);
  const start = indexOfDate(climate, `${year}-07-01`);
  const end = indexOfDate(climate, `${year + 1}-06-30`);
  if (jan1 < 0 || start < 0 || end < 0) return null;
  for (let i = start; i <= end; i++) {
    const tmin = climate.tmin[i];
    if (typeof tmin !== "number") return null;
    if (tmin <= frostAt) return { doy: i - jan1 + 1, frost: true };
  }
  return { doy: end - jan1 + 2, frost: false };
}

export interface FrostStats {
  /** Years with complete frost data. */
  years: number;
  /** Mean and "safe in 80 % of years" (80th percentile) day of year of the last spring frost. */
  lastSpringMean: number | null;
  lastSpringSafe: number | null;
  /** Mean (frost years only) and "safe in 80 % of years" (20th percentile) day of the first autumn frost. */
  firstAutumnMean: number | null;
  firstAutumnSafe: number | null;
  /** Mean frost-free season length in days (years with an autumn frost). */
  frostFreeDaysMean: number | null;
}

export function frostStats(climate: DailyClimate, years: readonly number[]): FrostStats {
  const spring: number[] = [];
  const autumn: number[] = [];
  const frostFree: number[] = [];
  const autumnFrostDays: number[] = [];
  for (const year of years) {
    const last = lastSpringFrost(climate, year);
    const first = firstAutumnFrost(climate, year);
    if (last === null || first === null) continue;
    spring.push(last);
    // A frost-free winter counts as "no frost before the window ends", so it never makes the safe date earlier.
    autumn.push(first.doy);
    if (first.frost) {
      autumnFrostDays.push(first.doy);
      frostFree.push(first.doy - last - 1);
    }
  }
  const mean = (v: readonly number[]) => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length);
  return {
    years: spring.length,
    lastSpringMean: mean(spring),
    lastSpringSafe: percentile(spring, FROST_SAFE_PROBABILITY),
    firstAutumnMean: mean(autumnFrostDays),
    firstAutumnSafe: percentile(autumn, 1 - FROST_SAFE_PROBABILITY),
    frostFreeDaysMean: mean(frostFree),
  };
}

// ── Climate statistics (SPEC §5.1) ───────────────────────────────────────────

export interface AnnualClimate {
  year: number;
  precipMm: number;
  et0Mm: number;
  /** Annual precipitation / annual ET0 (SPEC §5.1). */
  aridity: number;
  heatDays35: number;
  heatDays40: number;
  frostDays: number;
  extremeRainDays: number;
  /** Mean daily Tmax of June–August. */
  summerTmaxC: number;
  frostFreeDays: number | null;
}

/** Per-year statistics; a year with any missing day is left out (it was already flagged as excluded). */
export function annualClimate(
  climate: DailyClimate,
  et0: ReadonlyArray<number | null>,
  years: readonly number[],
): AnnualClimate[] {
  const result: AnnualClimate[] = [];
  for (const year of years) {
    const start = indexOfDate(climate, `${year}-01-01`);
    const end = indexOfDate(climate, `${year}-12-31`);
    if (start < 0 || end < 0) continue;
    let precip = 0;
    let et0Sum = 0;
    let heat35 = 0;
    let heat40 = 0;
    let frostDays = 0;
    let extreme = 0;
    let summerSum = 0;
    let summerDays = 0;
    let complete = true;
    for (let i = start; i <= end; i++) {
      const tmax = climate.tmax[i];
      const tmin = climate.tmin[i];
      const p = climate.precip[i];
      const e = et0[i];
      const date = climate.dates[i];
      if (typeof tmax !== "number" || typeof tmin !== "number" || typeof p !== "number" || typeof e !== "number" || date === undefined) {
        complete = false;
        break;
      }
      precip += p;
      et0Sum += e;
      if (tmax >= HEAT_DAY_THRESHOLDS_C[0]) heat35++;
      if (tmax >= HEAT_DAY_THRESHOLDS_C[1]) heat40++;
      if (tmin <= FROST_TMIN_C) frostDays++;
      if (p >= EXTREME_RAIN_MM) extreme++;
      if (SUMMER_MONTHS.includes(Number(date.slice(5, 7)))) {
        summerSum += tmax;
        summerDays++;
      }
    }
    if (!complete || summerDays === 0) continue;
    const spring = lastSpringFrost(climate, year);
    const autumn = firstAutumnFrost(climate, year);
    result.push({
      year,
      precipMm: Math.round(precip * 10) / 10,
      et0Mm: Math.round(et0Sum * 10) / 10,
      aridity: et0Sum > 0 ? Math.round((precip / et0Sum) * 1000) / 1000 : 0,
      heatDays35: heat35,
      heatDays40: heat40,
      frostDays,
      extremeRainDays: extreme,
      summerTmaxC: Math.round((summerSum / summerDays) * 100) / 100,
      frostFreeDays: spring !== null && autumn !== null && autumn.frost ? autumn.doy - spring - 1 : null,
    });
  }
  return result;
}

export interface MonthlyNormal {
  month: number;
  tmaxC: number | null;
  tminC: number | null;
  tmeanC: number | null;
  /** Mean monthly totals over the years. */
  precipMm: number | null;
  et0Mm: number | null;
}

/** 12-month climatology over the given years (SPEC §5.1): mean temperatures and mean monthly totals. */
export function monthlyNormals(
  climate: DailyClimate,
  et0: ReadonlyArray<number | null>,
  years: readonly number[],
): MonthlyNormal[] {
  const yearSet = new Set(years);
  const temps = Array.from({ length: 12 }, () => ({ tmax: 0, tmin: 0, n: 0 }));
  const totals = new Map<string, { p: number; e: number; pOk: boolean; eOk: boolean }>();
  climate.dates.forEach((date, i) => {
    if (!yearSet.has(Number(date.slice(0, 4)))) return;
    const m = Number(date.slice(5, 7)) - 1;
    const tmax = climate.tmax[i];
    const tmin = climate.tmin[i];
    const slot = temps[m];
    if (slot !== undefined && typeof tmax === "number" && typeof tmin === "number") {
      slot.tmax += tmax;
      slot.tmin += tmin;
      slot.n++;
    }
    const key = date.slice(0, 7);
    const total = totals.get(key) ?? { p: 0, e: 0, pOk: true, eOk: true };
    const p = climate.precip[i];
    const e = et0[i];
    if (typeof p === "number") total.p += p;
    else total.pOk = false;
    if (typeof e === "number") total.e += e;
    else total.eOk = false;
    totals.set(key, total);
  });
  return temps.map((t, m) => {
    const months = [...totals.entries()].filter(([key]) => Number(key.slice(5, 7)) - 1 === m).map(([, v]) => v);
    const precip = months.filter((v) => v.pOk).map((v) => v.p);
    const evap = months.filter((v) => v.eOk).map((v) => v.e);
    const avg = (v: number[]) => (v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10);
    return {
      month: m + 1,
      tmaxC: t.n === 0 ? null : Math.round((t.tmax / t.n) * 10) / 10,
      tminC: t.n === 0 ? null : Math.round((t.tmin / t.n) * 10) / 10,
      tmeanC: t.n === 0 ? null : Math.round(((t.tmax + t.tmin) / 2 / t.n) * 10) / 10,
      precipMm: avg(precip),
      et0Mm: avg(evap),
    };
  });
}

/**
 * Standardised anomaly (z-score) of each month of a monthly series against the same calendar month in
 * `firstYear`–`lastYear` (SPEC §5.1 soil-moisture anomaly). `null` where the value or the climatology is missing.
 */
export function monthlyAnomalies(
  startMonth: string,
  values: ReadonlyArray<number | null>,
  firstYear: number,
  lastYear: number,
): (number | null)[] {
  const startYear = Number(startMonth.slice(0, 4));
  const firstMonth = Number(startMonth.slice(5, 7)) - 1;
  const at = (i: number) => ({ year: startYear + Math.floor((firstMonth + i) / 12), month: (firstMonth + i) % 12 });
  const byMonth = Array.from({ length: 12 }, () => [] as number[]);
  values.forEach((v, i) => {
    const { year, month } = at(i);
    if (typeof v === "number" && year >= firstYear && year <= lastYear) byMonth[month]?.push(v);
  });
  const stats = byMonth.map((v) => {
    if (v.length < 2) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
    return sd > 0 ? { mean, sd } : null;
  });
  return values.map((v, i) => {
    const s = stats[at(i).month];
    return typeof v === "number" && s !== null && s !== undefined ? Math.round(((v - s.mean) / s.sd) * 100) / 100 : null;
  });
}

/** Long-term trends of the SPEC §5.4 climate series (Sen's slope + Mann–Kendall), per year. */
export function climateTrends(annual: readonly AnnualClimate[]): {
  precipMm: TrendResult | null;
  summerTmaxC: TrendResult | null;
  heatDays35: TrendResult | null;
  frostFreeDays: TrendResult | null;
} {
  const series = (pick: (a: AnnualClimate) => number | null) => trend(annual.map((a) => ({ t: a.year, value: pick(a) })));
  return {
    precipMm: series((a) => a.precipMm),
    summerTmaxC: series((a) => a.summerTmaxC),
    heatDays35: series((a) => a.heatDays35),
    frostFreeDays: series((a) => a.frostFreeDays),
  };
}

/** Yearly means of a monthly series (for the GWETROOT trend); a year needs all 12 months. */
export function annualMeansOfMonthly(startMonth: string, values: ReadonlyArray<number | null>): Array<{ t: number; value: number | null }> {
  const startYear = Number(startMonth.slice(0, 4));
  const firstMonth = Number(startMonth.slice(5, 7)) - 1;
  const years = new Map<number, number[]>();
  values.forEach((v, i) => {
    if (typeof v !== "number") return;
    const year = startYear + Math.floor((firstMonth + i) / 12);
    const list = years.get(year) ?? [];
    list.push(v);
    years.set(year, list);
  });
  return [...years.entries()].map(([t, v]) => ({ t, value: v.length === 12 ? v.reduce((a, b) => a + b, 0) / 12 : null }));
}
