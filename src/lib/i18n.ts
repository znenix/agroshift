/**
 * i18n core (SPEC §7): supported locales, request-locale resolution and a typed `t()`.
 *
 * Pure TypeScript with no React or Next imports, so the same code runs in Server Components,
 * Client Components, `src/proxy.ts`, scripts and tests. Next-specific glue lives in
 * `src/app/i18n-server.ts` (server) and `src/components/I18nProvider.tsx` (client).
 */
import type enMessages from "../../locales/en.json";

export const LOCALES = ["uz", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when nothing in the request names a supported language (SPEC §7). */
export const DEFAULT_LOCALE: Locale = "uz";
/** Source of truth for keys; every other dictionary falls back to it (SPEC §7). */
export const FALLBACK_LOCALE: Locale = "en";

export const LANG_COOKIE = "lang";
export const LANG_QUERY_PARAM = "lang";
export const LANG_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/** BCP 47 tags for `<html lang>` and `Intl`. Uzbek is written in Latin script (SPEC §7). */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = { uz: "uz-Latn", ru: "ru", en: "en" };

/** Dictionaries are flat JSON objects with dotted keys; `en.json` defines the set of keys. */
export type MessageKey = keyof typeof enMessages;
export type Messages = Readonly<Record<MessageKey, string>>;
export type PartialMessages = Readonly<Partial<Record<MessageKey, string>>>;
export type MessageParams = Readonly<Record<string, string | number>>;
export type TranslateFn = (key: MessageKey, params?: MessageParams) => string;

export type MissingTranslation =
  | { kind: "key"; locale: Locale; key: MessageKey }
  | { kind: "param"; locale: Locale; key: MessageKey; param: string };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Maps "EN", " ru-RU " or "uz_Latn" to a supported locale; anything else to `null`. */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (value == null) return null;
  const primary = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return isLocale(primary) ? primary : null;
}

/** Supported locales named in an `Accept-Language` header, best first. `q=0` means "not acceptable". */
export function parseAcceptLanguage(header: string | null | undefined): Locale[] {
  if (!header) return [];
  const ranked: { locale: Locale; q: number; order: number }[] = [];
  header.split(",").forEach((range, order) => {
    const [tag, ...attributes] = range.split(";");
    const locale = parseLocale(tag);
    if (locale === null) return;
    const qAttribute = attributes.map((a) => a.trim()).find((a) => a.startsWith("q="));
    const q = qAttribute === undefined ? 1 : Number(qAttribute.slice(2));
    if (Number.isFinite(q) && q > 0) ranked.push({ locale, q, order });
  });
  ranked.sort((a, b) => b.q - a.q || a.order - b.order);
  return [...new Set(ranked.map((entry) => entry.locale))];
}

/**
 * Locale for a request, in SPEC §7 order: `?lang=` → `lang` cookie → `Accept-Language` → uz.
 * In the app, `src/proxy.ts` has already turned `?lang=` into the cookie before rendering.
 */
export function resolveLocale(sources: {
  query?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    parseLocale(sources.query) ??
    parseLocale(sources.cookie) ??
    parseAcceptLanguage(sources.acceptLanguage).at(0) ??
    DEFAULT_LOCALE
  );
}

/**
 * For a URL carrying `?lang=`: the locale it names (`null` if unsupported) and the same URL without
 * the parameter. Returns `null` when the URL has no `lang` parameter. Used by `src/proxy.ts`.
 */
export function splitLangParam(url: URL): { lang: Locale | null; location: URL } | null {
  if (!url.searchParams.has(LANG_QUERY_PARAM)) return null;
  const location = new URL(url.href);
  const lang = parseLocale(location.searchParams.get(LANG_QUERY_PARAM));
  location.searchParams.delete(LANG_QUERY_PARAM);
  return { lang, location };
}

/** `Intl.NumberFormat` for the locale, or English where the runtime lacks that locale's data (SPEC §7). */
export function numberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const tag = LOCALE_TAGS[locale];
  const usable = Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : LOCALE_TAGS[FALLBACK_LOCALE];
  return new Intl.NumberFormat(usable, options);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, options).format(value);
}

const defaultNumberFormats = new Map<Locale, Intl.NumberFormat>();

function defaultNumberFormat(locale: Locale): Intl.NumberFormat {
  let format = defaultNumberFormats.get(locale);
  if (format === undefined) {
    format = numberFormat(locale);
    defaultNumberFormats.set(locale, format);
  }
  return format;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Names of the `{placeholders}` in a message template, sorted. Used to check translations. */
export function placeholdersOf(template: string): string[] {
  return Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]).sort();
}

/**
 * Fills `{name}` placeholders. Numbers are formatted for the locale; pass pre-formatted strings for
 * years, IDs or values that need fixed decimals. A missing parameter stays visible as `{name}`.
 */
export function formatMessage(
  template: string,
  params: MessageParams | undefined,
  locale: Locale,
  onMissingParam?: (param: string) => void,
): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      onMissingParam?.(name);
      return placeholder;
    }
    return typeof value === "number" ? defaultNumberFormat(locale).format(value) : value;
  });
}

export interface TranslatorOptions {
  locale: Locale;
  /** The locale's dictionary; may be incomplete. */
  messages: PartialMessages;
  /** The complete English dictionary, used for keys the locale lacks. */
  fallback: Messages;
  /** Reports missing keys and parameters. Default: `console.warn` in development only (SPEC §7). */
  onMissing?: (issue: MissingTranslation) => void;
}

export function createTranslator({
  locale,
  messages,
  fallback,
  onMissing = warnInDevelopment,
}: TranslatorOptions): TranslateFn {
  return (key, params) => {
    let template = messages[key];
    if (template === undefined || template === "") {
      if (locale !== FALLBACK_LOCALE) onMissing({ kind: "key", locale, key });
      template = fallback[key];
    }
    return formatMessage(template, params, locale, (param) => onMissing({ kind: "param", locale, key, param }));
  };
}

function warnInDevelopment(issue: MissingTranslation): void {
  if (process.env.NODE_ENV !== "development") return;
  console.warn(
    issue.kind === "key"
      ? `[i18n] "${issue.key}" is missing in ${issue.locale}.json; showing English.`
      : `[i18n] "${issue.key}" (${issue.locale}) was called without {${issue.param}}.`,
  );
}
