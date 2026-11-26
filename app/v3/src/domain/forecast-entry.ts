import { z } from "zod";
import {
  isoDate,
  nextNumber,
  optionalText,
  slug,
  text,
  writeRevision,
  writtenAt,
  writtenBy,
} from "./common.ts";
import { companyId } from "./company.ts";
import { dealId } from "./deal.ts";
import { money } from "./money.ts";
import { month } from "./payment-plan.ts";
import { salespersonId } from "./salesperson.ts";

/**
 * A manual row of the forecast (`data/forecastEntries/<id>.yaml`), id
 * `F-2026-0001`: an income expected in a month that no won deal plans, such
 * as a recurring fee or a contract signed outside the pipeline. It has the
 * state of a payment (invoice issued, due, paid) and may name the deal it
 * belongs to.
 */
export const FORECAST_ENTRY_ID = /^F-[0-9]{4}-[0-9]{4}$/;
export const forecastEntryId = z
  .string()
  .regex(FORECAST_ENTRY_ID, { message: "expected F-2026-0001" });

export const forecastEntry = z.strictObject({
  id: forecastEntryId,
  month,
  title: text,
  amount: money.describe("The amount without VAT, in haléře."),
  companyId: companyId.optional(),
  ownerId: salespersonId.optional(),
  dealTypeId: slug.optional(),
  billingEntityId: slug.optional(),
  dealId: dealId.optional(),
  reverseCharge: z.boolean().optional(),
  invoicedOn: isoDate.optional(),
  dueOn: isoDate.optional(),
  paidOn: isoDate.optional(),
  note: optionalText,
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type ForecastEntry = z.infer<typeof forecastEntry>;

/** The next free forecast row id of a year: `F-2026-0008`. */
export function nextForecastEntryId(year: string | number, existing: readonly string[]): string {
  const pattern = new RegExp(`^F-${year}-([0-9]+)$`);
  return `F-${year}-${String(nextNumber(existing, pattern)).padStart(4, "0")}`;
}

/**
 * A note on one month of the forecast (`data/forecastNotes/<month>.yaml`),
 * id the month itself: `2026-11`.
 */
export const forecastNote = z.strictObject({
  id: month,
  text: z.string().trim().min(1).max(4000),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type ForecastNote = z.infer<typeof forecastNote>;
