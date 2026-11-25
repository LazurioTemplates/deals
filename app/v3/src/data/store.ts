import type { DraftPanelInput } from "@lazurio/repository-db";
import type { Activity } from "../domain/activity.ts";
import type { DataSet } from "../domain/collections.ts";
import type { Company } from "../domain/company.ts";
import type { Contact } from "../domain/contact.ts";
import type { Deal } from "../domain/deal.ts";
import type { RuleIssue } from "../domain/rules.ts";
import type { Settings } from "../domain/settings.ts";
import type { Locale, Localized } from "../i18n/locale.ts";

/**
 * The storage port of Deals: everything the server, the tools for agents and
 * the command line need from the data, named by the domain and never by files
 * or Git.
 *
 * Generation v3 implements it over repository-db (`repository-db-store.ts`);
 * `memory-store.ts` implements it in memory for the demo and the tests. A
 * later generation implements the same port over another engine; the server,
 * the UI and the shared test suite (`tests/store-contract.ts`) stay as they
 * are. No path of a YAML file and no Git term crosses this boundary: a record
 * is addressed by its id, and a change is confirmed by an opaque revision.
 */

/**
 * An opaque version of one stored record; a save names the one it was edited
 * from. It is new on every write, never derived from the content alone and
 * never a counter: every write stores a new random `record.revision`, and the
 * revision covers it and the content, so after A → B → A it differs from A's
 * and a direct change that kept `record.revision` is a change too.
 */
export type Revision = string;

export interface Stored<T> {
  value: T;
  revision: Revision;
}

/** A save of one record: the value and the revision it was edited from (`null` for a new one). */
export interface Save<T> {
  value: T;
  baseRevision: Revision | null;
}

/**
 * Draft & Publish is the contract of the UI: an edit is a draft, a person
 * reviews it and publishes it as one change. The card input is the shared
 * view model of `@lazurio/repository-db`, which another engine produces as well.
 */
export type DraftCard = DraftPanelInput;

export type DiscardScope = { kind: "draft" } | { kind: "record"; path: string };

export type StoreEvent =
  /** Records changed: a write or a discard of any page, a colleague's publish that came in. */
  | { type: "records-changed" }
  /** The draft or the sync state changed; reload the card. */
  | { type: "draft-changed" };

export interface DealsStore {
  /** False while the data cannot be read (not mounted yet, wrong repository). */
  available(): Promise<{ ok: true } | { ok: false; code: string; message: string }>;

  /** The settings; refused with `settings_missing` while the data has none. */
  settings(): Promise<Stored<Settings>>;
  saveSettings(value: Settings, baseRevision: Revision | null): Promise<Stored<Settings>>;

  /** Every company, by name. */
  listCompanies(): Promise<Stored<Company>[]>;
  getCompany(id: string): Promise<Stored<Company> | null>;
  saveCompany(value: Company, baseRevision: Revision | null): Promise<Stored<Company>>;

  /** Every contact, by name. */
  listContacts(): Promise<Stored<Contact>[]>;
  getContact(id: string): Promise<Stored<Contact> | null>;
  saveContact(value: Contact, baseRevision: Revision | null): Promise<Stored<Contact>>;

  /** Every deal, newest id first. */
  listDeals(): Promise<Stored<Deal>[]>;
  getDeal(id: string): Promise<Stored<Deal> | null>;
  /**
   * Save a deal as a draft. `baseRevision` is the revision the editor opened,
   * `null` for a new deal. A stale revision is refused with `record_changed`,
   * which names the revision stored now (`StoreError.currentRevision`); so is
   * every other save.
   */
  saveDeal(value: Deal, baseRevision: Revision | null): Promise<Stored<Deal>>;

  /** Every activity, newest first. */
  listActivities(): Promise<Stored<Activity>[]>;
  getActivity(id: string): Promise<Stored<Activity> | null>;
  saveActivity(value: Activity, baseRevision: Revision | null): Promise<Stored<Activity>>;

  /**
   * Every record as one consistent read (draft included), without revisions:
   * what the forecast and the statistics are computed from.
   */
  readData(): Promise<DataSet>;

