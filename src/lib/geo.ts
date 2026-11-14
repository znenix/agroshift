/**
 * Geometry: distances, polygons, POWER native cells and MODIS sinusoidal pixels.
 * Pure functions; coordinates in GeoJSON order ([lon, lat]) where arrays are used.
 */
import { MODIS_SPHERE_RADIUS_M, POWER_GRID } from "./constants";

export interface LatLon {
  lat: number;
  lon: number;
}

export type Position = readonly [number, number];
export type Ring = ReadonlyArray<Position>;
/** Outer ring first, then holes. */
export type PolygonCoords = ReadonlyArray<Ring>;
export type AreaGeometry =
  | { type: "Polygon"; coordinates: PolygonCoords }
  | { type: "MultiPolygon"; coordinates: ReadonlyArray<PolygonCoords> };

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Mean Earth radius (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Offsets a point by metres north and east (local flat approximation; fine below a few km). */
export function offsetMetres(p: LatLon, northM: number, eastM: number): LatLon {
  const R = EARTH_RADIUS_KM * 1000;
  return {
    lat: p.lat + toDeg(northM / R),
    lon: p.lon + toDeg(eastM / (R * Math.cos(toRad(p.lat)))),
  };
}

export function polygonsOf(geometry: AreaGeometry): ReadonlyArray<PolygonCoords> {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon (ray casting) with holes, for Polygon and MultiPolygon. */
export function pointInGeometry(p: LatLon, geometry: AreaGeometry): boolean {
  return polygonsOf(geometry).some(
    ([outer, ...holes]) =>
      outer !== undefined && pointInRing(p.lon, p.lat, outer) && !holes.some((h) => pointInRing(p.lon, p.lat, h)),
  );
}

export function geometryBBox(geometry: AreaGeometry): BBox {
  const box: BBox = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        box.west = Math.min(box.west, lon);
        box.east = Math.max(box.east, lon);
        box.south = Math.min(box.south, lat);
        box.north = Math.max(box.north, lat);
      }
    }
  }
  return box;
}

function cross(o: Position, a: Position, b: Position): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsIntersect(p1: Position, p2: Position, q1: Position, q2: Position): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when any part of the rectangle overlaps the geometry (exact for polygons vs. an axis-aligned box). */
export function rectIntersectsGeometry(rect: BBox, geometry: AreaGeometry): boolean {
  const corners: Position[] = [
    [rect.west, rect.south],
    [rect.east, rect.south],
    [rect.east, rect.north],
    [rect.west, rect.north],
  ];
  const centre = { lat: (rect.south + rect.north) / 2, lon: (rect.west + rect.east) / 2 };
  if (pointInGeometry(centre, geometry) || corners.some(([lon, lat]) => pointInGeometry({ lat, lon }, geometry))) {
    return true;
  }
  const edges = corners.map((corner, k) => [corner, corners[(k + 1) % 4]] as const);
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        if (a[0] >= rect.west && a[0] <= rect.east && a[1] >= rect.south && a[1] <= rect.north) return true;
        const b = ring[(i + 1) % ring.length];
        if (edges.some(([e1, e2]) => segmentsIntersect(a, b, e1, e2))) return true;
      }
    }
  }
  return false;
}

function perpendicularDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

/** Douglas–Peucker simplification of an open polyline. */
function simplifyLine(points: Ring, tolerance: number): Position[] {
  if (points.length <= 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = -1;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = simplifyLine(points.slice(0, index + 1), tolerance);
  const right = simplifyLine(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Simplifies a closed ring; returns `null` if it collapses below a valid ring (4 positions). */
export function simplifyRing(ring: Ring, tolerance: number): Position[] | null {
  if (ring.length < 4) return null;
  // Split at the vertex farthest from the start so a closed ring keeps its shape.
  const start = ring[0];
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++) {
    if (Math.hypot(ring[i][0] - start[0], ring[i][1] - start[1]) > Math.hypot(ring[far][0] - start[0], ring[far][1] - start[1])) {
      far = i;
    }
  }
  const firstHalf = simplifyLine(ring.slice(0, far + 1), tolerance);
  const secondHalf = simplifyLine(ring.slice(far), tolerance);
  const result = [...firstHalf.slice(0, -1), ...secondHalf];
  return result.length >= 4 ? result : null;
}

export function simplifyGeometry(geometry: AreaGeometry, tolerance: number, round = 4): AreaGeometry {
  const factor = 10 ** round;
  const roundPosition = ([lon, lat]: Position): Position => [
    Math.round(lon * factor) / factor,
    Math.round(lat * factor) / factor,
  ];
  const polygons: Position[][][] = [];
  for (const [outer, ...holes] of polygonsOf(geometry)) {
    if (outer === undefined) continue;
    const simplifiedOuter = simplifyRing(outer, tolerance);
    if (simplifiedOuter === null) continue;
    const simplifiedHoles = holes
      .map((h) => simplifyRing(h, tolerance))
      .filter((h): h is Position[] => h !== null);
    polygons.push([simplifiedOuter, ...simplifiedHoles].map((r) => r.map(roundPosition)));
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

// ── POWER native cells ───────────────────────────────────────────────────────

export interface PowerCell {
  id: string;
  latIndex: number;
  lonIndex: number;
  lat: number;
  lon: number;
  bounds: BBox;
}

export function powerCellByIndex(latIndex: number, lonIndex: number): PowerCell {
  const { latStep, lonStep, latOrigin, lonOrigin } = POWER_GRID;
  const lat = latOrigin + latStep * latIndex;
  const lon = lonOrigin + lonStep * lonIndex;
  return {
    id: `y${latIndex}x${lonIndex}`,
    latIndex,
    lonIndex,
    lat,
    lon,
    bounds: { west: lon - lonStep / 2, east: lon + lonStep / 2, south: lat - latStep / 2, north: lat + latStep / 2 },
  };
}

/** The native POWER cell that contains the point; POWER serves this cell's values for the point (SPEC §4.1). */
export function powerCellFor(p: LatLon): PowerCell {
  const { latStep, lonStep, latOrigin, lonOrigin } = POWER_GRID;
  return powerCellByIndex(Math.round((p.lat - latOrigin) / latStep), Math.round((p.lon - lonOrigin) / lonStep));
}

/** Every native cell that overlaps the geometry, ordered south→north, west→east. */
export function powerCellsCovering(geometry: AreaGeometry): PowerCell[] {
  const box = geometryBBox(geometry);
  const sw = powerCellFor({ lat: box.south, lon: box.west });
  const ne = powerCellFor({ lat: box.north, lon: box.east });
  const cells: PowerCell[] = [];
  for (let j = sw.latIndex; j <= ne.latIndex; j++) {
    for (let i = sw.lonIndex; i <= ne.lonIndex; i++) {
      const cell = powerCellByIndex(j, i);
      if (rectIntersectsGeometry(cell.bounds, geometry)) cells.push(cell);
    }
  }
  return cells;
}

// ── MODIS sinusoidal projection ──────────────────────────────────────────────

export function sinusoidalToLatLon(x: number, y: number): LatLon {
  const lat = y / MODIS_SPHERE_RADIUS_M;
  return { lat: toDeg(lat), lon: toDeg(x / (MODIS_SPHERE_RADIUS_M * Math.cos(lat))) };
}

export function latLonToSinusoidal(p: LatLon): { x: number; y: number } {
  const lat = toRad(p.lat);
  return { x: MODIS_SPHERE_RADIUS_M * toRad(p.lon) * Math.cos(lat), y: MODIS_SPHERE_RADIUS_M * lat };
}
