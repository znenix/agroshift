"use client";

/**
 * The /field flow (SPEC §2): choose field → field conditions → your farm → compare rotations → stress test →
 * 14-day forecast (Open-Meteo, not NASA; loaded only on that step). State
 * lives in the URL (?farm=&step= for a demo farm, ?lat=&lon=&step= for a map point) so a step can be
 * linked and the back button works. All engines run in the browser (SPEC §4.3): demo farms come from
 * static files, map points from prepared data only: the static climate cell and the region (lib/point.ts).
 */
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FieldBackdrop } from "@/components/backgrounds/FieldBackdrop";
import { useI18n } from "@/components/I18nProvider";
import { analyze, buildProfile, soilConditions, type FarmAnswers, type FieldProfile } from "@/lib/analysis";
import { CROPS, ROTATION_TEMPLATES } from "@/lib/catalog";
import { NORMAL_SCENARIO, type Scenario } from "@/lib/climate";
import type { BoundariesFile, RegionsFile } from "@/lib/datafiles";
import { todayIso } from "@/lib/dates";
import type { MessageKey, TranslateFn } from "@/lib/i18n";
import { fieldIndicators } from "@/lib/indicators";
import { powerCellFor } from "@/lib/geo";
import { cellDistanceKm, pointSite, pointSiteId, preparedPointData, regionOfPoint, roundCoord, type PointGap } from "@/lib/point";
import { ApiError, loadBoundaries, loadCell, loadFarm, loadRegions } from "@/lib/staticdata";
import { StepChoose, type DemoFarm, type PointInfo, type PointVia } from "./StepChoose";
import { StepCompare } from "./StepCompare";
import { StepConditions } from "./StepConditions";
import { StepFarm } from "./StepFarm";
import { StepForecast } from "./StepForecast";
import { StepStress } from "./StepStress";

const STEPS: ReadonlyArray<{ n: number; label: MessageKey }> = [
  { n: 1, label: "field.step.choose" },
  { n: 2, label: "field.step.conditions" },
  { n: 3, label: "field.step.farm" },
  { n: 4, label: "field.step.compare" },
  { n: 5, label: "field.step.stress" },
  { n: 6, label: "field.step.forecast" },
];
const COMPARE_STEP = 4;
const STRESS_STEP = 5;
const FORECAST_STEP = 6;
const LAST_STEP = FORECAST_STEP;
/** SPEC §5.11: re-run the engine about 100 ms after the last slider move. */
const SCENARIO_DEBOUNCE_MS = 100;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** The observed climate is always the NORMAL_SCENARIO object, so the engine can reuse precomputed values. */
const normalized = (s: Scenario): Scenario => (s.deltaT === 0 && s.rainFactor === 1 ? NORMAL_SCENARIO : s);

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };
const NO_GAPS: readonly PointGap[] = [];

/** A field to analyse: a demo farm, or any point inside Uzbekistan. */
type Site =
  | { kind: "demo"; key: string; farm: DemoFarm; defaultRotation: string }
  | { kind: "point"; key: string; lat: number; lon: number; defaultRotation: string };

/** ASSUMPTION: a map point starts from the standard cotton–wheat system (SPEC §1); the farmer changes it in step 3. */
const POINT_DEFAULT_ROTATION = "cotton_wheat";

