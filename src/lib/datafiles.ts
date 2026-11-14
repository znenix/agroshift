/**
 * Schemas of the static files in public/data/ (SPEC §4.2). build-data validates every file before
 * writing it, check-demo validates them again, and the app validates what it loads.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/);
const int = z.number().int();

export const regionIdSchema = z.string().regex(/^UZ-[A-Z]{2}$/);
export const localizedNameSchema = z.object({ uz: z.string().min(1), ru: z.string().min(1), en: z.string().min(1) });

export const sourceIdSchema = z.enum([
  "nasa-power",
  "modis-ornl",
  "soilgrids",
  "copernicus-dem",
  "geoboundaries",
  "team-salinity",
  "team-soil",
]);
export type SourceId = z.infer<typeof sourceIdSchema>;

export const sourceRefSchema = z.object({
  id: sourceIdSchema,
  /** Short label for the UI source chip (SPEC §3). */
  label: z.string(),
  citation: z.string(),
  url: z.string(),
  retrieved: isoDate.nullable(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/** Daily series: value × 10, rounded, little-endian Int16, base64; −32768 = missing (src/lib/encode.ts). */
export const CLIMATE_ENCODING = "int16le-x10-base64";

const yearMissingSchema = z.object({ tmax_c: int, tmin_c: int, precip_mm: int, wind_ms: int, gwetroot: int });

export const climateSchema = z.object({
  /** The native POWER cell whose values these are (SPEC §4.1). */
  cell: z.object({ id: z.string(), lat: z.number(), lon: z.number() }),
  start: isoDate,
  end: isoDate,
  days: int.positive(),
  encoding: z.literal(CLIMATE_ENCODING),
  daily: z.object({ tmax_c: z.string(), tmin_c: z.string(), precip_mm: z.string() }),
  /** Means of complete calendar months; `null` where more than 10 % of days are missing. */
  monthly: z.object({
    start: isoMonth,
    wind_ms: z.array(z.number().nullable()),
    gwetroot: z.array(z.number().nullable()),
  }),
  /** Missing days per year; `excluded` years (> 10 % missing) are left out of statistics (SPEC §3.1). */
  years: z.array(z.object({ year: int, days: int, complete: z.boolean(), excluded: z.boolean(), missing: yearMissingSchema })),
  units: z.object({ tmax_c: z.string(), tmin_c: z.string(), precip_mm: z.string(), wind_ms: z.string(), gwetroot: z.string() }),
  power: z.object({ api_version: z.string(), upstream: z.array(z.string()), time_standard: z.string() }),
});
export type ClimateData = z.infer<typeof climateSchema>;

export const ndviSchema = z.object({
  product: z.literal("MOD13Q1"),
  window_km: z.number(),
  /** Pixels in the window and how many of them are cropland-like (MCD12Q1 class 12 or 14). */
  pixels: int,
  cropland_pixels: int,
  mask_land_cover_year: int,
  /**
   * Period of the NDVI record. Full record from 2006 for some farms; from 2016 for farms fetched after
   * the team decision of 2026-11-14 to save time — seasonal curves and trends must use this period.
   */
  period: z.object({ start: isoDate, end: isoDate }),
  /** One entry per 16-day composite (start date): median NDVI of reliable cropland pixels, `n` pixels used. */
  composites: z.array(z.object({ date: isoDate, ndvi: z.number().nullable(), n: int })),
});

export const landCoverSchema = z.object({
  product: z.literal("MCD12Q1"),
  year: int,
  majority_class: int.nullable(),
  majority_class_name: z.string().nullable(),
  majority_share: z.number(),
  counts: z.record(z.string(), int),
});

const soilValue = z.number().nullable();
export const soilSchema = z.object({
  depth: z.literal("0-30 cm"),
  /** modelled = SoilGrids; estimated = team fallback table; unknown = information gap. */
  status: z.enum(["modelled", "estimated", "unknown"]),
  ph_h2o: soilValue,
  soc_g_kg: soilValue,
  clay_pct: soilValue,
  sand_pct: soilValue,
  silt_pct: soilValue,
  source: z.enum(["soilgrids", "team-soil"]).nullable(),
});

export const terrainSchema = z.object({
  elevation_m: z.number(),
  slope_pct: z.number(),
  slope_deg: z.number(),
  neighbour_distance_m: z.number(),
});

export const farmFileSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  region: regionIdSchema,
  names: localizedNameSchema,
  city: z.object({ names: localizedNameSchema, lat: z.number(), lon: z.number() }),
  point: z.object({ lat: z.number(), lon: z.number(), distance_km: z.number() }),
  selection: z.object({ reason: z.string(), selected_on: isoDate }),
  climate: climateSchema,
  ndvi: ndviSchema,
  land_cover: landCoverSchema,
  soil: soilSchema,
  terrain: terrainSchema,
  sources: z.array(sourceRefSchema),
});
export type FarmFile = z.infer<typeof farmFileSchema>;

