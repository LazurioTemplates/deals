import type { Locale } from "../../../i18n/locale.ts";

/**
 * Words and short forms the forecast and the statistics show: month names,
 * an amount in whole crowns for a tile, a change against an earlier period.
 */
const MONTHS: Record<Locale, string[]> = {
  cs: [
    "leden",
    "únor",
    "březen",
    "duben",
    "květen",
    "červen",
    "červenec",
    "srpen",
    "září",
    "říjen",
    "listopad",
    "prosinec",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const SHORT: Record<Locale, string[]> = {
  cs: ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** `2026-11` → `listopad` / `November`. */
export function monthName(month: string, locale: Locale): string {
  return MONTHS[locale][Number(month.slice(5, 7)) - 1] ?? month;
}

/** `2026-11` → `lis 26` / `Nov 26`: a month under a column. */
export function monthShort(month: string, locale: Locale, withYear = true): string {
  const name = SHORT[locale][Number(month.slice(5, 7)) - 1] ?? month;
  return withYear ? `${name} ${month.slice(2, 4)}` : name;
}

/** `2026-11-24` → `24. 11.` / `24 Nov`: a day under a column. */
export function dayShort(date: string, locale: Locale): string {
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  return locale === "en" ? `${day} ${SHORT.en[month - 1] ?? month}` : `${day}. ${month}.`;
}

/** A formatted amount without its `,00` / `.00` when it is whole crowns. */
export function withoutZeroCents(formatted: string): string {
  return formatted.replace(/([0-9])[,.]00(?![0-9])/, "$1");
}

/**
 * A change against an earlier period as a person reads it: `▲ 12 %`,
 * `▼ 3,5 %`, `= 0 %`; `nové` / `new` when there was nothing before.
 */
export function changeText(
  basisPoints: number | null,
  rate: (basisPoints: number) => string,
  locale: Locale,
): string {
  if (basisPoints === null) return locale === "en" ? "new" : "nové";
  if (basisPoints === 0) return `= ${rate(0)}`;
  return `${basisPoints > 0 ? "▲" : "▼"} ${rate(Math.abs(basisPoints))}`;
}
