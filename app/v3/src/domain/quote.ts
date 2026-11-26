import { z } from "zod";
import {
  currencyCode,
  isoDate,
  nextNumber,
  optionalText,
  slug,
  text,
  writeRevision,
  writtenAt,
  writtenBy,
} from "./common.ts";
import { address, companyId, ico } from "./company.ts";
import { contactId } from "./contact.ts";
import { dealId } from "./deal.ts";
import { basisPoints, lineAmount, money, quantity, shareOf } from "./money.ts";
import { pricebookItemId } from "./pricebook.ts";
import { quoteSection, quoteTerms } from "./settings.ts";

/**
 * A quote („Cenová nabídka“, `data/quotes/<id>.yaml`): one revision of the
 * offer of a deal. The quote number `Q-2026-0001` names the offer; every
 * revision is its own record (`version` 2, id `Q-2026-0001-r2`), so a revision sent to a
 * customer never changes when the next one is written.
 *
 * Amounts are haléře without VAT; the VAT rate is one per quote, in basis
 * points. The customer is a copy of the company as the quote was written, so
 * a printed quote stays what it was.
 */
export const QUOTE_NUMBER = /^Q-[0-9]{4}-[0-9]{4}$/;
export const QUOTE_ID = /^Q-[0-9]{4}-[0-9]{4}-r[0-9]{1,3}$/;
export const quoteNumber = z.string().regex(QUOTE_NUMBER, { message: "expected Q-2026-0001" });
export const quoteId = z.string().regex(QUOTE_ID, { message: "expected Q-2026-0001-r1" });

