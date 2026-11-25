import { z } from "zod";
import type { Locale } from "../i18n/locale.ts";

/**
 * Money is counted in minor units of the currency (haléře for CZK, cents for
 * EUR) as safe integers, never as floating-point crowns: `139000` is
 * 1 390,00 Kč. Every product goes through BigInt and every division rounds
 * half up, so the same pipeline gives the same haléře on every machine.
 */
export const MAX_AMOUNT = 100_000_000_000_000; // one trillion crowns, in haléře

export const money = z
  .int()
  .min(0)
  .max(MAX_AMOUNT)
  .describe("An amount in minor units of the currency (haléře): 139000 = 1 390,00 Kč.");

/** A probability in whole percent, 0–100. */
export const probability = z.int().min(0).max(100).describe("A probability in whole percent.");

/**
 * Integer division rounded half up (half away from zero for a negative
 * numerator), never to the even neighbour: 5 / 10 → 1, 25 / 10 → 3.
 */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("the denominator must be positive");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** A BigInt amount as a safe number; refuses anything beyond safe integers. */
export function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("the amount is too large");
  }
  return Number(value);
}

/**
 * An amount weighted by a probability, kept exact as hundredths of a haléř
 * (`value × percent`): a sum of these is divided by 100 once, so the haléře
 * are rounded only in the total (`weightedTotal`).
 */
export function weightedHundredths(amount: number, percent: number): bigint {
  return BigInt(amount) * BigInt(percent);
}

/** A sum of weighted hundredths in whole haléře, rounded half up. */
export function weightedTotal(hundredths: bigint): number {
  return safe(roundDiv(hundredths, 100n));
}

/** The average of amounts in whole haléře, rounded half up; null for none. */
export function averageAmount(amounts: readonly number[]): number | null {
  if (amounts.length === 0) return null;
  const sum = amounts.reduce((acc, amount) => acc + BigInt(amount), 0n);
  return safe(roundDiv(sum, BigInt(amounts.length)));
}

/** The sum of amounts, exact; refuses a sum beyond safe integers. */
export function sumAmounts(amounts: readonly number[]): number {
  return safe(amounts.reduce((acc, amount) => acc + BigInt(amount), 0n));
}

/**
 * Parses a decimal number as people type it into an integer scaled by
 * `10^decimals`, without floating point. In English a comma groups
 * thousands and a dot is the decimal mark (`1,234.5`). In Czech a comma is
 * the decimal mark; a dot is one too when it is the only mark, and with both
 * the last one is (`1 234,5`, `1.234,5`, `12.5`). Spaces and non-breaking
 * spaces group thousands. Returns null for anything else or for more
 * decimals than allowed: `1 234,5` → 123450 for two decimals.
 */
export function parseScaled(input: string, decimals: number, locale: Locale = "cs"): number | null {
  let value = input.replace(/[\s  ]/g, "").replace(/^(Kč|CZK|EUR|€)|(Kč|CZK|EUR|€|%)$/gi, "");
  if (value === "") return null;
  const negative = value.startsWith("-");
  if (negative || value.startsWith("+")) value = value.slice(1);
  let separator: "," | "." | null = null;
  if (locale === "en") {
    value = value.replace(/,/g, "");
    separator = value.includes(".") ? "." : null;
    if (value.indexOf(".") !== value.lastIndexOf(".")) return null;
  } else {
    const lastComma = value.lastIndexOf(",");
    const lastDot = value.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) separator = lastComma > lastDot ? "," : ".";
    else if (lastComma >= 0) separator = value.indexOf(",") === lastComma ? "," : null;
    else if (lastDot >= 0) separator = value.indexOf(".") === lastDot ? "." : null;
  }
  let whole = value;
  let fraction = "";
  if (separator) {
    const at = value.lastIndexOf(separator);
    whole = value.slice(0, at);
    fraction = value.slice(at + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  if (!/^[0-9]+$/.test(whole || "0") || !/^[0-9]*$/.test(fraction)) return null;
  if (fraction.length > decimals) {
    if (/[^0]/.test(fraction.slice(decimals))) return null;
    fraction = fraction.slice(0, decimals);
  }
  const scaled =
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return negative ? -Number(scaled) : Number(scaled);
}

/** `1 234,50` → 123450 haléřů; null when it is not an amount. */
export function parseMoney(input: string, locale: Locale = "cs"): number | null {
  return parseScaled(input, 2, locale);
}

const NBSP = " ";
const SYMBOLS: Record<string, string> = { CZK: "Kč", EUR: "€" };

/** `123450` → `1 234,50` in Czech (non-breaking spaces), `1,234.50` in English. */
export function formatAmount(amount: number, locale: Locale = "cs"): string {
  const negative = amount < 0;
  const absolute = BigInt(Math.abs(amount));
  const group = locale === "en" ? "," : NBSP;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}${whole}${locale === "en" ? "." : ","}${fraction}`;
}

/** `123450` → `1 234,50 Kč` in Czech, `CZK 1,234.50` in English. */
export function formatMoney(amount: number, currency = "CZK", locale: Locale = "cs"): string {
  if (locale === "en") return `${currency}${NBSP}${formatAmount(amount, locale)}`;
  return `${formatAmount(amount, locale)}${NBSP}${SYMBOLS[currency] ?? currency}`;
}

/** Basis points as a percentage: `6000` → `60 %` in Czech, `60%` in English; `3333` → `33,33 %`. */
export function formatBasisPoints(basisPoints: number, locale: Locale = "cs"): string {
  const whole = Math.trunc(basisPoints / 100);
  const rest = Math.abs(basisPoints % 100);
  const number =
    rest === 0
      ? String(whole)
      : `${whole}${locale === "en" ? "." : ","}${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  return locale === "en" ? `${number}%` : `${number}${NBSP}%`;
}
