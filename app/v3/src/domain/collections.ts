import type { z } from "zod";
import { type Activity, activity } from "./activity.ts";
import { type Company, company } from "./company.ts";
import { type Contact, contact } from "./contact.ts";
import { type Deal, deal } from "./deal.ts";
import {
  type ForecastEntry,
  type ForecastNote,
  forecastEntry,
  forecastNote,
} from "./forecast-entry.ts";
import { type PricebookItem, pricebookItem } from "./pricebook.ts";
import { type Quote, quote } from "./quote.ts";
import { type Salesperson, salesperson } from "./salesperson.ts";
import { SETTINGS_ID, type Settings, settings } from "./settings.ts";

/** One collection of this Module's data: the `schemaVersion` of its documents
 * and the Zod schema of one record. */
export type CollectionSpec = Readonly<{ schemaVersion: string; record: z.ZodType }>;

/**
 * The collections of this Module's data, by the name of their directory
 * (`db/data/<name>/`, one document `<id>.yaml` each, in the envelope of
 * repository-db: `schemaVersion`, `id`, `record`). Zod is the one source of a
 * record's shape (profile `app-data`): the types come from these schemas
 * (`z.infer`), the App hands the same schemas to repository-db as its parsers,
 * `bun run schema:export` generates the JSON Schemas of the data repository
 * from them, and `bun run validate:data` checks every record of `seed/`.
 *
 * A new collection is one entry here, written before its first record. A
 * change of a record's shape that older data does not match is a new
 * `schemaVersion` and a migration (`bun run migrate`, `docs/data.md`).
 */
export const collections = {
  settings: { schemaVersion: "deals.settings.v2", record: settings },
  salespeople: { schemaVersion: "deals.salesperson.v1", record: salesperson },
  companies: { schemaVersion: "deals.company.v1", record: company },
  contacts: { schemaVersion: "deals.contact.v1", record: contact },
  deals: { schemaVersion: "deals.deal.v2", record: deal },
  activities: { schemaVersion: "deals.activity.v1", record: activity },
  pricebook: { schemaVersion: "deals.pricebook-item.v1", record: pricebookItem },
  quotes: { schemaVersion: "deals.quote.v1", record: quote },
  forecastEntries: { schemaVersion: "deals.forecast-entry.v1", record: forecastEntry },
  forecastNotes: { schemaVersion: "deals.forecast-note.v1", record: forecastNote },
} as const satisfies Record<string, CollectionSpec>;

export type CollectionName = keyof typeof collections;
export const COLLECTION_NAMES = Object.keys(collections) as CollectionName[];

export interface RecordOf {
  settings: Settings;
  salespeople: Salesperson;
  companies: Company;
  contacts: Contact;
  deals: Deal;
  activities: Activity;
  pricebook: PricebookItem;
  quotes: Quote;
  forecastEntries: ForecastEntry;
  forecastNotes: ForecastNote;
}

/** The collections whose records have an `id` of their own (every one but the settings). */
export type RecordCollection = Exclude<CollectionName, "settings">;

/** The id a record must be stored under: its own id, or `settings`. */
export function recordId<C extends CollectionName>(collection: C, value: RecordOf[C]): string {
  if (collection === "settings") return SETTINGS_ID;
  return (value as RecordOf[RecordCollection]).id;
}

/** Every record of the Module's data, as the rules, the forecast and the statistics read it. */
export interface DataSet {
  settings: Settings | null;
  salespeople: readonly Salesperson[];
  companies: readonly Company[];
  contacts: readonly Contact[];
  deals: readonly Deal[];
  activities: readonly Activity[];
  pricebook: readonly PricebookItem[];
  quotes: readonly Quote[];
  forecastEntries: readonly ForecastEntry[];
  forecastNotes: readonly ForecastNote[];
}

/** No records at all; the start of a data set built in code. */
export function emptyDataSet(): DataSet {
  return {
    settings: null,
    salespeople: [],
    companies: [],
    contacts: [],
    deals: [],
    activities: [],
    pricebook: [],
    quotes: [],
    forecastEntries: [],
    forecastNotes: [],
  };
}
