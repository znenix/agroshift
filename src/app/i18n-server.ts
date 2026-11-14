import { cookies, headers } from "next/headers";
import { cache } from "react";
import { dictionaries, fallbackMessages } from "@/lib/dictionaries";
import { createTranslator, LANG_COOKIE, resolveLocale, type Locale, type TranslateFn } from "@/lib/i18n";

/**
 * Language of the current request (SPEC §7): `lang` cookie → `Accept-Language` → uz.
 * `?lang=` has already been turned into the cookie by `src/proxy.ts`. Memoised per request.
 */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LANG_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
});

/** `t()` for Server Components, in the request's language. */
export const getServerI18n = cache(async (): Promise<{ locale: Locale; t: TranslateFn }> => {
  const locale = await getRequestLocale();
  return { locale, t: createTranslator({ locale, messages: dictionaries[locale], fallback: fallbackMessages }) };
});
