import type { Metadata } from "next";
import { getServerI18n } from "@/app/i18n-server";
import { DataVersions } from "@/components/about/DataVersions";
import { ATTRIBUTIONS, METHOD_REFERENCES } from "@/lib/attributions";
import {
  CLIMATOLOGY_FIRST_YEAR,
  CLIMATOLOGY_LAST_YEAR,
  DRY_YEAR_PERCENTILE,
  FIT_RECOMMENDED_MIN,
  FIT_RISKY_MIN,
  IRRIGATION_EFFICIENCY,
  MAX_MISSING_SHARE,
  NDVI_BARE_MAX,
  NDVI_GREEN_MIN,
  NDVI_RECENT_YEARS,
  SATELLITE_MISMATCH_MIN_COMPOSITES,
  TREND_ALPHA,
} from "@/lib/constants";
import type { MessageKey } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("about.title") };
}

const SECTIONS: ReadonlyArray<{ id: string; title: MessageKey }> = [
  { id: "sources", title: "about.sources.title" },
  { id: "methods", title: "about.methods.title" },
  { id: "assumptions", title: "about.assumptions.title" },
  { id: "limitations", title: "about.limits.title" },
  { id: "glossary", title: "about.glossary.title" },
  { id: "ai", title: "about.ai.title" },
];

const GLOSSARY: ReadonlyArray<{ term: MessageKey; text: MessageKey }> = [
  { term: "about.glossary.ndvi", text: "glossary.ndvi" },
  { term: "about.glossary.et", text: "glossary.et" },
  { term: "about.glossary.soil_moisture", text: "glossary.soil_moisture" },
  { term: "about.glossary.reanalysis", text: "glossary.reanalysis" },
  { term: "about.glossary.salinity", text: "glossary.salinity" },
  { term: "about.glossary.frost_free", text: "glossary.frost_free" },
  { term: "about.glossary.rotation", text: "glossary.rotation" },
  { term: "about.glossary.double_cropping", text: "glossary.double_cropping" },
];

const pct = (share: number) => Math.round(share * 100);

