/**
 * "Any point" mode (team decision 2026-11-15): a map point uses prepared data only — its static POWER
 * cell and its region's salinity — and shows soil, NDVI and the satellite check as "demo farms only" gaps.
 * Uses the committed public/data files, so it also checks that every point's climate cell is there.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, buildProfile, soilConditions } from "@/lib/analysis";
import { CROPS, ROTATION_TEMPLATES } from "@/lib/catalog";
import { boundariesFileSchema, cellFileSchema, regionsFileSchema } from "@/lib/datafiles";
import { fieldIndicators } from "@/lib/indicators";
import {
  cellDistanceKm,
  ndviDemoOnly,
  PREPARED_ONLY_GAPS,
  preparedPointData,
  pointSite,
  regionOfPoint,
} from "@/lib/point";

const DATA = path.join(process.cwd(), "public", "data");
const readData = (file: string): unknown => JSON.parse(readFileSync(path.join(DATA, file), "utf8"));
const boundaries = boundariesFileSchema.parse(readData("boundaries.json"));
const regions = regionsFileSchema.parse(readData("regions.json"));
const cellFile = (id: string) => cellFileSchema.parse(readData(path.join("cells", `${id}.json`)));
const salinityOf = (region: string) => regions.regions.find((r) => r.id === region)?.salinity ?? null;

/** Builds a map point exactly as the /field flow does. */
function pointProfile(lat: number, lon: number) {
  const region = regionOfPoint({ lat, lon }, boundaries);
  if (region === null) throw new Error(`test point ${lat}, ${lon} is outside Uzbekistan`);
  const data = preparedPointData({ lat, lon }, region, "2026-11-15");
  const names = regions.regions.find((r) => r.id === region)?.names ?? { uz: region, ru: region, en: region };
  return { data, profile: buildProfile(pointSite(data, cellFile(data.cell), names), salinityOf(region)) };
}

const ANSWERS = {
  current: { id: "cotton_wheat", years: ROTATION_TEMPLATES.find((r) => r.id === "cotton_wheat")?.years ?? [] },
  priorities: { water_saving: 1, soil_health: 1, forage: 1, income_market: 1, low_risk: 1, simplicity: 1 },
  reliability: "sometimes_short",
  farmer: { mode: "irrigated", irrigation: "furrow", waterAllocationM3PerHa: null, requiredShare: null, unavailableCrops: [], marketRating: {} },
  soilTest: { ece: null, ph: null },
} as const;

describe("any point: inside or outside Uzbekistan", () => {
  it.each([
    ["Karshi", 38.86, 65.79, "UZ-QA"],
    ["Samarkand", 39.65, 66.96, "UZ-SA"],
    ["Nukus", 42.46, 59.6, "UZ-QR"],
    ["Tashkent city", 41.31, 69.28, "UZ-TK"],
    ["Fergana", 40.39, 71.78, "UZ-FA"],
  ])("%s lies in its region", (_name, lat, lon, region) => {
    expect(regionOfPoint({ lat, lon }, boundaries)).toBe(region);
  });

  it.each([
    ["Almaty", 43.24, 76.89],
    ["Bishkek", 42.87, 74.59],
    ["Dushanbe", 38.56, 68.79],
    ["Ashgabat", 37.95, 58.38],
    ["Osh (Kyrgyzstan, next to Fergana valley)", 40.53, 72.8],
    ["the open sea", 0, 0],
  ])("%s is outside Uzbekistan", (_name, lat, lon) => {
    expect(regionOfPoint({ lat, lon }, boundaries)).toBeNull();
  });

  it("rejects coordinates that are not numbers", () => {
    expect(regionOfPoint({ lat: Number.NaN, lon: 65 }, boundaries)).toBeNull();
    expect(regionOfPoint({ lat: 40, lon: Number.POSITIVE_INFINITY }, boundaries)).toBeNull();
  });
});

