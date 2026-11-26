import { z } from "zod";
import {
  nextNumber,
  optionalText,
  slug,
  text,
  writeRevision,
  writtenAt,
  writtenBy,
} from "./common.ts";
import { money } from "./money.ts";

/**
 * An item of the Organization's price list („Ceník“,
 * `data/pricebook/<id>.yaml`), id `I-0001`. A quote line may start from it:
 * the line copies the name, the unit and the price, so a later change of the
 * price list never changes a quote already written. An item no longer sold
 * stays with `active: false`.
 */
export const PRICEBOOK_ITEM_ID = /^I-[0-9]{4,6}$/;
export const pricebookItemId = z.string().regex(PRICEBOOK_ITEM_ID, { message: "expected I-0001" });

export const pricebookItem = z.strictObject({
  id: pricebookItemId,
  name: text,
  code: optionalText.describe("The Organization's own code of the item."),
  description: optionalText,
  unit: text,
  unitPrice: money.describe("The price of one unit without VAT, in haléře."),
  sectionId: slug.optional().describe("The quote section a line from it goes to by default."),
  active: z.boolean(),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type PricebookItem = z.infer<typeof pricebookItem>;

/** The next free price list id after the highest one used: `I-0013`. */
export function nextPricebookItemId(existing: readonly string[]): string {
  return `I-${String(nextNumber(existing, /^I-([0-9]+)$/)).padStart(4, "0")}`;
}
