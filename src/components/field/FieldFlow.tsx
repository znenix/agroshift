"use client";

/**
 * The /field flow (SPEC §2): choose field → field conditions → your farm → compare rotations → stress test. State
 * lives in the URL (?farm=&step=) so a step can be linked and the back button works. All engines run
 * in the browser on static files (SPEC §4.3).
 */
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { analyze, buildProfile, soilConditions, type FarmAnswers, type FieldProfile } from "@/lib/analysis";
import { CROPS, ROTATION_TEMPLATES } from "@/lib/catalog";
import { NORMAL_SCENARIO, type Scenario } from "@/lib/climate";
import type { RegionsFile } from "@/lib/datafiles";
import type { MessageKey } from "@/lib/i18n";
import { fieldIndicators } from "@/lib/indicators";
import { loadFarm, loadRegions } from "@/lib/staticdata";
import { StepChoose, type DemoFarm } from "./StepChoose";
import { StepCompare } from "./StepCompare";
import { StepConditions } from "./StepConditions";
import { StepFarm } from "./StepFarm";
import { StepStress } from "./StepStress";

const STEPS: ReadonlyArray<{ n: number; label: MessageKey }> = [
  { n: 1, label: "field.step.choose" },
  { n: 2, label: "field.step.conditions" },
  { n: 3, label: "field.step.farm" },
  { n: 4, label: "field.step.compare" },
  { n: 5, label: "field.step.stress" },
];
const COMPARE_STEP = 4;
const STRESS_STEP = 5;
const LAST_STEP = STRESS_STEP;
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

/** Neutral defaults: every priority 1, irrigated furrow field; the current rotation is the demo farmer's answer. */
function defaultAnswers(farm: DemoFarm): FarmAnswers {
  const template = ROTATION_TEMPLATES.find((r) => r.id === farm.demo_rotation) ?? ROTATION_TEMPLATES[0];
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

function navigate(params: { farm: string | null; step: number }) {
  const search = new URLSearchParams();
  if (params.farm !== null) search.set("farm", params.farm);
  search.set("step", String(params.step));
  window.history.pushState(null, "", `/field?${search.toString()}`);
  window.scrollTo({ top: 0 });
}

export function FieldFlow() {
  const { t } = useI18n();
  const search = useSearchParams();
  const farmParam = search.get("farm");
  const stepParam = Number(search.get("step") ?? (farmParam === null ? 1 : 2));

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

  const farms = regions.status === "ready" ? regions.value.demo_farms : [];
  const demoFarm = farms.find((f) => f.id === farmParam) ?? null;
  const step = demoFarm === null ? 1 : Math.min(LAST_STEP, Math.max(1, Number.isFinite(stepParam) ? Math.round(stepParam) : 2));

  const [profiles, setProfiles] = useState<Readonly<Record<string, Load<FieldProfile>>>>({});
  useEffect(() => {
    if (demoFarm === null || regions.status !== "ready" || profiles[demoFarm.id] !== undefined) return;
    const id = demoFarm.id;
    const salinity = regions.value.regions.find((r) => r.id === demoFarm.region)?.salinity ?? null;
    let live = true;
    loadFarm(id).then(
      (farm) => live && setProfiles((p) => ({ ...p, [id]: { status: "ready", value: buildProfile(farm, salinity) } })),
      (error: unknown) => live && setProfiles((p) => ({ ...p, [id]: { status: "error", message: error instanceof Error ? error.message : String(error) } })),
    );
    return () => {
      live = false;
    };
  }, [demoFarm, regions, profiles]);

  const [answersByFarm, setAnswersByFarm] = useState<Readonly<Record<string, FarmAnswers>>>({});
  const defaults = useMemo(() => (demoFarm === null ? null : defaultAnswers(demoFarm)), [demoFarm]);
  const answers = demoFarm === null ? null : (answersByFarm[demoFarm.id] ?? defaults);
  const setAnswers = (next: FarmAnswers) => {
    if (demoFarm !== null) setAnswersByFarm((a) => ({ ...a, [demoFarm.id]: next }));
  };
  const deferredAnswers = useDeferredValue(answers);

  const loaded = demoFarm === null ? undefined : profiles[demoFarm.id];
  const profile = loaded?.status === "ready" ? loaded.value : null;
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

  const go = (n: number) => navigate({ farm: demoFarm?.id ?? null, step: n });

  return (
    <div className="space-y-6">
      <nav aria-label={t("field.steps_label")}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map(({ n, label }) => {
            const enabled = n === 1 || demoFarm !== null;
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
        <StepChoose farms={farms} selectedId={demoFarm?.id ?? null} onChoose={(id) => navigate({ farm: id, step: 2 })} />
      )}

      {step > 1 && loaded?.status === "error" && <ErrorBox message={t("field.error", { message: loaded.message })} />}
      {step > 1 && (loaded === undefined || loaded.status === "loading") && <Skeleton label={t("field.loading")} />}

      {profile !== null && answers !== null && soil !== null && (
        <>
          {step === 2 && <StepConditions profile={profile} indicators={indicators} soil={soil} />}
          {step === 3 && <StepFarm answers={answers} onChange={setAnswers} />}
          {step === COMPARE_STEP && (analysis === null ? <Skeleton label={t("field.loading")} /> : <StepCompare profile={profile} analysis={analysis} />)}
          {step === STRESS_STEP &&
            (analysis === null ? (
              <Skeleton label={t("field.loading")} />
            ) : (
              <StepStress profile={profile} normal={analysis} result={stressed ?? analysis} pending={scenarioPending} scenario={scenario} onScenario={setScenario} />
            ))}
        </>
      )}

      {demoFarm !== null && (
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

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
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