  /**
   * Every problem of the data as it stands (draft included): records that do
   * not match their schema (errors) and the rules across records (errors and
   * warnings). Empty when valid. `today` decides which expected closing dates
   * have passed; the Environment's today by default.
   */
  check(locale?: Locale, today?: string): Promise<RuleIssue[]>;

  /** The Draft & Publish card: state, the changed records and the draft revision, labelled in `locale`. */
  draft(locale?: Locale): Promise<DraftCard>;
  /**
   * Publish the whole draft as shown; a changed draft is refused with
   * `draft_changed`, a draft that breaks a rule across records with
   * `rules_failed` (warnings do not block).
   */
  publish(input: { expectedRevision: string; actor?: string; summary?: string }): Promise<void>;
  /** Finish sending a publish that was saved but not sent. */
  finishSend(expectedHead: string): Promise<void>;
  discard(scope: DiscardScope, expectedRevision: string): Promise<void>;
  /** Take colleagues' published work. */
  pull(): Promise<void>;

  subscribe(listener: (event: StoreEvent) => void): () => void;
  close(): void;
}

/** A refusal the UI words for the person; `code` follows repository-db's error codes. */
export class StoreError extends Error {
  readonly code: string;
  readonly text: Localized;
  readonly localizedIssues: readonly { path: string; message: Localized }[];
  /**
   * With `record_changed`: the revision of the record as it is stored now
   * (`null` when it is gone), so an editor can load it again and compare.
   * Undefined for every other refusal.
   */
  readonly currentRevision: Revision | null | undefined;

  constructor(
    code: string,
    message: string | Localized,
    issues: { path: string; message: string | Localized }[] = [],
    options: { currentRevision?: Revision | null } = {},
  ) {
    const text = typeof message === "string" ? { cs: message, en: message } : message;
    super(text.en);
    this.name = "StoreError";
    this.code = code;
    this.text = text;
    this.currentRevision = options.currentRevision;
    this.localizedIssues = issues.map((issue) => ({
      path: issue.path,
      message:
        typeof issue.message === "string"
          ? { cs: issue.message, en: issue.message }
          : issue.message,
    }));
  }

  /** The issues in English, as logs and tests read them. */
  get issues(): { path: string; message: string }[] {
    return this.issuesIn("en");
  }

  messageIn(locale: Locale): string {
    return this.text[locale];
  }

  issuesIn(locale: Locale): { path: string; message: string }[] {
    return this.localizedIssues.map((issue) => ({
      path: issue.path,
      message: issue.message[locale],
    }));
  }
}

/** The operations of the port that only read; every other one changes data. */
type Reads =
  | "available"
  | "settings"
  | "listCompanies"
  | "getCompany"
  | "listContacts"
  | "getContact"
  | "listDeals"
  | "getDeal"
  | "listActivities"
  | "getActivity"
  | "readData"
  | "check"
  | "draft"
  | "subscribe"
  | "close";

/**
 * Every operation that changes data, publishes or pulls. A new operation of
 * the port that is not a read must be named here, or this does not compile.
 */
export const CHANGES: Readonly<Record<Exclude<keyof DealsStore, Reads>, true>> = {
  saveSettings: true,
  saveCompany: true,
  saveContact: true,
  saveDeal: true,
  saveActivity: true,
  publish: true,
  finishSend: true,
  discard: true,
  pull: true,
};

/**
 * The same store for a caller that may not write (the one writer rule of the
 * Module Standard): every change, publish and pull is refused with
 * `data_read_only` before it reaches the data; reads pass through.
 */
export function readOnly(store: DealsStore): DealsStore {
  const refuse = async () => {
    throw new StoreError("data_read_only", {
      cs: "Tato kopie Obchodních případů teď data nemění, jen je čte.",
      en: "This copy of Deals does not change data now; it only reads them.",
    });
  };
  return new Proxy(store, {
    get(target, key, receiver) {
      if (typeof key === "string" && Object.hasOwn(CHANGES, key)) return refuse;
      return Reflect.get(target, key, receiver);
    },
  });
}