export const QUOTE_STATUSES = ["draft", "active", "approved", "superseded", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quoteLine = z.strictObject({
  id: slug.describe("A short id unique within the quote: `l1`, `l2`."),
  sectionId: slug,
  pricebookItemId: pricebookItemId.optional().describe("The price list item it came from."),
  name: text,
  description: optionalText,
  quantity,
  unit: text,
  unitPrice: money.describe("The price of one unit without VAT, in haléře."),
  discount: basisPoints.optional().describe("A discount of the line in basis points: 1000 = 10 %."),
});

export const quoteCustomer = z.strictObject({
  companyId: companyId.optional(),
  name: text,
  ico: ico.optional(),
  dic: optionalText,
  address: address.optional(),
});

/** How a quote's terms stand for one area of the commercial terms. */
export const TERMS_CHOICES = [
  "standard",
  "custom",
  "customer",
  "not-applicable",
  "excluded",
  "pending",
] as const;
export type TermsChoice = (typeof TERMS_CHOICES)[number];

/** The areas of the commercial terms a quote records a choice for. */
export const TERMS_AREAS = [
  "payments",
  "deposit",
  "ownership",
  "warranty",
  "liability",
  "service",
  "support",
  "sla",
  "changes",
] as const;
export type TermsArea = (typeof TERMS_AREAS)[number];

export const CUSTOMER_SCOPES = ["b2b", "b2c", "mixed", "unresolved"] as const;

/**
 * The record of the commercial terms a quote offered and the customer
 * accepted: which version, where it is published, the evidence of the
 * acceptance (a signed quote, an e-mail, a document path) and, per area,
 * whether the standard terms apply. Never the legal text itself.
 */
export const commercialTerms = z.strictObject({
  customerScope: z.enum(CUSTOMER_SCOPES),
  termsVersion: optionalText,
  termsUrl: optionalText,
  acceptedOn: isoDate.optional(),
  evidence: optionalText.describe("Where the acceptance can be found: a signed quote, an e-mail."),
  choices: z.partialRecord(z.enum(TERMS_AREAS), z.enum(TERMS_CHOICES)).optional(),
  note: optionalText,
});

export const quote = z.strictObject({
  id: quoteId,
  number: quoteNumber,
  version: z.int().min(1).max(999).describe("The revision of the quote („Revize“): 1, 2, 3."),
  dealId,
  status: z.enum(QUOTE_STATUSES),
  title: text,
  issuedOn: isoDate.describe("The day the quote was written („Vystaveno“)."),
  validUntil: isoDate.optional(),
  currency: currencyCode,
  billingEntityId: slug.optional().describe("The entity offering it, from the settings."),
  customer: quoteCustomer,
  contactId: contactId.optional(),
  vatRate: basisPoints,
  reverseCharge: z.boolean().optional(),
  sections: z.array(quoteSection).min(1),
  lines: z.array(quoteLine),
  changeReserve: money
    .optional()
    .describe("A reserve for changes outside the price („Rezerva na změny“), in haléře."),
  terms: quoteTerms.optional(),
  commercialTerms: commercialTerms.optional(),
  note: optionalText.describe("An internal note; never printed on the quote."),
  sentOn: isoDate.optional().describe("The day it became active (was sent)."),
  approvedOn: isoDate.optional().describe("The day the customer approved it."),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Quote = z.infer<typeof quote>;
export type QuoteLine = z.infer<typeof quoteLine>;
export type QuoteCustomer = z.infer<typeof quoteCustomer>;
export type CommercialTerms = z.infer<typeof commercialTerms>;

/** The id of a revision of a quote: `Q-2026-0001` and 2 → `Q-2026-0001-r2`. */
export function quoteRevisionId(number: string, version: number): string {
  return `${number}-r${version}`;
}

/** The next free quote number of a year: `Q-2026-0004` after `Q-2026-0003`. */
export function nextQuoteNumber(year: string | number, existing: readonly string[]): string {
  const pattern = new RegExp(`^Q-${year}-([0-9]+)$`);
  return `Q-${year}-${String(nextNumber(existing, pattern)).padStart(4, "0")}`;
}

/** A free line id within a quote: `l4` after `l1`–`l3`. */
export function nextLineId(lines: readonly Pick<QuoteLine, "id">[]): string {
  const used = new Set(lines.map((entry) => entry.id));
  let number = lines.length + 1;
  while (used.has(`l${number}`)) number += 1;
  return `l${number}`;
}

export interface SectionTotal {
  sectionId: string;
  label: string;
  /** Lines of the section, in order. */
  count: number;
  /** The sum of its lines without VAT, in haléře. */
  amount: number;
}

export interface QuoteTotals {
  /** Each line's amount, by line id. */
  lines: Record<string, number>;
  /** Sections that have a line, in the order of the quote. */
  sections: SectionTotal[];
  /** Everything without VAT. */
  subtotal: number;
  /** The VAT of the subtotal; 0 with reverse charge. */
  vat: number;
  /** The subtotal with VAT. */
  total: number;
  /** The subtotal with the reserve for changes, for planning. */
  planning: number;
  /** The amount the line discounts take off. */
  discount: number;
}

/**
 * The totals of a quote: each line rounded once to whole haléře, the
 * sections and the subtotal the sums of their lines, the VAT of the
 * subtotal rounded half up once.
 */
export function quoteTotals(
  value: Pick<Quote, "lines" | "sections" | "vatRate" | "reverseCharge" | "changeReserve">,
): QuoteTotals {
  const lines: Record<string, number> = {};
  const bySection = new Map<string, { count: number; amount: bigint }>();
  let subtotal = 0n;
  let gross = 0n;
  for (const line of value.lines) {
    const amount = lineAmount(line.unitPrice, line.quantity, line.discount ?? 0);
    gross += BigInt(lineAmount(line.unitPrice, line.quantity, 0));
    lines[line.id] = amount;
    subtotal += BigInt(amount);
    const section = bySection.get(line.sectionId) ?? { count: 0, amount: 0n };
    section.count += 1;
    section.amount += BigInt(amount);
    bySection.set(line.sectionId, section);
  }
  const sections: SectionTotal[] = value.sections.flatMap((section) => {
    const found = bySection.get(section.id);
    return found
      ? [
          {
            sectionId: section.id,
            label: section.label,
            count: found.count,
            amount: Number(found.amount),
          },
        ]
      : [];
  });
  const sub = Number(subtotal);
  const vat = value.reverseCharge ? 0 : shareOf(sub, value.vatRate);
  return {
    lines,
    sections,
    subtotal: sub,
    vat,
    total: sub + vat,
    planning: sub + (value.changeReserve ?? 0),
    discount: Number(gross - subtotal),
  };
}

/** The statuses whose quote still offers something: not superseded, not cancelled. */
export function isLive(status: QuoteStatus): boolean {
  return status === "draft" || status === "active" || status === "approved";
}

/**
 * The quote a deal's value follows: the one the deal names, else its
 * approved one, else its highest revision of a live quote, else its latest
 * quote of any status; `undefined` without a quote.
 */
export function primaryQuote(
  deal: { id: string; primaryQuoteId?: string | undefined },
  quotes: readonly Quote[],
): Quote | undefined {
  const own = quotes.filter((entry) => entry.dealId === deal.id);
  if (own.length === 0) return undefined;
  const named = deal.primaryQuoteId
    ? own.find((entry) => entry.id === deal.primaryQuoteId)
    : undefined;
  if (named) return named;
  const newest = (left: Quote, right: Quote) =>
    right.issuedOn.localeCompare(left.issuedOn) ||
    right.number.localeCompare(left.number) ||
    right.version - left.version;
  const approved = own.filter((entry) => entry.status === "approved").sort(newest);
  if (approved[0]) return approved[0];
  const live = own.filter((entry) => isLive(entry.status)).sort(newest);
  if (live[0]) return live[0];
  return [...own].sort(newest)[0];
}

/**
 * The value a deal follows from its quotes: the primary quote's subtotal once
 * that quote has a line; `undefined` while the deal keeps its own value.
 */
export function valueFromQuotes(
  deal: { id: string; primaryQuoteId?: string | undefined },
  quotes: readonly Quote[],
): number | undefined {
  const primary = primaryQuote(deal, quotes);
  if (!primary || primary.lines.length === 0) return undefined;
  return quoteTotals(primary).subtotal;
}

/** The latest revision of every quote number, newest first. */
export function latestRevisions(quotes: readonly Quote[]): Quote[] {
  const byNumber = new Map<string, Quote>();
  for (const entry of quotes) {
    const found = byNumber.get(entry.number);
    if (!found || entry.version > found.version) byNumber.set(entry.number, entry);
  }
  return [...byNumber.values()].sort(
    (left, right) =>
      right.issuedOn.localeCompare(left.issuedOn) || right.number.localeCompare(left.number),
  );
}

/**
 * Parses the light markup of terms texts into blocks: `## Heading` lines,
 * `- item` lines gathered into a list, other lines into paragraphs split by
 * an empty line.
 */
export type TermsBlock =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

export function termsBlocks(source: string | undefined): TermsBlock[] {
  if (!source) return [];
  const blocks: TermsBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
    } else if (/^[-•]\s+/.test(line)) {
      if (paragraph.length > 0) {
        blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
        paragraph = [];
      }
      list.push(line.replace(/^[-•]\s+/, ""));
    } else {
      if (list.length > 0) {
        blocks.push({ kind: "list", items: list });
        list = [];
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
