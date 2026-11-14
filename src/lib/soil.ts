/** SoilGrids v2.0 REST (SPEC §3.3): URL, response schema and the 0–30 cm thickness-weighted mean. */
import { z } from "zod";
import { SOIL_PROPERTIES, SOILGRIDS_QUERY_URL, TOPSOIL_LAYERS } from "./constants";
import type { LatLon } from "./geo";

export type SoilProperty = (typeof SOIL_PROPERTIES)[number];

export const soilGridsResponseSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({ type: z.literal("Point"), coordinates: z.array(z.number()).min(2) }),
  properties: z.object({
    layers: z.array(
      z.object({
        name: z.string(),
        unit_measure: z.object({ d_factor: z.number().positive(), mapped_units: z.string(), target_units: z.string() }),
        depths: z.array(
          z.object({
            label: z.string(),
            range: z.object({ top_depth: z.number(), bottom_depth: z.number(), unit_depth: z.string() }),
            values: z.object({ mean: z.number().nullable() }),
          }),
        ),
      }),
    ),
  }),
});
export type SoilGridsResponse = z.infer<typeof soilGridsResponseSchema>;

export function soilGridsUrl(point: LatLon): string {
  const properties = SOIL_PROPERTIES.map((p) => `property=${p}`).join("&");
  const depths = TOPSOIL_LAYERS.map((d) => `depth=${d.label}`).join("&");
  return `${SOILGRIDS_QUERY_URL}?lon=${point.lon.toFixed(6)}&lat=${point.lat.toFixed(6)}&${properties}&${depths}&value=mean`;
}

export interface TopsoilValue {
  /** 0–30 cm thickness-weighted mean in `unit`, or `null` if any layer is missing. */
  value: number | null;
  unit: string;
}

/**
 * 0–30 cm mean weighted by layer thickness (5, 10 and 15 cm), divided by the response's `d_factor`
 * to get conventional units (pH, g/kg, %). Any missing layer gives `null` rather than a partial mean.
 */
export function topsoilValues(response: SoilGridsResponse): Record<SoilProperty, TopsoilValue> {
  const valueFor = (property: SoilProperty): TopsoilValue => {
    const layer = response.properties.layers.find((l) => l.name === property);
    if (layer === undefined) return { value: null, unit: "" };
    let weighted = 0;
    for (const depth of TOPSOIL_LAYERS) {
      const value = layer.depths.find((d) => d.label === depth.label)?.values.mean;
      if (value === null || value === undefined) return { value: null, unit: layer.unit_measure.target_units };
      weighted += value * (depth.bottom - depth.top);
    }
    const thickness = TOPSOIL_LAYERS.reduce((sum, d) => sum + (d.bottom - d.top), 0);
    return {
      value: Math.round((weighted / thickness / layer.unit_measure.d_factor) * 100) / 100,
      unit: layer.unit_measure.target_units,
    };
  };
  return {
    phh2o: valueFor("phh2o"),
    soc: valueFor("soc"),
    clay: valueFor("clay"),
    sand: valueFor("sand"),
    silt: valueFor("silt"),
  };
}
