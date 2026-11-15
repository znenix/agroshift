/**
 * 14-day forecast (Open-Meteo, not NASA): response validation, daily condensing, the one-line summary
 * parts and the two alerts. The fixture is a real response for the Kashkadarya demo point on 2026-11-15.
 */
import { describe, expect, it } from "vitest";
import {
  daySummary,
  forecastAlerts,
  forecastDays,
  forecastResponseSchema,
  fungalSensitiveCrops,
  openMeteoForecastSchema,
  openMeteoForecastUrl,
  receivedHourly,
  roundForecastCoord,
  skyOf,
  unavailableGroups,
  variablesToDrop,
  soilStateOf,
  type ForecastDay,
} from "@/lib/forecast";
import raw from "./fixtures/open-meteo-karshi-2026-11-15.json";

const day = (date: string, over: Partial<ForecastDay> = {}): ForecastDay => ({
  date,
  rainMm: 0,
  rainProbPct: 0,
  tmaxC: 25,
  tminC: 12,
  et0Mm: 3,
  cloudPct: 50,
  humidityPct: 50,
  soilMoisture: 0.3,
  ...over,
});
const dates = (n: number) => Array.from({ length: n }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

describe("forecast: request and response", () => {
  it("asks Open-Meteo for 14 local days with exactly the daily and hourly fields used", () => {
    const url = new URL(openMeteoForecastUrl(38.87, 65.73));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("forecast_days")).toBe("14");
    expect(url.searchParams.get("timezone")).toBe("Asia/Tashkent");
    expect(url.searchParams.get("daily")?.split(",")).toEqual([
      "precipitation_sum",
      "precipitation_probability_max",
      "temperature_2m_max",
      "temperature_2m_min",
      "et0_fao_evapotranspiration",
    ]);
    expect(url.searchParams.get("hourly")?.split(",")).toEqual([
      "cloud_cover",
      "relative_humidity_2m",
      "soil_moisture_0_to_1cm",
      "soil_moisture_1_to_3cm",
      "soil_moisture_3_to_9cm",
    ]);
    expect(roundForecastCoord(38.87292)).toBe(38.87);
  });

  it("validates a real response and condenses it to 14 local days", () => {
    const parsed = openMeteoForecastSchema.parse(raw);
    const days = forecastDays(parsed);
    expect(days).toHaveLength(14);
    expect(days[0]?.date).toBe("2026-11-15");
    expect(days.at(-1)?.date).toBe("2026-11-28");
    const first = days[0];
    expect(first?.rainProbPct).toBe(parsed.daily.precipitation_probability_max[0]);
    // Daily means of the 24 local hours of the first day.
    const hours = (parsed.hourly?.relative_humidity_2m ?? []).slice(0, 24).map((v) => v ?? NaN);
    expect(first?.humidityPct).toBe(Math.round(hours.reduce((a, b) => a + b, 0) / 24));
    for (const d of days) {
      expect(d.soilMoisture).not.toBeNull();
      expect(d.soilMoisture ?? -1).toBeGreaterThanOrEqual(0);
      expect(d.soilMoisture ?? 2).toBeLessThanOrEqual(1);
    }
    // What /api/forecast returns passes the browser-side schema.
    expect(forecastResponseSchema.safeParse({ version: 1, lat: 38.87, lon: 65.73, grid: { lat: 38.9, lon: 65.7, elevation_m: 370 }, retrieved: "2026-11-15T10:00:00Z", stale: false, unavailable: [], days }).success).toBe(true);
  });

  it("rejects a response with wrong units or arrays of different lengths", () => {
    const parsed = openMeteoForecastSchema.parse(raw);
    expect(openMeteoForecastSchema.safeParse({ ...parsed, hourly_units: { ...parsed.hourly_units, soil_moisture_0_to_1cm: "%" } }).success).toBe(false);
    expect(openMeteoForecastSchema.safeParse({ ...parsed, daily: { ...parsed.daily, precipitation_sum: [1, 2] } }).success).toBe(false);
  });

  it("weights the soil layers by thickness (1, 2 and 6 cm) and leaves a day with too few hours unknown", () => {
    const parsed = openMeteoForecastSchema.parse(raw);
    const base = parsed.hourly;
    if (base === undefined) throw new Error("fixture has hourly values");
    const n = base.time.length;
    const hourly = {
      ...base,
      soil_moisture_0_to_1cm: Array<number>(n).fill(0.09),
      soil_moisture_1_to_3cm: Array<number>(n).fill(0.18),
      soil_moisture_3_to_9cm: Array<number>(n).fill(0.36),
      cloud_cover: (base.cloud_cover ?? []).map((v, i) => (i < 24 && i % 4 === 0 ? null : v)),
    };
    const days = forecastDays({ ...parsed, hourly });
    expect(days[0]?.soilMoisture).toBe(0.29); // (0.09·1 + 0.18·2 + 0.36·6) / 9
    expect(days[0]?.cloudPct).toBeNull(); // 18 of 24 hours
    expect(days[1]?.cloudPct).not.toBeNull();
  });
});

