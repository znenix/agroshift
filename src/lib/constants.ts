/**
 * Fixed parameters, thresholds and coefficients (CLAUDE.md §3, SPEC §5).
 * Every value names its source, or says ASSUMPTION; the About page lists all assumptions.
 */

// ── Record period (SPEC §3.1) ────────────────────────────────────────────────
/** 20 complete years (2006–2025) plus the current year. */
export const RECORD_START = "2006-01-01";
export const CLIMATOLOGY_FIRST_YEAR = 2006;
export const CLIMATOLOGY_LAST_YEAR = 2025;

// ── NASA POWER (SPEC §3.1) ───────────────────────────────────────────────────
export const POWER_DAILY_POINT_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
export const POWER_COMMUNITY = "AG";
/** Requested as in SPEC §3.1. T2M stays in the raw files only: Tmean = (Tmax + Tmin) / 2 (FAO-56 eq. 9). */
export const POWER_PARAMETERS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "WS2M", "GWETROOT"] as const;
/** POWER fill value (response header `fill_value`). Fill values become `null` and are never averaged. */
export const POWER_FILL_VALUE = -999;
/** A year (or month) with more than 10 % missing days is excluded from statistics and flagged (SPEC §3.1). */
export const MAX_MISSING_SHARE = 0.1;
/**
 * POWER's native meteorology grid (MERRA-2): 0.5° latitude × 0.625° longitude, cell centres at
 * −90 + 0.5·j and −180 + 0.625·i. Verified against the API on 2026-11-14 (SPEC §4.1).
 */
export const POWER_GRID = { latStep: 0.5, lonStep: 0.625, latOrigin: -90, lonOrigin: -180 } as const;
export const POWER_SOURCE_LABEL = "NASA POWER (reanalysis, ~50 km)";

// ── MODIS via ORNL DAAC (SPEC §3.2) ──────────────────────────────────────────
export const ORNL_API_URL = "https://modis.ornl.gov/rst/api/v1";
/** The subset endpoint returns at most 10 dates per request (ORNL DAAC web service). */
export const ORNL_MAX_DATES_PER_REQUEST = 10;
/** Window half-size around the point: kmAboveBelow = kmLeftRight = 1 (SPEC §3.2). */
export const MODIS_WINDOW_KM = 1;
/** MOD13Q1 band metadata from the ORNL `/bands` endpoint; reliability ≤ 1 keeps "good" and "marginal" (SPEC §3.2). */
export const MOD13Q1 = {
  product: "MOD13Q1",
  ndviBand: "250m_16_days_NDVI",
  reliabilityBand: "250m_16_days_pixel_reliability",
  scale: 0.0001,
  fill: -3000,
  validMin: -2000,
  validMax: 10000,
  maxReliability: 1,
} as const;
export const MCD12Q1 = { product: "MCD12Q1", band: "LC_Type1" } as const;
/** LC_Type1 fill / unclassified value (MCD12Q1 Collection 6.1 user guide); never counted as a class. */
export const MCD12Q1_FILL = 255;
/**
 * Team decision 2026-11-14 (to save time on the slow ORNL service): demo farms whose MOD13Q1 series was
 * not yet downloaded fetch NDVI from this date only; farms already complete keep the record from
 * RECORD_START. The period is recorded per farm (raw meta.json and `ndvi.period` in the farm file).
 */
export const NDVI_SHORT_RECORD_START = "2016-01-01";
/** IGBP legend of MCD12Q1 LC_Type1 (MCD12Q1 Collection 6.1 user guide). */
export const IGBP_CLASSES: Readonly<Record<number, string>> = {
  1: "Evergreen needleleaf forests",
  2: "Evergreen broadleaf forests",
  3: "Deciduous needleleaf forests",
  4: "Deciduous broadleaf forests",
  5: "Mixed forests",
  6: "Closed shrublands",
  7: "Open shrublands",
  8: "Woody savannas",
  9: "Savannas",
  10: "Grasslands",
  11: "Permanent wetlands",
  12: "Croplands",
  13: "Urban and built-up lands",
  14: "Cropland/natural vegetation mosaics",
  15: "Permanent snow and ice",
  16: "Barren",
  17: "Water bodies",
};
/** IGBP 12 = croplands, 14 = cropland/natural mosaic (SPEC §3.2). */
export const CROPLAND_CLASSES: readonly number[] = [12, 14];
/** Sphere radius of the MODIS sinusoidal grid (MODIS land grid definition). */
export const MODIS_SPHERE_RADIUS_M = 6371007.181;
export const MODIS_SOURCE_LABEL = "NASA MODIS (satellite, 250 m)";

