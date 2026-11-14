"use client";

/**
 * Step 5: stress test (SPEC §5.11). Presets and sliders change the observed daily climate (delta-change
 * method); the whole engine re-runs in the browser and the ranking animates to its new order.
 * Labelled everywhere as a what-if test, not a forecast.
 */
import { useLayoutEffect, useRef } from "react";
import { ConfidenceBadge } from "@/components/badges";
import { useI18n } from "@/components/I18nProvider";
import type { Analysis, FieldProfile, ScenarioClimate } from "@/lib/analysis";
import { rotationCrops } from "@/lib/catalog";
import type { Scenario } from "@/lib/climate";
import { CLIMATOLOGY_FIRST_YEAR, CLIMATOLOGY_LAST_YEAR } from "@/lib/constants";
import { cropName, dayMonth, reasonParams, rotationName } from "@/lib/format";
import { formatNumber, type Locale, type MessageKey } from "@/lib/i18n";
import type { RankedRotation } from "@/lib/ranking";

export const SCENARIO_PRESETS: ReadonlyArray<{ id: "normal" | "dry" | "hot"; label: MessageKey; scenario: Scenario }> = [
  { id: "normal", label: "stress.preset.normal", scenario: { deltaT: 0, rainFactor: 1 } },
  { id: "dry", label: "stress.preset.dry", scenario: { deltaT: 0, rainFactor: 0.7 } },
  { id: "hot", label: "stress.preset.hot", scenario: { deltaT: 2, rainFactor: 1 } },
];
const DELTA_T = { min: 0, max: 4, step: 0.5 } as const;
const DELTA_RAIN_PCT = { min: -30, max: 30, step: 5 } as const;
const ANIMATION_MS = 450;

const sameScenario = (a: Scenario, b: Scenario) => a.deltaT === b.deltaT && Math.abs(a.rainFactor - b.rainFactor) < 1e-9;

function ranked(analysis: Analysis): RankedRotation[] {
  const { current, top, more } = analysis.ranking;
  return [...(current === null ? [] : [current]), ...top, ...more].sort(
    (a, b) => (b.score.total ?? -1) - (a.score.total ?? -1) || a.evaluation.id.localeCompare(b.evaluation.id),
  );
}

function signed(value: number, locale: Locale, digits = 0): string {
  return formatNumber(value, locale, { maximumFractionDigits: digits, minimumFractionDigits: digits, signDisplay: "exceptZero" });
}

