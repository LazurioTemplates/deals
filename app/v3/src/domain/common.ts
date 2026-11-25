import { z } from "zod";
import type { Locale } from "../i18n/locale.ts";

/** A calendar date as the records store it: `YYYY-MM-DD`, no time zone. */
export const isoDate = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, {
  message: "expected a date YYYY-MM-DD",
});

/**
 * An instant with a time and an offset: `2026-11-06T09:30:00+01:00` or
 * `2026-11-06T08:30Z`. Seconds and milliseconds are optional.
 */
export const isoDateTime = z
  .string()
  .regex(
    /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,3})?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$/,
    { message: "expected a date and time YYYY-MM-DDTHH:MM with an offset" },
  );

/** A non-empty line of text. */
export const text = z.string().trim().min(1);

/** An optional free text; an empty string is stored as no value. */
export const optionalText = z.string().trim().min(1).optional();

/**
 * The write revision of a stored record (`record.revision`): a new random
 * value every write of the data port stores (Lazurio Module Standard, "One
 * data port"). It is audit metadata, never business data: the port leaves it
 * out of the values it hands out and replaces it on every save.
 */
export const writeRevision = z
  .string()
  .min(1)
  .optional()
  .describe("A new random value on every write; audit metadata, not business data.");

/**
 * When the data port last wrote the record (`record.updatedAt`), UTC with
 * milliseconds. Together with `revision` and `updatedBy` it is
 * repository-db's audit bundle: two colleagues' changes of different fields
 * of one record merge, the later bundle is kept.
 */
export const writtenAt = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/, {
    message: "expected an instant YYYY-MM-DDTHH:MM:SS.sssZ",
  })
  .optional()
  .describe("When the App last wrote the record (UTC); audit metadata, not business data.");

/**
 * Who the data port wrote the record for (`record.updatedBy`): the person's
 * `subject` as the writer knows it, never a value a caller sent. A write
 * without a known person leaves it out. Audit metadata, not business data.
 */
export const writtenBy = z
  .string()
  .min(1)
  .optional()
  .describe("The subject of the person the App last wrote the record for; audit metadata.");

/** A lowercase identifier of a stage or a loss reason: `proposal`, `no-decision`. */
export const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "expected lowercase letters, digits and -" });

/** An ISO 4217 currency code. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, { message: "expected e.g. CZK" });

function utcDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/** The day after or before a date, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date(utcDay(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from one date to another: `2026-07-01` → `2026-09-14` is 75. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

/** The month of a date: `2026-11-06` → `2026-11`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Today in the Environment's local time zone, as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-11-06` → `6. 11. 2026` in Czech, `6 Nov 2026` in English. */
export function formatDate(date: string | undefined, locale: Locale = "cs"): string {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (locale === "en") return `${Number(day)} ${MONTHS_EN[Number(month) - 1] ?? month} ${year}`;
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

/** `2026-11` → `11/2026` in Czech, `Nov 2026` in English. */
export function formatMonth(month: string, locale: Locale = "cs"): string {
  const [year, number] = month.split("-");
  if (locale === "en") return `${MONTHS_EN[Number(number) - 1] ?? number} ${year}`;
  return `${Number(number)}/${year}`;
}

/** A slug of a name for a new id: `Bez rozhodnutí` → `bez-rozhodnuti`. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** The next free number after the highest one of ids matching `pattern` (one group). */
export function nextNumber(existing: readonly string[], pattern: RegExp): number {
  let highest = 0;
  for (const id of existing) {
    const match = pattern.exec(id);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}
