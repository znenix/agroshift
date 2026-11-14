"use client";

/** Versions and access dates of the built data (public/data/meta.json), with POWER's data reference. */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { powerDataReference } from "@/lib/attributions";
import { dataMetaSchema, type DataMeta } from "@/lib/datafiles";
import { sourceRef } from "@/lib/datasources";
import { fetchStatic } from "@/lib/staticdata";

export function DataVersions() {
  const { t } = useI18n();
  const [meta, setMeta] = useState<DataMeta | null | "error">(null);
  useEffect(() => {
    let live = true;
    fetchStatic("/data/meta.json", dataMetaSchema).then(
      (m) => live && setMeta(m),
      () => live && setMeta("error"),
    );
    return () => {
      live = false;
    };
  }, []);
  if (meta === null) return <p className="text-sm text-ink-muted">{t("field.loading")}</p>;
  if (meta === "error") return <p className="text-sm text-ink-muted">{t("about.versions_unavailable")}</p>;
  const power = meta.retrieved.find((r) => r.id === "nasa-power");
  return (
    <div className="space-y-2 rounded-lg border border-sand-300 bg-white p-4 text-sm">
      <p className="font-medium">{t("about.versions_title", { built: meta.built })}</p>
      <ul className="space-y-0.5">
        {meta.retrieved.map((r) => (
          <li key={r.id}>
            {sourceRef(r.id, null).label}: {r.from === r.to ? t("about.accessed_on", { date: r.from }) : t("about.accessed_between", { from: r.from, to: r.to })}
          </li>
        ))}
      </ul>
      {power !== undefined &&
        meta.power_api_versions.map((v) => (
          <blockquote key={v} lang="en" className="border-l-4 border-sand-300 pl-3 text-ink-muted italic">
            {powerDataReference(v, power.to)}
          </blockquote>
        ))}
    </div>
  );
}
