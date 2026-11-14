import { describe, expect, it } from "vitest";
import { slopeFromElevations, slopeSamplePoints } from "@/lib/elevation";
import { haversineKm } from "@/lib/geo";
import { soilGridsUrl, topsoilValues, type SoilGridsResponse } from "@/lib/soil";

function layer(name: string, dFactor: number, unit: string, values: Array<number | null>) {
  const ranges = [
    ["0-5cm", 0, 5],
    ["5-15cm", 5, 15],
    ["15-30cm", 15, 30],
  ] as const;
  return {
    name,
    unit_measure: { d_factor: dFactor, mapped_units: "", target_units: unit },
    depths: ranges.map(([label, top, bottom], i) => ({
      label,
      range: { top_depth: top, bottom_depth: bottom, unit_depth: "cm" },
      values: { mean: values[i] ?? null },
    })),
  };
}

const response: SoilGridsResponse = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [59.45, 42.33] },
  properties: {
    layers: [
      layer("phh2o", 10, "-", [70, 75, 80]),
      layer("soc", 10, "g/kg", [120, 90, 60]),
      layer("clay", 10, "%", [200, 250, 300]),
      layer("sand", 10, "%", [300, 300, 300]),
      layer("silt", 10, "%", [500, null, 400]),
    ],
  },
};

describe("SoilGrids topsoil (SPEC §3.3)", () => {
  it("weights layers by thickness over 0–30 cm and divides by d_factor", () => {
    const t = topsoilValues(response);
    expect(t.phh2o).toEqual({ value: 7.67, unit: "-" }); // (5·70 + 10·75 + 15·80) / 30 / 10
    expect(t.soc).toEqual({ value: 8, unit: "g/kg" });
    expect(t.clay).toEqual({ value: 26.67, unit: "%" });
    expect(t.sand).toEqual({ value: 30, unit: "%" });
  });

  it("returns null instead of a partial mean when a layer is missing", () => {
    expect(topsoilValues(response).silt).toEqual({ value: null, unit: "%" });
  });

  it("asks for the 3 topsoil layers of the 5 properties", () => {
    const url = soilGridsUrl({ lat: 42.33, lon: 59.45 });
    expect(url).toContain("property=phh2o&property=soc&property=clay&property=sand&property=silt");
    expect(url).toContain("depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean");
  });
});

describe("slope from 4 neighbours", () => {
  it("uses central differences", () => {
    expect(slopeFromElevations({ centre: 101, north: 50, south: 50, east: 102, west: 100 })).toEqual({ slopePct: 1, slopeDeg: 0.57 });
    expect(slopeFromElevations({ centre: 75, north: 75, south: 75, east: 75, west: 75 })).toEqual({ slopePct: 0, slopeDeg: 0 });
  });

  it("samples points 100 m away in each direction", () => {
    const [centre, north, , east] = slopeSamplePoints({ lat: 42.33, lon: 59.45 });
    expect(centre).toBeDefined();
    if (centre === undefined || north === undefined || east === undefined) return;
    expect(haversineKm(centre, north) * 1000).toBeCloseTo(100, 0);
    expect(haversineKm(centre, east) * 1000).toBeCloseTo(100, 0);
    expect(north.lat).toBeGreaterThan(centre.lat);
    expect(east.lon).toBeGreaterThan(centre.lon);
  });
});
