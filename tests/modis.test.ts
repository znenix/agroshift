import { describe, expect, it } from "vitest";
import {
  chunkDates,
  classMask,
  compositeMedian,
  contiguousRuns,
  ndviComposites,
  ndviFromRaw,
  pixelAt,
  pixelCentre,
  summarizeClasses,
  windowValues,
  type OrnlSubset,
  type PixelGrid,
} from "@/lib/modis";

const grid3: PixelGrid = { xll: 0, yll: 0, cellsize: 10, nrows: 3, ncols: 3 };

function subset(band: string, dates: string[], data: number[][], grid: PixelGrid = { xll: 0, yll: 0, cellsize: 1, nrows: 1, ncols: 3 }): OrnlSubset {
  return {
    xllcorner: grid.xll,
    yllcorner: grid.yll,
    cellsize: grid.cellsize,
    nrows: grid.nrows,
    ncols: grid.ncols,
    band,
    units: "",
    scale: "0.0001",
    latitude: 0,
    longitude: 0,
    header: "synthetic",
    subset: dates.map((d, i) => ({ modis_date: `A${d.slice(0, 4)}001`.replace("001", String(i + 1).padStart(3, "0")), calendar_date: d, band, tile: "h00v00", proc_date: "0", data: data[i] ?? [] })),
  };
}

describe("ORNL subset geometry (SPEC §3.2)", () => {
  it("puts row 0 at the northern edge (verified by a one-pixel shift test, 2026-11-14)", () => {
    expect(pixelCentre(grid3, 0, 0)).toEqual({ x: 5, y: 25 });
    expect(pixelCentre(grid3, 2, 2)).toEqual({ x: 25, y: 5 });
    expect(pixelAt(grid3, 5, 25)).toEqual({ row: 0, col: 0 });
    expect(pixelAt(grid3, 29, 1)).toEqual({ row: 2, col: 2 });
    expect(pixelAt(grid3, 31, 1)).toBeNull();
  });

  it("maps 250 m pixels to the 500 m land-cover pixels that contain them", () => {
    // Same lower-left corner, as ORNL returns for a ±1 km window: 9×9 at 1 unit vs 5×5 at 2 units.
    const ndviGrid: PixelGrid = { xll: 0, yll: 0, cellsize: 1, nrows: 9, ncols: 9 };
    const lcGrid: PixelGrid = { xll: 0, yll: 0, cellsize: 2, nrows: 5, ncols: 5 };
    const lc = Array.from({ length: 25 }, (_, i) => (i < 5 ? 12 : 10)); // only the top row is cropland
    const mask = classMask(ndviGrid, lcGrid, lc, [12, 14]);
    expect(mask.slice(0, 9).every(Boolean)).toBe(true);
    expect(mask.slice(9).some(Boolean)).toBe(false);
  });

  it("splits date lists into requests of at most 10", () => {
    expect(chunkDates(Array.from({ length: 23 }, (_, i) => i)).map((c) => c.length)).toEqual([10, 10, 3]);
  });

  it("requests only runs of consecutive composites (a range is answered with every composite inside it)", () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ modis_date: `A2025${String(i * 16 + 1).padStart(3, "0")}` }));
    const pick = (...indices: number[]) => indices.map((i) => all[i] ?? { modis_date: "" });
    const runs = contiguousRuns(all, pick(9, 0, 1, 2, 3, 6, 7, 8, 10, 11), 3);
    expect(runs.map((run) => run.map((d) => all.indexOf(d)))).toEqual([[0, 1, 2], [3], [6, 7, 8], [9, 10, 11]]);
    expect(contiguousRuns(all, [{ modis_date: "A1999001" }])).toEqual([]);
  });
});

describe("land cover", () => {
  it("finds the majority class, ignores fill (255) and reports ties as no majority", () => {
    expect(summarizeClasses([12, 12, 10, 255, 255])).toMatchObject({ majority: 12, majorityCount: 2, total: 3 });
    expect(summarizeClasses([12, 10]).majority).toBeNull();
    expect(summarizeClasses([]).majority).toBeNull();
  });

  it("returns a full window or nothing", () => {
    const data = Array.from({ length: 9 }, (_, i) => i);
    expect(windowValues(grid3, data, 1, 1, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(windowValues(grid3, data, 0, 1, 1)).toBeNull();
  });
});

describe("NDVI composites", () => {
  it("scales NDVI and drops the fill value and out-of-range values", () => {
    expect(ndviFromRaw(6543)).toBeCloseTo(0.6543, 6);
    expect(ndviFromRaw(-3000)).toBeNull();
    expect(ndviFromRaw(10001)).toBeNull();
  });

  it("takes the median of reliable (0–1), unmasked, valid pixels", () => {
    const ndvi = [5000, 6000, 7000, 8000, -3000, 9000];
    const reliability = [0, 1, 0, 2, 0, -1];
    expect(compositeMedian(ndvi, reliability, null)).toEqual({ ndvi: 0.6, n: 3 });
    expect(compositeMedian(ndvi, reliability, [false, true, true, true, true, true])).toEqual({ ndvi: 0.65, n: 2 });
    expect(compositeMedian([1000], [3], null)).toEqual({ ndvi: null, n: 0 });
  });

  it("pairs NDVI with reliability by composite and sorts by date", () => {
    const dates = ["2025-07-28", "2025-07-12"];
    const ndvi = subset("250m_16_days_NDVI", dates, [[7000, 7200, 7400], [5000, 5000, 5000]]);
    const rel = subset("250m_16_days_pixel_reliability", dates, [[0, 0, 0], [0, 3, 3]]);
    expect(ndviComposites([ndvi], [rel], null)).toEqual([
      { date: "2025-07-12", ndvi: 0.5, n: 1 },
      { date: "2025-07-28", ndvi: 0.72, n: 3 },
    ]);
  });
});
