/** Schemas and loaders for the committed source files in data/ and the raw boundary files. */
import path from "node:path";
import { z } from "zod";
import type { AreaGeometry, Position } from "@/lib/geo";
import { DATA_DIR, readJson, writeJsonAtomic } from "./io";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const regionIdSchema = z.string().regex(/^UZ-[A-Z]{2}$/);
export const localizedNameSchema = z.object({ uz: z.string().min(1), ru: z.string().min(1), en: z.string().min(1) });

export const demoPointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  distance_km: z.number(),
  land_cover: z.object({
    product: z.literal("MCD12Q1"),
    year: z.number().int(),
    majority_class: z.number().int(),
    majority_share: z.number(),
  }),
  summer_ndvi: z.object({ peak: z.number(), peak_date: isoDate, years: z.array(z.number().int()) }),
  candidates: z.object({
    pixels_in_radius: z.number().int(),
    cropland_candidates: z.number().int(),
    ndvi_checked: z.number().int(),
  }),
  reason: z.string(),
  selected_on: isoDate,
});
export type DemoPoint = z.infer<typeof demoPointSchema>;

export const regionsSourceSchema = z.object({
  about: z.string(),
  regions: z.array(z.object({ id: regionIdSchema, names: localizedNameSchema })).length(14),
  demo_farms: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z]+$/),
        region: regionIdSchema,
        names: localizedNameSchema,
        city: z.object({ names: localizedNameSchema, lat: z.number(), lon: z.number() }),
        /** Default answer of the demo farmer: the rotation id the demo starts from. */
        demo_rotation: z.string().regex(/^[a-z_]+$/),
        point: demoPointSchema.nullable(),
      }),
    )
    .length(6),
});
export type RegionsSource = z.infer<typeof regionsSourceSchema>;
export type DemoFarmSource = RegionsSource["demo_farms"][number];

export const REGIONS_SOURCE_FILE = path.join(DATA_DIR, "regions.json");

export const loadRegionsSource = () => readJson(REGIONS_SOURCE_FILE, regionsSourceSchema);
export const saveRegionsSource = (source: RegionsSource) => writeJsonAtomic(REGIONS_SOURCE_FILE, source, true);

const shareSchema = z.number().min(0).max(100).nullable();
export const salinitySourceSchema = z.object({
  about: z.string(),
  classes: z.tuple([z.literal("none"), z.literal("slight"), z.literal("moderate"), z.literal("strong")]),
  regions: z.array(
    z.object({
      region: regionIdSchema,
      year: z.number().int().nullable(),
      shares_pct: z.object({ none: shareSchema, slight: shareSchema, moderate: shareSchema, strong: shareSchema }),
      source: z.string().min(1).nullable(),
    }),
  ),
});

const optionalValue = z.number().nullable();
export const soilFallbackSourceSchema = z.object({
  about: z.string(),
  regions: z.array(
    z.object({
      region: regionIdSchema,
      ph_h2o: optionalValue,
      soc_g_kg: optionalValue,
      clay_pct: optionalValue,
      sand_pct: optionalValue,
      silt_pct: optionalValue,
      source: z.string().min(1).nullable(),
    }),
  ),
});

/** data/raw/farms/{id}/meta.json: the point the raw files belong to and the farm's NDVI period start. */
export const farmRawMetaSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  ndvi_start: isoDate.optional(),
});

// ── Raw geoBoundaries files ──────────────────────────────────────────────────

export const geoBoundariesMetaSchema = z.object({
  boundaryID: z.string(),
  boundaryType: z.string(),
  boundarySource: z.string(),
  boundaryLicense: z.string(),
  buildDate: z.string(),
  gjDownloadURL: z.string().min(1),
  simplifiedGeometryGeoJSON: z.string().min(1),
});

const rawPosition = z.array(z.number()).min(2);
const rawPolygon = z.array(z.array(rawPosition));
export const boundaryCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      properties: z.object({ shapeName: z.string(), shapeISO: z.string(), shapeType: z.string() }),
      geometry: z.discriminatedUnion("type", [
        z.object({ type: z.literal("Polygon"), coordinates: rawPolygon }),
        z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(rawPolygon) }),
      ]),
    }),
  ),
});
export type BoundaryCollection = z.infer<typeof boundaryCollectionSchema>;

export function toAreaGeometry(geometry: BoundaryCollection["features"][number]["geometry"]): AreaGeometry {
  const ring = (positions: number[][]): Position[] => positions.map((p) => [p[0] ?? NaN, p[1] ?? NaN] as const);
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map((polygon) => polygon.map(ring)) };
}
