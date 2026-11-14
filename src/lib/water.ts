/**
 * Water engine (SPEC §5.2): extraterrestrial radiation, Hargreaves ET0, effective rainfall, the
 * FAO-56 single crop coefficient curve and the seasonal irrigation need. Pure; depths in mm.
 *
 * Known simplifications (listed on the About page):
 * - Hargreaves needs only temperature, so it responds to the ΔT scenario, but it is an approximation
 *   of Penman–Monteith (FAO-56 §"ET0 from temperature data").
 * - Kc values are FAO-56 Table 12 standard values, not adjusted for climate (FAO-56 eq. 62). In dry,
 *   windy summers the adjustment would raise Kc_mid, so crop water need is probably underestimated.
 * - Not included: salt-leaching water, canal losses, soil water storage between months.
 */
import {
  DRY_YEAR_PERCENTILE,
  EFFECTIVE_RAIN,
  HARGREAVES,
  M3_PER_HA_PER_MM,
  MJ_TO_MM,
  SOLAR_CONSTANT_MJ_M2_MIN,
} from "./constants";
import { daysInMonth, isoToUtcMs } from "./dates";

const DAY_MS = 86_400_000;

/** Day of the year, 1 = 1 January (FAO-56 "J"). */
export function dayOfYear(iso: string): number {
  const ms = isoToUtcMs(iso);
  return Math.round((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

/** Extraterrestrial radiation Ra in MJ m⁻² day⁻¹ for a latitude (°, south negative) and day of year (FAO-56 eq. 21–25). */
export function extraterrestrialRadiation(latDeg: number, doy: number): number {
  const phi = (latDeg * Math.PI) / 180; // eq. 22
  const angle = (2 * Math.PI * doy) / 365;
  const dr = 1 + 0.033 * Math.cos(angle); // eq. 23: inverse relative Earth–Sun distance
  const delta = 0.409 * Math.sin(angle - 1.39); // eq. 24: solar declination
  const ws = Math.acos(Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(delta)))); // eq. 25 (clamped for polar day/night)
  return (
    ((24 * 60) / Math.PI) *
    SOLAR_CONSTANT_MJ_M2_MIN *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** Hargreaves reference evapotranspiration in mm/day (FAO-56 eq. 52); Ra in mm/day. Never negative. */
export function et0Hargreaves(tmaxC: number, tminC: number, raMmPerDay: number): number {
  const tmean = (tmaxC + tminC) / 2; // FAO-56 eq. 9
  const range = Math.max(0, tmaxC - tminC);
  return Math.max(0, HARGREAVES.coefficient * (tmean + HARGREAVES.offsetC) * Math.sqrt(range) * raMmPerDay);
}

/** Daily ET0 along a series; `null` where Tmax or Tmin is missing. */
export function dailyEt0(
  dates: readonly string[],
  tmax: ReadonlyArray<number | null>,
  tmin: ReadonlyArray<number | null>,
  latDeg: number,
): (number | null)[] {
  const raByDay = new Map<number, number>();
  return dates.map((date, i) => {
    const hi = tmax[i];
    const lo = tmin[i];
    if (typeof hi !== "number" || typeof lo !== "number") return null;
    const doy = dayOfYear(date);
    let ra = raByDay.get(doy);
    if (ra === undefined) {
      ra = extraterrestrialRadiation(latDeg, doy) * MJ_TO_MM;
      raByDay.set(doy, ra);
    }
    return et0Hargreaves(hi, lo, ra);
  });
}

/** Effective rainfall in mm for a monthly rainfall total in mm (Brouwer & Heibloem 1986). */
export function effectiveRainfall(monthlyMm: number): number {
  const { thresholdMm, high, low } = EFFECTIVE_RAIN;
  const pe = monthlyMm > thresholdMm ? high.slope * monthlyMm + high.intercept : low.slope * monthlyMm + low.intercept;
  return Math.max(0, pe);
}

export interface KcCurve {
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  /** Shares of the season in the initial, development, mid-season and late stages (sum 1). */
  stageFractions: readonly [number, number, number, number];
  seasonDays: number;
}

/**
 * Single crop coefficient on `day` of the season, day 1 = sowing day (FAO-56 eq. 66): constant in the
 * initial and mid-season stages, linear in the development and late stages.
 */
export function kcOnDay(curve: KcCurve, day: number): number {
  const [fIni, fDev, fMid] = curve.stageFractions;
  const lIni = fIni * curve.seasonDays;
  const lDev = fDev * curve.seasonDays;
  const lMid = fMid * curve.seasonDays;
  const lLate = curve.seasonDays - lIni - lDev - lMid;
  if (day <= lIni) return curve.kcIni;
  if (day <= lIni + lDev) return curve.kcIni + ((day - lIni) / lDev) * (curve.kcMid - curve.kcIni);
  if (day <= lIni + lDev + lMid) return curve.kcMid;
  if (lLate <= 0) return curve.kcEnd;
  return curve.kcMid + (Math.min(day - lIni - lDev - lMid, lLate) / lLate) * (curve.kcEnd - curve.kcMid);
}

export interface SeasonWater {
  days: number;
  /** Crop evapotranspiration over the season, Σ Kc · ET0. */
  etcMm: number;
  /** Effective rainfall credited to the season. */
  peffMm: number;
  /** Net irrigation need: monthly deficits ETc − Peff, summed (never negative). */
  netMm: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Net irrigation need of one crop season (SPEC §5.2), balanced per calendar month as in FAO CROPWAT:
 * the month's effective rainfall (formula applied to the whole month's rain, then prorated by the share
 * of the month inside the season) is subtracted from that month's ETc; deficits are summed and a wet
 * month's surplus is not carried forward. `start` is the index of the sowing day in `dates`.
 * Returns `null` if the season leaves the series or any needed day (ET0, or rain of a touched month) is
 * missing — that crop-year is then left out rather than guessed.
 */
export function seasonWaterNeed(args: {
  dates: readonly string[];
  et0: ReadonlyArray<number | null>;
  precip: ReadonlyArray<number | null>;
  start: number;
  curve: KcCurve;
}): SeasonWater | null {
  const { dates, et0, precip, start, curve } = args;
  const firstDate = dates[0];
  const end = start + curve.seasonDays - 1;
  if (firstDate === undefined || start < 0 || end >= dates.length) return null;
  const origin = isoToUtcMs(firstDate);
  const indexOf = (iso: string) => Math.round((isoToUtcMs(iso) - origin) / DAY_MS);

  const months = new Map<string, { etc: number; days: number }>();
  let etcTotal = 0;
  for (let i = start; i <= end; i++) {
    const value = et0[i];
    const date = dates[i];
    if (typeof value !== "number" || date === undefined) return null;
    const etc = kcOnDay(curve, i - start + 1) * value;
    etcTotal += etc;
    const key = date.slice(0, 7);
    const month = months.get(key) ?? { etc: 0, days: 0 };
    month.etc += etc;
    month.days += 1;
    months.set(key, month);
  }

  let peffTotal = 0;
  let net = 0;
  for (const [key, month] of months) {
    const year = Number(key.slice(0, 4));
    const monthNumber = Number(key.slice(5, 7));
    const length = daysInMonth(year, monthNumber);
    const first = indexOf(`${key}-01`);
    if (first < 0 || first + length > dates.length) return null; // the month's full rain total is needed
    let rain = 0;
    for (let i = first; i < first + length; i++) {
      const p = precip[i];
      if (typeof p !== "number") return null;
      rain += p;
    }
    const peff = effectiveRainfall(rain) * (month.days / length);
    peffTotal += peff;
    net += Math.max(0, month.etc - peff);
  }
  return { days: curve.seasonDays, etcMm: round1(etcTotal), peffMm: round1(peffTotal), netMm: round1(net) };
}

/** Gross irrigation need: net need divided by the field application efficiency (0–1]. */
export function grossNeedMm(netMm: number, efficiency: number): number {
  if (!(efficiency > 0 && efficiency <= 1)) throw new RangeError(`efficiency must be in (0, 1], got ${efficiency}`);
  return round1(netMm / efficiency);
}

/** Depth in mm to volume in m³ per hectare (1 mm = 10 m³/ha). */
export function m3PerHa(mm: number): number {
  return Math.round(mm * M3_PER_HA_PER_MM);
}

/** Percentile with linear interpolation between order statistics (Hyndman & Fan type 7, the R default). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lower = Math.floor(h);
  const a = sorted[lower] ?? 0;
  const b = sorted[Math.min(lower + 1, sorted.length - 1)] ?? a;
  return a + (h - lower) * (b - a);
}

/** Average year and dry year (90th percentile, SPEC §5.2) of yearly needs; `null` without data. */
export function averageAndDryYear(yearly: readonly number[]): { average: number; dryYear: number; years: number } | null {
  const dry = percentile(yearly, DRY_YEAR_PERCENTILE);
  if (dry === null) return null;
  const average = yearly.reduce((sum, v) => sum + v, 0) / yearly.length;
  return { average: round1(average), dryYear: round1(dry), years: yearly.length };
}
