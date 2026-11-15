import Link from "next/link";
import { getServerI18n } from "@/app/i18n-server";
import { HeroLandscape } from "@/components/backgrounds/HeroLandscape";

export default async function HomePage() {
  const { t } = await getServerI18n();
  return (
    // The landscape lives in the bottom padding band, below the text; behind the text only a faint sky tint.
    <div className="hero relative isolate overflow-hidden pb-[clamp(150px,30vw,280px)]">
      <HeroLandscape />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight text-forest-900 sm:text-4xl">{t("landing.title")}</h1>
        <p className="mt-4 text-lg leading-relaxed">{t("landing.lead")}</p>
        <p className="mt-3 text-lg leading-relaxed">{t("landing.pitch_data")}</p>
        <p className="mt-3 text-lg leading-relaxed">{t("landing.pitch_judgment")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/field" className="rounded bg-forest-900 px-5 py-3 text-lg font-semibold text-sand-50 hover:bg-forest-900/90">
            {t("landing.try_demo")}
          </Link>
          <Link href="/about" className="rounded border border-forest-900 px-5 py-3 text-lg font-semibold text-forest-900 hover:bg-forest-100">
            {t("landing.how_it_works")}
          </Link>
        </div>
      </div>
    </div>
  );
}