export function StepStress({
  profile,
  normal,
  result,
  pending,
  scenario,
  onScenario,
}: {
  profile: FieldProfile;
  normal: Analysis;
  /** Analysis for the last applied scenario (kept on screen while the next one is computed). */
  result: Analysis;
  pending: boolean;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}) {
  const { t, locale } = useI18n();
  const shown = result;
  const before = ranked(normal);
  const after = ranked(shown);
  const rankBefore = new Map(before.map((r, i) => [r.evaluation.id, i + 1]));
  const scoreBefore = new Map(before.map((r) => [r.evaluation.id, r.score.total]));
  const waterBefore = new Map(before.map((r) => [r.evaluation.id, r.evaluation.metrics.water.dryYearM3PerHa]));
  const feasibleNow = new Set(after.map((r) => r.evaluation.id));
  const newlyExcluded = shown.ranking.excluded.filter((e) => rankBefore.has(e.id) && !feasibleNow.has(e.id));
  const rainPct = Math.round((scenario.rainFactor - 1) * 100);
  const years = { from: String(profile.years[0] ?? CLIMATOLOGY_FIRST_YEAR), to: String(profile.years.at(-1) ?? CLIMATOLOGY_LAST_YEAR) };

  const listRef = useRef<HTMLOListElement>(null);
  const lastTops = useRef(new Map<string, number>());
  const order = after.map((r) => r.evaluation.id).join("|");
  // FLIP: rows keep rank order in the DOM (screen readers read the new order); the move is animated.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const row of list.querySelectorAll<HTMLLIElement>("li[data-id]")) {
      const id = row.dataset.id ?? "";
      const top = row.offsetTop;
      const previous = lastTops.current.get(id);
      if (!reduce && previous !== undefined && previous !== top) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: ANIMATION_MS, easing: "ease-in-out" });
      }
      lastTops.current.set(id, top);
    }
  }, [order]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-forest-900">{t("stress.title")}</h2>
        <p className="inline-block rounded-md border-2 border-status-warning bg-status-warning/15 px-3 py-1 font-semibold">{t("stress.not_forecast")}</p>
        <p className="text-ink-muted">{t("stress.lead", years)}</p>
      </div>

      <section aria-labelledby="scenario-title" className="space-y-4 rounded-lg border border-sand-300 bg-white p-4">
        <h3 id="scenario-title" className="sr-only">
          {t("stress.scenario")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {SCENARIO_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={sameScenario(p.scenario, scenario)}
              onClick={() => onScenario(p.scenario)}
              className="rounded-full border border-forest-900 bg-white px-4 py-2 font-medium text-forest-900 hover:bg-forest-100 aria-pressed:bg-forest-900 aria-pressed:text-sand-50"
            >
              {t(p.label)}
            </button>
          ))}
          {!SCENARIO_PRESETS.some((p) => sameScenario(p.scenario, scenario)) && (
            <span className="rounded-full bg-forest-900 px-4 py-2 font-medium text-sand-50">{t("stress.custom")}</span>
          )}
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Slider
            label={t("stress.delta_t")}
            value={scenario.deltaT}
            display={`${signed(scenario.deltaT, locale, 1)} °C`}
            {...DELTA_T}
            onChange={(deltaT) => onScenario({ ...scenario, deltaT })}
          />
          <Slider
            label={t("stress.delta_rain")}
            value={rainPct}
            display={`${signed(rainPct, locale)} %`}
            {...DELTA_RAIN_PCT}
            onChange={(pct) => onScenario({ ...scenario, rainFactor: 1 + pct / 100 })}
          />
        </div>
        <p aria-live="polite" className="text-sm text-ink-muted">
          {pending ? t("stress.computing") : t("stress.applied", { dt: signed(shown.scenario.deltaT, locale, 1), rain: signed(Math.round((shown.scenario.rainFactor - 1) * 100), locale) })}
        </p>
      </section>

      <section aria-labelledby="stress-rank-title" className="space-y-2">
        <h3 id="stress-rank-title" className="text-xl font-semibold text-forest-900">
          {t("stress.ranking")}
        </h3>
        <p className="text-sm text-ink-muted">{t("stress.dry_water_note")}</p>
        <ol ref={listRef} className={`relative space-y-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
          {after.map((r, i) => {
            const id = r.evaluation.id;
            const was = rankBefore.get(id);
            const move = was === undefined ? 0 : was - (i + 1);
            const prevScore = scoreBefore.get(id);
            const scoreDelta = r.score.total !== null && prevScore != null ? r.score.total - prevScore : null;
            const water = r.evaluation.metrics.water.dryYearM3PerHa;
            const prevWater = waterBefore.get(id);
            const waterDelta = water !== null && prevWater != null ? water - prevWater : null;
            const isCurrent = id === shown.current.id;
            return (
              <li
                key={id}
                data-id={id}
                className={`grid grid-cols-[2.5rem_1fr] items-center gap-x-3 gap-y-1 rounded-lg border bg-white px-3 py-2 sm:grid-cols-[2.5rem_1fr_auto_auto] ${isCurrent ? "border-2 border-forest-900" : "border-sand-300"}`}
              >
                <span className="row-span-2 text-2xl font-bold tabular-nums sm:row-span-1">{i + 1}</span>
                <span>
                  <span className="font-medium">{rotationName(r.evaluation.years, locale)}</span>
                  {isCurrent && <span className="ml-2 text-xs font-semibold text-ink-muted uppercase">{t("compare.current")}</span>}
                  <RankMove move={move} />
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-lg font-semibold">{r.score.total === null ? "–" : Math.round(r.score.total)}</span>
                  <span className="text-ink-muted"> / 100</span>
                  {scoreDelta !== null && Math.abs(scoreDelta) >= 0.05 && <span className="ml-1 text-ink-muted">({signed(scoreDelta, locale, 1)})</span>}
                </span>
                <span className="text-sm tabular-nums">
                  {water === null ? t("value.unknown") : t("value.m3", { value: formatNumber(Math.round(water / 100) * 100, locale) })}
                  {waterDelta !== null && Math.abs(waterDelta) >= 50 && (
                    <span className="ml-1 text-ink-muted">({signed(Math.round(waterDelta / 10) * 10, locale)})</span>
                  )}
                  <span className="block text-xs text-ink-muted">{t("stress.water_dry_short")}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {after[0] !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <ConfidenceBadge level={after[0].confidence} />
            <span className="text-ink-muted">{t("stress.confidence_note")}</span>
          </div>
        )}
      </section>

      {newlyExcluded.length > 0 && (
        <section aria-labelledby="stress-excluded-title" className="space-y-2">
          <h3 id="stress-excluded-title" className="text-xl font-semibold text-forest-900">
            {t("stress.newly_excluded")}
          </h3>
          <ul className="divide-y divide-sand-300 rounded-lg border border-sand-300 bg-white">
            {newlyExcluded.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <p className="font-medium">{rotationName(e.years, locale)}</p>
                <ul className="list-disc pl-5 text-sm text-ink-muted">
                  {e.exclusions.map((r, i) => (
                    <li key={`${r.key}-${i}`}>{t(r.key, reasonParams(r, locale))}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="stress-climate-title" className="space-y-2">
        <h3 id="stress-climate-title" className="text-xl font-semibold text-forest-900">
          {t("stress.climate")}
        </h3>
        <ClimateTable normal={normal.climate} scenario={shown.climate} />
        <SowingShifts normal={normal} scenario={shown} />
      </section>
    </div>
  );
}

function RankMove({ move }: { move: number }) {
  const { t } = useI18n();
  if (move === 0) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-sand-100 px-2 text-xs font-semibold">
      <span aria-hidden>{move > 0 ? "▲" : "▼"}</span>
      {t(move > 0 ? "stress.rank_up" : "stress.rank_down", { n: Math.abs(move) })}
    </span>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-forest-900"
      />
    </label>
  );
}

function ClimateTable({ normal, scenario }: { normal: ScenarioClimate; scenario: ScenarioClimate }) {
  const { t, locale } = useI18n();
  const num = (v: number | null, unit: string) => (v === null ? t("value.unknown") : `${formatNumber(Math.round(v), locale)} ${unit}`);
  const day = (v: number | null) => (v === null ? t("value.unknown") : dayMonth(v, locale));
  const rows: ReadonlyArray<{ label: MessageKey; a: string; b: string }> = [
    { label: "stress.climate_rain", a: num(normal.precipMm, t("unit.mm")), b: num(scenario.precipMm, t("unit.mm")) },
    { label: "stress.climate_et0", a: num(normal.et0Mm, t("unit.mm")), b: num(scenario.et0Mm, t("unit.mm")) },
    { label: "stress.climate_heat", a: num(normal.heatDays35, ""), b: num(scenario.heatDays35, "") },
    { label: "stress.climate_frost_free", a: num(normal.frostFreeDaysMean, ""), b: num(scenario.frostFreeDaysMean, "") },
    { label: "stress.climate_spring", a: day(normal.lastSpringSafe), b: day(scenario.lastSpringSafe) },
    { label: "stress.climate_autumn", a: day(normal.firstAutumnSafe), b: day(scenario.firstAutumnSafe) },
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-sand-300 bg-white">
      <table className="min-w-full border-collapse text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-sand-300">
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">{t("compare.metric")}</span>
            </th>
            <th scope="col" className="px-3 py-2">{t("stress.normal_col")}</th>
            <th scope="col" className="px-3 py-2">{t("stress.scenario_col")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="odd:bg-sand-100/60">
              <th scope="row" className="px-3 py-1.5 font-normal">
                {t(r.label)}
              </th>
              <td className="px-3 py-1.5">{r.a}</td>
              <td className={`px-3 py-1.5 ${r.a === r.b ? "" : "font-semibold"}`}>{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sowing and harvest dates of the farmer's main crops, as observed and in the scenario. */
function SowingShifts({ normal, scenario }: { normal: Analysis; scenario: Analysis }) {
  const { t, locale } = useI18n();
  const mains = new Set(normal.current.years.map((y) => y.main));
  const crops = rotationCrops(normal.current.years).filter((c) => mains.has(c.id) && !c.perennial);
  const day = (v: number | null) => (v === null ? "–" : dayMonth(v, locale));
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {crops.map((crop) => {
        const a = normal.fits.find((f) => f.cropId === crop.id)?.stats;
        const b = scenario.fits.find((f) => f.cropId === crop.id)?.stats;
        if (a === undefined || b === undefined) return null;
        return (
          <li key={crop.id}>
            {t("stress.sowing", {
              crop: cropName(crop.id, locale),
              from: day(a.sowDayMedian),
              to: day(b.sowDayMedian),
              hfrom: day(a.harvestDayMedian),
              hto: day(b.harvestDayMedian),
            })}
          </li>
        );
      })}
    </ul>
  );
}
