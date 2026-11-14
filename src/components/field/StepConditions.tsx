"use client";

/** Step 2: what the data says about the field (SPEC §2, §5.1–5.5). Observations, not a forecast. */
import { ConfidenceBadge, EstimatedMark, InfoTip, SourceChip, StatusBadge } from "@/components/badges";
import { MonthlyBarLineChart, MonthlyBarsChart, MonthlyLineChart, NdviCurveChart } from "@/components/charts/LazyCharts";
import { useI18n } from "@/components/I18nProvider";
import type { FieldProfile } from "@/lib/analysis";
import { CLIMATOLOGY_FIRST_YEAR, CLIMATOLOGY_LAST_YEAR } from "@/lib/constants";
import type { SoilConditions } from "@/lib/crops";
import { dayMonth, monthShort } from "@/lib/format";
import { formatNumber, type MessageKey } from "@/lib/i18n";
import type { Indicator } from "@/lib/indicators";
import { isPointSite, type PointGap } from "@/lib/point";
import type { TrendResult } from "@/lib/trends";
import { DataTable } from "./DataTable";

const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const CLIMATE_INDICATORS: ReadonlyArray<Indicator["id"]> = ["water", "heat", "frost", "extreme_rain", "vegetation"];

export function StepConditions({
  profile,
  indicators,
  soil,
  gaps,
}: {
  profile: FieldProfile;
  indicators: readonly Indicator[];
  soil: SoilConditions;
  /** Map points only: what could not be fetched (each shown as an information gap). */
  gaps: readonly PointGap[];
}) {
  const { t, locale } = useI18n();
  const farm = profile.farm;
  const refs = farm.sources;
  const num = (v: number | null, digits = 1) => (v === null ? "–" : formatNumber(v, locale, { maximumFractionDigits: digits }));
  const months = profile.normals.map((n) => monthShort(n.month, locale));
  const climateYears = { from: String(profile.years[0] ?? CLIMATOLOGY_FIRST_YEAR), to: String(profile.years.at(-1) ?? CLIMATOLOGY_LAST_YEAR) };

  const temperature = profile.normals.map((n, i) => ({ month: months[i] ?? "", tmax: n.tmaxC, tmin: n.tminC }));
  const water = profile.normals.map((n, i) => ({ month: months[i] ?? "", precip: n.precipMm, et0: n.et0Mm }));
  const extremes = profile.extremes.map((e, i) => ({ month: months[i] ?? "", heat: e.heatDays, frost: e.frostDays }));
  const recentFrom = String(profile.ndvi.recentYears[0] ?? "");
  const recentTo = String(profile.ndvi.recentYears.at(-1) ?? "");
  const recordFrom = farm.ndvi.period.start.slice(0, 4);
  const ndvi = profile.ndvi.recent.map((p, i) => ({ doy: p.startDoy + 8, recent: p.median, record: profile.ndvi.record[i]?.median ?? null }));
  const bare = profile.ndvi.bare.map((b) => ({ from: b.fromDoy, to: b.toDoy }));
  const monthTicks = MONTH_START_DOY.map((doy, m) => ({ doy, label: monthShort(m + 1, locale) }));
  const frost = profile.frost;
  const isPoint = isPointSite(farm);
  const hasNdvi = farm.ndvi.composites.some((c) => c.ndvi !== null);

  const trends: ReadonlyArray<{ label: MessageKey; result: TrendResult | null; digits: number; source: "nasa-power" | "modis-ornl" }> = [
    { label: "trend.precip", result: profile.trends.precipMm, digits: 0, source: "nasa-power" },
    { label: "trend.summer_tmax", result: profile.trends.summerTmaxC, digits: 2, source: "nasa-power" },
    { label: "trend.heat_days", result: profile.trends.heatDays35, digits: 1, source: "nasa-power" },
    { label: "trend.frost_free", result: profile.trends.frostFreeDays, digits: 1, source: "nasa-power" },
    { label: "trend.soil_wetness", result: profile.trends.soilWetness, digits: 3, source: "nasa-power" },
    { label: "trend.ndvi", result: profile.trends.ndvi, digits: 3, source: "modis-ornl" },
  ];

  return (
    <div className="space-y-10">
      <section aria-labelledby="farm-title" className="space-y-1">
        <h2 id="farm-title" className="text-2xl font-semibold text-forest-900">
          {farm.names[locale]}
        </h2>
        <p className="text-sm text-ink-muted tabular-nums">
          {isPoint
            ? t("conditions.location_point", { region: farm.city.names[locale], cell: farm.climate.cell.id })
            : t("conditions.location", {
                lat: farm.point.lat.toFixed(3),
                lon: farm.point.lon.toFixed(3),
                km: num(farm.point.distance_km, 1),
                city: farm.city.names[locale],
                cell: farm.climate.cell.id,
              })}
        </p>
        {gaps.length > 0 && (
          <div role="note" className="mt-2 rounded-md border border-status-warning bg-status-warning/15 px-3 py-2 text-sm">
            <p className="font-medium">{t("point.gaps_title")}</p>
            <ul className="list-disc pl-5">
              {gaps.map((g) => (
                <li key={g}>{t(`point.gap.${g}`)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="indicators-title" className="space-y-3">
        <h3 id="indicators-title" className="text-xl font-semibold text-forest-900">
          {t("conditions.indicators")}
        </h3>
        <IndicatorGrid indicators={indicators.filter((i) => CLIMATE_INDICATORS.includes(i.id))} profile={profile} />
      </section>

      <section aria-labelledby="climate-title" className="space-y-4">
        <div>
          <h3 id="climate-title" className="text-xl font-semibold text-forest-900">
            {t("conditions.climate")}
          </h3>
          <p className="text-sm text-ink-muted">{t("conditions.climate_lead", climateYears)}</p>
          <div className="mt-1">
            <SourceChip source="nasa-power" refs={refs} />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartBlock title={t("conditions.temperature")}>
            <MonthlyLineChart
              data={temperature}
              unit=" °C"
              series={[
                { key: "tmax", name: t("series.tmax"), short: t("series.tmax_short"), slot: 2 },
                { key: "tmin", name: t("series.tmin"), short: t("series.tmin_short"), slot: 1 },
              ]}
            />
            <DataTable
              caption={t("conditions.temperature")}
              headers={["", t("series.tmax"), t("series.tmin")]}
              rows={temperature.map((r) => [r.month, num(r.tmax), num(r.tmin)])}
            />
          </ChartBlock>
          <ChartBlock title={t("conditions.water")}>
            <MonthlyBarLineChart
              data={water}
              unit=" mm"
              bar={{ key: "precip", name: t("series.precip"), slot: 1 }}
              line={{ key: "et0", name: t("series.et0"), short: t("series.et0_short"), slot: 2 }}
            />
            <DataTable
              caption={t("conditions.water")}
              headers={["", t("series.precip"), t("series.et0")]}
              rows={water.map((r) => [r.month, num(r.precip, 0), num(r.et0, 0)])}
            />
          </ChartBlock>
          <ChartBlock title={t("conditions.heat_frost")} note={t("source.heat_label")}>
            <MonthlyBarsChart
              data={extremes}
              unit={t("unit.days")}
              series={[
                { key: "heat", name: t("conditions.heat_days"), slot: 2 },
                { key: "frost", name: t("conditions.frost_days"), slot: 1 },
              ]}
            />
            <DataTable
              caption={t("conditions.heat_frost")}
              headers={["", t("conditions.heat_days"), t("conditions.frost_days")]}
              rows={extremes.map((r) => [r.month, num(r.heat), num(r.frost)])}
            />
          </ChartBlock>
          <div className="space-y-2 rounded-lg border border-sand-300 bg-white p-4">
            <h4 className="font-semibold">{t("indicator.title.frost")}</h4>
            <p>
              {frost.lastSpringSafe !== null && frost.firstAutumnSafe !== null
                ? t("conditions.frost_dates", { spring: dayMonth(frost.lastSpringSafe, locale), autumn: dayMonth(frost.firstAutumnSafe, locale) })
                : t("conditions.no_frost_dates")}
            </p>
            <p className="text-sm text-ink-muted">{t("conditions.frost_free_mean", { days: num(frost.frostFreeDaysMean, 0) })}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="trends-title" className="space-y-3">
        <div>
          <h3 id="trends-title" className="text-xl font-semibold text-forest-900">
            {t("conditions.trends")}
          </h3>
          <p className="text-sm text-ink-muted">{t("conditions.trends_lead")}</p>
        </div>
        <ul className="divide-y divide-sand-300 rounded-lg border border-sand-300 bg-white">
          {trends.map(({ label, result, digits, source }) => (
            <li key={label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
              <span className="font-medium">{t(label)}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <TrendWord result={result} />
                {result !== null && (
                  <span className="text-ink-muted tabular-nums">
                    {t("trend.detail", { slope: signed(result.slope * 10, digits, locale), p: result.p < 0.01 ? "< 0.01" : `= ${result.p.toFixed(2)}`, n: result.n })}
                  </span>
                )}
                <SourceChip source={source} refs={refs} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="satellite-title" className="space-y-3">
        <div>
          <h3 id="satellite-title" className="text-xl font-semibold text-forest-900">
            {t("conditions.satellite")}
          </h3>
          <p className="text-sm text-ink-muted">
            {t("conditions.satellite_lead")} <InfoTip text={t("glossary.ndvi")} />
          </p>
          <div className="mt-1">
            <SourceChip source="modis-ornl" refs={refs} />
          </div>
        </div>
        {!hasNdvi ? (
          <p className="rounded-lg border border-sand-300 bg-white p-4">{t("conditions.no_satellite")}</p>
        ) : (
        <>
        <div className="rounded-lg border border-sand-300 bg-white p-4">
          <NdviCurveChart
            data={ndvi}
            bare={bare}
            monthTicks={monthTicks}
            labels={{
              recent: t("series.ndvi_recent", { from: recentFrom, to: recentTo }),
              record: t("series.ndvi_record", { from: recordFrom, to: recentTo }),
              threshold: t("series.bare_threshold"),
              bare: t("family.bare"),
            }}
          />
          <DataTable
            caption={t("conditions.satellite")}
            headers={["", t("series.ndvi_recent", { from: recentFrom, to: recentTo }), t("series.ndvi_record", { from: recordFrom, to: recentTo })]}
            rows={ndvi.map((r) => [dayMonth(r.doy - 8, locale), num(r.recent, 2), num(r.record, 2)])}
          />
        </div>
        <ul className="space-y-1">
          {profile.ndvi.bare.length === 0 ? (
            <li>{t("conditions.never_bare")}</li>
          ) : (
            profile.ndvi.bare.map((b) => (
              <li key={b.fromSlot} className="font-medium">
                {t("conditions.bare", { from: dayMonth(b.fromDoy, locale), to: dayMonth(b.toDoy, locale) })}
              </li>
            ))
          )}
          <li className="text-sm text-ink-muted">
            {t("conditions.cropland_pixels", { cropland: farm.ndvi.cropland_pixels, total: farm.ndvi.pixels, year: String(farm.ndvi.mask_land_cover_year) })}
          </li>
        </ul>
        </>
        )}
      </section>

      <section aria-labelledby="soil-title" className="space-y-3">
        <div>
          <h3 id="soil-title" className="text-xl font-semibold text-forest-900">
            {t("conditions.soil")}
          </h3>
          <p className="text-sm text-ink-muted">{t("conditions.soil_lead")}</p>
        </div>
        <IndicatorGrid indicators={indicators.filter((i) => !CLIMATE_INDICATORS.includes(i.id))} profile={profile} />
        {soil.ece === null && <p className="rounded-md bg-status-warning/15 px-3 py-2 text-sm">{t("gap.salinity")}</p>}
      </section>
    </div>
  );
}

function ChartBlock({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <figure className="space-y-2 rounded-lg border border-sand-300 bg-white p-4">
      <figcaption>
        <span className="font-semibold">{title}</span>
        {note !== undefined && <span className="block text-xs text-ink-muted">{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

function signed(value: number, digits: number, locale: Parameters<typeof formatNumber>[1]): string {
  return formatNumber(value, locale, { maximumFractionDigits: digits, minimumFractionDigits: digits, signDisplay: "exceptZero" });
}

function TrendWord({ result }: { result: TrendResult | null }) {
  const { t } = useI18n();
  if (result === null) return <span className="text-ink-muted">{t("trend.not_enough")}</span>;
  const arrow = result.direction === "rising" ? "↑" : result.direction === "falling" ? "↓" : "→";
  return (
    <span className={result.significant ? "font-semibold" : "text-ink-muted"}>
      <span aria-hidden>{arrow} </span>
      {t(`trend.${result.direction}`)}
    </span>
  );
}

function IndicatorGrid({ indicators, profile }: { indicators: readonly Indicator[]; profile: FieldProfile }) {
  const { t, locale } = useI18n();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {indicators.map((ind) => {
        const value =
          ind.valueKey !== null
            ? t(ind.valueKey)
            : ind.value === null
              ? t("value.unknown")
              : formatNumber(ind.value, locale, { maximumFractionDigits: 3 });
        const estimated = ind.source === "team-salinity" || ind.source === "team-soil";
        return (
          <li key={ind.id} className="flex flex-col gap-2 rounded-lg border border-sand-300 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-semibold">{t(`indicator.title.${ind.id}`)}</h4>
              <StatusBadge status={ind.status} />
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {value}
              {ind.unit !== null && ind.value !== null && <span className="ml-1 text-sm font-normal text-ink-muted">{t(ind.unit)}</span>}
            </p>
            <p className="text-sm">{t(ind.explanation, ind.params)}</p>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {ind.source !== null && <SourceChip source={ind.source} refs={profile.farm.sources} label={ind.id === "heat" ? t("source.heat_label") : undefined} />}
              {estimated && <EstimatedMark />}
              <ConfidenceBadge level={ind.confidence} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
