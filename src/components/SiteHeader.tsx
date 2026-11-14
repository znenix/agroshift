"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";

const NAV_ITEMS: ReadonlyArray<{ href: "/" | "/field" | "/about"; label: MessageKey }> = [
  { href: "/", label: "nav.home" },
  { href: "/field", label: "nav.field" },
  { href: "/about", label: "nav.about" },
];

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <header className="bg-forest-900 text-sand-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="rounded text-lg font-semibold tracking-tight focus-visible:outline-sand-50">
          {t("app.name")}
        </Link>
        <nav aria-label={t("nav.label")}>
          <ul className="flex flex-wrap gap-1">
            {NAV_ITEMS.map(({ href, label }) => {
              const isCurrent = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isCurrent ? "page" : undefined}
                    className="block rounded px-3 py-1.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-sand-50 aria-[current=page]:underline aria-[current=page]:underline-offset-4"
                  >
                    {t(label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
