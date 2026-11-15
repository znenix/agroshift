/**
 * Field indicators (SPEC §5.5): traffic lights with a value, unit, status, explanation key, source and
 * confidence — never one composite "suitability score". Status colours are always paired with an icon
 * and text in the UI.
 */
import type { FieldProfile } from "./analysis";
import type { SoilConditions } from "./crops";
import type { SourceId } from "./datafiles";
import type { MessageKey } from "./i18n";
import type { Confidence } from "./rotations";
import type { TrendDirection } from "./trends";

export type IndicatorStatus = "good" | "watch" | "concern" | "unknown";

export interface Indicator {
  id: "water" | "heat" | "frost" | "extreme_rain" | "vegetation" | "ph" | "organic_carbon" | "texture" | "salinity" | "slope";
  value: number | null;
  /** Categorical values (texture class, salinity class) as a message key instead of a number. */
  valueKey: MessageKey | null;
  unit: MessageKey | null;
  status: IndicatorStatus;
  explanation: MessageKey;
  params: Readonly<Record<string, string | number>>;
  source: SourceId | "soil-test" | null;
  confidence: Confidence;
}

export type TextureClass =
  | "sand"
  | "loamy_sand"
  | "sandy_loam"
  | "loam"
  | "silt_loam"
  | "silt"
  | "sandy_clay_loam"
  | "clay_loam"
  | "silty_clay_loam"
  | "sandy_clay"
  | "silty_clay"
  | "clay";

/** USDA soil texture class from clay, sand and silt percentages (USDA NRCS texture triangle). */
export function textureClass(clay: number, sand: number, silt: number): TextureClass {
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 2 * clay < 30) return "loamy_sand";
  if ((clay >= 7 && clay < 20 && sand > 52) || (clay < 7 && silt < 50)) return "sandy_loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "silt_loam";
  if (silt >= 80 && clay < 12) return "silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy_clay_loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "clay_loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "silty_clay_loam";
  if (clay >= 35 && sand > 45) return "sandy_clay";
  if (clay >= 40 && silt >= 40) return "silty_clay";
  return "clay";
}

const VEGETATION_EXPLANATION: Readonly<Record<TrendDirection, MessageKey>> = {
  rising: "indicator.vegetation_rising",
  falling: "indicator.vegetation_falling",
  no_clear_trend: "indicator.vegetation_no_clear_trend",
};

const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Thresholds are ASSUMPTIONS unless noted: aridity classes follow UNEP (arid < 0.2, semi-arid 0.2–0.5);
 * heat > 60 days ≥ 35 °C is a concern; frost-free season < 180 days is a concern for cotton-type crops.
 */
