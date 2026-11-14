import { describe, expect, it, vi } from "vitest";
import { dictionaries, fallbackMessages } from "@/lib/dictionaries";
import {
  createTranslator,
  formatMessage,
  formatNumber,
  LOCALES,
  parseAcceptLanguage,
  parseLocale,
  placeholdersOf,
  resolveLocale,
  splitLangParam,
  type MessageKey,
} from "@/lib/i18n";

const enKeys = Object.keys(fallbackMessages);

describe("locale resolution (SPEC §7)", () => {
  it("uses ?lang= first, then the cookie, then Accept-Language", () => {
    expect(resolveLocale({ query: "en", cookie: "ru", acceptLanguage: "uz" })).toBe("en");
    expect(resolveLocale({ cookie: "ru", acceptLanguage: "en-US,en;q=0.9" })).toBe("ru");
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
  });

  it("skips unsupported values and falls back to Uzbek", () => {
    expect(resolveLocale({})).toBe("uz");
    expect(resolveLocale({ query: "fr", cookie: "de", acceptLanguage: "fr-FR,de;q=0.8,*;q=0.1" })).toBe("uz");
    expect(resolveLocale({ cookie: "xx", acceptLanguage: "ru-RU" })).toBe("ru");
  });

  it("normalises case, region and script subtags", () => {
    expect(parseLocale("EN")).toBe("en");
    expect(parseLocale(" ru-RU ")).toBe("ru");
    expect(parseLocale("uz_Latn")).toBe("uz");
    expect(parseLocale("")).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });

  it("ranks Accept-Language by q, keeps header order on ties and drops q=0", () => {
    expect(parseAcceptLanguage("de-DE,ru;q=0.5,en-GB;q=0.8,uz-Cyrl-UZ;q=0.9")).toEqual(["uz", "en", "ru"]);
    expect(parseAcceptLanguage("ru;q=0.9, en-US;q=0.9, en")).toEqual(["en", "ru"]);
    expect(parseAcceptLanguage("ru;q=0,en")).toEqual(["en"]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe("?lang= handling for src/proxy.ts", () => {
  it("returns the locale and the URL without the parameter", () => {
    const split = splitLangParam(new URL("https://example.test/field?step=2&lang=EN"));
    expect(split?.lang).toBe("en");
    expect(split?.location.href).toBe("https://example.test/field?step=2");
  });

  it("drops an unsupported value without choosing a locale", () => {
    const split = splitLangParam(new URL("https://example.test/?lang=fr"));
    expect(split?.lang).toBeNull();
    expect(split?.location.href).toBe("https://example.test/");
  });

  it("leaves URLs without the parameter alone", () => {
    expect(splitLangParam(new URL("https://example.test/about?step=3"))).toBeNull();
  });
});

describe("translator", () => {
  it("returns the active locale's text", () => {
    const t = createTranslator({ locale: "ru", messages: dictionaries.ru, fallback: fallbackMessages });
    expect(t("nav.about")).toBe(dictionaries.ru["nav.about"]);
  });

  it("falls back to English and reports the missing key", () => {
    const onMissing = vi.fn();
    const t = createTranslator({ locale: "uz", messages: {}, fallback: fallbackMessages, onMissing });
    expect(t("nav.about")).toBe(fallbackMessages["nav.about"]);
    expect(onMissing).toHaveBeenCalledWith({ kind: "key", locale: "uz", key: "nav.about" });
  });

  it("treats an empty translation as missing", () => {
    const t = createTranslator({ locale: "ru", messages: { "nav.about": "" }, fallback: fallbackMessages, onMissing: vi.fn() });
    expect(t("nav.about")).toBe(fallbackMessages["nav.about"]);
  });

  it("does not report English as missing when it only has the fallback", () => {
    const onMissing = vi.fn();
    const t = createTranslator({ locale: "en", messages: {}, fallback: fallbackMessages, onMissing });
    expect(t("app.name")).toBe("AgroShift UZ");
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("message and number formatting", () => {
  it("fills placeholders and formats numbers for the locale", () => {
    const template = "{crop}: {loss} %";
    expect(formatMessage(template, { crop: "cotton", loss: 18.5 }, "en")).toBe("cotton: 18.5 %");
    expect(formatMessage(template, { crop: "paxta", loss: 18.5 }, "uz")).toBe("paxta: 18,5 %");
    expect(formatMessage(template, { crop: "хлопок", loss: 1234.5 }, "ru")).toBe("хлопок: 1 234,5 %");
  });

  it("keeps a missing parameter visible and reports it", () => {
    const onMissingParam = vi.fn();
    expect(formatMessage("{a} and {b}", { a: "x" }, "en", onMissingParam)).toBe("x and {b}");
    expect(onMissingParam).toHaveBeenCalledWith("b");
  });

  it("uses the locale's separators", () => {
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatNumber(1234.5, "uz")).toBe("1 234,5");
  });
});

describe("dictionaries (SPEC §7)", () => {
  it("has non-empty English text for every key", () => {
    for (const key of enKeys) {
      expect(fallbackMessages[key as MessageKey].trim(), key).not.toBe("");
    }
  });

  it("only uses English keys in uz and ru, with the same placeholders", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(dictionaries[locale])) {
        expect(enKeys, `${locale}.json has unknown key "${key}"`).toContain(key);
        expect(typeof text, `${locale}: ${key}`).toBe("string");
        expect(placeholdersOf(text ?? ""), `${locale}: ${key}`).toEqual(
          placeholdersOf(fallbackMessages[key as MessageKey]),
        );
      }
    }
  });

  it("writes Uzbek in Latin script (no Cyrillic letters in uz.json)", () => {
    for (const [key, text] of Object.entries(dictionaries.uz)) {
      expect(text, key).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});
