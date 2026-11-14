import { describe, expect, it } from "vitest";
import { analyze, buildProfile, soilConditions } from "@/lib/analysis";
import { fieldIndicators } from "@/lib/indicators";
import { pointSite, pointSoil, recentCompositeRuns, roundCoord, type PointData } from "@/lib/point";
import type { SoilGridsResponse } from "@/lib/soil";
import { CROPS, ROTATIONS, template } from "./fixtures/synthetic";
import { syntheticFarm } from "./fixtures/farm";

const farm = syntheticFarm();
const cell = { version: 1 as const, id: farm.climate.cell.id, lat: 41, lon: 60, climate: farm.climate, sources: [] };
const names = { uz: "Qoraqalpogʻiston", ru: "Каракалпакстан", en: "Karakalpakstan" };

function point(overrides: Partial<PointData> = {}): PointData {
  return {
    version: 1,
    lat: 41.1234,
    lon: 60.5678,
    region: "UZ-QR",
    cell: cell.id,
    retrieved: "2026-11-14",
    land_cover: null,
    ndvi: null,
    soil: pointSoil(null),
    terrain: null,
    sources: [],
    gaps: ["land_cover", "ndvi", "soil", "terrain"],
    ...overrides,
  };
}

describe("map points (SPEC §8 /api/point)", () => {
  it("asks ORNL for the last 3 seasons in runs of at most 10 consecutive composites, across New Year", () => {
    const runs = recentCompositeRuns(2025, 3);
    expect(runs).toHaveLength(7); // 69 composites
    expect(runs[0]).toEqual({ start: "A2023001", end: "A2023145" });
    expect(runs[2]).toEqual({ start: "A2023321", end: "A2024097" });
    expect(runs.at(-1)).toEqual({ start: "A2025225", end: "A2025353" });
  });

  it("rounds points to 0.001° so repeated clicks share a cache entry", () => {
    expect(roundCoord(41.12345)).toBe(41.123);
    expect(roundCoord(-0.0004)).toBe(-0);
  });

  it("never guesses soil: no response or unexpected units is an information gap", () => {
    expect(pointSoil(null).status).toBe("unknown");
    const layer = (name: string, units: string, mean: number) => ({
      name,
      unit_measure: { d_factor: 1, target_units: units },
      depths: ["0-5cm", "5-15cm", "15-30cm"].map((label) => ({ label, values: { mean } })),
    });
    const response = {
      properties: {
        layers: [layer("phh2o", "-", 8), layer("soc", "g/kg", 7), layer("clay", "%", 20), layer("sand", "%", 30), layer("silt", "%", 50)],
      },
    } as unknown as SoilGridsResponse;
    expect(pointSoil(response)).toMatchObject({ status: "modelled", ph_h2o: 8, clay_pct: 20 });
    const wrongUnits = { properties: { layers: [layer("phh2o", "pH*10", 80), ...response.properties.layers.slice(1)] } } as unknown as SoilGridsResponse;
    expect(pointSoil(wrongUnits).status).toBe("unknown");
  });

  it("a point with every upstream missing still runs the whole engine, with gaps instead of values", () => {
    const site = pointSite(point(), cell, names);
    expect(site.id).toBe("point_41.123_60.568");
    expect(site.terrain).toBeNull();
    expect(site.ndvi.composites).toEqual([]);
    const profile = buildProfile(site, null);
    const soil = soilConditions(profile, { ece: null, ph: null });
    expect(soil.slopePct).toBeNull();
    const indicators = fieldIndicators(profile, soil);
    expect(indicators.find((i) => i.id === "slope")?.status).toBe("unknown");
    expect(indicators.find((i) => i.id === "ph")?.status).toBe("unknown");
    const analysis = analyze(profile, CROPS, ROTATIONS, {
      current: { id: "cotton_wheat", years: template("cotton_wheat").years },
      priorities: { water_saving: 1, soil_health: 1, forage: 1, income_market: 1, low_risk: 1, simplicity: 1 },
      reliability: "sometimes_short",
      farmer: { mode: "irrigated", irrigation: "furrow", waterAllocationM3PerHa: null, requiredShare: null, unavailableCrops: [], marketRating: {} },
      soilTest: { ece: null, ph: null },
    });
    expect(analysis.satellite).toBeNull();
    expect(analysis.ranking.current?.evaluation.id).toBe("cotton_wheat");
  });
});
