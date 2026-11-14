/** Elevation from Copernicus DEM via the Open-Meteo elevation API, and slope from 4 neighbours (SPEC §3). */
import { z } from "zod";
import { ELEVATION_URL, SLOPE_NEIGHBOUR_DISTANCE_M } from "./constants";
import { offsetMetres, type LatLon } from "./geo";

export const elevationResponseSchema = z.object({ elevation: z.array(z.number()) });

export function elevationUrl(points: readonly LatLon[]): string {
  const lat = points.map((p) => p.lat.toFixed(6)).join(",");
  const lon = points.map((p) => p.lon.toFixed(6)).join(",");
  return `${ELEVATION_URL}?latitude=${lat}&longitude=${lon}`;
}

export const SLOPE_SAMPLE_ORDER = ["centre", "north", "south", "east", "west"] as const;
export type SlopeSample = (typeof SLOPE_SAMPLE_ORDER)[number];

/** The point and its neighbours north, south, east and west, in SLOPE_SAMPLE_ORDER. */
export function slopeSamplePoints(point: LatLon, distanceM = SLOPE_NEIGHBOUR_DISTANCE_M): LatLon[] {
  return [
    point,
    offsetMetres(point, distanceM, 0),
    offsetMetres(point, -distanceM, 0),
    offsetMetres(point, 0, distanceM),
    offsetMetres(point, 0, -distanceM),
  ];
}

/** Slope by central differences: rise over run between opposite neighbours, 2·distance apart. */
export function slopeFromElevations(
  e: Readonly<Record<SlopeSample, number>>,
  distanceM = SLOPE_NEIGHBOUR_DISTANCE_M,
): { slopePct: number; slopeDeg: number } {
  const dzdx = (e.east - e.west) / (2 * distanceM);
  const dzdy = (e.north - e.south) / (2 * distanceM);
  const gradient = Math.hypot(dzdx, dzdy);
  return {
    slopePct: Math.round(gradient * 1000) / 10,
    slopeDeg: Math.round(((Math.atan(gradient) * 180) / Math.PI) * 100) / 100,
  };
}
