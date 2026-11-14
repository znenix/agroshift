"use client";

import { useI18n } from "@/components/I18nProvider";
import type { RegionsFile } from "@/lib/datafiles";

export type DemoFarm = RegionsFile["demo_farms"][number];

/** Step 1: demo farms whose data is built (SPEC §2). The map click comes in Phase 4. */
export function StepChoose({ farms, selectedId, onChoose }: { farms: readonly DemoFarm[]; selectedId: string | null; onChoose: (id: string) => void }) {
  const { t, locale } = useI18n();
  return (
    <section aria-labelledby="choose-title" className="space-y-4">
      <div>
        <h2 id="choose-title" className="text-2xl font-semibold text-forest-900">
          {t("field.choose.title")}
        </h2>
        <p className="mt-1 text-ink-muted">{t("field.choose.lead")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {farms.map((farm) => {
          const selected = farm.id === selectedId;
          return (
            <li key={farm.id}>
              <button
                type="button"
                onClick={() => onChoose(farm.id)}
                aria-pressed={selected}
                className="flex w-full flex-col items-start gap-1 rounded-lg border border-sand-300 bg-white px-4 py-3 text-left shadow-sm hover:border-forest-900 aria-pressed:border-2 aria-pressed:border-forest-900"
              >
                <span className="text-lg font-semibold text-forest-900">{farm.names[locale]}</span>
                <span className="text-sm text-ink-muted">{t("field.choose.near", { city: farm.city[locale] })}</span>
                <span className="text-xs text-ink-muted tabular-nums">
                  {farm.lat.toFixed(3)}° N, {farm.lon.toFixed(3)}° E
                </span>
                {selected && <span className="text-xs font-semibold text-forest-900">{t("field.choose.selected")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-ink-muted">{t("field.choose.more_coming")}</p>
    </section>
  );
}
