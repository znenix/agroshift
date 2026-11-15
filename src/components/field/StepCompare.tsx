"use client";

/**
 * Step 4: the farmer's rotation and the best alternatives (SPEC §5.10, §5.12). Each card answers: why
 * suggested · evidence · benefits · risks needing local review · information gaps · confidence.
 */
import { ConfidenceBadge, EstimatedMark, SourceChip, StatusIcon } from "@/components/badges";
import { useI18n } from "@/components/I18nProvider";
import type { Analysis, FieldProfile } from "@/lib/analysis";
import { CROPS, ROTATION_TEMPLATES, rotationCrops } from "@/lib/catalog";
import { cardNotes } from "@/lib/compare";
import { CLIMATOLOGY_FIRST_YEAR, CLIMATOLOGY_LAST_YEAR } from "@/lib/constants";
import type { CropFit, FitCategory, Reason } from "@/lib/crops";
import { cropName, dayMonth, isoDayMonth, reasonParams, rotationName } from "@/lib/format";
import { formatNumber, type MessageKey } from "@/lib/i18n";
import type { IndicatorStatus } from "@/lib/indicators";
import { ndviDemoOnly } from "@/lib/point";
import type { RankedRotation } from "@/lib/ranking";
import type { RotationEvaluation } from "@/lib/rotations";
import { RotationTimeline } from "./RotationTimeline";

const FIT_STATUS: Readonly<Record<FitCategory, IndicatorStatus>> = { recommended: "good", risky: "watch", not_suitable: "concern" };
const FIT_ORDER: Readonly<Record<FitCategory, number>> = { recommended: 0, risky: 1, not_suitable: 2 };
const MIXED_PIXEL_SHARE = 0.5;

