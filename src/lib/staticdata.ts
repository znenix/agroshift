/**
 * Loading the app's own static files (public/data, SPEC §4.2) with validation. The browser only ever
 * fetches these and our own /api/* routes (CLAUDE.md §1.8).
 */
import type { z } from "zod";
import { farmFileSchema, regionsFileSchema, type FarmFile, type RegionsFile } from "./datafiles";

export async function fetchStatic<T>(path: string, schema: z.ZodType<T>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${path}: unexpected file format`);
  return parsed.data;
}

/** Regions and the demo farms whose data is built (farms still downloading are simply not listed yet). */
export const loadRegions = (fetchImpl?: typeof fetch): Promise<RegionsFile> =>
  fetchStatic("/data/regions.json", regionsFileSchema, fetchImpl);

export const loadFarm = (id: string, fetchImpl?: typeof fetch): Promise<FarmFile> =>
  fetchStatic(`/data/farms/${encodeURIComponent(id)}.json`, farmFileSchema, fetchImpl);
