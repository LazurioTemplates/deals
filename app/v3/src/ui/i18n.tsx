import { createContext, useContext, useMemo } from "react";
import { formatDate, formatMonth } from "../domain/common.ts";
import { formatAmount, formatBasisPoints, formatMoney, parseMoney } from "../domain/money.ts";
import { DEFAULT_LOCALE, type Locale, type Localized, pick } from "../i18n/locale.ts";

/**
 * Every text of the interface is written in both languages side by side,
 * `t("Firmy", "Companies")`, so neither can be forgotten and a screen never
 * mixes them. Amounts, numbers and dates follow the same language.
 */
export const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The words of a count: Czech has one, few (2–4) and many; English one and other. */
export interface CountWords {
  cs: { one: string; few: string; many: string };
  en: { one: string; other: string };
}

export function countWord(locale: Locale, count: number, words: CountWords): string {
  const rule = new Intl.PluralRules(locale).select(count);
  if (locale === "en") return rule === "one" ? words.en.one : words.en.other;
  return rule === "one" ? words.cs.one : rule === "few" ? words.cs.few : words.cs.many;
}

export const DEALS: CountWords = {
  cs: { one: "případ", few: "případy", many: "případů" },
  en: { one: "deal", other: "deals" },
};

export const DAYS: CountWords = {
  cs: { one: "den", few: "dny", many: "dní" },
  en: { one: "day", other: "days" },
};

export function useT() {
  const locale = useLocale();
  return useMemo(() => {
    const t = (cs: string, en: string) => pick(locale, cs, en);
    return Object.assign(t, {
      of: (text: Localized) => text[locale],
      /** `3 případy`, `5 případů`, `1 deal`: the number and its word. */
      count: (count: number, words: CountWords) => `${count} ${countWord(locale, count, words)}`,
    });
  }, [locale]);
}

/**
 * `2026-11-24T10:00:00+01:00` → `24. 11. 2026 10:00`: the date and the time
 * as they were written down, in the offset they were written in.
 */
export function formatDateTime(at: string, locale: Locale): string {
  const time = at.slice(11, 16);
  return `${formatDate(at.slice(0, 10), locale)} ${time}`;
}

/** Formatting and parsing in a language. */
export function formatIn(locale: Locale, currency = "CZK") {
  return {
    locale,
    money: (amount: number) => formatMoney(amount, currency, locale),
    amount: (amount: number) => formatAmount(amount, locale),
    rate: (basisPoints: number | null) =>
      basisPoints === null ? "–" : formatBasisPoints(basisPoints, locale),
    date: (value: string | undefined) => formatDate(value, locale),
    month: (value: string) => formatMonth(value, locale),
    dateTime: (value: string) => formatDateTime(value, locale),
    parseMoney: (text: string) => parseMoney(text, locale),
  };
}

export type Format = ReturnType<typeof formatIn>;

/** Formatting and parsing in the interface's language. */
export function useFormat(currency = "CZK"): Format {
  const locale = useLocale();
  return useMemo(() => formatIn(locale, currency), [locale, currency]);
}