describe("forecast: variables the service does not provide", () => {
  it("after a 400, drops the variables named in the reason, else the soil-moisture variables", () => {
    const all = ["cloud_cover", "relative_humidity_2m", "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm"] as const;
    expect(variablesToDrop("Cannot initialize SurfaceVariable from invalid String value soil_moisture_3_to_9cm.", all)).toEqual(["soil_moisture_3_to_9cm"]);
    expect(variablesToDrop("Parameter hourly is invalid", all)).toEqual(["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm"]);
    expect(variablesToDrop("anything", ["cloud_cover"])).toEqual([]);
  });

  it("a response without soil moisture still gives 14 days, with soil moisture null and listed as not available", () => {
    const parsed = openMeteoForecastSchema.parse(raw);
    const hourly = { ...parsed.hourly, soil_moisture_0_to_1cm: undefined, soil_moisture_1_to_3cm: undefined, soil_moisture_3_to_9cm: undefined };
    const units = { ...parsed.hourly_units, soil_moisture_0_to_1cm: undefined, soil_moisture_1_to_3cm: undefined, soil_moisture_3_to_9cm: undefined };
    const reduced = openMeteoForecastSchema.parse(JSON.parse(JSON.stringify({ ...parsed, hourly, hourly_units: units })));
    const days = forecastDays(reduced);
    expect(days).toHaveLength(14);
    expect(days.every((d) => d.soilMoisture === null && d.humidityPct !== null)).toBe(true);
    expect(unavailableGroups(receivedHourly(reduced))).toEqual(["soil_moisture"]);
    expect(unavailableGroups(receivedHourly(parsed))).toEqual([]);
    // No soil moisture → no irrigation alert can fire.
    expect(forecastAlerts(days, { sensitiveCrops: [], irrigated: true })).toEqual([]);
  });
});

describe("forecast: one-line summary", () => {
  it("classifies cloud cover and top-soil moisture by the documented thresholds", () => {
    expect([skyOf(10), skyOf(30), skyOf(69), skyOf(70), skyOf(null)]).toEqual(["clear", "partly_cloudy", "partly_cloudy", "cloudy", null]);
    expect([soilStateOf(0.1), soilStateOf(0.15), soilStateOf(0.25), soilStateOf(null)]).toEqual(["dry", "medium", "moist", null]);
  });

  it("builds 'Cloudy with 70% chance of 8 mm rain; soil stays moist'", () => {
    const today = day("2026-06-02", { cloudPct: 85, rainProbPct: 70, rainMm: 8, soilMoisture: 0.3 });
    const s = daySummary(today, day("2026-06-01", { soilMoisture: 0.31 }));
    expect(s).toEqual({ sky: "cloudy", rain: { kind: "chance", probPct: 70, mm: 8 }, soil: { state: "moist", change: "stays" } });
  });

  it("says 'no rain' only when both amount and probability are zero, and never invents a missing value", () => {
    expect(daySummary(day("2026-06-01"), null).rain).toEqual({ kind: "none" });
    expect(daySummary(day("2026-06-01", { rainProbPct: null, rainMm: 2 }), null).rain).toEqual({ kind: "amount_only", mm: 2 });
    expect(daySummary(day("2026-06-01", { rainProbPct: null, rainMm: null }), null).rain).toEqual({ kind: "unknown" });
    // A probability without a measurable amount is not worded as "0 mm".
    expect(daySummary(day("2026-06-01", { rainProbPct: 4, rainMm: 0 }), null).rain).toEqual({ kind: "chance", probPct: 4, mm: null });
    expect(daySummary(day("2026-06-01", { soilMoisture: null }), null).soil).toBeNull();
    expect(daySummary(day("2026-06-02", { soilMoisture: 0.1 }), day("2026-06-01")).soil).toEqual({ state: "dry", change: "becomes" });
  });
});