// ── Demo-farm selection (SPEC §4.1) ──────────────────────────────────────────
/** Candidates lie within 25 km of the city centre (SPEC §4.1). */
export const DEMO_SEARCH_RADIUS_KM = 25;
/** ASSUMPTION: "high summer NDVI" means a July–August composite median of at least 0.5 in a recent year. */
export const DEMO_SUMMER_NDVI_MIN = 0.5;
/** ASSUMPTION: summer = July and August composites. */
export const DEMO_SUMMER_MONTHS: readonly number[] = [7, 8];
/** ASSUMPTION: last 3 complete years; a field in a cotton–wheat rotation is green in at least one of them. */
export const DEMO_SUMMER_YEARS: readonly number[] = [2023, 2024, 2025];
/** ASSUMPTION: give up (and report) after this many cropland candidates fail the NDVI test. */
export const DEMO_MAX_NDVI_CANDIDATES = 30;
/**
 * ASSUMPTION: skip candidates within 1 km of one that already failed — their ±1 km windows mostly
 * overlap, so they would fail for the same reason. The search then moves outward, and "nearest"
 * is accurate to about 1 km.
 */
export const DEMO_SKIP_NEAR_REJECTED_KM = 1;

// ── SoilGrids v2.0 (SPEC §3.3) ───────────────────────────────────────────────
export const SOILGRIDS_QUERY_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";
export const SOIL_PROPERTIES = ["phh2o", "soc", "clay", "sand", "silt"] as const;
/** 0–30 cm as a thickness-weighted mean of the 0–5, 5–15 and 15–30 cm layers (SPEC §3.3). */
export const TOPSOIL_LAYERS: ReadonlyArray<{ label: string; top: number; bottom: number }> = [
  { label: "0-5cm", top: 0, bottom: 5 },
  { label: "5-15cm", top: 5, bottom: 15 },
  { label: "15-30cm", top: 15, bottom: 30 },
];
/** ISRIC fair-use policy for the beta REST API: about 5 requests per minute. */
export const SOILGRIDS_MIN_INTERVAL_MS = 12_500;
export const SOILGRIDS_SOURCE_LABEL = "SoilGrids (modelled, 250 m)";

// ── Elevation and slope (SPEC §3) ────────────────────────────────────────────
export const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
/**
 * ASSUMPTION: neighbours 100 m north, south, east and west of the point (about one cell of the
 * 90 m Copernicus GLO-90 DEM); slope by central differences over 200 m. Elevations are whole
 * metres, so slope resolution is 0.5 %.
 */
export const SLOPE_NEIGHBOUR_DISTANCE_M = 100;
export const ELEVATION_SOURCE_LABEL = "Copernicus DEM (non-NASA)";

// ── Water (SPEC §5.2) ────────────────────────────────────────────────────────
/** Solar constant, MJ m⁻² min⁻¹ (FAO-56 eq. 21). */
export const SOLAR_CONSTANT_MJ_M2_MIN = 0.082;
/** 1 MJ m⁻² day⁻¹ of radiation evaporates 0.408 mm day⁻¹ (FAO-56 eq. 20). */
export const MJ_TO_MM = 0.408;
/** Hargreaves (FAO-56 eq. 52): ET0 = 0.0023 · (Tmean + 17.8) · √(Tmax − Tmin) · Ra. */
export const HARGREAVES = { coefficient: 0.0023, offsetC: 17.8 } as const;
/**
 * Monthly effective rainfall (Brouwer & Heibloem 1986, FAO Irrigation Water Management Training
 * Manual 3): P > 75 mm → 0.8 P − 25, otherwise 0.6 P − 10, never below 0. (CROPWAT's "FAO/AGLW"
 * option uses a slightly different split: 0.6 P − 10 up to 70 mm, 0.8 P − 24 above.)
 */
export const EFFECTIVE_RAIN = {
  thresholdMm: 75,
  high: { slope: 0.8, intercept: -25 },
  low: { slope: 0.6, intercept: -10 },
} as const;
/** ASSUMPTION: typical field application efficiencies (furrow / sprinkler / drip); source to be confirmed by the team. */
export const IRRIGATION_EFFICIENCY = { furrow: 0.6, sprinkler: 0.75, drip: 0.9 } as const;
export type IrrigationMethod = keyof typeof IRRIGATION_EFFICIENCY;
/** 1 mm of water over one hectare is 10 m³. */
export const M3_PER_HA_PER_MM = 10;
/** The dry year is the 90th percentile of yearly irrigation need across the record (SPEC §5.2). */
export const DRY_YEAR_PERCENTILE = 0.9;

