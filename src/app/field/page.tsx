import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerI18n } from "@/app/i18n-server";
import { FieldFlow } from "@/components/field/FieldFlow";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("field.title") };
}

export default async function FieldPage() {
  const { t } = await getServerI18n();
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-forest-900">{t("field.title")}</h1>
      <Suspense fallback={<p role="status">{t("field.loading")}</p>}>
        <FieldFlow />
      </Suspense>
    </div>
  );
}
