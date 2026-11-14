/**
 * Long-term trends (SPEC §5.4): Sen's slope for the size of the change and the Mann–Kendall test for
 * whether it is real. A slope that is not significant is never called a trend.
 *
 * Known simplifications (About page): Mann–Kendall uses the normal approximation with the tie and
 * continuity corrections; it assumes the years are independent, so serial correlation can make a
 * trend look significant more often than it should.
 */
import { TREND_ALPHA, TREND_MIN_POINTS } from "./constants";

export type TrendDirection = "rising" | "falling" | "no_clear_trend";

export interface TrendResult {
  /** Points used (missing values are left out). */
  n: number;
  /** Sen's slope: change per unit of `t` (per year for annual data). */
  slope: number;
  /** Sen's intercept: median of value − slope · t. */
  intercept: number;
  /** Mann–Kendall statistic, its variance (tie-corrected), Z score and two-sided p-value. */
  s: number;
  varS: number;
  z: number;
  p: number;
  significant: boolean;
  direction: TrendDirection;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
}

/** Standard normal CDF via erf (Abramowitz & Stegun 7.1.26, absolute error < 1.5e−7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Median of the pairwise slopes (x_j − x_i) / (t_j − t_i) over all i < j with t_j ≠ t_i. */
export function senSlope(t: readonly number[], x: readonly number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dt = (t[j] ?? NaN) - (t[i] ?? NaN);
      if (dt !== 0) slopes.push(((x[j] ?? NaN) - (x[i] ?? NaN)) / dt);
    }
  }
  return slopes.length === 0 ? 0 : median(slopes);
}

/** Mann–Kendall S, tie-corrected variance, continuity-corrected Z and two-sided p (values in time order). */
export function mannKendall(x: readonly number[]): { s: number; varS: number; z: number; p: number } {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) s += Math.sign((x[j] ?? NaN) - (x[i] ?? NaN));
  }
  const ties = new Map<number, number>();
  for (const value of x) ties.set(value, (ties.get(value) ?? 0) + 1);
  let tieTerm = 0;
  for (const count of ties.values()) if (count > 1) tieTerm += count * (count - 1) * (2 * count + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (varS <= 0) return { s, varS, z: 0, p: 1 };
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  return { s, varS, z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}

/**
 * Trend of a series such as one value per year. Missing values are dropped; with fewer than
 * TREND_MIN_POINTS points no test is run and the result is `null` (shown as "not enough data").
 */
export function trend(
  points: ReadonlyArray<{ t: number; value: number | null }>,
  alpha = TREND_ALPHA,
  minPoints = TREND_MIN_POINTS,
): TrendResult | null {
  const valid = points
    .filter((p): p is { t: number; value: number } => typeof p.value === "number" && Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  if (valid.length < minPoints) return null;
  const t = valid.map((p) => p.t);
  const x = valid.map((p) => p.value);
  const slope = senSlope(t, x);
  const intercept = median(valid.map((p) => p.value - slope * p.t));
  const { s, varS, z, p } = mannKendall(x);
  const significant = p < alpha;
  return {
    n: valid.length,
    slope,
    intercept,
    s,
    varS,
    z,
    p,
    significant,
    direction: !significant || slope === 0 ? "no_clear_trend" : slope > 0 ? "rising" : "falling",
  };
}
