/** NASA POWER daily point API (SPEC §3.1): request URL, response schema, parsing and data coverage. */
import { z } from "zod";
import {
  MAX_MISSING_SHARE,
  POWER_COMMUNITY,
  POWER_DAILY_POINT_URL,
  POWER_FILL_VALUE,
  POWER_PARAMETERS,
} from "./constants";
import { addDays, compactFromIso, dateRange, daysInMonth, daysInYear, isoFromCompact } from "./dates";
import type { LatLon } from "./geo";

export type PowerParameter = (typeof POWER_PARAMETERS)[number];

const compactDate = z.string().regex(/^\d{8}$/);

export const powerDailyResponseSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({ type: z.literal("Point"), coordinates: z.array(z.number()).min(2) }),
  properties: z.object({ parameter: z.record(z.string(), z.record(compactDate, z.number())) }),
  header: z.object({
    title: z.string(),
    api: z.object({ version: z.string(), name: z.string() }),
    sources: z.array(z.string()),
    fill_value: z.number(),
    time_standard: z.string(),
    start: compactDate,
    end: compactDate,
  }),
  messages: z.array(z.string()),
  parameters: z.record(z.string(), z.object({ units: z.string(), longname: z.string() })),
});
export type PowerDailyResponse = z.infer<typeof powerDailyResponseSchema>;

export function powerDailyUrl(
  point: LatLon,
  start: string,
  end: string,
  parameters: readonly PowerParameter[] = POWER_PARAMETERS,
): string {
  const query = [
    `parameters=${parameters.join(",")}`,
    `community=${POWER_COMMUNITY}`,
    `latitude=${point.lat.toFixed(4)}`,
    `longitude=${point.lon.toFixed(4)}`,
    `start=${compactFromIso(start)}`,
    `end=${compactFromIso(end)}`,
    "format=JSON",
  ];
  return `${POWER_DAILY_POINT_URL}?${query.join("&")}`;
}

/** A daily series on consecutive dates; missing or fill values are `null`. */
export interface DailySeries {
  dates: string[];
  values: Record<string, (number | null)[]>;
  units: Record<string, string>;
  sources: string[];
  apiVersion: string;
}

export function seriesOf(series: DailySeries, parameter: string): (number | null)[] {
  const values = series.values[parameter];
  if (values === undefined) throw new Error(`series has no parameter ${parameter}`);
  return values;
}

/**
 * Turns a POWER response into consecutive daily values. Fill values (−999) and absent days become
 * `null` (SPEC §3.1). Trailing days that are missing for every parameter are dropped: they are not
 * available yet, so the series ends at the latest available day.
 */
export function parsePowerDaily(response: PowerDailyResponse, parameters: readonly string[]): DailySeries {
  const fill = response.header.fill_value;
  const dates = dateRange(isoFromCompact(response.header.start), isoFromCompact(response.header.end));
  const values: Record<string, (number | null)[]> = {};
  const units: Record<string, string> = {};
  for (const parameter of parameters) {
    const record = response.properties.parameter[parameter];
    if (record === undefined) throw new Error(`POWER response has no ${parameter}`);
    values[parameter] = dates.map((date) => {
      const value = record[compactFromIso(date)];
      return value === undefined || value === fill || value === POWER_FILL_VALUE ? null : value;
    });
    units[parameter] = response.parameters[parameter]?.units ?? "";
  }
  const column = (parameter: string): (number | null)[] => {
    const series = values[parameter];
    if (series === undefined) throw new Error(`POWER response has no ${parameter}`);
    return series;
  };
  let length = dates.length;
  while (length > 0 && parameters.every((p) => column(p)[length - 1] === null)) length--;
  for (const parameter of parameters) values[parameter] = column(parameter).slice(0, length);
  return {
    dates: dates.slice(0, length),
    values,
    units,
    sources: response.header.sources,
    apiVersion: response.header.api.version,
  };
}

/** Joins consecutive blocks (e.g. 5-year requests) into one series. Gaps or overlaps are errors. */
export function mergeDailySeries(blocks: readonly DailySeries[]): DailySeries {
  const sorted = [...blocks].filter((b) => b.dates.length > 0).sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  const first = sorted[0];
  if (first === undefined) throw new Error("no POWER data to merge");
  const merged: DailySeries = {
    dates: [...first.dates],
    values: Object.fromEntries(Object.entries(first.values).map(([k, v]) => [k, [...v]])),
    units: { ...first.units },
    sources: [...first.sources],
    apiVersion: first.apiVersion,
  };
  for (const block of sorted.slice(1)) {
    const expected = addDays(merged.dates[merged.dates.length - 1], 1);
    if (block.dates[0] !== expected) throw new Error(`POWER blocks are not consecutive: expected ${expected}, got ${block.dates[0]}`);
    merged.dates.push(...block.dates);
    for (const parameter of Object.keys(merged.values)) seriesOf(merged, parameter).push(...seriesOf(block, parameter));
    for (const source of block.sources) if (!merged.sources.includes(source)) merged.sources.push(source);
  }
  return merged;
}

export interface YearCoverage {
  year: number;
  /** Days of this year inside the series. */
  days: number;
  /** The whole calendar year is inside the series. */
  complete: boolean;
  missing: Record<string, number>;
  /** More than 10 % of days missing for at least one parameter: excluded from statistics (SPEC §3.1). */
  excluded: boolean;
}

export function yearCoverage(
  series: DailySeries,
  parameters: readonly string[],
  maxMissingShare = MAX_MISSING_SHARE,
): YearCoverage[] {
  const byYear = new Map<number, number[]>();
  series.dates.forEach((date, index) => {
    const year = Number(date.slice(0, 4));
    const indices = byYear.get(year) ?? [];
    indices.push(index);
    byYear.set(year, indices);
  });
  return [...byYear.entries()].map(([year, indices]) => {
    const missing: Record<string, number> = {};
    for (const parameter of parameters) {
      const values = seriesOf(series, parameter);
      missing[parameter] = indices.filter((i) => values[i] === null).length;
    }
    return {
      year,
      days: indices.length,
      complete: indices.length === daysInYear(year),
      missing,
      excluded: parameters.some((p) => (missing[p] ?? 0) / indices.length > maxMissingShare),
    };
  });
}

/**
 * Monthly means of a daily series, for complete calendar months only. A month with more than 10 %
 * missing days is `null` (SPEC §3.1 rule applied per month).
 */
export function monthlyMeans(
  dates: readonly string[],
  values: readonly (number | null)[],
  digits = 3,
  maxMissingShare = MAX_MISSING_SHARE,
): { start: string; means: (number | null)[] } {
  const months = new Map<string, number[]>();
  dates.forEach((date, index) => {
    const month = date.slice(0, 7);
    const indices = months.get(month) ?? [];
    indices.push(index);
    months.set(month, indices);
  });
  const factor = 10 ** digits;
  const complete = [...months.entries()].filter(
    ([month, indices]) => indices.length === daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))),
  );
  const means = complete.map(([, indices]) => {
    const present = indices.map((i) => values[i]).filter((v): v is number => v !== null && v !== undefined);
    if (present.length === 0 || (indices.length - present.length) / indices.length > maxMissingShare) return null;
    return Math.round((present.reduce((sum, v) => sum + v, 0) / present.length) * factor) / factor;
  });
  return { start: complete[0]?.[0] ?? "", means };
}
