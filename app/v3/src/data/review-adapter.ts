import {
  parseYaml,
  REVIEW_SURFACE_CONTRACT_VERSION,
  type ResourceChangeKind,
  type ReviewableResource,
  type ReviewFieldSummary,
  type ReviewInputChange,
  type ReviewSurfaceAdapter,
  structuralDiff,
  toStableYaml,
} from "@lazurio/repository-db";
import { COLLECTION_NAMES, type CollectionName } from "../domain/collections.ts";
import { formatAmount } from "../domain/money.ts";
import { type Locale, type Localized, pick } from "../i18n/locale.ts";
import { withoutAudit } from "./records.ts";

/** Labels of the fields a reviewer sees; a field without one shows its key. */
const FIELD_LABELS: Record<string, Localized> = {
  name: { cs: "Název", en: "Name" },
  title: { cs: "Název", en: "Title" },
  ico: { cs: "IČO", en: "Company ID" },
  dic: { cs: "DIČ", en: "VAT ID" },
  address: { cs: "Adresa", en: "Address" },
  website: { cs: "Web", en: "Website" },
  note: { cs: "Poznámka", en: "Note" },
  email: { cs: "E-mail", en: "E-mail" },
  phone: { cs: "Telefon", en: "Phone" },
  role: { cs: "Role", en: "Role" },
  companyId: { cs: "Firma", en: "Company" },
  contactIds: { cs: "Kontakty", en: "Contacts" },
  ownerId: { cs: "Obchodník", en: "Salesperson" },
  dealTypeId: { cs: "Typ zakázky", en: "Deal type" },
  billingEntityId: { cs: "Fakturační firma", en: "Billing entity" },
  primaryQuoteId: { cs: "Hlavní nabídka", en: "Primary quote" },
  paymentPlan: { cs: "Plán plateb", en: "Payment plan" },
  active: { cs: "Aktivní", en: "Active" },
  code: { cs: "Kód", en: "Code" },
  unit: { cs: "Jednotka", en: "Unit" },
  unitPrice: { cs: "Jednotková cena", en: "Unit price" },
  sectionId: { cs: "Sekce", en: "Section" },
  number: { cs: "Číslo nabídky", en: "Quote number" },
  version: { cs: "Revize", en: "Revision" },
  status: { cs: "Stav", en: "Status" },
  issuedOn: { cs: "Vystaveno", en: "Issued" },
  validUntil: { cs: "Platnost do", en: "Valid until" },
  customer: { cs: "Odběratel", en: "Customer" },
  contactId: { cs: "Kontakt", en: "Contact" },
  vatRate: { cs: "Sazba DPH", en: "VAT rate" },
  reverseCharge: { cs: "Přenesená daňová povinnost", en: "Reverse charge" },
  sections: { cs: "Sekce", en: "Sections" },
  lines: { cs: "Položky", en: "Lines" },
  changeReserve: { cs: "Rezerva na změny", en: "Reserve for changes" },
  terms: { cs: "Podmínky nabídky", en: "Quote terms" },
  commercialTerms: { cs: "Obchodní podmínky", en: "Commercial terms" },
  sentOn: { cs: "Odesláno", en: "Sent" },
  approvedOn: { cs: "Schváleno", en: "Approved" },
  month: { cs: "Měsíc", en: "Month" },
  amount: { cs: "Částka", en: "Amount" },
  invoicedOn: { cs: "Faktura vystavena", en: "Invoiced" },
  dueOn: { cs: "Splatnost", en: "Due" },
  paidOn: { cs: "Zaplaceno", en: "Paid" },
  text: { cs: "Text", en: "Text" },
  paymentDueDays: { cs: "Splatnost faktur (dny)", en: "Invoice due (days)" },
  dealTypes: { cs: "Typy zakázek", en: "Deal types" },
  billingEntities: { cs: "Fakturační firmy", en: "Billing entities" },
  quotes: { cs: "Výchozí hodnoty nabídek", en: "Quote defaults" },
  stageId: { cs: "Fáze", en: "Stage" },
  value: { cs: "Hodnota", en: "Value" },
  probability: { cs: "Pravděpodobnost", en: "Probability" },
  createdAt: { cs: "Založeno", en: "Created" },
  expectedClose: { cs: "Očekávané uzavření", en: "Expected close" },
  closedAt: { cs: "Uzavřeno", en: "Closed" },
  lossReasonId: { cs: "Důvod ztráty", en: "Loss reason" },
  lossNote: { cs: "Poznámka ke ztrátě", en: "Loss note" },
  description: { cs: "Popis", en: "Description" },
  dealId: { cs: "Obchodní případ", en: "Deal" },
  type: { cs: "Typ", en: "Type" },
  at: { cs: "Kdy", en: "When" },
  summary: { cs: "Shrnutí", en: "Summary" },
  done: { cs: "Hotovo", en: "Done" },
  currency: { cs: "Měna", en: "Currency" },
  stages: { cs: "Fáze pipeline", en: "Pipeline stages" },
  lossReasons: { cs: "Důvody ztráty", en: "Loss reasons" },
  aresLookup: { cs: "Vyhledávání v ARES", en: "ARES lookup" },
};