describe("any point: region lookup and the climate cell", () => {
  it("every region of Uzbekistan resolves to its own salinity entry (estimated or unknown, never borrowed)", () => {
    for (const r of regions.regions) expect(["estimated", "unknown"]).toContain(r.salinity.status);
    const samarkand = pointProfile(39.65, 66.96).profile.salinity;
    expect(samarkand?.status).toBe("estimated");
    const karshi = pointProfile(38.86, 65.79).profile.salinity;
    expect(karshi?.status).toBe("unknown");
  });

  it("uses the native POWER cell containing the point, whose static file exists, and reports its distance", () => {
    for (const [lat, lon] of [
      [38.86, 65.79],
      [42.46, 59.6],
      [41.31, 69.28],
      [37.3, 67.3],
    ] as const) {
      const data = preparedPointData({ lat, lon }, "UZ-QA", "2026-11-15");
      expect(existsSync(path.join(DATA, "cells", `${data.cell}.json`))).toBe(true);
      // Half the cell diagonal (0.25° × 0.3125°) is under 40 km at these latitudes.
      expect(cellDistanceKm({ lat, lon })).toBeLessThan(40);
      expect(cellDistanceKm({ lat, lon })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("any point: missing soil and NDVI are gaps, never borrowed values", () => {
  it("has no soil, land cover, NDVI or slope, and lists each as a 'demo farms only' gap", () => {
    const data = preparedPointData({ lat: 38.86, lon: 65.79 }, "UZ-QA", "2026-11-15");
    expect(data.soil.status).toBe("unknown");
    expect([data.soil.ph_h2o, data.soil.soc_g_kg, data.soil.clay_pct, data.soil.sand_pct, data.soil.silt_pct]).toEqual([null, null, null, null, null]);
    expect(data.land_cover).toBeNull();
    expect(data.ndvi).toBeNull();
    expect(data.terrain).toBeNull();
    expect(data.sources).toEqual([]);
    expect(data.gaps).toEqual([...PREPARED_ONLY_GAPS]);
  });

  it("a point on a demo farm's exact coordinates still gets no soil or NDVI from that farm", () => {
    const farm = regions.demo_farms.find((f) => f.id === "qashqadaryo");
    expect(farm).toBeDefined();
    const { profile } = pointProfile(farm?.lat ?? 0, farm?.lon ?? 0);
    expect(profile.farm.ndvi.composites).toEqual([]);
    expect(profile.farm.soil.status).toBe("unknown");
    expect(profile.farm.terrain).toBeNull();
    expect(ndviDemoOnly(profile.farm)).toBe(true);
  });

  it("runs the whole comparison; missing inputs show as unknown with low confidence", () => {
    const { profile } = pointProfile(39.65, 66.96);
    const soil = soilConditions(profile, ANSWERS.soilTest);
    const indicators = fieldIndicators(profile, soil);
    const byId = (id: string) => indicators.find((i) => i.id === id);
    for (const id of ["ph", "organic_carbon", "texture", "slope", "vegetation"]) {
      expect(byId(id)?.status, id).toBe("unknown");
      expect(byId(id)?.confidence, id).toBe("low");
    }
    // Salinity comes from the region (Samarkand: estimated "slight"), not from a farm.
    expect(byId("salinity")?.valueKey).toBe("salinity.slight");
    expect(byId("salinity")?.confidence).toBe("low");

    const analysis = analyze(profile, CROPS, ROTATION_TEMPLATES, ANSWERS);
    expect(analysis.satellite).toBeNull();
    expect(analysis.ranking.current?.evaluation.id).toBe("cotton_wheat");
    expect(analysis.ranking.top.length).toBeGreaterThan(0);
    for (const r of [...analysis.ranking.top, ...(analysis.ranking.current === null ? [] : [analysis.ranking.current])]) {
      expect(r.evaluation.confidence.soil).toBe("low");
    }
  });

  it("a demo farm is not an 'any point' site", () => {
    const { profile } = pointProfile(41.31, 69.28);
    expect(ndviDemoOnly(profile.farm)).toBe(true);
    const demo = { ...profile.farm, selection: { reason: "Nearest pixel to Tashkent …", selected_on: "2026-11-14" } };
    expect(ndviDemoOnly(demo)).toBe(false);
  });
});
