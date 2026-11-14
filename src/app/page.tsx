import { getServerI18n } from "@/app/i18n-server";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export default async function HomePage() {
  const { t } = await getServerI18n();
  return <PagePlaceholder title={t("landing.title")} lead={t("landing.lead")} note={t("common.under_construction")} />;
}
