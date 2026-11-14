/** Display helpers: crop and rotation names, reason parameters, dates (no React). */
import { CROPS } from "./catalog";
import type { Reason } from "./crops";
import { LOCALE_TAGS, type Locale, type MessageParams } from "./i18n";
import type { RotationYear } from "./rotations";

export function cropName(id: string, locale: Locale): string {
  return CROPS.get(id)?.names[locale] ?? id;
}

/** "Alfalfa ×3 → Cotton ×2 → Winter wheat + Mung bean" (consecutive equal years are grouped). */
export function rotationName(years: readonly RotationYear[], locale: Locale): string {
  const parts: Array<{ label: string; count: number }> = [];
  for (const y of years) {
    const label = y.second === null ? cropName(y.main, locale) : `${cropName(y.main, locale)} + ${cropName(y.second, locale)}`;
    const last = parts[parts.length - 1];
    if (last !== undefined && last.label === label) last.count++;
    else parts.push({ label, count: 1 });
  }
  return parts.map((p) => (p.count > 1 ? `${p.label} ×${p.count}` : p.label)).join(" → ");
}

/** Reason parameters with crop ids swapped for crop names in the reader's language. */
export function reasonParams(reason: Reason, locale: Locale): MessageParams {
  const params: Record<string, string | number> = { ...reason.params };
  const crop = reason.params.crop;
  if (typeof crop === "string") params.crop = cropName(crop, locale);
  return params;
}

/** Day of the year (1 = 1 January; values beyond the year wrap) as "15 Apr" in the reader's language. */
export function dayMonth(dayOfYear: number, locale: Locale): string {
  const day = ((Math.round(dayOfYear) - 1) % 365 + 365) % 365;
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(2025, 0, 1 + day));
}

export function isoDayMonth(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** Short month name, month 1–12. */
export function monthShort(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "short", timeZone: "UTC" }).format(Date.UTC(2025, month - 1, 1));
}
