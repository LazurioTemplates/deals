import { monthOf } from "../../../domain/common.ts";
import { basisPointsOf, parseScaled, shareOf } from "../../../domain/money.ts";
import {
  addMonths,
  equalShares,
  MAX_PAYMENTS,
  MONTH,
  nextPaymentId,
  type Payment,
  type PaymentPlan,
  plannedTotal,
  splitValue,
} from "../../../domain/payment-plan.ts";
import type { Locale } from "../../../i18n/locale.ts";

/**
 * The arithmetic of the payment plan editor, pure so it is tested apart from
 * the page. Amounts are whole haléře and shares basis points; nothing here
 * multiplies floating-point crowns.
 */

/** The quick splits the editor offers, in basis points. */
export const QUICK_SPLITS: { id: string; label: string; shares: number[] }[] = [
  { id: "50-50", label: "50/50", shares: [5_000, 5_000] },
  { id: "30-40-30", label: "30/40/30", shares: [3_000, 4_000, 3_000] },
];

/** A share as people type it, `33,33` or `33.33` (percent, two decimals) → 3333 basis points. */
export function parseShare(text: string, locale: Locale): number | null {
  const value = parseScaled(text, 2, locale);
  if (value === null || value < 0 || value > 10_000) return null;
  return value;
}

/** 3333 → `33,33` in Czech, `33.33` in English; 5000 → `50`. */
export function shareText(basisPoints: number, locale: Locale): string {
  const whole = Math.trunc(basisPoints / 100);
  const rest = basisPoints % 100;
  if (rest === 0) return String(whole);
  const fraction = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${whole}${locale === "en" ? "." : ","}${fraction}`;
}

/** The amount of a share of the total, rounded half up. */
export function amountForShare(total: number, basisPoints: number): number {
  return shareOf(total, basisPoints);
}

/** The share of the total an amount is, in basis points. */
export function shareForAmount(amount: number, total: number): number {
  return basisPointsOf(amount, total);
}

/** A plan of one payment of the whole total in today's month: where a new plan starts. */
export function initialPlan(total: number, today: string, reverseCharge?: boolean): PaymentPlan {
  return {
    status: "planned",
    ...(reverseCharge ? { reverseCharge } : {}),
    payments: splitValue(total, [10_000], monthOf(today)),
  };
}

/**
 * New amounts by shares, keeping what the existing rows know beyond the
 * amount (id, month, label, invoice, payment, note) row by row; a row added
 * by the split takes the month after the row before it.
 */
export function resplit(
  payments: readonly Payment[],
  total: number,
  shares: readonly number[],
  firstMonth: string,
): Payment[] {
  const fresh = splitValue(total, shares, payments[0]?.month ?? firstMonth);
  const result: Payment[] = [];
  fresh.forEach((entry, index) => {
    const kept = payments[index];
    const previous = result.at(-1);
    result.push(
      kept
        ? { ...kept, amount: entry.amount }
        : {
            id: nextPaymentId(result),
            month: previous ? addMonths(previous.month, 1) : entry.month,
            amount: entry.amount,
          },
    );
  });
  return result;
}

/** Equal shares over `count` payments (1–12). */
export function equalSplit(
  payments: readonly Payment[],
  total: number,
  count: number,
  firstMonth: string,
): Payment[] {
  const clamped = Math.min(MAX_PAYMENTS, Math.max(1, count));
  return resplit(payments, total, equalShares(clamped), firstMonth);
}

/** One more payment: the month after the last one, the amount still missing (or 0). */
export function addPayment(payments: readonly Payment[], total: number, today: string): Payment[] {
  if (payments.length >= MAX_PAYMENTS) return [...payments];
  const last = payments.at(-1);
  const missing = total - plannedTotal({ payments: [...payments] });
  return [
    ...payments,
    {
      id: nextPaymentId(payments),
      month: last ? addMonths(last.month, 1) : monthOf(today),
      amount: Math.max(0, missing),
    },
  ];
}

/** A plan without its row at `index`; the last row stays. */
export function removePayment(payments: readonly Payment[], index: number): Payment[] {
  if (payments.length <= 1) return [...payments];
  return payments.filter((_, at) => at !== index);
}

/** The last row takes what makes the sum the total, when that is not negative. */
export function balanceLast(payments: readonly Payment[], total: number): Payment[] {
  if (payments.length === 0) return [];
  const others = plannedTotal({ payments: payments.slice(0, -1) });
  const rest = total - others;
  if (rest < 0) return [...payments];
  return [...payments.slice(0, -1), { ...(payments.at(-1) as Payment), amount: rest }];
}

/** What is missing to the total: positive when under, negative when over. */
export function difference(payments: readonly Payment[], total: number): number {
  return total - plannedTotal({ payments: [...payments] });
}

/**
 * Whether a plan can be saved: planned, 1–12 payments, each with a month,
 * and the amounts sum exactly to the total.
 */
export function planComplete(plan: PaymentPlan, total: number): boolean {
  return (
    plan.status === "planned" &&
    plan.payments.length >= 1 &&
    plan.payments.length <= MAX_PAYMENTS &&
    plan.payments.every((entry) => MONTH.test(entry.month) && entry.amount >= 0) &&
    plannedTotal(plan) === total
  );
}
