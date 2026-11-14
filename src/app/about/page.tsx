import type { Metadata } from "next";
import { getServerI18n } from "@/app/i18n-server";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("about.title") };
}

export default async function AboutPage() {
  const { t } = await getServerI18n();
  return <PagePlaceholder title={t("about.title")} note={t("common.under_construction")} />;
}
