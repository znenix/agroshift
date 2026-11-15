"use client";

/**
 * Step 6: the 14-day weather forecast (Open-Meteo weather models — not NASA, not observations). Loaded
 * only when this step is open; if the service fails or is slow, a short message is shown and the other
 * steps are unaffected. Alert thresholds are ASSUMPTIONS (lib/constants.ts).
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  FORECAST_DAYS,
  FORECAST_SOIL_DRY_M3M3,
  FUNGAL_HUMIDITY_PCT,
  FUNGAL_MIN_DAYS,
  FUNGAL_SENSITIVE_CROPS,
  FUNGAL_TMAX_RANGE_C,
  IRRIGATION_MIN_DAYS,
  IRRIGATION_RAIN_PROB_MAX_PCT,
} from "@/lib/constants";
import { daySummary, forecastAlerts, fungalSensitiveCrops, type ForecastDay, type ForecastResponse } from "@/lib/forecast";
import { cropName, isoDayMonth } from "@/lib/format";
import { formatNumber, LOCALE_TAGS, type Locale, type TranslateFn } from "@/lib/i18n";
import { loadForecast } from "@/lib/staticdata";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; value: ForecastResponse };

export function StepForecast({
  lat,
  lon,
  rotationYears,
  irrigated,
}: {
  lat: number;
  lon: number;
  rotationYears: ReadonlyArray<{ main: string; second: string | null }>;
  irrigated: boolean;
}) {
  const { t, locale } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadForecast(lat, lon).then(
      (value) => live && setLoad({ status: "ready", value }),
      () => live && setLoad({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [lat, lon, attempt]);

  const sensitive = fungalSensitiveCrops(rotationYears);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-forest-900">{t("forecast.title", { days: FORECAST_DAYS })}</h2>
        <p className="inline-block rounded-md border-2 border-status-warning bg-status-warning/15 px-3 py-1 font-semibold">{t("forecast.badge")}</p>
        <p className="text-ink-muted">{t("forecast.lead")}</p>
        <p className="text-sm">
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">
            {t("forecast.attribution")}
          </a>{" "}
          (
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline">
            CC BY 4.0
          </a>
          ). {t("forecast.changes")}
        </p>
      </div>

      {load.status === "loading" && (
        <p role="status" className="text-ink-muted">
          {t("forecast.loading")}
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-sand-300 bg-white px-4 py-3">
          <span>{t("forecast.unavailable")}</span>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
            className="rounded border border-sand-300 px-3 py-1 text-sm font-medium"
          >
            {t("forecast.retry")}
          </button>
        </div>
      )}
      {load.status === "ready" && (
        <>
          <Alerts days={load.value.days} sensitive={sensitive} irrigated={irrigated} />
          <section aria-labelledby="days-title" className="space-y-3">
            <h3 id="days-title" className="text-xl font-semibold text-forest-900">
              {t("forecast.days_title")}
            </h3>
            <ol className="space-y-3">
              {load.value.days.map((day, i) => (
                <DayCard key={day.date} day={day} previous={load.value.days[i - 1] ?? null} />
              ))}
            </ol>
            <p className="text-xs text-ink-muted tabular-nums">
              {t("forecast.grid", {
                lat: load.value.grid.lat.toFixed(2),
                lon: load.value.grid.lon.toFixed(2),
                time: new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(load.value.retrieved)),
              })}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Alerts({ days, sensitive, irrigated }: { days: readonly ForecastDay[]; sensitive: readonly string[]; irrigated: boolean }) {
  const { t, locale } = useI18n();
  const alerts = forecastAlerts(days, { sensitiveCrops: sensitive, irrigated });
  const crops = sensitive.map((c) => cropName(c, locale)).join(", ");
  return (
    <section aria-labelledby="alerts-title" className="space-y-2 rounded-lg border border-sand-300 bg-white p-4">
      <h3 id="alerts-title" className="text-lg font-semibold">
        {t("forecast.alerts_title")}
      </h3>
      {alerts.length === 0 ? (
        <p>{t("forecast.alerts_none", { days: days.length })}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={`${a.kind}-${a.from}`} className="rounded-md border border-status-warning bg-status-warning/15 px-3 py-2 font-medium">
              {a.kind === "fungal"
                ? t("forecast.alert.fungal", { crops, from: isoDayMonth(a.from, locale), to: isoDayMonth(a.to, locale), days: a.days })
                : t("forecast.alert.irrigation", { from: isoDayMonth(a.from, locale), to: isoDayMonth(a.to, locale), days: a.days })}
            </li>
          ))}
        </ul>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
        <li>
          {t("forecast.rule.fungal", {
            humidity: FUNGAL_HUMIDITY_PCT,
            tmin: FUNGAL_TMAX_RANGE_C.min,
            tmax: FUNGAL_TMAX_RANGE_C.max,
            days: FUNGAL_MIN_DAYS,
            crops: FUNGAL_SENSITIVE_CROPS.map((c) => cropName(c, locale)).join(", "),
          })}
          {sensitive.length === 0 && ` ${t("forecast.rule.fungal_na")}`}
        </li>
        <li>
          {t("forecast.rule.irrigation", { soil: formatNumber(FORECAST_SOIL_DRY_M3M3, locale, { maximumFractionDigits: 2 }), prob: IRRIGATION_RAIN_PROB_MAX_PCT, days: IRRIGATION_MIN_DAYS })}
          {!irrigated && ` ${t("forecast.rule.irrigation_na")}`}
        </li>
      </ul>
    </section>
  );
}

function summaryLine(t: TranslateFn, locale: Locale, day: ForecastDay, previous: ForecastDay | null): string {
  const s = daySummary(day, previous);
  const sky = t(s.sky === null ? "forecast.sky.unknown" : `forecast.sky.${s.sky}`);
  const mm = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 1 });
  const weather =
    s.rain.kind === "chance"
      ? s.rain.mm === null
        ? t("forecast.summary.chance_only", { sky, prob: s.rain.probPct })
        : t("forecast.summary.chance", { sky, prob: s.rain.probPct, mm: mm(s.rain.mm) })
      : s.rain.kind === "amount_only"
        ? t("forecast.summary.amount_only", { sky, mm: mm(s.rain.mm) })
        : t(s.rain.kind === "none" ? "forecast.summary.none" : "forecast.summary.unknown", { sky });
  const soil = s.soil === null ? t("forecast.soil.unknown") : t(`forecast.soil.${s.soil.change}.${s.soil.state}`);
  return t("forecast.summary.line", { weather, soil });
}

function DayCard({ day, previous }: { day: ForecastDay; previous: ForecastDay | null }) {
  const { t, locale } = useI18n();
  const num = (v: number | null, digits: number) => (v === null ? "–" : formatNumber(v, locale, { maximumFractionDigits: digits }));
  const date = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`));
  const cells: ReadonlyArray<{ label: string; value: string }> = [
    { label: t("forecast.col.rain"), value: num(day.rainMm, 1) },
    { label: t("forecast.col.prob"), value: num(day.rainProbPct, 0) },
    { label: t("forecast.col.cloud"), value: num(day.cloudPct, 0) },
    { label: t("forecast.col.humidity"), value: num(day.humidityPct, 0) },
    { label: t("forecast.col.soil"), value: num(day.soilMoisture, 2) },
    { label: t("forecast.col.et0"), value: num(day.et0Mm, 1) },
    { label: t("forecast.col.temp"), value: `${num(day.tmaxC, 0)} / ${num(day.tminC, 0)}` },
  ];
  return (
    <li className="rounded-lg border border-sand-300 bg-white p-3">
      <p>
        <span className="font-semibold">{date}</span> — {summaryLine(t, locale, day, previous)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <dt className="text-xs text-ink-muted">{c.label}</dt>
            <dd className="tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
