/**
 * 14-day weather forecast from the Open-Meteo forecast API (weather models — not NASA, not observations).
 * The route handler fetches and condenses it to one row per local day; the browser composes the summary
 * line and the alerts from these pure functions. Every threshold is an ASSUMPTION in constants.ts.
 */
import { z } from "zod";
import {
  FORECAST_CLOUD_CLEAR_PCT,
  FORECAST_CLOUD_CLOUDY_PCT,
  FORECAST_DAYS,
  FORECAST_POINT_DECIMALS,
  FORECAST_SOIL_DRY_M3M3,
  FORECAST_SOIL_MOIST_M3M3,
  FORECAST_TIMEZONE,
  FUNGAL_HUMIDITY_PCT,
  FUNGAL_MIN_DAYS,
  FUNGAL_SENSITIVE_CROPS,
  FUNGAL_TMAX_RANGE_C,
  IRRIGATION_MIN_DAYS,
  IRRIGATION_RAIN_PROB_MAX_PCT,
  OPEN_METEO_FORECAST_URL,
} from "./constants";

const DAILY = ["precipitation_sum", "precipitation_probability_max", "temperature_2m_max", "temperature_2m_min", "et0_fao_evapotranspiration"] as const;
export const HOURLY_VARIABLES = ["cloud_cover", "relative_humidity_2m", "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm"] as const;
export type HourlyVariable = (typeof HOURLY_VARIABLES)[number];
/** What the user is told is missing when the service rejects or omits an hourly variable. */
export const forecastGroupSchema = z.enum(["cloud", "humidity", "soil_moisture"]);
export type ForecastGroup = z.infer<typeof forecastGroupSchema>;
const GROUP_OF: Readonly<Record<HourlyVariable, ForecastGroup>> = {
  cloud_cover: "cloud",
  relative_humidity_2m: "humidity",
  soil_moisture_0_to_1cm: "soil_moisture",
  soil_moisture_1_to_3cm: "soil_moisture",
  soil_moisture_3_to_9cm: "soil_moisture",
};
const SOIL_MOISTURE_VARIABLES: readonly HourlyVariable[] = ["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm"];
/** Layer thicknesses (cm) for the 0–9 cm depth-weighted soil moisture. */
const SOIL_LAYERS = [
  { key: "soil_moisture_0_to_1cm", cm: 1 },
  { key: "soil_moisture_1_to_3cm", cm: 2 },
  { key: "soil_moisture_3_to_9cm", cm: 6 },
] as const;

export const roundForecastCoord = (v: number): number => Math.round(v * 10 ** FORECAST_POINT_DECIMALS) / 10 ** FORECAST_POINT_DECIMALS;

