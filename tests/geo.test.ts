import { describe, expect, it } from "vitest";
import {
  haversineKm,
  latLonToSinusoidal,
  offsetMetres,
  pointInGeometry,
  powerCellByIndex,
  powerCellFor,
  powerCellsCovering,
  rectIntersectsGeometry,
  simplifyRing,
  sinusoidalToLatLon,
  type AreaGeometry,
  type Position,
} from "@/lib/geo";

const square = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

const donut: AreaGeometry = { type: "Polygon", coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)] };

describe("geometry", () => {
  it("measures great-circle distance", () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.195, 3);
    expect(haversineKm({ lat: 41, lon: 69 }, offsetMetres({ lat: 41, lon: 69 }, 300, -400)) * 1000).toBeCloseTo(500, 0);
  });

  it("tests points against polygons with holes and multipolygons", () => {
    expect(pointInGeometry({ lon: 2, lat: 2 }, donut)).toBe(true);
    expect(pointInGeometry({ lon: 5, lat: 5 }, donut)).toBe(false);
    expect(pointInGeometry({ lon: 11, lat: 5 }, donut)).toBe(false);
    const two: AreaGeometry = { type: "MultiPolygon", coordinates: [[square(0, 0, 1, 1)], [square(5, 5, 6, 6)]] };
    expect(pointInGeometry({ lon: 5.5, lat: 5.5 }, two)).toBe(true);
    expect(pointInGeometry({ lon: 3, lat: 3 }, two)).toBe(false);
  });

  it("finds every rectangle that touches a polygon, including a thin crossing sliver", () => {
    const sliver: AreaGeometry = { type: "Polygon", coordinates: [[[-1, 0.49], [3, 0.49], [3, 0.51], [-1, 0.51], [-1, 0.49]]] };
    expect(rectIntersectsGeometry({ west: 1, south: 0, east: 2, north: 1 }, sliver)).toBe(true);
    expect(rectIntersectsGeometry({ west: 1, south: 0.6, east: 2, north: 1 }, sliver)).toBe(false);
    expect(rectIntersectsGeometry({ west: 4.5, south: 4.5, east: 5.5, north: 5.5 }, donut)).toBe(false);
    expect(rectIntersectsGeometry({ west: -5, south: -5, east: 20, north: 20 }, donut)).toBe(true);
  });

  it("maps points to POWER's native 0.5° × 0.625° cells (edges verified against the API, 2026-11-14)", () => {
    expect(powerCellFor({ lat: 42.46, lon: 59.68 }).id).toBe("y265x383");
    expect(powerCellFor({ lat: 42.46, lon: 59.7 }).id).toBe("y265x384");
    expect([42.24, 42.26, 42.74, 42.76].map((lat) => powerCellFor({ lat, lon: 59.4 }).id)).toEqual([
      "y264x383",
      "y265x383",
      "y265x383",
      "y266x383",
    ]);
    expect(powerCellByIndex(265, 383)).toMatchObject({ lat: 42.5, lon: 59.375 });
  });

  it("lists the native cells that overlap an area", () => {
    const inOneCell: AreaGeometry = { type: "Polygon", coordinates: [square(59.2, 42.3, 59.3, 42.4)] };
    expect(powerCellsCovering(inOneCell).map((c) => c.id)).toEqual(["y265x383"]);
    const acrossEdge: AreaGeometry = { type: "Polygon", coordinates: [square(59.6, 42.3, 59.8, 42.4)] };
    expect(powerCellsCovering(acrossEdge).map((c) => c.id)).toEqual(["y265x383", "y265x384"]);
  });

  it("simplifies rings without breaking them", () => {
    const noisy: Position[] = [[0, 0], [5, 0.001], [10, 0], [10, 10], [5, 10.001], [0, 10], [0, 0]];
    const simplified = simplifyRing(noisy, 0.01);
    expect(simplified).toHaveLength(5);
    expect(simplified?.[0]).toEqual(simplified?.at(-1));
  });

  it("round-trips the MODIS sinusoidal projection", () => {
    const { x, y } = latLonToSinusoidal({ lat: 42.33, lon: 59.45 });
    const back = sinusoidalToLatLon(x, y);
    expect(back.lat).toBeCloseTo(42.33, 9);
    expect(back.lon).toBeCloseTo(59.45, 9);
  });
});
