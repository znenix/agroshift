import type { Metadata } from "next";
import { getServerI18n } from "@/app/i18n-server";
import { I18nProvider } from "@/components/I18nProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { dictionaries, fallbackMessages } from "@/lib/dictionaries";
import { FALLBACK_LOCALE, LOCALE_TAGS } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  const name = t("app.name");
  return { title: { default: name, template: `%s · ${name}` }, description: t("app.description") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, t } = await getServerI18n();

  return (
    <html lang={LOCALE_TAGS[locale]} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <I18nProvider
          locale={locale}
          messages={locale === FALLBACK_LOCALE ? {} : dictionaries[locale]}
          fallback={fallbackMessages}
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-sand-50 focus:px-4 focus:py-2 focus:text-ink"
          >
            {t("a11y.skip_to_content")}
          </a>
          <SiteHeader />
          <p role="note" className="border-b border-sand-300 bg-forest-100 px-4 py-2 text-center text-sm text-forest-900">
            {t("common.disclaimer")}
          </p>
          <main id="main" className="flex-1">
            {children}
          </main>
          <footer className="border-t border-sand-300 bg-sand-100">
            <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-sm text-ink-muted">
              <p>{t("footer.event")}</p>
              <p>{t("footer.not_endorsed")}</p>
            </div>
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
