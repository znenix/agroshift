/**
 * MODIS land products through the ORNL DAAC TESViS web service (SPEC §3.2): URLs, response schemas,
 * pixel geometry, land-cover summaries and NDVI composites.
 */
import { z } from "zod";
import { MCD12Q1_FILL, MOD13Q1, MODIS_WINDOW_KM, ORNL_API_URL, ORNL_MAX_DATES_PER_REQUEST } from "./constants";
import type { LatLon } from "./geo";

const modisDate = z.string().regex(/^A\d{7}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ornlDatesSchema = z.object({
  dates: z.array(z.object({ modis_date: modisDate, calendar_date: isoDate })),
});
export type OrnlDate = z.infer<typeof ornlDatesSchema>["dates"][number];

export const ornlSubsetSchema = z
  .object({
    xllcorner: z.coerce.number(),
    yllcorner: z.coerce.number(),
    cellsize: z.coerce.number().positive(),
    nrows: z.number().int().positive(),
    ncols: z.number().int().positive(),
    band: z.string(),
    units: z.string(),
    scale: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    header: z.string(),
    subset: z.array(
      z.object({
        modis_date: modisDate,
        calendar_date: isoDate,
        band: z.string(),
        tile: z.string(),
        proc_date: z.string(),
        data: z.array(z.number()),
      }),
    ),
  })
  .refine((s) => s.subset.every((composite) => composite.data.length === s.nrows * s.ncols), {
    message: "subset data length does not match nrows × ncols",
  });
export type OrnlSubset = z.infer<typeof ornlSubsetSchema>;

const coordinate = (value: number) => value.toFixed(6);

export function ornlDatesUrl(product: string, point: LatLon): string {
  return `${ORNL_API_URL}/${product}/dates?latitude=${coordinate(point.lat)}&longitude=${coordinate(point.lon)}`;
}

export function ornlSubsetUrl(args: {
  product: string;
  band: string;
  point: LatLon;
  startDate: string;
  endDate: string;
  kmAboveBelow?: number;
  kmLeftRight?: number;
}): string {
  const { product, band, point, startDate, endDate, kmAboveBelow = MODIS_WINDOW_KM, kmLeftRight = MODIS_WINDOW_KM } = args;
  return (
    `${ORNL_API_URL}/${product}/subset?latitude=${coordinate(point.lat)}&longitude=${coordinate(point.lon)}` +
    `&band=${band}&startDate=${startDate}&endDate=${endDate}&kmAboveBelow=${kmAboveBelow}&kmLeftRight=${kmLeftRight}`
  );
}

/** Splits dates into request-sized runs (the subset endpoint returns at most 10 dates per call). */
export function chunkDates<T>(dates: readonly T[], size = ORNL_MAX_DATES_PER_REQUEST): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < dates.length; i += size) chunks.push(dates.slice(i, i + size));
  return chunks;
}

/**
 * Groups the `wanted` dates into request runs. The subset endpoint takes a date *range* and returns
 * every composite inside it, so each run must be consecutive in the product's full date list `all`
 * and hold at most `max` dates (a range spanning more composites is rejected with HTTP 400).
 */