export default async function AboutPage() {
  const { t } = await getServerI18n();
  const years = { from: String(CLIMATOLOGY_FIRST_YEAR), to: String(CLIMATOLOGY_LAST_YEAR) };
  const methods: ReadonlyArray<[MessageKey, Record<string, string | number>]> = [
    ["about.method.climate", { ...years, missing: pct(MAX_MISSING_SHARE) }],
    ["about.method.et0", {}],
    ["about.method.rain", {}],
    [
      "about.method.water",
      { furrow: pct(IRRIGATION_EFFICIENCY.furrow), sprinkler: pct(IRRIGATION_EFFICIENCY.sprinkler), drip: pct(IRRIGATION_EFFICIENCY.drip), percentile: pct(DRY_YEAR_PERCENTILE) },
    ],
    ["about.method.frost", {}],
    ["about.method.trends", { alpha: TREND_ALPHA }],
    ["about.method.ndvi", { bare: NDVI_BARE_MAX, green: NDVI_GREEN_MIN }],
    ["about.method.satellite", { years: NDVI_RECENT_YEARS, runs: SATELLITE_MISMATCH_MIN_COMPOSITES }],
    ["about.method.fit", { good: FIT_RECOMMENDED_MIN, risky: FIT_RISKY_MIN, risky_top: FIT_RECOMMENDED_MIN - 1 }],
    ["about.method.rotation", {}],
    ["about.method.ranking", {}],
    ["about.method.scenario", {}],
  ];
  const assumptions: readonly MessageKey[] = [
    "about.assumption.crops",
    "about.assumption.cotton",
    "about.assumption.ph",
    "about.assumption.heat",
    "about.assumption.efficiency",
    "about.assumption.dry_year",
    "about.assumption.defaults",
    "about.assumption.decisions",
  ];
  const limits: readonly MessageKey[] = [
    "about.limit.power",
    "about.limit.modis",
    "about.limit.soil",
    "about.limit.salinity",
    "about.limit.money",
    "about.limit.advice",
  ];

  return (
    <article className="mx-auto max-w-3xl space-y-12 px-4 py-10 sm:py-14">
      <header className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-forest-900 sm:text-4xl">{t("about.title")}</h1>
        <p className="text-lg leading-relaxed">{t("about.lead")}</p>
        <nav aria-label={t("about.contents")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-water-700">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="underline-offset-2 hover:underline">
                  {t(s.title)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <section id="sources" aria-labelledby="sources-title" className="scroll-mt-6 space-y-4">
        <h2 id="sources-title" className="text-2xl font-semibold text-forest-900">
          {t("about.sources.title")}
        </h2>
        <p>{t("about.sources.lead")}</p>
        <ul className="space-y-4">
          {ATTRIBUTIONS.map((a) => (
            <li key={a.id} className="space-y-1 rounded-lg border border-sand-300 bg-white p-4">
              <p className="font-semibold">
                {a.name}
                {a.nasa && <span className="ml-2 rounded bg-forest-100 px-1.5 py-0.5 text-xs font-semibold text-forest-900">{t("about.nasa_dataset")}</span>}
              </p>
              <p>{t(a.use)}</p>
              <p lang="en" className="text-sm text-ink-muted">
                {a.citation}
              </p>
              <p className="text-sm">
                {a.licence !== null && <span className="mr-3">{t("about.licence", { licence: a.licence })}</span>}
                <a href={a.url} className="text-water-700 underline underline-offset-2" rel="noreferrer">
                  {a.url.replace(/^https:\/\//, "")}
                </a>
              </p>
            </li>
          ))}
        </ul>
        <DataVersions />
      </section>

      <section id="methods" aria-labelledby="methods-title" className="scroll-mt-6 space-y-3">
        <h2 id="methods-title" className="text-2xl font-semibold text-forest-900">
          {t("about.methods.title")}
        </h2>
        <p>{t("about.methods.lead")}</p>
        <ul className="list-disc space-y-2 pl-5">
          {methods.map(([key, params]) => (
            <li key={key}>{t(key, params)}</li>
          ))}
        </ul>
        <h3 className="pt-2 font-semibold">{t("about.references")}</h3>
        <ul lang="en" className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {METHOD_REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section id="assumptions" aria-labelledby="assumptions-title" className="scroll-mt-6 space-y-3">
        <h2 id="assumptions-title" className="text-2xl font-semibold text-forest-900">
          {t("about.assumptions.title")}
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          {assumptions.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section id="limitations" aria-labelledby="limits-title" className="scroll-mt-6 space-y-3">
        <h2 id="limits-title" className="text-2xl font-semibold text-forest-900">
          {t("about.limits.title")}
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          {limits.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section id="glossary" aria-labelledby="glossary-title" className="scroll-mt-6 space-y-3">
        <h2 id="glossary-title" className="text-2xl font-semibold text-forest-900">
          {t("about.glossary.title")}
        </h2>
        <dl className="space-y-3">
          {GLOSSARY.map(({ term, text }) => (
            <div key={term}>
              <dt className="font-semibold">{t(term)}</dt>
              <dd>{t(text)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="ai" aria-labelledby="ai-title" className="scroll-mt-6 space-y-3">
        <h2 id="ai-title" className="text-2xl font-semibold text-forest-900">
          {t("about.ai.title")}
        </h2>
        <p>{t("about.ai.code")}</p>
        <p>{t("about.ai.data")}</p>
        <p>{t("about.ai.translations")}</p>
      </section>

      <section aria-labelledby="endorse-title" className="space-y-2 rounded-lg border border-sand-300 bg-sand-100 p-4">
        <h2 id="endorse-title" className="font-semibold">
          {t("about.endorse.title")}
        </h2>
        <p>{t("footer.not_endorsed")}</p>
        <p>{t("common.disclaimer")}</p>
      </section>
    </article>
  );
}
