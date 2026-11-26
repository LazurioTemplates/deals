import { z } from "zod";
import {
  currencyCode,
  optionalText,
  slug,
  text,
  writeRevision,
  writtenAt,
  writtenBy,
} from "./common.ts";
import { address, ico } from "./company.ts";
import { basisPoints, probability } from "./money.ts";

/**
 * The settings of Deals, one record per data repository
 * (`data/settings/settings.yaml`). The stages of the pipeline, the reasons a
 * deal is lost, the types of deals, the entities that invoice and what a new
 * quote starts with are data the Organization edits in the App, never
 * constants in the code. The salespeople are a collection of their own
 * (`salespeople`).
 */
export const SETTINGS_ID = "settings";

/** How a stage counts: still open, won or lost. */
export const STAGE_KINDS = ["open", "won", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/**
 * One stage of the pipeline. Stages are kept in the order of the pipeline;
 * the probability of a stage is the default chance a deal in it is won.
 */
export const stage = z.strictObject({
  id: slug,
  label: text,
  kind: z.enum(STAGE_KINDS),
  probability,
});

/** Why a deal was lost: `price`, `competitor`. */
export const lossReason = z.strictObject({
  id: slug,
  label: text,
});

/** A type of deal („Typ zakázky“): `delivery`, `service`, `licence`. */
export const dealType = z.strictObject({
  id: slug,
  label: text,
});

/**
 * An entity of the Organization that issues quotes and invoices („Fakturační
 * firma“), printed as the supplier on a quote. An Organization with one
 * entity has one; the forecast groups by entity only when there are more.
 */
export const billingEntity = z.strictObject({
  id: slug,
  name: text,
  ico: ico.optional(),
  dic: optionalText,
  address: address.optional(),
  email: optionalText,
  phone: optionalText,
  website: optionalText,
  bankAccount: optionalText,
});

/** A section a quote's lines are grouped in: `hardware`, `work`. */
export const quoteSection = z.strictObject({
  id: slug,
  label: text,
});

/**
 * The texts of a quote's terms. Each is plain text with a light markup: a
 * line `## Heading` is a heading, a line `- item` a bullet, an empty line a
 * new paragraph.
 */
export const quoteTerms = z.strictObject({
  vatNote: optionalText.describe("The note on VAT („Poznámka k DPH“)."),
  payments: optionalText.describe("Payments and deposits („Platby a zálohy“)."),
  scope: optionalText.describe("Scope, assumptions and other conditions."),
});

/** What a new quote starts with. */
export const quoteDefaults = z.strictObject({
  vatRate: basisPoints.describe("The VAT rate of a new quote in basis points: 2100 = 21 %."),
  validityDays: z.int().min(1).max(365).describe("How many days a new quote is valid."),
  sections: z.array(quoteSection).min(1).describe("The sections a new quote offers, in order."),
  units: z.array(text).min(1).describe("The units a line offers: ks, h, MD, m …"),
  terms: quoteTerms.optional(),
  termsVersion: optionalText.describe("The version of the Organization's commercial terms."),
  termsUrl: optionalText.describe("Where the public commercial terms are published."),
});

export const settings = z.strictObject({
  currency: currencyCode.describe("The currency of every amount, ISO 4217; CZK by default."),
  stages: z
    .array(stage)
    .min(3)
    .describe(
      "The pipeline in order: at least one open stage, exactly one won (100) and one lost (0).",
    ),
  lossReasons: z.array(lossReason).min(1),
  dealTypes: z
    .array(dealType)
    .optional()
    .describe("The types of deals („Typ zakázky“) a deal and a forecast row may name."),
  billingEntities: z
    .array(billingEntity)
    .optional()
    .describe("The entities that issue quotes and invoices; the first one is the default."),
  quotes: quoteDefaults,
  paymentDueDays: z
    .int()
    .min(0)
    .max(365)
    .describe("Days from an invoice to its due date, unless a company has its own."),
  aresLookup: z.boolean().describe("Whether the App looks companies up in ARES by their IČO."),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Settings = z.infer<typeof settings>;
export type Stage = z.infer<typeof stage>;
export type LossReason = z.infer<typeof lossReason>;
export type DealType = z.infer<typeof dealType>;
export type BillingEntity = z.infer<typeof billingEntity>;
export type QuoteSection = z.infer<typeof quoteSection>;
export type QuoteTerms = z.infer<typeof quoteTerms>;
export type QuoteDefaults = z.infer<typeof quoteDefaults>;

/** The stage a stage id names, or undefined. */
export function stageById(value: Pick<Settings, "stages">, id: string): Stage | undefined {
  return value.stages.find((entry) => entry.id === id);
}

/** The loss reason a reason id names, or undefined. */
export function lossReasonById(
  value: Pick<Settings, "lossReasons">,
  id: string,
): LossReason | undefined {
  return value.lossReasons.find((entry) => entry.id === id);
}

/** The deal type an id names, or undefined. */
export function dealTypeById(
  value: Pick<Settings, "dealTypes">,
  id: string | undefined,
): DealType | undefined {
  if (id === undefined) return undefined;
  return value.dealTypes?.find((entry) => entry.id === id);
}

/** The billing entity an id names, or undefined. */
export function billingEntityById(
  value: Pick<Settings, "billingEntities">,
  id: string | undefined,
): BillingEntity | undefined {
  if (id === undefined) return undefined;
  return value.billingEntities?.find((entry) => entry.id === id);
}

/** The open stages in pipeline order. */
export function openStages(value: Pick<Settings, "stages">): Stage[] {
  return value.stages.filter((entry) => entry.kind === "open");
}

/** The won stage, or undefined while the settings break the rules. */
export function wonStage(value: Pick<Settings, "stages">): Stage | undefined {
  return value.stages.find((entry) => entry.kind === "won");
}

/** The lost stage, or undefined while the settings break the rules. */
export function lostStage(value: Pick<Settings, "stages">): Stage | undefined {
  return value.stages.find((entry) => entry.kind === "lost");
}