// ── Trends (SPEC §5.4) ───────────────────────────────────────────────────────
/** Mann–Kendall significance level: p < 0.05 (SPEC §5.4). */
export const TREND_ALPHA = 0.05;
/** ASSUMPTION: with fewer points the normal approximation of Mann–Kendall is too rough; no test is run. */
export const TREND_MIN_POINTS = 8;

// ── Climate statistics (SPEC §5.1) ───────────────────────────────────────────
/** A frost day has Tmin ≤ 0 °C (SPEC §5.1). */
export const FROST_TMIN_C = 0;
/** ASSUMPTION: crops with "light" frost tolerance are damaged only at Tmin ≤ −2 °C. */
export const LIGHT_FROST_TMIN_C = -2;
/** Extreme rain day: P ≥ 20 mm (SPEC §5.1). */
export const EXTREME_RAIN_MM = 20;
/** Heat days: Tmax ≥ 35 °C and Tmax ≥ 40 °C (SPEC §5.1). */
export const HEAT_DAY_THRESHOLDS_C = [35, 40] as const;
/** ASSUMPTION: "summer" for the summer-mean-Tmax trend is June–August (SPEC §5.4). */
export const SUMMER_MONTHS: readonly number[] = [6, 7, 8];

// ── Vegetation (SPEC §5.3) ───────────────────────────────────────────────────
/** A composite with NDVI below 0.2 counts as bare (SPEC §5.3). */
export const NDVI_BARE_MAX = 0.2;
/** ASSUMPTION: NDVI of at least 0.3 counts as clearly green; 0.2–0.3 is not judged. */
export const NDVI_GREEN_MIN = 0.3;
/** Growing season for the NDVI trend: April–September (SPEC §5.3). */
export const GROWING_SEASON_MONTHS: readonly number[] = [4, 5, 6, 7, 8, 9];
/** ASSUMPTION: a growing season needs at least 8 composites with a value to give a yearly mean. */
export const NDVI_MIN_SEASON_COMPOSITES = 8;
/** Seasonal curve "over the last 3 years" (SPEC §5.3). */
export const NDVI_RECENT_YEARS = 3;
/** ASSUMPTION: a satellite-vs-farmer mismatch is reported when it lasts at least 3 composites (~48 days). */
export const SATELLITE_MISMATCH_MIN_COMPOSITES = 3;
/** ASSUMPTION: the satellite check gives a verdict only when at least this many composites could be judged. */
export const SATELLITE_MIN_JUDGED_COMPOSITES = 8;
/** ASSUMPTION: crops resting in December–February can look bare from space, so "crop expected but bare" is not judged then. */
export const NDVI_WINTER_MONTHS: readonly number[] = [12, 1, 2];
/** Spring frosts are those before 1 July (day 182), autumn frosts those from 1 July to 30 June of the next year. */
export const FROST_SEASON_SPLIT_DOY = 182;
/**
 * "P80" frost dates are dates that are safe in 80 % of years: the 80th percentile of last spring frosts
 * and the 20th percentile of first autumn frosts (SPEC §5.1, §5.7).
 */
export const FROST_SAFE_PROBABILITY = 0.8;

