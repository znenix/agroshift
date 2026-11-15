/** Decorative field palette (visual only; no data). */
export const FIELD = {
  deepGreen: "#1f3d2b",
  fieldGreen: "#4f7a3a",
  lightGreen: "#a8c686",
  wheatGold: "#d9b44a",
  sand: "#f4efe4",
  sky: "#bcd9ea",
} as const;

/** Linear mix of two #rrggbb colours (t = share of b). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const k = Math.min(1, Math.max(0, t));
  const c = [1, 3, 5].map((i) => Math.round(p(a, i) * (1 - k) + p(b, i) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const DRY_BROWN = "#9c7a3c";
const HOT_SKY = "#f2d29b";

/**
 * Step 5 backdrop colours for a stress-test scenario (visual only). Dryness 0–1 reaches 1 at rain −30 %
 * (the "Dry year" preset); heat 0–1 reaches 1 at +2 °C (the "Hot" preset) and stays there above it.
 */
export function scenarioColours(deltaT: number, rainFactor: number) {
  const dry = Math.min(1, Math.max(0, (1 - rainFactor) / 0.3));
  const hot = Math.min(1, Math.max(0, deltaT / 2));
  return {
    dry,
    hot,
    rows: mixHex(FIELD.fieldGreen, DRY_BROWN, dry),
    between: mixHex(FIELD.lightGreen, FIELD.wheatGold, dry),
    sky: mixHex(FIELD.sky, HOT_SKY, hot),
  };
}
