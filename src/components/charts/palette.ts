/**
 * Chart colours as hex (SVG attributes). Mirrors the @theme tokens in src/app/globals.css, which were
 * validated with the dataviz palette script against the page surface. Slots are fixed per entity.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"] as const;

export const CHART = {
  grid: "#e6e1d4",
  ink: "#1c1f1a",
  muted: "#4a5446",
  /** Context series (e.g. the whole NDVI record behind the recent years). */
  context: "#8c8778",
  surface: "#fbf8f1",
  bare: "#b9ab8a",
} as const;

export function seriesColor(slot: number): string {
  return SERIES[slot - 1] ?? CHART.context;
}
