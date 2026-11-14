"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { createTranslator, type Locale, type Messages, type PartialMessages, type TranslateFn } from "@/lib/i18n";

interface I18nContextValue {
  locale: Locale;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  locale: Locale;
  /** The active dictionary (empty for English). */
  messages: PartialMessages;
  /** The complete English dictionary, used for missing keys. */
  fallback: Messages;
  children: ReactNode;
}

/** Gives client components `t()` in the language the server rendered with, so there is no flash. */
export function I18nProvider({ locale, messages, fallback, children }: I18nProviderProps) {
  const value = useMemo(
    () => ({ locale, t: createTranslator({ locale, messages, fallback }) }),
    [locale, messages, fallback],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  const value = use(I18nContext);
  if (value === null) throw new Error("useI18n() must be called inside <I18nProvider>.");
  return value;
}
