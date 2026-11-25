import {
  parseYaml,
  REVIEW_SURFACE_CONTRACT_VERSION,
  type ResourceChangeKind,
  type ReviewableResource,
  type ReviewFieldSummary,
  type ReviewInputChange,
  type ReviewSurfaceAdapter,
  structuralDiff,
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
  owner: { cs: "Obchodník", en: "Owner" },
  stageId: { cs: "Fáze", en: "Stage" },
  value: { cs: "Hodnota", en: "Value" },
  probability: { cs: "Pravděpodobnost", en: "Probability" },
  createdAt: { cs: "Založeno", en: "Created" },
  expectedClose: { cs: "Očekávané uzavření", en: "Expected close" },
  closedAt: { cs: "Uzavřeno", en: "Closed" },
  lossReasonId: { cs: "Důvod ztráty", en: "Loss reason" },
  lossNote: { cs: "Poznámka ke ztrátě", en: "Loss note" },
  quoteRef: { cs: "Nabídka", en: "Quote" },
  description: { cs: "Popis", en: "Description" },
  dealId: { cs: "Obchodní případ", en: "Deal" },
  type: { cs: "Typ", en: "Type" },
  at: { cs: "Kdy", en: "When" },
  summary: { cs: "Shrnutí", en: "Summary" },
  done: { cs: "Hotovo", en: "Done" },
  currency: { cs: "Měna", en: "Currency" },
  stages: { cs: "Fáze pipeline", en: "Pipeline stages" },
  lossReasons: { cs: "Důvody ztráty", en: "Loss reasons" },
  owners: { cs: "Obchodníci", en: "Salespeople" },
  aresLookup: { cs: "Vyhledávání v ARES", en: "ARES lookup" },
};

/** Fields that hold an amount in haléře, shown as an amount. */
const MONEY_FIELDS = new Set(["value"]);

const TYPE_LABELS: Record<CollectionName, Localized> = {
  settings: { cs: "Nastavení", en: "Settings" },
  companies: { cs: "Firma", en: "Company" },
  contacts: { cs: "Kontakt", en: "Contact" },
  deals: { cs: "Obchodní případ", en: "Deal" },
  activities: { cs: "Aktivita", en: "Activity" },
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
  const match = /(?:^|\/)data\/([a-z]+)\/([^/]+)\.yaml$/.exec(path);
  if (!match?.[1] || !match[2]) return null;
  const collection = match[1] as CollectionName;
  if (!COLLECTION_NAMES.includes(collection)) return null;
  try {
    return { collection, id: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
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

/** One change of one record as the Draft & Publish card shows it. */
export function reviewResource(
  collection: CollectionName,
  id: string,
  kind: ResourceChangeKind,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  change: Pick<ReviewInputChange, "changeId" | "technicalRefs">,
  locale: Locale = "cs",
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
    metadata: { typeLabel: subject.typeLabel },
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
        ),
      );
    }
    return resources;
  },
});