interface Loaded {
  profile: FieldProfile;
  /** What could not be fetched for a map point (empty for demo farms). */
  gaps: PointGap[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** User-facing text for a loading error; point codes get their own sentence. */
function errorText(t: TranslateFn, load: { message: string; code?: string }): string {
  if (load.code === "outside_uzbekistan") return t("map.error.outside");
  if (load.code === "invalid_point") return t("map.error.invalid");
  return t("field.error", { message: load.message });
}

async function loadSite(site: Site, regions: RegionsFile, boundaries: BoundariesFile | null): Promise<Loaded> {
  const salinityOf = (region: string) => regions.regions.find((r) => r.id === region)?.salinity ?? null;
  if (site.kind === "demo") {
    const farm = await loadFarm(site.farm.id);
    return { profile: buildProfile(farm, salinityOf(farm.region)), gaps: [] };
  }
  // Prepared data only: no live ORNL/SoilGrids call for a map point (lib/point.ts).
  if (boundaries === null) throw new Error("boundaries not loaded");
  const regionId = regionOfPoint(site, boundaries);
  if (regionId === null) throw new ApiError("outside_uzbekistan", "The point is outside Uzbekistan.");
  const point = preparedPointData(site, regionId, todayIso());
  const cell = await loadCell(point.cell);
  const region = regions.regions.find((r) => r.id === point.region);
  const names = region?.names ?? { uz: point.region, ru: point.region, en: point.region };
  return { profile: buildProfile(pointSite(point, cell, names), salinityOf(point.region)), gaps: point.gaps };
}

/** Neutral defaults: every priority 1, irrigated furrow field; the current rotation is the demo farmer's answer. */
function defaultAnswers(rotationId: string): FarmAnswers {
  const template = ROTATION_TEMPLATES.find((r) => r.id === rotationId) ?? ROTATION_TEMPLATES[0];
  return {
    current: { id: template?.id ?? "own", years: template?.years ?? [{ main: "cotton", second: null }] },
    priorities: { water_saving: 1, soil_health: 1, forage: 1, income_market: 1, low_risk: 1, simplicity: 1 },
    reliability: "sometimes_short",
    farmer: {
      mode: "irrigated",
      irrigation: "furrow",
      waterAllocationM3PerHa: null,
      requiredShare: null,
      unavailableCrops: [],
      marketRating: {},
    },
    soilTest: { ece: null, ph: null },
  };
}

function navigate(params: { farm?: string; point?: { lat: number; lon: number }; step: number }) {
  const search = new URLSearchParams();
  if (params.farm !== undefined) search.set("farm", params.farm);
  if (params.point !== undefined) {
    search.set("lat", String(roundCoord(params.point.lat)));
    search.set("lon", String(roundCoord(params.point.lon)));
  }
  search.set("step", String(params.step));
  window.history.pushState(null, "", `/field?${search.toString()}`);
  window.scrollTo({ top: 0 });
}

export function FieldFlow() {
  const { t } = useI18n();
  const search = useSearchParams();
  const farmParam = search.get("farm");
  const latParam = Number(search.get("lat") ?? NaN);
  const lonParam = Number(search.get("lon") ?? NaN);
  const hasPoint = Number.isFinite(latParam) && Number.isFinite(lonParam);
  const pointLat = hasPoint ? roundCoord(latParam) : null;
  const pointLon = hasPoint ? roundCoord(lonParam) : null;
  const stepParam = Number(search.get("step") ?? (farmParam === null && !hasPoint ? 1 : 2));

  const [regions, setRegions] = useState<Load<RegionsFile>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadRegions().then(
      (value) => live && setRegions({ status: "ready", value }),
      (error: unknown) => live && setRegions({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, []);

  const [boundaries, setBoundaries] = useState<Load<BoundariesFile>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadBoundaries().then(
      (value) => live && setBoundaries({ status: "ready", value }),
      (error: unknown) => live && setBoundaries({ status: "error", message: messageOf(error) }),
    );
    return () => {
      live = false;
    };
  }, []);
  /** Step 1 message for a point that cannot be used (outside Uzbekistan). */
  const [pointNotice, setPointNotice] = useState<PointVia | null>(null);

  const farms = regions.status === "ready" ? regions.value.demo_farms : [];
  const demoFarm = farms.find((f) => f.id === farmParam) ?? null;
  const site = useMemo((): Site | null => {
    if (demoFarm !== null) return { kind: "demo", key: demoFarm.id, farm: demoFarm, defaultRotation: demoFarm.demo_rotation };
    if (pointLat !== null && pointLon !== null) {
      return { kind: "point", key: pointSiteId(pointLat, pointLon), lat: pointLat, lon: pointLon, defaultRotation: POINT_DEFAULT_ROTATION };
    }
    return null;
  }, [demoFarm, pointLat, pointLon]);
  const step = site === null ? 1 : Math.min(LAST_STEP, Math.max(1, Number.isFinite(stepParam) ? Math.round(stepParam) : 2));

  const [loads, setLoads] = useState<Readonly<Record<string, Load<Loaded> & { code?: string }>>>({});
  useEffect(() => {
    if (site === null || regions.status !== "ready" || loads[site.key] !== undefined) return;
    // A map point needs the outlines to find its region (a load error is shown below).
    if (site.kind === "point" && boundaries.status !== "ready") return;
    const key = site.key;
    let live = true;
    loadSite(site, regions.value, boundaries.status === "ready" ? boundaries.value : null).then(
      (value) => live && setLoads((l) => ({ ...l, [key]: { status: "ready", value } })),
      (error: unknown) =>
        live &&
        setLoads((l) => ({ ...l, [key]: { status: "error", message: messageOf(error), ...(error instanceof ApiError ? { code: error.code } : {}) } })),
    );
    return () => {
      live = false;
    };
  }, [site, regions, boundaries, loads]);

  const [answersBySite, setAnswersBySite] = useState<Readonly<Record<string, FarmAnswers>>>({});
  const defaults = useMemo(() => (site === null ? null : defaultAnswers(site.defaultRotation)), [site]);
  const answers = site === null ? null : (answersBySite[site.key] ?? defaults);
  const setAnswers = (next: FarmAnswers) => {
    if (site !== null) setAnswersBySite((a) => ({ ...a, [site.key]: next }));
  };
  const deferredAnswers = useDeferredValue(answers);

  const loaded = site === null ? undefined : loads[site.key];
  const profile = loaded?.status === "ready" ? loaded.value.profile : null;
  const gaps = loaded?.status === "ready" ? loaded.value.gaps : NO_GAPS;
  const soil = useMemo(() => (profile === null || answers === null ? null : soilConditions(profile, answers.soilTest)), [profile, answers]);
  const indicators = useMemo(() => (profile === null || soil === null ? [] : fieldIndicators(profile, soil)), [profile, soil]);
  const analysis = useMemo(
    () => (profile === null || deferredAnswers === null || step < COMPARE_STEP ? null : analyze(profile, CROPS, ROTATION_TEMPLATES, deferredAnswers)),
    [profile, deferredAnswers, step],
  );

  const [scenario, setScenario] = useState<Scenario>(NORMAL_SCENARIO);
  const debouncedScenario = useDebounced(scenario, SCENARIO_DEBOUNCE_MS);
  const stressed = useMemo(() => {
    const s = normalized(debouncedScenario);
    if (analysis === null || profile === null || deferredAnswers === null || step !== STRESS_STEP) return null;
    return s === NORMAL_SCENARIO ? analysis : analyze(profile, CROPS, ROTATION_TEMPLATES, deferredAnswers, s);
  }, [analysis, profile, deferredAnswers, debouncedScenario, step]);
  const scenarioPending = scenario.deltaT !== debouncedScenario.deltaT || scenario.rainFactor !== debouncedScenario.rainFactor;

  const pointInfo = useMemo((): PointInfo | null => {
    if (site?.kind !== "point" || boundaries.status !== "ready" || regions.status !== "ready") return null;
    const regionId = regionOfPoint(site, boundaries.value);
    const region = regions.value.regions.find((r) => r.id === regionId);
    return { lat: site.lat, lon: site.lon, regionNames: region?.names ?? null, cell: powerCellFor(site).id, km: cellDistanceKm(site) };
  }, [site, boundaries, regions]);

  /** A map click, the browser's location or typed coordinates: outside Uzbekistan stays on step 1 with a message. */
  const choosePoint = (lat: number, lon: number, via: PointVia) => {
    if (boundaries.status === "ready" && regionOfPoint({ lat, lon }, boundaries.value) === null) {
      setPointNotice(via);
      return;
    }
    setPointNotice(null);
    navigate({ point: { lat, lon }, step: 2 });
  };

  const go = (n: number) =>
    navigate({ ...(site?.kind === "demo" ? { farm: site.key } : {}), ...(site?.kind === "point" ? { point: site } : {}), step: n });

  return (
    <div className="space-y-6">
      {/* Decorative only (aria-hidden, behind everything): reads the step and the scenario, never changes them. */}
      <FieldBackdrop step={step} deltaT={scenario.deltaT} rainFactor={scenario.rainFactor} />
      <nav aria-label={t("field.steps_label")}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map(({ n, label }) => {
            const enabled = n === 1 || site !== null;
            return (
              <li key={n}>
                <button
                  type="button"
                  disabled={!enabled}
                  aria-current={n === step ? "step" : undefined}
                  onClick={() => go(n)}
                  className="flex items-center gap-2 rounded-full border border-sand-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 aria-[current=step]:border-forest-900 aria-[current=step]:bg-forest-900 aria-[current=step]:text-sand-50"
                >
                  <span className="tabular-nums">{n}</span>
                  {t(label)}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {regions.status === "loading" && <Skeleton label={t("field.loading")} />}
      {regions.status === "error" && <ErrorBox message={t("field.error", { message: regions.message })} />}

      {regions.status === "ready" && step === 1 && (
        <StepChoose
          farms={farms}
          selectedId={demoFarm?.id ?? null}
          point={site?.kind === "point" ? site : null}
          pointInfo={pointInfo}
          notice={pointNotice}
          onChoose={(id) => {
            setPointNotice(null);
            navigate({ farm: id, step: 2 });
          }}
          onPoint={choosePoint}
        />
      )}

      {step > 1 && loaded?.status === "error" && <ErrorBox message={errorText(t, loaded)} />}
      {step > 1 && site?.kind === "point" && boundaries.status === "error" && <ErrorBox message={t("field.error", { message: boundaries.message })} />}
      {step > 1 && !(site?.kind === "point" && boundaries.status === "error") && (loaded === undefined || loaded.status === "loading") && (
        <Skeleton label={t(site?.kind === "point" ? "map.loading_point" : "field.loading")} visible={site?.kind === "point"} />
      )}

      {profile !== null && answers !== null && soil !== null && (
        <>
          {step === 2 && <StepConditions profile={profile} indicators={indicators} soil={soil} gaps={gaps} />}
          {step === 3 && <StepFarm answers={answers} onChange={setAnswers} />}
          {step === COMPARE_STEP && (analysis === null ? <Skeleton label={t("field.loading")} /> : <StepCompare profile={profile} analysis={analysis} />)}
          {step === STRESS_STEP &&
            (analysis === null ? (
              <Skeleton label={t("field.loading")} />
            ) : (
              <StepStress profile={profile} normal={analysis} result={stressed ?? analysis} pending={scenarioPending} scenario={scenario} onScenario={setScenario} />
            ))}
          {step === FORECAST_STEP && (
            <StepForecast
              key={profile.farm.id}
              lat={profile.farm.point.lat}
              lon={profile.farm.point.lon}
              rotationYears={answers.current.years}
              irrigated={answers.farmer.mode === "irrigated"}
            />
          )}
        </>
      )}

      {site !== null && (
        <div className="flex justify-between border-t border-sand-300 pt-4">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 1} className="rounded border border-sand-300 bg-white px-4 py-2 font-medium disabled:invisible">
            {t("field.back")}
          </button>
          <button
            type="button"
            onClick={() => go(step + 1)}
            disabled={step === LAST_STEP}
            className="rounded bg-forest-900 px-4 py-2 font-medium text-sand-50 hover:bg-forest-900/90 disabled:invisible"
          >
            {t("field.next")}
          </button>
        </div>
      )}
    </div>
  );
}

function Skeleton({ label, visible = false }: { label: string; visible?: boolean }) {
  return (
    <div role="status" className="space-y-3">
      <span className={visible ? "block text-ink-muted" : "sr-only"}>{label}</span>
      <div aria-hidden className="h-8 w-1/3 animate-pulse rounded bg-sand-100" />
      <div aria-hidden className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-sand-100" />
        ))}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-status-critical bg-white px-4 py-3">
      {message}
    </p>
  );
}
