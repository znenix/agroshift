/**
 * Climate-cell map layers (SPEC §6, Phase 4): heat days, frost-free days, aridity and the rain trend
 * from public/data/grid.json. Class breaks are fixed and documented; colours are the validated
 * one-hue blue ramp (sequential) and a blue/red pair with a grey "no clear trend" class.
 */
import type { GridFile } from "./datafiles";
import type { MessageKey } from "./i18n";

export type GridLayerId = "heat_days" | "frost_free" | "aridity" | "rain_trend";

export interface LayerClass {
  color: string;
  /** Inclusive lower bound (null = open). */
  from: number | null;
  /** Exclusive upper bound (null = open). */
  to: number | null;
  /** For categorical classes (rain trend) instead of a numeric range. */
  label?: MessageKey;
}

export interface GridLayer {
  id: GridLayerId;
  title: MessageKey;
  unit: MessageKey | null;
  classes: LayerClass[];
}

/** Dataviz reference sequential blue ramp, steps 150 → 650 (light = little, dark = much). */
const BLUE = ["#b7d3f6", "#86b6ef", "#5598e7", "#256abf", "#104281"] as const;

function ranges(breaks: readonly number[]): LayerClass[] {
  return BLUE.map((color, i) => ({ color, from: i === 0 ? null : (breaks[i - 1] ?? null), to: i === BLUE.length - 1 ? null : (breaks[i] ?? null) }));
}

export const GRID_LAYERS: readonly GridLayer[] = [
  // ASSUMPTION breaks: days per year with Tmax ≥ 35 °C (regional air temperature).
  { id: "heat_days", title: "map.layer.heat_days", unit: "unit.heat_days", classes: ranges([10, 30, 60, 90]) },
  // ASSUMPTION breaks: frost-free season length in days.
  { id: "frost_free", title: "map.layer.frost_free", unit: "unit.frost_free_days", classes: ranges([180, 200, 220, 240]) },
  // UNEP aridity classes (P/ET0): hyper-arid < 0.05, arid < 0.2, semi-arid < 0.5, dry sub-humid < 0.65.
  { id: "aridity", title: "map.layer.aridity", unit: null, classes: ranges([0.05, 0.2, 0.5, 0.65]) },
  {
    id: "rain_trend",
    title: "map.layer.rain_trend",
    unit: null,
    classes: [
      { color: "#e34948", from: null, to: null, label: "map.trend.falling" },
      { color: "#d6d2c8", from: null, to: null, label: "map.trend.none" },
      { color: "#2a78d6", from: null, to: null, label: "map.trend.rising" },
    ],
  },
];

const TREND_CODE = { falling: 0, no_clear_trend: 1, rising: 2 } as const;
const HALF_LAT = 0.25;

/** Value of a cell for a layer; `null` when the cell has no indicator (left uncoloured). */
export function cellValue(cell: GridFile["cells"][number], layer: GridLayerId): number | null {
  const ind = cell.indicators;
  if (ind === null) return null;
  switch (layer) {
    case "heat_days":
      return ind.heat_days_35;
    case "frost_free":
      return ind.frost_free_days;
    case "aridity":
      return ind.aridity;
    case "rain_trend":
      return ind.rain_trend === null ? null : TREND_CODE[ind.rain_trend.direction];
  }
}

/** Index of the class a value falls in. */
export function classOf(layer: GridLayer, value: number): number {
  if (layer.id === "rain_trend") return value;
  const i = layer.classes.findIndex((c) => (c.from === null || value >= c.from) && (c.to === null || value < c.to));
  return i < 0 ? layer.classes.length - 1 : i;
}

export interface CellFeature {
  type: "Feature";
  properties: { id: string; value: number; cls: number; color: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

/** Grid cells as rectangles (0.5° × 0.625° POWER cells), coloured by class; cells without a value are left out. */
export function gridFeatures(grid: GridFile, layer: GridLayer): { type: "FeatureCollection"; features: CellFeature[] } {
  const halfLon = grid.grid.lon_step / 2;
  const halfLat = grid.grid.lat_step / 2 || HALF_LAT;
  const features: CellFeature[] = [];
  for (const cell of grid.cells) {
    const value = cellValue(cell, layer.id);
    if (value === null) continue;
    const cls = classOf(layer, value);
    const { lat, lon } = cell;
    features.push({
      type: "Feature",
      properties: { id: cell.id, value, cls, color: layer.classes[cls]?.color ?? "#d6d2c8" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon - halfLon, lat - halfLat],
            [lon + halfLon, lat - halfLat],
            [lon + halfLon, lat + halfLat],
            [lon - halfLon, lat + halfLat],
            [lon - halfLon, lat - halfLat],
          ],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}