/**
 * A field the engines can analyse: a demo farm, or a map point assembled from a climate cell and
 * /api/point. A point may lack land cover or terrain when an upstream request failed (information gap).
 */
export const siteFileSchema = farmFileSchema.extend({ land_cover: landCoverSchema.nullable(), terrain: terrainSchema.nullable() });
export type SiteFile = z.infer<typeof siteFileSchema>;

export const cellFileSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  lat: z.number(),
  lon: z.number(),
  climate: climateSchema,
  sources: z.array(sourceRefSchema),
});
export type CellFile = z.infer<typeof cellFileSchema>;

/** Map-layer summary of one cell over the complete, non-excluded years 2006–2025 (SPEC §4.2). */
export const cellIndicatorsSchema = z.object({
  years: int,
  heat_days_35: z.number(),
  heat_days_40: z.number(),
  frost_free_days: z.number().nullable(),
  /** Annual precipitation / annual Hargreaves ET0. */
  aridity: z.number(),
  precip_mm: z.number(),
  /** Sen's slope with Mann–Kendall; `direction` is "no_clear_trend" unless p < 0.05. */
  rain_trend: z
    .object({ mm_per_decade: z.number(), p: z.number(), direction: z.enum(["rising", "falling", "no_clear_trend"]) })
    .nullable(),
});

export const gridFileSchema = z.object({
  version: z.literal(1),
  grid: z.object({ lat_step: z.number(), lon_step: z.number(), lat_origin: z.number(), lon_origin: z.number() }),
  period: z.object({ from: int, to: int }),
  cells: z.array(z.object({ id: z.string(), lat: z.number(), lon: z.number(), indicators: cellIndicatorsSchema.nullable() })),
});
export type GridFile = z.infer<typeof gridFileSchema>;

export const salinityClassSchema = z.enum(["none", "slight", "moderate", "strong"]);
const share = z.number().nullable();

export const regionsFileSchema = z.object({
  version: z.literal(1),
  regions: z.array(
    z.object({
      id: regionIdSchema,
      names: localizedNameSchema,
      salinity: z.object({
        /** estimated = from the team's regional table with a source; unknown = information gap (SPEC §3.4). */
        status: z.enum(["estimated", "unknown"]),
        dominant_class: salinityClassSchema.nullable(),
        shares_pct: z.object({ none: share, slight: share, moderate: share, strong: share }),
        year: int.nullable(),
        source: z.string().nullable(),
      }),
    }),
  ),
  demo_farms: z.array(
    z.object({
      id: z.string(),
      region: regionIdSchema,
      names: localizedNameSchema,
      city: localizedNameSchema,
      lat: z.number(),
      lon: z.number(),
      /** Default answer of the demo farmer (rotation id). */
      demo_rotation: z.string(),
      file: z.string(),
    }),
  ),
});
export type RegionsFile = z.infer<typeof regionsFileSchema>;

const position = z.tuple([z.number(), z.number()]);
export const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(position))),
});

export const boundariesFileSchema = z.object({
  version: z.literal(1),
  /** Douglas–Peucker tolerance in degrees used for this file. */
  tolerance_deg: z.number(),
  country: multiPolygonSchema,
  regions: z.array(z.object({ id: regionIdSchema, geometry: multiPolygonSchema })),
  source: sourceRefSchema,
});
export type BoundariesFile = z.infer<typeof boundariesFileSchema>;