export function openMeteoForecastUrl(lat: number, lon: number, hourly: readonly HourlyVariable[] = HOURLY_VARIABLES): string {
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&daily=${DAILY.join(",")}` +
    (hourly.length > 0 ? `&hourly=${hourly.join(",")}` : "") +
    `&forecast_days=${FORECAST_DAYS}&timezone=${encodeURIComponent(FORECAST_TIMEZONE)}`
  );
}

/** Why /api/forecast could not give a forecast (logged, and returned as `error.reason`). */
export const forecastFailureSchema = z.enum(["bad_request", "rate_limited", "timeout", "upstream_error", "invalid_response"]);
export type ForecastFailure = z.infer<typeof forecastFailureSchema>;

/** Open-Meteo's error body, e.g. {"error": true, "reason": "Cannot initialize SurfaceAndPressureVariable from invalid String value ..."}. */
export const openMeteoErrorSchema = z.object({ reason: z.string() });

/**
 * After a 400 (bad parameter): the hourly variables to drop before one retry. Variables named in the reason
 * go first; if none is named, the soil-moisture variables (the least widely supported) are dropped.
 */
export function variablesToDrop(reason: string, requested: readonly HourlyVariable[]): HourlyVariable[] {
  const named = requested.filter((v) => reason.includes(v));
  if (named.length > 0) return named;
  return requested.filter((v) => SOIL_MOISTURE_VARIABLES.includes(v));
}

/** Groups the user is told are not available, given the hourly variables that were actually received. */
export function unavailableGroups(received: readonly HourlyVariable[]): ForecastGroup[] {
  const groups: ForecastGroup[] = [];
  for (const v of HOURLY_VARIABLES) {
    const g = GROUP_OF[v];
    if (!received.includes(v) && !groups.includes(g)) groups.push(g);
  }
  return groups;
}

const values = z.array(z.number().nullable());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoHour = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/** The raw Open-Meteo response (only the fields we use), with matching array lengths. */
export const openMeteoForecastSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number().optional(),
    timezone: z.string(),
    daily_units: z.object({ precipitation_sum: z.literal("mm"), precipitation_probability_max: z.literal("%"), temperature_2m_max: z.literal("°C"), temperature_2m_min: z.literal("°C"), et0_fao_evapotranspiration: z.literal("mm") }),
    /** Hourly variables are optional: a retry after a 400 asks for fewer of them. */
    hourly_units: z
      .object({
        cloud_cover: z.literal("%").optional(),
        relative_humidity_2m: z.literal("%").optional(),
        soil_moisture_0_to_1cm: z.literal("m³/m³").optional(),
        soil_moisture_1_to_3cm: z.literal("m³/m³").optional(),
        soil_moisture_3_to_9cm: z.literal("m³/m³").optional(),
      })
      .optional(),
    daily: z.object({
      time: z.array(isoDate),
      precipitation_sum: values,
      precipitation_probability_max: values,
      temperature_2m_max: values,
      temperature_2m_min: values,
      et0_fao_evapotranspiration: values,
    }),
    hourly: z
      .object({
        time: z.array(isoHour),
        cloud_cover: values.optional(),
        relative_humidity_2m: values.optional(),
        soil_moisture_0_to_1cm: values.optional(),
        soil_moisture_1_to_3cm: values.optional(),
        soil_moisture_3_to_9cm: values.optional(),
      })
      .optional(),
  })
  .refine((r) => DAILY.every((k) => r.daily[k].length === r.daily.time.length), "daily arrays differ in length")
  .refine((r) => r.hourly === undefined || HOURLY_VARIABLES.every((k) => r.hourly?.[k] === undefined || r.hourly[k].length === r.hourly.time.length), "hourly arrays differ in length");

/** The hourly variables present in a response (with their units). */
export const receivedHourly = (raw: OpenMeteoForecast): HourlyVariable[] =>
  HOURLY_VARIABLES.filter((v) => raw.hourly?.[v] !== undefined && raw.hourly_units?.[v] !== undefined);
export type OpenMeteoForecast = z.infer<typeof openMeteoForecastSchema>;

const nullableNumber = z.number().nullable();
export const forecastDaySchema = z.object({
  date: isoDate,
  rainMm: nullableNumber,
  rainProbPct: nullableNumber,
  tmaxC: nullableNumber,
  tminC: nullableNumber,
  et0Mm: nullableNumber,
  /** Daily means of the hourly values (local day, at least 20 of 24 hours). */
  cloudPct: nullableNumber,
  humidityPct: nullableNumber,
  /** 0–9 cm depth-weighted model soil moisture, m³/m³. */
  soilMoisture: nullableNumber,
});
export type ForecastDay = z.infer<typeof forecastDaySchema>;

/** What /api/forecast returns. */
export const forecastResponseSchema = z.object({
  version: z.literal(1),
  lat: z.number(),
  lon: z.number(),
  /** The model grid point Open-Meteo answered for, and its elevation. */
  grid: z.object({ lat: z.number(), lon: z.number(), elevation_m: z.number().nullable() }),
  /** When the forecast was fetched (ISO timestamp). */
  retrieved: z.string(),
  /** True when the service failed just now and the last good forecast (at most a few hours old) is shown. */
  stale: z.boolean(),
  /** Hourly groups the service did not provide this time (shown as "not available"). */
  unavailable: z.array(forecastGroupSchema),
  days: z.array(forecastDaySchema),
});
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

/** Hours a day needs for a daily mean (ASSUMPTION: 20 of 24, so one short gap does not hide a day). */
const MIN_HOURS = 20;
const round = (v: number | null, digits: number) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

function dailyMean(raw: OpenMeteoForecast, date: string, key: HourlyVariable): number | null {
  const hourly = raw.hourly;
  const series = hourly?.[key];
  if (hourly === undefined || series === undefined || raw.hourly_units?.[key] === undefined) return null;
  const vals: number[] = [];
  hourly.time.forEach((t, i) => {
    const v = series[i];
    if (t.startsWith(date) && v !== null && v !== undefined) vals.push(v);
  });
  return vals.length < MIN_HOURS ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** One row per local day: daily values as given, cloud/humidity/soil as daily means of the hourly values. */
export function forecastDays(raw: OpenMeteoForecast): ForecastDay[] {
  return raw.daily.time.map((date, i) => {
    const layers = SOIL_LAYERS.map((l) => ({ cm: l.cm, v: dailyMean(raw, date, l.key) }));
    const soil = layers.every((l) => l.v !== null) ? layers.reduce((s, l) => s + (l.v ?? 0) * l.cm, 0) / 9 : null;
    const at = (k: (typeof DAILY)[number]) => raw.daily[k][i] ?? null;
    return {
      date,
      rainMm: round(at("precipitation_sum"), 1),
      rainProbPct: round(at("precipitation_probability_max"), 0),
      tmaxC: round(at("temperature_2m_max"), 1),
      tminC: round(at("temperature_2m_min"), 1),
      et0Mm: round(at("et0_fao_evapotranspiration"), 1),
      cloudPct: round(dailyMean(raw, date, "cloud_cover"), 0),
      humidityPct: round(dailyMean(raw, date, "relative_humidity_2m"), 0),
      soilMoisture: round(soil, 3),
    };
  });
}

export type Sky = "clear" | "partly_cloudy" | "cloudy";
export type SoilState = "dry" | "medium" | "moist";

export const skyOf = (cloudPct: number | null): Sky | null =>
  cloudPct === null ? null : cloudPct < FORECAST_CLOUD_CLEAR_PCT ? "clear" : cloudPct >= FORECAST_CLOUD_CLOUDY_PCT ? "cloudy" : "partly_cloudy";

export const soilStateOf = (m3m3: number | null): SoilState | null =>
  m3m3 === null ? null : m3m3 < FORECAST_SOIL_DRY_M3M3 ? "dry" : m3m3 >= FORECAST_SOIL_MOIST_M3M3 ? "moist" : "medium";

/** The parts of the one-line summary; the UI words them in the reader's language. */
export interface DaySummary {
  sky: Sky | null;
  /** `mm` is null in "chance" when the model gives a probability but no measurable amount. */
  rain: { kind: "none" } | { kind: "chance"; probPct: number; mm: number | null } | { kind: "amount_only"; mm: number } | { kind: "unknown" };
  /** "stays" when the previous day had the same state, "becomes" when it changed, "is" on the first day. */
  soil: { state: SoilState; change: "is" | "stays" | "becomes" } | null;
}

export function daySummary(day: ForecastDay, previous: ForecastDay | null): DaySummary {
  const mm = day.rainMm;
  const prob = day.rainProbPct;
  const rain: DaySummary["rain"] =
    mm === null && prob === null
      ? { kind: "unknown" }
      : (prob ?? 0) === 0 && (mm ?? 0) === 0
        ? { kind: "none" }
        : prob === null
          ? { kind: "amount_only", mm: mm ?? 0 }
          : { kind: "chance", probPct: prob, mm: mm === null || mm === 0 ? null : mm };
  const state = soilStateOf(day.soilMoisture);
  const before = previous === null ? null : soilStateOf(previous.soilMoisture);
  return {
    sky: skyOf(day.cloudPct),
    rain,
    soil: state === null ? null : { state, change: before === null ? "is" : before === state ? "stays" : "becomes" },
  };
}

export interface ForecastAlert {
  kind: "fungal" | "irrigation";
  from: string;
  to: string;
  days: number;
}

/** Runs of at least `min` consecutive days for which `test` holds. */
function runs(days: readonly ForecastDay[], test: (d: ForecastDay) => boolean, min: number, kind: ForecastAlert["kind"]): ForecastAlert[] {
  const out: ForecastAlert[] = [];
  let start = -1;
  days.forEach((d, i) => {
    const ok = test(d);
    if (ok && start < 0) start = i;
    const last = i === days.length - 1;
    if (start >= 0 && (!ok || last)) {
      const end = ok ? i : i - 1;
      const n = end - start + 1;
      const first = days[start];
      const final = days[end];
      if (n >= min && first !== undefined && final !== undefined) out.push({ kind, from: first.date, to: final.date, days: n });
      start = -1;
    }
  });
  return out;
}

/** Crops of the farmer's rotation for which the fungal alert applies. */
export function fungalSensitiveCrops(years: ReadonlyArray<{ main: string; second: string | null }>): string[] {
  const ids = new Set(years.flatMap((y) => (y.second === null ? [y.main] : [y.main, y.second])));
  return FUNGAL_SENSITIVE_CROPS.filter((c) => ids.has(c));
}

/**
 * Alerts from the forecast only (team rules, ASSUMPTION thresholds):
 * - fungal: daily mean humidity > 75 % and Tmax 20–30 °C on 2+ consecutive days, when cotton or melon is in the rotation;
 * - irrigation (irrigated fields only): top soil dry and rain probability ≤ 10 % on 3+ consecutive days.
 * A day with a missing value never counts towards an alert.
 */
export function forecastAlerts(days: readonly ForecastDay[], context: { sensitiveCrops: readonly string[]; irrigated: boolean }): ForecastAlert[] {
  const alerts: ForecastAlert[] = [];
  if (context.sensitiveCrops.length > 0) {
    alerts.push(
      ...runs(
        days,
        (d) => d.humidityPct !== null && d.humidityPct > FUNGAL_HUMIDITY_PCT && d.tmaxC !== null && d.tmaxC >= FUNGAL_TMAX_RANGE_C.min && d.tmaxC <= FUNGAL_TMAX_RANGE_C.max,
        FUNGAL_MIN_DAYS,
        "fungal",
      ),
    );
  }
  if (context.irrigated) {
    alerts.push(
      ...runs(days, (d) => soilStateOf(d.soilMoisture) === "dry" && d.rainProbPct !== null && d.rainProbPct <= IRRIGATION_RAIN_PROB_MAX_PCT, IRRIGATION_MIN_DAYS, "irrigation"),
    );
  }
  return alerts;
}