export function StepCompare({ profile, analysis }: { profile: FieldProfile; analysis: Analysis }) {
  const { t, locale } = useI18n();
  const { ranking } = analysis;
  const cards: Array<{ ranked: RankedRotation; label: string }> = [
    ...(ranking.current === null ? [] : [{ ranked: ranking.current, label: t("compare.current") }]),
    ...ranking.top.map((ranked, i) => ({ ranked, label: t("compare.alternative", { n: i + 1 }) })),
  ];
  const shown = cards.map((c) => c.ranked.evaluation);
  const anyUnverified = shown.some((e) => rotationCrops(e.years).some((c) => !c.verified));

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <p>{t("compare.lead")}</p>
        <p className="text-sm text-ink-muted">
          {t("compare.basis", { from: String(profile.years[0] ?? CLIMATOLOGY_FIRST_YEAR), to: String(profile.years.at(-1) ?? CLIMATOLOGY_LAST_YEAR) })}
        </p>
      </div>

      <SatelliteBanner profile={profile} analysis={analysis} />

      <section aria-label={t("field.step.compare")} className="grid gap-4 lg:grid-cols-2">
        {cards.map(({ ranked, label }) => (
          <RotationCard key={ranked.evaluation.id} ranked={ranked} label={label} analysis={analysis} profile={profile} />
        ))}
      </section>

      <MetricsTable evaluations={shown} labels={cards.map((c) => c.label)} />

      {ranking.more.length > 0 && (
        <section aria-labelledby="more-title" className="space-y-2">
          <h3 id="more-title" className="text-xl font-semibold text-forest-900">
            {t("compare.more")}
          </h3>
          <ul className="divide-y divide-sand-300 rounded-lg border border-sand-300 bg-white">
            {ranking.more.map((r) => (
              <li key={r.evaluation.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{rotationName(r.evaluation.years, locale)}</span>
                <span className="flex items-center gap-2 text-sm tabular-nums">
                  {r.score.total === null ? t("compare.no_score") : t("compare.score", { score: Math.round(r.score.total) })}
                  <ConfidenceBadge level={r.confidence} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ranking.excluded.length > 0 && (
        <section aria-labelledby="excluded-title" className="space-y-2">
          <h3 id="excluded-title" className="text-xl font-semibold text-forest-900">
            {t("compare.excluded")}
          </h3>
          <ul className="divide-y divide-sand-300 rounded-lg border border-sand-300 bg-white">
            {ranking.excluded.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <p className="font-medium">{rotationName(e.years, locale)}</p>
                <ReasonList reasons={e.exclusions} className="text-sm text-ink-muted" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="judgment-title" className="space-y-2 rounded-lg border-2 border-water-700 bg-white p-4">
        <h3 id="judgment-title" className="text-xl font-semibold text-forest-900">
          {t("judgment.title")}
        </h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("judgment.market")}</li>
          <li>{t("judgment.equipment")}</li>
          <li>{t("judgment.pests")}</li>
          <li>{t("judgment.water")}</li>
          {analysis.soil.eceSource !== "soil_test" && <li>{t("judgment.soil_test")}</li>}
          {anyUnverified && <li>{t("judgment.review")}</li>}
        </ul>
      </section>

      <CropFitTable fits={analysis.fits} />
    </div>
  );
}

function SatelliteBanner({ profile, analysis }: { profile: FieldProfile; analysis: Analysis }) {
  const { t, locale } = useI18n();
  const check = analysis.satellite;
  const ndvi = profile.farm.ndvi;
  const share = ndvi.pixels === 0 ? 0 : ndvi.cropland_pixels / ndvi.pixels;
  const agree = check !== null && check.mismatches.length === 0;
  const status: IndicatorStatus = check === null ? "unknown" : agree ? "good" : "watch";
  return (
    <section aria-labelledby="sat-title" className="space-y-2 rounded-lg border border-sand-300 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sat-title" className="flex items-center gap-2 text-lg font-semibold">
          <StatusIcon status={status} className="size-5" />
          {t("satellite.title")}
        </h3>
        <SourceChip source="modis-ornl" refs={profile.farm.sources} />
      </div>
      {check === null ? (
        <p>{t(ndviDemoOnly(profile.farm) ? "point.demo_only.satellite" : "satellite.unavailable")}</p>
      ) : agree ? (
        <p className="font-medium">{t("satellite.agree", { from: String(check.years[0] ?? ""), to: String(check.years.at(-1) ?? "") })}</p>
      ) : (
        <>
          <p className="font-medium">{t("satellite.differ")}</p>
          <ul className="list-disc pl-5 text-sm">
            {check.mismatches.map((m) => (
              <li key={`${m.year}-${m.from}`}>
                {t(`satellite.${m.kind}`, { year: String(m.year), from: isoDayMonth(m.from, locale), to: isoDayMonth(m.to, locale) })}
              </li>
            ))}
          </ul>
        </>
      )}
      {ndvi.pixels > 0 && share < MIXED_PIXEL_SHARE && <p className="text-sm text-ink-muted">{t("satellite.mixed_pixel", { share: Math.round(share * 100) })}</p>}
    </section>
  );
}

function RotationCard({ ranked, label, analysis, profile }: { ranked: RankedRotation; label: string; analysis: Analysis; profile: FieldProfile }) {
  const { t, locale, isKey } = useI18n();
  const e = ranked.evaluation;
  const m = e.metrics;
  const isCurrent = e.id === analysis.current.id;
  const notes = cardNotes(e, analysis);
  const template = ROTATION_TEMPLATES.find((r) => r.id === e.id);
  const why = template !== undefined && isKey(template.why_key) ? t(template.why_key) : t("compare.why_own");
  const unverified = rotationCrops(e.years).some((c) => !c.verified);
  const refs = profile.farm.sources;
  const num = (v: number, digits = 0) => formatNumber(v, locale, { maximumFractionDigits: digits });
  const salinityEstimated = analysis.soil.eceSource === "regional_estimate";

  return (
    <article className={`flex flex-col gap-4 rounded-lg border bg-white p-4 ${isCurrent ? "border-2 border-forest-900" : "border-sand-300"}`}>
      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
        <h3 className="text-lg font-semibold text-forest-900">{rotationName(e.years, locale)}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="tabular-nums">
            <span className="text-3xl font-bold">{ranked.score.total === null ? "–" : Math.round(ranked.score.total)}</span>
            <span className="text-ink-muted"> / 100</span>
            <span className="block text-xs text-ink-muted">{t("compare.score_label")}</span>
          </p>
          <ConfidenceBadge level={ranked.confidence} />
        </div>
      </header>

      {isCurrent && !e.feasible && (
        <div className="rounded-md bg-status-warning/15 px-3 py-2 text-sm">
          <p className="font-medium">{t("compare.current_warnings")}</p>
          <ReasonList reasons={e.exclusions} />
        </div>
      )}

      <CardSection title={t("compare.why")}>
        <p>{why}</p>
      </CardSection>

      <CardSection title={t("compare.evidence")}>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr] [&>dd]:text-right sm:[&>dd]:text-left">
          <dt className="text-ink-muted">{t("metric.water_dry")}</dt>
          <dd className="font-medium tabular-nums">
            {m.water.dryYearM3PerHa === null ? t("value.unknown") : t("value.m3", { value: num(Math.round(m.water.dryYearM3PerHa / 100) * 100) })}
          </dd>
          <dt className="text-ink-muted">{t("metric.bare")}</dt>
          <dd className="font-medium tabular-nums">{t("value.days_year", { value: m.bareDaysPerYear })}</dd>
          <dt className="text-ink-muted">{t("metric.n_fixing")}</dt>
          <dd className="font-medium tabular-nums">{t("value.pct", { value: Math.round(m.nFixingShare * 100) })}</dd>
          <dt className="text-ink-muted">{t("metric.pest")}</dt>
          <dd className="font-medium tabular-nums">
            {Number.isFinite(m.longestFamilyRun) ? t(m.longestFamilyRun === 1 ? "value.season_one" : "value.seasons", { value: m.longestFamilyRun }) : t("value.monoculture")}
          </dd>
          <dt className="text-ink-muted">{t("metric.salinity")}</dt>
          <dd className="font-medium tabular-nums">
            {m.salinityLossPct === null ? t("value.unknown") : t("value.pct", { value: Math.round(m.salinityLossPct) })}
            {m.salinityLossPct !== null && salinityEstimated && (
              <span className="ml-1">
                <EstimatedMark />
              </span>
            )}
          </dd>
        </dl>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SourceChip source="nasa-power" refs={refs} />
          <SourceChip source="formula-fao56" refs={refs} />
          <SourceChip source="crop-table" refs={refs} estimated={unverified} />
        </div>
      </CardSection>

      {!isCurrent && (
        <CardSection title={t("compare.benefits")}>
          <ReasonList reasons={notes.benefits} empty={t("compare.none")} />
        </CardSection>
      )}
      <CardSection title={t("compare.risks")}>
        <ReasonList reasons={notes.risks} empty={t("compare.none")} />
      </CardSection>
      <CardSection title={t("compare.gaps")}>
        <ReasonList reasons={notes.gaps} empty={t("compare.none")} className="text-sm text-ink-muted" />
      </CardSection>

      <CardSection title={t("compare.timeline")}>
        <p className="mb-1 text-xs text-ink-muted">{t("compare.timeline_lead", { years: e.years.length })}</p>
        <RotationTimeline evaluation={e} />
      </CardSection>
    </article>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function ReasonList({ reasons, empty, className = "" }: { reasons: readonly Reason[]; empty?: string; className?: string }) {
  const { t, locale } = useI18n();
  if (reasons.length === 0) return empty === undefined ? null : <p className={`text-sm text-ink-muted ${className}`}>{empty}</p>;
  return (
    <ul className={`list-disc space-y-0.5 pl-5 ${className}`}>
      {reasons.map((r, i) => (
        <li key={`${r.key}-${i}`}>{t(r.key, reasonParams(r, locale))}</li>
      ))}
    </ul>
  );
}

function MetricsTable({ evaluations, labels }: { evaluations: readonly RotationEvaluation[]; labels: readonly string[] }) {
  const { t, locale } = useI18n();
  const num = (v: number, digits = 0) => formatNumber(v, locale, { maximumFractionDigits: digits });
  const pct = (v: number | null) => (v === null ? t("value.unknown") : t("value.pct", { value: Math.round(v * 100) }));
  const m3 = (v: number | null) => (v === null ? t("value.unknown") : t("value.m3", { value: num(Math.round(v / 100) * 100) }));
  const rows: ReadonlyArray<{ label: MessageKey; value: (e: RotationEvaluation) => string }> = [
    { label: "metric.water", value: (e) => m3(e.metrics.water.averageM3PerHa) },
    { label: "metric.water_dry", value: (e) => m3(e.metrics.water.dryYearM3PerHa) },
    { label: "metric.bare", value: (e) => t("value.days_year", { value: e.metrics.bareDaysPerYear }) },
    { label: "metric.erosion", value: (e) => (e.metrics.erosionIndex === null ? t("value.unknown") : num(e.metrics.erosionIndex)) },
    { label: "metric.n_fixing", value: (e) => pct(e.metrics.nFixingShare) },
    { label: "metric.organic", value: (e) => num(e.metrics.organicMatter, 2) },
    {
      label: "metric.pest",
      value: (e) => (Number.isFinite(e.metrics.longestFamilyRun) ? t(e.metrics.longestFamilyRun === 1 ? "value.season_one" : "value.seasons", { value: e.metrics.longestFamilyRun }) : t("value.monoculture")),
    },
    { label: "metric.frost", value: (e) => pct(e.metrics.vulnerability.frost) },
    { label: "metric.harvest_rain", value: (e) => pct(e.metrics.vulnerability.harvestRain) },
    { label: "metric.heat", value: (e) => pct(e.metrics.vulnerability.heat) },
    { label: "metric.salinity", value: (e) => (e.metrics.salinityLossPct === null ? t("value.unknown") : t("value.pct", { value: Math.round(e.metrics.salinityLossPct) })) },
    { label: "metric.forage", value: (e) => num(e.metrics.forage, 1) },
  ];
  return (
    <section aria-labelledby="table-title" className="space-y-2">
      <h3 id="table-title" className="text-xl font-semibold text-forest-900">
        {t("compare.table")}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-sand-300 bg-white">
        <table className="min-w-full border-collapse text-left text-sm tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="border-b border-sand-300 px-3 py-2">
                {t("compare.metric")}
              </th>
              {evaluations.map((e, i) => (
                <th key={e.id} scope="col" className="border-b border-sand-300 px-3 py-2 align-bottom">
                  <span className="block text-xs font-semibold text-ink-muted uppercase">{labels[i]}</span>
                  <span className="font-semibold">{rotationName(e.years, locale)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="odd:bg-sand-100/60">
                <th scope="row" className="px-3 py-1.5 font-normal">
                  {t(row.label)}
                </th>
                {evaluations.map((e) => (
                  <td key={e.id} className="px-3 py-1.5">
                    {row.value(e)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CropFitTable({ fits }: { fits: readonly CropFit[] }) {
  const { t, locale } = useI18n();
  const sorted = [...fits].sort((a, b) => FIT_ORDER[a.category] - FIT_ORDER[b.category] || (b.score ?? -1) - (a.score ?? -1));
  return (
    <section aria-labelledby="fit-title" className="space-y-2">
      <div>
        <h3 id="fit-title" className="text-xl font-semibold text-forest-900">
          {t("compare.crop_fit")}
        </h3>
        <p className="text-sm text-ink-muted">{t("compare.crop_fit_lead")}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-sand-300 bg-white">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-sand-300">
              <th scope="col" className="px-3 py-2">{t("compare.crop")}</th>
              <th scope="col" className="px-3 py-2">{t("compare.fit")}</th>
              <th scope="col" className="px-3 py-2">{t("compare.sowing")}</th>
              <th scope="col" className="px-3 py-2">{t("compare.harvest")}</th>
              <th scope="col" className="px-3 py-2">{t("compare.notes")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((fit) => {
              const reasons = [...fit.hardBlockers, ...fit.softBlockers, ...fit.limits, ...fit.warnings, ...fit.gaps];
              const crop = CROPS.get(fit.cropId);
              return (
                <tr key={fit.cropId} className="border-b border-sand-300/60 align-top">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {cropName(fit.cropId, locale)}
                    {crop !== undefined && !crop.verified && (
                      <span className="ml-1">
                        <EstimatedMark />
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusIcon status={FIT_STATUS[fit.category]} />
                      {t(`fit.${fit.category}`)}
                      <span className="text-ink-muted tabular-nums">{fit.score === null ? "" : `(${Math.round(fit.score)})`}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fit.stats.sowDayMedian === null ? "–" : dayMonth(fit.stats.sowDayMedian, locale)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {fit.stats.harvestDayMedian === null ? "–" : dayMonth(fit.stats.harvestDayMedian, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <ReasonList reasons={reasons} className="text-xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
