"use client";

/** Step 3: the farmer's current rotation, priorities, constraints and optional soil test (SPEC §2, §5.10). */
import { useId } from "react";
import { InfoTip } from "@/components/badges";
import { useI18n } from "@/components/I18nProvider";
import type { FarmAnswers } from "@/lib/analysis";
import { CROP_LIST, ROTATION_TEMPLATES } from "@/lib/catalog";
import { PRIORITY_MAX } from "@/lib/constants";
import { cropName, rotationName } from "@/lib/format";
import { PRIORITIES, type WaterReliability } from "@/lib/ranking";
import type { RotationYear } from "@/lib/rotations";

export const OWN_ROTATION_ID = "own";
const MAX_YEARS = 10;
const RELIABILITY: readonly WaterReliability[] = ["reliable", "sometimes_short", "often_short"];
const IRRIGATION = ["furrow", "sprinkler", "drip"] as const;
const MAIN_CROPS = CROP_LIST.filter((c) => c.sowing.main !== null);
const SECOND_CROPS = CROP_LIST.filter((c) => c.sowing.second !== null);

export function StepFarm({ answers, onChange }: { answers: FarmAnswers; onChange: (next: FarmAnswers) => void }) {
  const { t, locale } = useI18n();
  const isOwn = answers.current.id === OWN_ROTATION_ID;
  const farmer = answers.farmer;
  const setFarmer = (patch: Partial<FarmAnswers["farmer"]>) => onChange({ ...answers, farmer: { ...farmer, ...patch } });
  const setYears = (years: RotationYear[]) => onChange({ ...answers, current: { id: OWN_ROTATION_ID, years } });
  const templates = ROTATION_TEMPLATES.filter((r) => r.conditions.mode === farmer.mode || r.id === answers.current.id);

  return (
    <div className="space-y-10">
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold text-forest-900">{t("farm.current")}</legend>
        <p className="text-sm text-ink-muted">{t("farm.current_lead")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-sand-300 bg-white px-3 py-2 has-checked:border-2 has-checked:border-forest-900">
              <input
                type="radio"
                name="current-rotation"
                className="mt-1 accent-forest-900"
                checked={answers.current.id === r.id}
                onChange={() => onChange({ ...answers, current: { id: r.id, years: r.years } })}
              />
              <span>{rotationName(r.years, locale)}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-sand-300 bg-white px-3 py-2 has-checked:border-2 has-checked:border-forest-900">
            <input
              type="radio"
              name="current-rotation"
              className="mt-1 accent-forest-900"
              checked={isOwn}
              onChange={() => setYears([...answers.current.years])}
            />
            <span>{t("farm.own")}</span>
          </label>
        </div>
        {isOwn && (
          <ol className="space-y-2">
            {answers.current.years.map((y, i) => (
              <li key={i} className="flex flex-wrap items-end gap-3 rounded-lg border border-sand-300 bg-sand-100 p-3">
                <span className="w-16 font-semibold">{t("farm.year", { n: i + 1 })}</span>
                <SelectField
                  label={t("farm.main_crop")}
                  value={y.main}
                  options={MAIN_CROPS.map((c) => ({ value: c.id, label: cropName(c.id, locale) }))}
                  onChange={(main) => setYears(answers.current.years.map((old, k) => (k === i ? { ...old, main } : old)))}
                />
                <SelectField
                  label={t("farm.second_crop")}
                  value={y.second ?? ""}
                  options={[{ value: "", label: t("farm.none") }, ...SECOND_CROPS.map((c) => ({ value: c.id, label: cropName(c.id, locale) }))]}
                  onChange={(second) => setYears(answers.current.years.map((old, k) => (k === i ? { ...old, second: second === "" ? null : second } : old)))}
                />
                {answers.current.years.length > 1 && (
                  <button
                    type="button"
                    className="rounded border border-sand-300 bg-white px-2 py-1 text-sm hover:border-forest-900"
                    onClick={() => setYears(answers.current.years.filter((_, k) => k !== i))}
                  >
                    {t("farm.remove_year", { n: i + 1 })}
                  </button>
                )}
              </li>
            ))}
            {answers.current.years.length < MAX_YEARS && (
              <li>
                <button
                  type="button"
                  className="rounded border border-forest-900 bg-white px-3 py-1.5 text-sm font-medium text-forest-900 hover:bg-forest-100"
                  onClick={() => setYears([...answers.current.years, { main: "cotton", second: null }])}
                >
                  {t("farm.add_year")}
                </button>
              </li>
            )}
          </ol>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold text-forest-900">{t("farm.priorities")}</legend>
        <p className="text-sm text-ink-muted">{t("farm.priorities_lead")}</p>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {PRIORITIES.map((p) => (
            <RangeField
              key={p}
              label={t(`priority.${p}`)}
              hint={t(`priority.${p}_hint`)}
              value={answers.priorities[p]}
              onChange={(v) => onChange({ ...answers, priorities: { ...answers.priorities, [p]: v } })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xl font-semibold text-forest-900">{t("farm.constraints")}</legend>
        <RadioRow
          label={t("farm.mode")}
          name="mode"
          value={farmer.mode}
          options={[
            { value: "irrigated", label: t("farm.mode.irrigated") },
            { value: "rainfed", label: t("farm.mode.rainfed") },
          ]}
          onChange={(mode) => setFarmer({ mode })}
        />
        {farmer.mode === "irrigated" && (
          <>
            <RadioRow
              label={t("farm.reliability")}
              name="reliability"
              value={answers.reliability}
              options={RELIABILITY.map((r) => ({ value: r, label: t(`reliability.${r}`) }))}
              onChange={(reliability) => onChange({ ...answers, reliability })}
            />
            <RadioRow
              label={t("farm.irrigation")}
              name="irrigation"
              value={farmer.irrigation}
              options={IRRIGATION.map((m) => ({ value: m, label: t(`irrigation.${m}`) }))}
              onChange={(irrigation) => setFarmer({ irrigation })}
            />
            <NumberField
              label={t("farm.allocation")}
              value={farmer.waterAllocationM3PerHa}
              min={0}
              max={30000}
              step={100}
              onChange={(waterAllocationM3PerHa) => setFarmer({ waterAllocationM3PerHa })}
            />
            <NumberField
              label={t("farm.cotton_share")}
              value={farmer.requiredShare === null ? null : Math.round(farmer.requiredShare.minShare * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(pct) => setFarmer({ requiredShare: pct === null || pct === 0 ? null : { crop: "cotton", minShare: pct / 100 } })}
            />
          </>
        )}
        <div>
          <p className="mb-1 font-medium">{t("farm.unavailable")}</p>
          <div className="flex flex-wrap gap-2">
            {CROP_LIST.map((c) => (
              <label key={c.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-sand-300 bg-white px-3 py-1 text-sm has-checked:border-forest-900 has-checked:bg-forest-100">
                <input
                  type="checkbox"
                  className="accent-forest-900"
                  checked={farmer.unavailableCrops.includes(c.id)}
                  onChange={(e) =>
                    setFarmer({
                      unavailableCrops: e.target.checked ? [...farmer.unavailableCrops, c.id] : farmer.unavailableCrops.filter((id) => id !== c.id),
                    })
                  }
                />
                {cropName(c.id, locale)}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold text-forest-900">{t("farm.soil_test")}</legend>
        <p className="text-sm text-ink-muted">
          {t("farm.soil_test_lead")} <InfoTip text={t("glossary.salinity")} />
        </p>
        <div className="flex flex-wrap gap-4">
          <NumberField label={t("farm.ece")} value={answers.soilTest.ece} min={0} max={40} step={0.1} onChange={(ece) => onChange({ ...answers, soilTest: { ...answers.soilTest, ece } })} />
          <NumberField label={t("farm.ph")} value={answers.soilTest.ph} min={3} max={11} step={0.1} onChange={(ph) => onChange({ ...answers, soilTest: { ...answers.soilTest, ph } })} />
        </div>
      </fieldset>
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-sand-300 bg-white px-2 py-1.5">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label} <InfoTip text={hint} />
        </label>
        <output htmlFor={id} className="text-lg font-semibold tabular-nums">
          {value}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={PRIORITY_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-forest-900"
      />
    </div>
  );
}

function RadioRow<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1">
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-sand-300 bg-white px-3 py-1 text-sm has-checked:border-forest-900 has-checked:bg-forest-100">
            <input type="radio" name={name} className="accent-forest-900" checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const v = raw === "" ? null : Number(raw);
          if (v === null) onChange(null);
          else if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        className="w-48 rounded border border-sand-300 bg-white px-2 py-1.5 tabular-nums"
      />
    </div>
  );
}