export function contiguousRuns<T extends { modis_date: string }>(
  all: readonly T[],
  wanted: readonly T[],
  max = ORNL_MAX_DATES_PER_REQUEST,
): T[][] {
  const position = new Map(all.map((d, i) => [d.modis_date, i]));
  const indexed = wanted
    .map((d) => ({ d, i: position.get(d.modis_date) }))
    .filter((x): x is { d: T; i: number } => x.i !== undefined)
    .sort((a, b) => a.i - b.i);
  const runs: T[][] = [];
  let current: T[] = [];
  let previous = -2;
  for (const { d, i } of indexed) {
    if (current.length === 0 || i !== previous + 1 || current.length >= max) {
      if (current.length > 0) runs.push(current);
      current = [];
    }
    current.push(d);
    previous = i;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

// ── Pixel geometry (MODIS sinusoidal metres) ─────────────────────────────────

export interface PixelGrid {
  xll: number;
  yll: number;
  cellsize: number;
  nrows: number;
  ncols: number;
}

export function gridOf(subset: OrnlSubset): PixelGrid {
  return { xll: subset.xllcorner, yll: subset.yllcorner, cellsize: subset.cellsize, nrows: subset.nrows, ncols: subset.ncols };
}

/**
 * Centre of a pixel. Data are row-major and row 0 is the northern edge — verified on 2026-11-14 by
 * requesting a window shifted one pixel north and comparing rows.
 */
export function pixelCentre(grid: PixelGrid, row: number, col: number): { x: number; y: number } {
  return { x: grid.xll + (col + 0.5) * grid.cellsize, y: grid.yll + (grid.nrows - row - 0.5) * grid.cellsize };
}

export function pixelAt(grid: PixelGrid, x: number, y: number): { row: number; col: number } | null {
  const col = Math.floor((x - grid.xll) / grid.cellsize);
  const rowFromBottom = Math.floor((y - grid.yll) / grid.cellsize);
  const row = grid.nrows - 1 - rowFromBottom;
  if (col < 0 || col >= grid.ncols || row < 0 || row >= grid.nrows) return null;
  return { row, col };
}

/** For each pixel of `target`, whether the `classGrid` pixel containing its centre has an allowed class. */
export function classMask(
  target: PixelGrid,
  classGrid: PixelGrid,
  classData: readonly number[],
  allowed: readonly number[],
): boolean[] {
  const mask: boolean[] = [];
  for (let row = 0; row < target.nrows; row++) {
    for (let col = 0; col < target.ncols; col++) {
      const { x, y } = pixelCentre(target, row, col);
      const hit = pixelAt(classGrid, x, y);
      const cls = hit === null ? undefined : classData[hit.row * classGrid.ncols + hit.col];
      mask.push(cls !== undefined && allowed.includes(cls));
    }
  }
  return mask;
}

// ── Land cover ───────────────────────────────────────────────────────────────

export interface ClassSummary {
  /** Most frequent class; `null` when the window is empty or two classes tie. */
  majority: number | null;
  majorityCount: number;
  total: number;
  counts: Record<string, number>;
}

export function summarizeClasses(values: readonly number[]): ClassSummary {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const value of values) {
    if (value === MCD12Q1_FILL) continue;
    counts[String(value)] = (counts[String(value)] ?? 0) + 1;
    total++;
  }
  let majority: number | null = null;
  let majorityCount = 0;
  let tie = false;
  for (const [cls, count] of Object.entries(counts)) {
    if (count > majorityCount) {
      majority = Number(cls);
      majorityCount = count;
      tie = false;
    } else if (count === majorityCount) {
      tie = true;
    }
  }
  return { majority: tie ? null : majority, majorityCount, total, counts };
}

/** Values of the (2·half + 1)² window centred on (row, col), or `null` if it leaves the grid. */
export function windowValues(grid: PixelGrid, data: readonly number[], row: number, col: number, half: number): number[] | null {
  if (row - half < 0 || col - half < 0 || row + half >= grid.nrows || col + half >= grid.ncols) return null;
  const values: number[] = [];
  for (let r = row - half; r <= row + half; r++) {
    for (let c = col - half; c <= col + half; c++) {
      const value = data[r * grid.ncols + c];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

// ── NDVI ─────────────────────────────────────────────────────────────────────

/** Scaled NDVI, or `null` for the fill value and values outside the valid range (ORNL `/bands`). */
export function ndviFromRaw(raw: number): number | null {
  if (raw === MOD13Q1.fill || raw < MOD13Q1.validMin || raw > MOD13Q1.validMax) return null;
  return raw * MOD13Q1.scale;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Median NDVI of one composite over the pixels that are reliable (pixel_reliability 0 or 1, SPEC §3.2)
 * and, when a mask is given, cropland-like. `n` is the number of pixels used.
 */
export function compositeMedian(
  ndviRaw: readonly number[],
  reliability: readonly number[],
  mask: readonly boolean[] | null,
): { ndvi: number | null; n: number } {
  const valid: number[] = [];
  ndviRaw.forEach((raw, i) => {
    const rel = reliability[i];
    if (rel === undefined || rel < 0 || rel > MOD13Q1.maxReliability) return;
    if (mask !== null && mask[i] !== true) return;
    const value = ndviFromRaw(raw);
    if (value !== null) valid.push(value);
  });
  const value = median(valid);
  return { ndvi: value === null ? null : Math.round(value * 10_000) / 10_000, n: valid.length };
}

export interface NdviComposite {
  /** Composite start date (16-day period). */
  date: string;
  ndvi: number | null;
  n: number;
}

/** Pairs NDVI and reliability composites by date and reduces each to a median (sorted, unique dates). */
export function ndviComposites(
  ndvi: readonly OrnlSubset[],
  reliability: readonly OrnlSubset[],
  mask: readonly boolean[] | null,
): NdviComposite[] {
  const reliabilityByDate = new Map<string, readonly number[]>();
  for (const subset of reliability) for (const c of subset.subset) reliabilityByDate.set(c.modis_date, c.data);
  const byDate = new Map<string, NdviComposite>();
  for (const subset of ndvi) {
    for (const composite of subset.subset) {
      const rel = reliabilityByDate.get(composite.modis_date);
      const { ndvi: value, n } = rel === undefined ? { ndvi: null, n: 0 } : compositeMedian(composite.data, rel, mask);
      byDate.set(composite.calendar_date, { date: composite.calendar_date, ndvi: value, n });
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