/** Fields that hold an amount in haléře, shown as an amount. */
const MONEY_FIELDS = new Set(["value", "amount", "unitPrice", "changeReserve"]);

const TYPE_LABELS: Record<CollectionName, Localized> = {
  settings: { cs: "Nastavení", en: "Settings" },
  salespeople: { cs: "Obchodník", en: "Salesperson" },
  companies: { cs: "Firma", en: "Company" },
  contacts: { cs: "Kontakt", en: "Contact" },
  deals: { cs: "Obchodní případ", en: "Deal" },
  activities: { cs: "Aktivita", en: "Activity" },
  pricebook: { cs: "Položka ceníku", en: "Price list item" },
  quotes: { cs: "Cenová nabídka", en: "Quote" },
  forecastEntries: { cs: "Řádek forecastu", en: "Forecast row" },
  forecastNotes: { cs: "Poznámka k měsíci", en: "Month note" },
};

/**
 * Names changed fields as a reviewer knows them and shows amounts as amounts
 * (without a currency: the review does not read the settings).
 */
export function labelFields(
  fields: readonly ReviewFieldSummary[],
  locale: Locale = "cs",
): ReviewFieldSummary[] {
  return fields.map((field) => {
    const segments = field.fieldPath.split("/").filter(Boolean);
    const key = segments[0] ?? "";
    const last = segments.at(-1) ?? "";
    const amount = (summary: string | undefined) =>
      summary !== undefined && MONEY_FIELDS.has(last) && /^[0-9]+$/.test(summary)
        ? formatAmount(Number(summary), locale)
        : summary;
    return {
      ...field,
      label: FIELD_LABELS[key]?.[locale] ?? field.label,
      beforeSummary: amount(field.beforeSummary),
      afterSummary: amount(field.afterSummary),
    };
  });
}

/** How a person recognises a record: its type, a label and the page that shows it. */
export function describeRecord(
  collection: CollectionName,
  id: string,
  record: unknown,
  locale: Locale = "cs",
) {
  const value = (record ?? {}) as Record<string, unknown>;
  const textOf = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const typeLabel = TYPE_LABELS[collection][locale];
  switch (collection) {
    case "settings":
      return {
        typeLabel,
        label: pick(locale, "Nastavení obchodních případů", "Deal settings"),
        href: "#/settings",
      };
    case "companies":
    case "contacts": {
      const name = textOf("name");
      return {
        typeLabel,
        label: name ? `${name} (${id})` : id,
        href: `#/${collection}/${encodeURIComponent(id)}`,
      };
    }
    case "deals": {
      const title = textOf("title");
      return {
        typeLabel,
        label: title ? `${id} · ${title}` : id,
        href: `#/deals/${encodeURIComponent(id)}`,
      };
    }
    case "salespeople":
    case "pricebook": {
      const name = textOf("name");
      const page = collection === "salespeople" ? "salespeople" : "pricebook";
      return {
        typeLabel,
        label: name ? `${name} (${id})` : id,
        href: `#/${page}/${encodeURIComponent(id)}`,
      };
    }
    case "quotes": {
      const title = textOf("title");
      return {
        typeLabel,
        label: title ? `${id} · ${title}` : id,
        href: `#/quotes/${encodeURIComponent(id)}`,
      };
    }
    case "forecastEntries": {
      const title = textOf("title");
      return { typeLabel, label: title ? `${id} · ${title}` : id, href: "#/forecast" };
    }
    case "forecastNotes":
      return { typeLabel, label: id, href: "#/forecast" };
    case "activities": {
      const summary = textOf("summary");
      const deal = textOf("dealId");
      return {
        typeLabel,
        label: summary ? `${id} · ${summary}` : id,
        href: deal ? `#/deals/${encodeURIComponent(deal)}` : "#/deals",
      };
    }
  }
}

