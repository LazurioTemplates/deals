import { z } from "zod";
import { addDays, isoDate, optionalText, slug } from "./common.ts";
import { basisPointsOf, money, roundDiv, safe } from "./money.ts";

/**
 * The payment plan of a won deal: how its value is invoiced, month by month.
 * The forecast is these payments (and the manual rows of the forecast), never
 * a weighted guess over open deals.
 *
 * A plan is `planned` with one or more payments whose amounts sum exactly to
 * the deal's value, or `unassigned` while nobody has planned it yet (the
 * forecast shows such a deal among „Nezařazené“). A payment carries its own
 * state: an invoice issued (`invoicedOn`, and its `dueOn`), paid (`paidOn`).
 */
export const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
export const month = z.string().regex(MONTH, { message: "expected a month YYYY-MM" });

export const MAX_PAYMENTS = 12;

export const payment = z.strictObject({
  id: slug.describe("A short id unique within the plan: `p1`, `p2`."),
  month: month.describe("The month the payment is invoiced („Fakturační měsíc“)."),
  amount: money.describe("The amount without VAT, in haléře."),
  label: optionalText.describe("What it is: „Záloha“, „Doplatek“."),
  invoicedOn: isoDate.optional().describe("The day the invoice was issued."),
  dueOn: isoDate.optional().describe("The day the invoice is due."),
  paidOn: isoDate.optional().describe("The day it was paid."),
  note: optionalText,
});

export const PLAN_STATUSES = ["planned", "unassigned"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const paymentPlan = z.strictObject({
  status: z.enum(PLAN_STATUSES),
  reverseCharge: z
    .boolean()
    .optional()
    .describe("Whether the customer accounts for the VAT („Přenesená daňová povinnost“)."),
  payments: z.array(payment).max(MAX_PAYMENTS),
});

export type Payment = z.infer<typeof payment>;
export type PaymentPlan = z.infer<typeof paymentPlan>;

/** The state of one payment, derived and never stored. */
export const PAYMENT_STATES = ["planned", "invoiced", "overdue", "paid"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/**
 * Paid once it has a day it was paid; overdue when invoiced, unpaid and its
 * due date has passed; invoiced when an invoice was issued; else planned.
 */
export function paymentState(
  value: Pick<Payment, "invoicedOn" | "dueOn" | "paidOn">,
  today: string,
): PaymentState {
  if (value.paidOn) return "paid";
  if (value.invoicedOn) {
    if (value.dueOn && value.dueOn < today) return "overdue";
    return "invoiced";
  }
  return "planned";
}

/** The sum of a plan's payments. */
export function plannedTotal(plan: Pick<PaymentPlan, "payments">): number {
  return safe(plan.payments.reduce((sum, entry) => sum + BigInt(entry.amount), 0n));
}

/** A payment's share of a value, in basis points. */
export function shareOfValue(amount: number, value: number): number {
  return basisPointsOf(amount, value);
}

/** The month after or before a month: `2026-12` + 1 → `2027-01`. */
export function addMonths(value: string, count: number): string {
  const [year, monthNumber] = value.split("-").map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + count;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/**
 * Splits a value into payments by shares in basis points, month after month
 * from `first`: every payment but the last is its share rounded half up, the
 * last takes what is left, so the amounts always sum to the value.
 */
export function splitValue(value: number, shares: readonly number[], first: string): Payment[] {
  if (shares.length === 0 || shares.length > MAX_PAYMENTS) {
    throw new RangeError(`a plan has 1 to ${MAX_PAYMENTS} payments`);
  }
  let left = BigInt(value);
  return shares.map((share, index) => {
    const last = index === shares.length - 1;
    const amount = last ? left : roundDiv(BigInt(value) * BigInt(share), 10_000n);
    left -= amount;
    return { id: `p${index + 1}`, month: addMonths(first, index), amount: safe(amount) };
  });
}

/** One payment of the whole value in a month. */
export function singlePayment(value: number, inMonth: string): PaymentPlan {
  return { status: "planned", payments: splitValue(value, [10_000], inMonth) };
}

/** Equal shares of 10 000 basis points: 3 → 3334, 3333, 3333. */
export function equalShares(count: number): number[] {
  const base = Math.floor(10_000 / count);
  const rest = 10_000 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
}

/** A free payment id within a plan: `p3` when `p1` and `p2` exist. */
export function nextPaymentId(payments: readonly Pick<Payment, "id">[]): string {
  const used = new Set(payments.map((entry) => entry.id));
  let number = payments.length + 1;
  while (used.has(`p${number}`)) number += 1;
  return `p${number}`;
}

/** Whether a payment was invoiced or paid, so a change of the value no longer re-splits the plan. */
export function isSettled(value: Payment): boolean {
  return value.invoicedOn !== undefined || value.paidOn !== undefined;
}

/**
 * Marks a payment invoiced on a day, due `dueDays` later; unmarking takes the
 * invoice, the due date and the payment back.
 */
export function withInvoice(value: Payment, on: string | null, dueDays: number): Payment {
  const { invoicedOn: _invoiced, dueOn: _due, paidOn: _paid, ...rest } = value;
  if (on === null) return rest;
  return { ...rest, invoicedOn: on, dueOn: addDays(on, dueDays) };
}

/** Marks a payment paid on a day (invoicing it that day if it was not); `null` takes it back. */
export function withPaid(value: Payment, on: string | null, dueDays: number): Payment {
  const { paidOn: _paid, ...rest } = value;
  if (on === null) return rest;
  const invoiced = rest.invoicedOn ? rest : withInvoice(rest, on, dueDays);
  return { ...invoiced, paidOn: on };
}
