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
import { contactId } from "./contact.ts";
import { money, probability } from "./money.ts";
import { type Settings, type Stage, stageById } from "./settings.ts";

/** A deal: one sale in the pipeline (`data/deals/<id>.yaml`), id `D-2026-0001`. */
export const DEAL_ID = /^D-[0-9]{4}-[0-9]{4}$/;
export const dealId = z.string().regex(DEAL_ID, { message: "expected D-2026-0001" });

/** A quote of the neighbouring Quotes Module the deal names; its existence is not checked. */
export const quoteRef = z.strictObject({ id: text });

export const deal = z.strictObject({
  id: dealId,
  title: text,
  companyId,
  contactIds: z.array(contactId).optional(),
  owner: text,
  stageId: slug,
  value: money,
  probability: probability
    .optional()
    .describe("The chance the deal is won when it differs from its stage's probability."),
  createdAt: isoDate.describe(
    "The day the deal entered the pipeline; the sales cycle starts here.",
  ),
  expectedClose: isoDate.optional(),
  closedAt: isoDate
    .optional()
    .describe("The day the deal was won or lost; required in a won or lost stage, never open."),
  lossReasonId: slug.optional().describe("Why it was lost; required in the lost stage, else none."),
  lossNote: optionalText,
  quoteRef: quoteRef.optional(),
  description: optionalText,
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Deal = z.infer<typeof deal>;

/** The next free deal id of a year: `D-2026-0015` after `D-2026-0014`. */
export function nextDealId(year: string | number, existing: readonly string[]): string {
  const prefix = `D-${year}-`;
  const pattern = new RegExp(`^D-${year}-([0-9]+)$`);
  return `${prefix}${String(nextNumber(existing, pattern)).padStart(4, "0")}`;
}

/** The stage of a deal, or undefined when its stage id names none. */
export function stageOf(value: Pick<Deal, "stageId">, settings: Pick<Settings, "stages">) {
  return stageById(settings, value.stageId);
}

/** The probability a deal counts with: its own, else its stage's, else 0. */
export function probabilityOf(value: Pick<Deal, "probability">, stage: Stage | undefined): number {
  return value.probability ?? stage?.probability ?? 0;
}