describe("forecast: alerts (ASSUMPTION thresholds)", () => {
  const humid = { humidityPct: 80, tmaxC: 26 };
  const cotton = { sensitiveCrops: ["cotton"], irrigated: true };

  it("finds the cotton and melon in the farmer's rotation, and nothing else", () => {
    expect(fungalSensitiveCrops([{ main: "cotton", second: null }, { main: "winter_wheat", second: "mung_bean" }])).toEqual(["cotton"]);
    expect(fungalSensitiveCrops([{ main: "winter_wheat", second: "melon" }])).toEqual(["melon"]);
    expect(fungalSensitiveCrops([{ main: "alfalfa", second: null }])).toEqual([]);
  });

  it("fungal: humidity > 75 % and Tmax 20–30 °C on 2+ consecutive days", () => {
    const d = dates(6).map((date, i) => day(date, i === 1 || i === 2 ? humid : {}));
    expect(forecastAlerts(d, cotton)).toEqual([{ kind: "fungal", from: "2026-06-02", to: "2026-06-03", days: 2 }]);
    // One humid day is not enough; 75 % exactly and 31 °C do not count.
    const single = dates(4).map((date, i) => day(date, i === 1 ? humid : {}));
    expect(forecastAlerts(single, cotton)).toEqual([]);
    const edge = dates(4).map((date, i) => day(date, i < 2 ? { humidityPct: 75, tmaxC: 25 } : { humidityPct: 90, tmaxC: 31 }));
    expect(forecastAlerts(edge, cotton)).toEqual([]);
    // A run that reaches the last day is reported too.
    const tail = dates(4).map((date, i) => day(date, i >= 2 ? humid : {}));
    expect(forecastAlerts(tail, cotton)).toEqual([{ kind: "fungal", from: "2026-06-03", to: "2026-06-04", days: 2 }]);
  });

  it("fungal: off when the rotation has neither cotton nor melon", () => {
    const d = dates(4).map((date) => day(date, humid));
    expect(forecastAlerts(d, { sensitiveCrops: [], irrigated: true })).toEqual([]);
  });

  it("irrigation: dry top soil and rain probability ≤ 10 % on 3+ days, irrigated fields only", () => {
    const dry = { soilMoisture: 0.1, rainProbPct: 10 };
    const d = dates(5).map((date, i) => day(date, i < 3 ? dry : {}));
    expect(forecastAlerts(d, cotton)).toEqual([{ kind: "irrigation", from: "2026-06-01", to: "2026-06-03", days: 3 }]);
    expect(forecastAlerts(d, { sensitiveCrops: [], irrigated: false })).toEqual([]);
    // Two days, an 11 % day or a missing probability break the run.
    expect(forecastAlerts(dates(2).map((date) => day(date, dry)), cotton)).toEqual([]);
    const broken = dates(4).map((date, i) => day(date, i === 1 ? { soilMoisture: 0.1, rainProbPct: 11 } : i === 2 ? { soilMoisture: 0.1, rainProbPct: null } : dry));
    expect(forecastAlerts(broken, cotton)).toEqual([]);
  });

  it("the real Karshi forecast (moist oasis soil, cool November) raises no alert", () => {
    const days = forecastDays(openMeteoForecastSchema.parse(raw));
    expect(forecastAlerts(days, cotton)).toEqual([]);
  });
});
