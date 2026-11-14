/**
 * Synthetic test climate (not real data): the same weather every year, so expected values can be
 * worked out by hand. Tmean = mean + amplitude · cos(2π (doy − 200) / 365); Tmax/Tmin = Tmean ± range/2.
 * With the defaults, Tmin ≤ 0 °C exactly up to day 82 and from day 318.
 */
import cropsJson from "../../data/crops.json";
import rotationsJson from "../../data/rotations.json";
import type { DailyClimate } from "@/lib/climate";
import { cropsFileSchema, indexCrops, type Crop } from "@/lib/crops";
import { dateRange } from "@/lib/dates";
import { rotationsFileSchema, type Rotation } from "@/lib/rotations";
import { dayOfYear } from "@/lib/water";

export interface SyntheticOptions {
  startYear?: number;
  years?: number;
  mean?: number;
  amplitude?: number;
  range?: number;
  rainMm?: number;
  lat?: number;
  /** Day of year that gets a −3 °C frost every year (to force an early autumn frost). */
  extraFrostDoy?: number | null;
}

export function syntheticClimate(options: SyntheticOptions = {}): DailyClimate {
  const { startYear = 2005, years = 22, mean = 14, amplitude = 16, range = 14, rainMm = 0.5, lat = 41, extraFrostDoy = null } = options;
  const dates = dateRange(`${startYear}-01-01`, `${startYear + years - 1}-12-31`);
  const tmax: number[] = [];
  const tmin: number[] = [];
  const precip: number[] = [];
  for (const date of dates) {
    const doy = dayOfYear(date);
    const tmean = mean + amplitude * Math.cos((2 * Math.PI * (doy - 200)) / 365);
    tmax.push(tmean + range / 2);
    tmin.push(doy === extraFrostDoy ? -3 : tmean - range / 2);
    precip.push(rainMm);
  }
  return { dates, tmax, tmin, precip, lat };
}

export const CROPS = indexCrops(cropsFileSchema.parse(cropsJson).crops);
export const ROTATIONS = rotationsFileSchema.parse(rotationsJson).rotations;

export function crop(id: string): Crop {
  const found = CROPS.get(id);
  if (found === undefined) throw new Error(`no crop ${id} in data/crops.json`);
  return found;
}

export function template(id: string): Rotation {
  const found = ROTATIONS.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rotation ${id} in data/rotations.json`);
  return found;
}
