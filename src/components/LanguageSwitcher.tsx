"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE_S, LOCALE_TAGS, LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

/** Each language is named in itself, so every reader can find their own. */
const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { uz: "Oʻzbekcha", ru: "Русский", en: "English" };

/** Browser side effect for the click handler; kept outside the component (react-hooks/immutability). */
function storeLanguage(locale: Locale): void {
  document.cookie = `${LANG_COOKIE}=${locale}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE_S}; SameSite=Lax`;
}

/**
 * Stores the choice in the `lang` cookie and re-renders on the server (SPEC §7).
 * `router.refresh()` keeps client state, so a farmer's inputs survive a language switch.
 */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    storeLanguage(next);
    startTransition(() => router.refresh());
  }

  return (
    <div role="group" aria-label={t("lang.label")} className="flex gap-1">
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={LOCALE_TAGS[option]}
          aria-pressed={option === locale}
          disabled={isPending}
          onClick={() => choose(option)}
          className="rounded px-2.5 py-1.5 text-sm font-medium text-sand-50 hover:bg-white/10 focus-visible:outline-sand-50 disabled:opacity-60 aria-pressed:bg-sand-50 aria-pressed:text-forest-900"
        >
          {LANGUAGE_NAMES[option]}
        </button>
      ))}
    </div>
  );
}