// ── Crop calendar and crop fit (SPEC §5.7) ───────────────────────────────────
/** ASSUMPTION: sowing rules test the trailing 7-day mean of daily Tmean. */
export const SOWING_SMOOTHING_DAYS = 7;
/** ASSUMPTION: a spring crop is sown between 1 Feb and 30 Jun of its harvest year; an autumn crop between 15 Aug and 15 Dec of the year before. */
export const SPRING_SOWING_WINDOW = { from: "02-01", to: "06-30" } as const;
export const AUTUMN_SOWING_WINDOW = { from: "08-15", to: "12-15" } as const;
/** ASSUMPTION: days with Tmean below 5 °C are winter rest, not growth, in the temperature fit. */
export const ACTIVE_GROWTH_MIN_TMEAN_C = 5;
/** Crop-fit categories (SPEC §5.7): recommended ≥ 70 without blockers, risky 40–69 or a soft blocker. */
export const FIT_RECOMMENDED_MIN = 70;
export const FIT_RISKY_MIN = 40;
/** Blockers (SPEC §5.7). */
export const SALINITY_LOSS_HARD_PCT = 50;
export const SALINITY_LOSS_SOFT_PCT = 10;
export const HEAT_WINDOW_SOFT_SHARE = 0.3;
export const FROST_AFTER_SOWING_SOFT_SHARE = 0.2;
/** ASSUMPTION: a harvest at least 20 days before the safe first-frost date fits fully; at 0 days the fit is 40. */
export const FROST_MARGIN_FULL_FIT_DAYS = 20;
/** ASSUMPTION: above this slope, annual furrow-irrigated crops are not suitable (agronomist to confirm). */
export const STEEP_SLOPE_PCT = 8;
/** Maas & Hoffman (1977) classes: a threshold below 3 dS/m means "sensitive" or "moderately sensitive". */
export const SALT_SENSITIVE_THRESHOLD_DSM = 3;
/** ASSUMPTION: representative ECe (dS/m) of the regional salinity classes, inside the FAO class limits 0–2, 2–4, 4–8, 8–16. */
export const SALINITY_CLASS_ECE: Readonly<Record<"none" | "slight" | "moderate" | "strong", number>> = {
  none: 1,
  slight: 3,
  moderate: 6,
  strong: 12,
};
/** ASSUMPTION: harvest-rain risk means an extreme rain day in the last 14 days of the season. */
export const HARVEST_WINDOW_DAYS = 14;

// ── Rotation metrics (SPEC §5.9) ─────────────────────────────────────────────
/** ASSUMPTION: wind factor = monthly mean WS2M / 3 m/s, clamped to 0.5–2; slope factor = 1 + slope % / 5. */
export const EROSION_REFERENCE_WIND_MS = 3;
export const EROSION_WIND_FACTOR_RANGE = { min: 0.5, max: 2 } as const;
export const EROSION_SLOPE_DIVISOR_PCT = 5;
/** ASSUMPTION: organic-matter points per crop season (indicative): residue class, +0.2 for deep roots; a perennial year scores 1. */
export const ORGANIC_MATTER_POINTS = {
  perennialYear: 1,
  residue: { low: 0.1, med: 0.4, high: 0.6 },
  deepRootBonus: 0.2,
} as const;

// ── Ranking (SPEC §5.10) ─────────────────────────────────────────────────────
/**
 * ASSUMPTION: fixed ranges that map each metric to 0–1 (1 = best), never relative to the other options.
 * Values beyond a range are clamped. The water range is a physical bound: a field under crop all year
 * at Kc ≈ 1 in the hottest demo climate (Surxondaryo, Hargreaves ET0 ≈ 1,500 mm/yr) with furrow
 * efficiency 0.6 needs ≈ 1,500 / 0.6 = 2,500 mm = 25,000 m³/ha. (A first guess of 2,000–14,000 put
 * almost every real rotation at the worst end, so water could not tell them apart.)
 */
export const METRIC_RANGES = {
  dryYearGrossM3: { best: 0, worst: 25000 },
  bareDays: { best: 0, worst: 300 },
  erosionIndex: { best: 0, worst: 400 },
  nFixingShare: { best: 0.5, worst: 0 },
  organicMatter: { best: 1, worst: 0 },
  longestFamilyRunSeasons: { best: 1, worst: 4 },
  vulnerabilityShare: { best: 0, worst: 0.5 },
  salinityLossPct: { best: 0, worst: 50 },
  forage: { best: 3, worst: 0 },
  marketRating: { best: 5, worst: 1 },
  distinctCrops: { best: 1, worst: 5 },
} as const;
/** ASSUMPTION: water-supply reliability adds to the water-saving weight (SPEC §5.10), capped at 3. */
export const WATER_RELIABILITY_BONUS = { reliable: 0, sometimes_short: 1, often_short: 2 } as const;
export const PRIORITY_MAX = 3;
/** Shown alternatives besides the farmer's current rotation (SPEC §5.10). */
export const TOP_ALTERNATIVES = 3;

// ── Boundaries (SPEC §3) ─────────────────────────────────────────────────────
export const GEOBOUNDARIES_API_URL = "https://www.geoboundaries.org/api/current/gbOpen/UZB";
/** ASSUMPTION: Douglas–Peucker tolerance for the boundary file the browser loads (~500 m). */
export const BOUNDARY_SIMPLIFY_TOLERANCE_DEG = 0.005;
