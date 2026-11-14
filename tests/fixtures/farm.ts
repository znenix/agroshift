/**
 * A synthetic farm file (SPEC §4.2 format) built from the synthetic climate: a cotton-like NDVI season
 * (green June–September, bare otherwise). Validated with the real schema, so tests use the real decoder.
 */
import { dayOfYear } from "@/lib/water";
import { encodeSeries } from "@/lib/encode";
import { CLIMATE_ENCODING, farmFileSchema, type FarmFile } from "@/lib/datafiles";
import { syntheticClimate } from "./synthetic";

const names = { uz: "Sinov", ru: "Тест", en: "Test" };

export function syntheticFarm(): FarmFile {
  const climate = syntheticClimate();
  const first = Number(climate.dates[0]?.slice(0, 4));
  const last = Number(climate.dates.at(-1)?.slice(0, 4));
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const months = years.length * 12;
  const composites = years
    .filter((y) => y >= 2016 && y <= 2025)
    .flatMap((y) =>
      Array.from({ length: 23 }, (_, k) => {
        const date = new Date(Date.UTC(y, 0, 1 + 16 * k)).toISOString().slice(0, 10);
        const doy = dayOfYear(date);
        return { date, ndvi: doy >= 161 && doy <= 273 ? 0.7 : 0.15, n: 10 };
      }),
    );
  return farmFileSchema.parse({
    version: 1,
    id: "synthetic",
    region: "UZ-QR",
    names,
    city: { names, lat: 41, lon: 60 },
    point: { lat: 41, lon: 60, distance_km: 5 },
    selection: { reason: "synthetic test farm", selected_on: "2026-11-14" },
    climate: {
      cell: { id: "y262x384", lat: 41, lon: 60 },
      start: climate.dates[0],
      end: climate.dates.at(-1),
      days: climate.dates.length,
      encoding: CLIMATE_ENCODING,
      daily: { tmax_c: encodeSeries(climate.tmax), tmin_c: encodeSeries(climate.tmin), precip_mm: encodeSeries(climate.precip) },
      monthly: { start: `${first}-01`, wind_ms: Array.from({ length: months }, () => 2), gwetroot: Array.from({ length: months }, () => 0.3) },
      years: years.map((year) => ({
        year,
        days: year % 4 === 0 ? 366 : 365,
        complete: true,
        excluded: false,
        missing: { tmax_c: 0, tmin_c: 0, precip_mm: 0, wind_ms: 0, gwetroot: 0 },
      })),
      units: { tmax_c: "°C", tmin_c: "°C", precip_mm: "mm/day", wind_ms: "m/s", gwetroot: "1" },
      power: { api_version: "test", upstream: ["synthetic"], time_standard: "LST" },
    },
    ndvi: {
      product: "MOD13Q1",
      window_km: 1,
      pixels: 81,
      cropland_pixels: 81,
      mask_land_cover_year: 2024,
      period: { start: "2016-01-01", end: "2025-12-31" },
      composites,
    },
    land_cover: { product: "MCD12Q1", year: 2024, majority_class: 12, majority_class_name: "Croplands", majority_share: 1, counts: { "12": 81 } },
    soil: { depth: "0-30 cm", status: "modelled", ph_h2o: 7.8, soc_g_kg: 8, clay_pct: 25, sand_pct: 30, silt_pct: 45, source: "soilgrids" },
    terrain: { elevation_m: 90, slope_pct: 0.5, slope_deg: 0.3, neighbour_distance_m: 100 },
    sources: [],
  });
}