/** `data/deals/D-2026-0001.yaml` → the collection and the id, or null for another file. */
export function recordAt(path: string): { collection: CollectionName; id: string } | null {
  const match = /(?:^|\/)data\/([a-zA-Z]+)\/([^/]+)\.yaml$/.exec(path);
  if (!match?.[1] || !match[2]) return null;
  const collection = match[1] as CollectionName;
  if (!COLLECTION_NAMES.includes(collection)) return null;
  try {
    return { collection, id: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

/**
 * Whether a record file's change is all in its parsed record: both texts are
 * the canonical YAML the App writes (no comment, no other formatting) and the
 * envelope around the record did not change. Otherwise part of the change is
 * not in the record's fields, and nothing that shows the fields shows it.
 */
export function changeIsInRecord(
  baselineText: string | undefined,
  draftText: string | undefined,
): boolean {
  const canonical = (text: string | undefined) => {
    if (text === undefined) return true;
    try {
      return toStableYaml(parseYaml(text)) === text;
    } catch {
      return false;
    }
  };
  if (!canonical(baselineText) || !canonical(draftText)) return false;
  if (baselineText === undefined || draftText === undefined) return true;
  const envelope = (text: string) => {
    const { record: _record, ...rest } = (parseYaml(text) ?? {}) as Record<string, unknown>;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };
  return envelope(baselineText) === envelope(draftText);
}

function recordOf(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const document = parseYaml(text) as { record?: unknown } | null;
    const record = document?.record;
    return record && typeof record === "object" && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The label of a record's field in the person's language: `address/city` → „Adresa“. */
export function fieldLabel(fieldPath: string, locale: Locale = "cs"): string {
  const key = fieldPath.split("/").filter(Boolean)[0] ?? "";
  return FIELD_LABELS[key]?.[locale] ?? key;
}

/** A JSON value of a record, as the card's metadata may carry it. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * One change of one record as the Draft & Publish card shows it. Besides the
 * card's short field summaries, `metadata.record` carries the whole record
 * before and after (without its audit fields), so a reviewer that is not a
 * person, the tools for agents, can show every changed value in full.
 */
export function reviewResource(
  collection: CollectionName,
  id: string,
  kind: ResourceChangeKind,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  change: Pick<ReviewInputChange, "changeId" | "technicalRefs">,
  locale: Locale = "cs",
  /** false when part of the change is outside the record's fields (`changeIsInRecord`). */
  whole = true,
): ReviewableResource {
  const subject = describeRecord(collection, id, after ?? before, locale);
  // The audit fields change on every write; a reviewer sees the business ones.
  const diff = structuralDiff(withoutAudit(before ?? {}), withoutAudit(after ?? {}), {
    maxFields: 12,
  });
  const fields = labelFields(diff.fields, locale);
  return {
    appId: "deals",
    resourceType: collection,
    stableResourceId: `${collection}:${id}`,
    label: subject.label,
    routeTarget: { href: subject.href, label: pick(locale, "Otevřít", "Open") },
    changes: [
      {
        changeId: change.changeId,
        kind,
        summary:
          kind === "created"
            ? pick(locale, "Nový záznam", "New record")
            : kind === "deleted"
              ? pick(locale, "Smazaný záznam", "Deleted record")
              : pick(
                  locale,
                  `Změněno polí: ${fields.length + diff.truncated}`,
                  `Fields changed: ${fields.length + diff.truncated}`,
                ),
        technicalRefs: change.technicalRefs,
        fields,
      },
    ],
    fallback: { activeLevel: "resource_adapter", steps: [] },
    metadata: {
      typeLabel: subject.typeLabel,
      // Only a change that is all in the record's fields: else its whole
      // values would not show all of it.
      ...(whole
        ? {
            record: {
              before: (before ? withoutAudit(before) : null) as Json,
              after: (after ? withoutAudit(after) : null) as Json,
            },
          }
        : {}),
    },
  };
}

/**
 * Turns changed data files into the records a person recognises: a deal by
 * its id and title, a company or a contact by its name, with the changed
 * fields named in the person's language. A file this adapter does not know
 * falls through to the engine's generic review.
 */
export const dealsReviewAdapter = (locale: Locale = "cs"): ReviewSurfaceAdapter => ({
  id: "deals-v3",
  appId: "deals",
  contractVersion: REVIEW_SURFACE_CONTRACT_VERSION,
  adapterVersion: "1.0.0",
  supportedPathGlobs: COLLECTION_NAMES.map((name) => `data/${name}/*.yaml`),
  toReviewableResources(changes: readonly ReviewInputChange[]): ReviewableResource[] {
    const resources: ReviewableResource[] = [];
    for (const change of changes) {
      const path = change.technicalRefs[0]?.path ?? "";
      const at = recordAt(path);
      if (!at) continue;
      const kind = change.kind === "renamed" ? "modified" : change.kind;
      resources.push(
        reviewResource(
          at.collection,
          at.id,
          kind,
          recordOf(change.baselineText),
          recordOf(change.draftText),
          change,
          locale,
          changeIsInRecord(change.baselineText, change.draftText),
        ),
      );
    }
    return resources;
  },
});
