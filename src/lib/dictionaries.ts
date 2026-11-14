/**
 * The three UI dictionaries (SPEC §7). Import this from server code, scripts and tests only:
 * client components get their messages through <I18nProvider>, so dictionaries stay out of client bundles.
 */
import en from "../../locales/en.json";
import ru from "../../locales/ru.json";
import uz from "../../locales/uz.json";
import type { Locale, Messages, PartialMessages } from "./i18n";

export const fallbackMessages: Messages = en;

export const dictionaries: Readonly<Record<Locale, PartialMessages>> = { uz, ru, en };