export function fieldIndicators(profile: FieldProfile, soil: SoilConditions): Indicator[] {
  const a = profile.annual;
  const aridity = mean(a.map((y) => y.aridity));
  const heat = mean(a.map((y) => y.heatDays35));
  const frostFree = profile.frost.frostFreeDaysMean;
  const extreme = mean(a.map((y) => y.extremeRainDays));
  const ndvi = profile.trends.ndvi;
  const s = profile.farm.soil;
  const texture = s.clay_pct !== null && s.sand_pct !== null && s.silt_pct !== null ? textureClass(s.clay_pct, s.sand_pct, s.silt_pct) : null;
  const salinity = profile.salinity;
  const fromTest = soil.eceSource === "soil_test";
  const slope = profile.farm.terrain?.slope_pct ?? null;
  return [
    {
      id: "water",
      value: aridity === null ? null : round(aridity, 2),
      valueKey: null,
      unit: "unit.aridity",
      status: aridity === null ? "unknown" : aridity < 0.2 ? "concern" : aridity < 0.5 ? "watch" : "good",
      explanation: "indicator.water",
      params: { aridity: aridity === null ? "–" : round(aridity, 2) },
      source: "nasa-power",
      confidence: "medium",
    },
    {
      id: "heat",
      value: heat === null ? null : round(heat, 0),
      valueKey: null,
      unit: "unit.heat_days",
      status: heat === null ? "unknown" : heat > 60 ? "concern" : heat > 20 ? "watch" : "good",
      explanation: "indicator.heat",
      params: { days: heat === null ? "–" : round(heat, 0) },
      source: "nasa-power",
      confidence: "low",
    },
    {
      id: "frost",
      value: frostFree === null ? null : round(frostFree, 0),
      valueKey: null,
      unit: "unit.frost_free_days",
      status: frostFree === null ? "unknown" : frostFree < 180 ? "concern" : frostFree < 210 ? "watch" : "good",
      explanation: "indicator.frost",
      params: { days: frostFree === null ? "–" : round(frostFree, 0) },
      source: "nasa-power",
      confidence: "medium",
    },
    {
      id: "extreme_rain",
      value: extreme === null ? null : round(extreme, 1),
      valueKey: null,
      unit: "unit.heavy_rain_days",
      status: extreme === null ? "unknown" : extreme >= 3 ? "concern" : extreme >= 1 ? "watch" : "good",
      explanation: "indicator.extreme_rain",
      params: { days: extreme === null ? "–" : round(extreme, 1) },
      source: "nasa-power",
      confidence: "medium",
    },
    {
      id: "vegetation",
      value: ndvi === null ? null : round(ndvi.slope * 10, 3),
      valueKey: null,
      unit: "unit.ndvi_decade",
      status: ndvi === null ? "unknown" : ndvi.direction === "falling" ? "concern" : ndvi.direction === "rising" ? "good" : "watch",
      explanation: ndvi === null ? "indicator.vegetation_unknown" : VEGETATION_EXPLANATION[ndvi.direction],
      params: { from: profile.farm.ndvi.period.start.slice(0, 4), years: ndvi?.n ?? 0 },
      source: "modis-ornl",
      confidence: ndvi === null ? "low" : "medium",
    },
    {
      id: "ph",
      value: soil.ph,
      valueKey: null,
      unit: null,
      status: soil.ph === null ? "unknown" : soil.ph >= 6 && soil.ph <= 8.2 ? "good" : soil.ph <= 8.8 && soil.ph >= 5.5 ? "watch" : "concern",
      explanation: soil.ph === null ? "crop.gap.ph_unknown" : "indicator.ph",
      params: { ph: soil.ph ?? "–" },
      source: s.source === "team-soil" ? "team-soil" : "soilgrids",
      confidence: "low",
    },
    {
      id: "organic_carbon",
      value: s.soc_g_kg,
      valueKey: null,
      unit: "unit.g_kg",
      status: s.soc_g_kg === null ? "unknown" : s.soc_g_kg < 6 ? "concern" : s.soc_g_kg < 10 ? "watch" : "good",
      explanation: "indicator.organic_carbon",
      params: { soc: s.soc_g_kg ?? "–" },
      source: "soilgrids",
      confidence: "low",
    },
    {
      id: "texture",
      value: null,
      valueKey: texture === null ? null : `texture.${texture}`,
      unit: null,
      status: texture === null ? "unknown" : "good",
      explanation: "indicator.texture",
      params: { clay: s.clay_pct ?? "–", sand: s.sand_pct ?? "–", silt: s.silt_pct ?? "–" },
      source: "soilgrids",
      confidence: "low",
    },
    {
      id: "salinity",
      value: fromTest ? soil.ece : null,
      valueKey: !fromTest && salinity?.status === "estimated" && salinity.dominant_class !== null ? `salinity.${salinity.dominant_class}` : null,
      unit: fromTest ? "unit.ds_m" : null,
      status: fromTest
        ? (soil.ece ?? 0) < 2
          ? "good"
          : (soil.ece ?? 0) < 4
            ? "watch"
            : "concern"
        : salinity?.status !== "estimated"
          ? "unknown"
          : salinity.dominant_class === "none"
            ? "good"
            : salinity.dominant_class === "slight"
              ? "watch"
              : "concern",
      explanation: fromTest ? "indicator.salinity_test" : salinity?.status === "estimated" ? "indicator.salinity_regional" : "crop.gap.salinity_unknown",
      params: { ece: soil.ece ?? "–" },
      source: fromTest ? "soil-test" : salinity?.status === "estimated" ? "team-salinity" : null,
      confidence: fromTest ? "farmer" : "low",
    },
    {
      id: "slope",
      value: slope,
      valueKey: null,
      unit: "unit.pct",
      status: slope === null ? "unknown" : slope < 2 ? "good" : slope <= 8 ? "watch" : "concern",
      explanation: slope === null ? "indicator.slope_unknown" : "indicator.slope",
      params: { slope: slope ?? "–" },
      source: slope === null ? null : "copernicus-dem",
      confidence: slope === null ? "low" : "medium",
    },
  ];
}
