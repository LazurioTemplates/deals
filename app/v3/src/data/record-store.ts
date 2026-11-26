import { canonicalJson } from "../domain/canonical.ts";
import type { CollectionName, DataSet, RecordOf } from "../domain/collections.ts";
import { localToday } from "../domain/common.ts";
import { checkRules, type RuleIssue } from "../domain/rules.ts";
import { SETTINGS_ID } from "../domain/settings.ts";
import type { Locale, Localized } from "../i18n/locale.ts";
import { currentOrigin } from "./origin.ts";
import {
  assertPublishable,
  assertRulesFor,
  dataSetOf,
  type Entry,
  newAudit,
  ordered,
  parseIn,
  recordId,
  recordKey,
  type Snapshot,
  withoutAudit,
} from "./records.ts";
import type {
  Change,
  DealsStore,
  DiscardScope,
  DraftCard,
  Revision,
  Save,
  Stored,
  StoreEvent,
} from "./store.ts";
import { StoreError } from "./store.ts";

/**
 * Writes one record as a draft and returns its new revision. The value
 * carries the write's new audit fields (`revision`, `updatedAt`,
 * `updatedBy`); the revision it returns is the one the port hands out for
 * what it stored. A `null` value removes the record (and returns "").
 */
export type Put = <C extends CollectionName>(
  collection: C,
  id: string,
  value: RecordOf[C] | null,
  baseRevision: Revision | null,
) => Revision;

/**
 * What a store implementation provides below the port: a fresh snapshot of
 * every record for a read (values without their audit fields, each with the
 * revision of what is stored), a write queue with a `put`, and Draft &
 * Publish.
 * `createRecordStore` builds the domain operations of the port on it once, so
 * the memory store and the repository-db store keep the same rules.
 */
export interface RecordBackend {
  available(): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  read<T>(operation: (snapshot: Snapshot) => T): Promise<T>;
  write<T>(kind: string, operation: (snapshot: Snapshot, put: Put) => T): Promise<T>;
  draft(locale: Locale): Promise<DraftCard>;
  publish(input: { expectedRevision: string; actor?: string; summary?: string }): Promise<void>;
  finishSend(expectedHead: string): Promise<void>;
  discard(scope: DiscardScope, expectedRevision: string): Promise<void>;
  pull(): Promise<void>;
  subscribe(listener: (event: StoreEvent) => void): () => void;
  close(): void;
}

const LABELS: Record<CollectionName, Localized> = {
  settings: { cs: "Nastavení", en: "Settings" },
  salespeople: { cs: "Obchodník", en: "Salesperson" },
  companies: { cs: "Firma", en: "Company" },
  contacts: { cs: "Kontakt", en: "Contact" },
  deals: { cs: "Obchodní případ", en: "Deal" },
  activities: { cs: "Aktivita", en: "Activity" },
  pricebook: { cs: "Položka ceníku", en: "Price list item" },
  quotes: { cs: "Nabídka", en: "Quote" },
  forecastEntries: { cs: "Řádek forecastu", en: "Forecast row" },
  forecastNotes: { cs: "Poznámka k měsíci", en: "Month note" },
};

// Every value the port hands out is a copy: changing it changes nothing stored.
const stored = <T>(entry: Entry<T>): Stored<T> => ({
  value: structuredClone(entry.value),
  revision: entry.revision,
});

const settingsMissing = () =>
  new StoreError("settings_missing", {
    cs: "Data zatím nemají nastavení obchodních případů.",
    en: "The data has no deal settings yet.",
  });

export function createRecordStore(backend: RecordBackend): DealsStore {
  function list<C extends CollectionName>(collection: C): Promise<Stored<RecordOf[C]>[]> {
    return backend.read((snapshot) => ordered(snapshot, collection).map(stored));
  }

  function get<C extends CollectionName>(
    collection: C,
    id: string,
  ): Promise<Stored<RecordOf[C]> | null> {
    return backend.read((snapshot) => {
      const entry = snapshot[collection].get(id) as Entry<RecordOf[C]> | undefined;
      return entry ? stored(entry) : null;
    });
  }

  /** A change of any collection, as `write` takes it: removal is a `null` value. */
  type AnyChange = {
    collection: CollectionName;
    id: string;
    value: Record<string, unknown> | null;
    base: Revision | null;
  };

  function write(kind: string, changes: readonly AnyChange[]): Promise<(Stored<unknown> | null)[]> {
    const keys = changes.map((change) => recordKey(change.collection, change.id));
    if (new Set(keys).size !== keys.length) {
      return Promise.reject(
        new StoreError("bad_request", {
          cs: "Stejný záznam je v ukládání dvakrát.",
          en: "The same record is saved twice.",
        }),
      );
    }
    // The person the write is for, taken before the write waits in the queue.
    const by = currentOrigin()?.subject ?? null;
    return backend.write(kind, (snapshot, put) => {
      for (const change of changes) {
        const records = snapshot[change.collection] as Map<string, Entry>;
        const existing = records.get(change.id);
        const { cs, en } = LABELS[change.collection];
        const id = change.id;
        // Every refusal names the revision stored now, so the editor can reload it.
        const changed = (message: Localized) =>
          new StoreError("record_changed", message, [], {
            currentRevision: existing?.revision ?? null,
          });
        if (change.base === null && existing) {
          throw changed({ cs: `${cs} ${id} už existuje.`, en: `${en} ${id} already exists.` });
        }
        if (change.base !== null && !existing) {
          throw changed({
            cs: `${cs} ${id} mezitím zmizel nebo se vrátil.`,
            en: `${en} ${id} was deleted or returned meanwhile.`,
          });
        }
        if (existing && change.base !== existing.revision) {
          throw changed({
            cs: `${cs} ${id} mezitím uložil někdo jiný.`,
            en: `Someone else saved ${en.toLowerCase()} ${id} meanwhile.`,
          });
        }
      }
      // A save that changes nothing writes nothing and keeps the revision: no
      // write, no new revision, and no record in the draft that changed nothing.
      const unchangedAt = changes.map((change) => {
        if (change.value === null) return null;
        const existing = (snapshot[change.collection] as Map<string, Entry>).get(change.id);
        return existing !== undefined &&
          canonicalJson(existing.value) === canonicalJson(change.value)
          ? existing
          : null;
      });
      // A removal may break a rule of a record it does not touch (a deal
      // naming a removed company): what the data said before tells new errors.
      const before = changes.some((change) => change.value === null) ? dataSetOf(snapshot) : null;
      changes.forEach((change, index) => {
        if (unchangedAt[index]) return;
        const records = snapshot[change.collection] as Map<string, Entry>;
        if (change.value === null) records.delete(change.id);
        else records.set(change.id, { value: change.value, revision: "" });
      });
      assertRulesFor(keys, dataSetOf(snapshot), before);
      // Every record this write changes gets its own new write revision.
      return changes.map((change, index) => {
        const kept = unchangedAt[index];
        if (kept) return stored(kept);
        if (change.value === null) {
          put(change.collection, change.id, null, change.base);
          return null;
        }
        return {
          value: structuredClone(change.value),
          revision: put(
            change.collection,
            change.id,
            { ...change.value, ...newAudit(by) } as never,
            change.base,
          ),
        };
      });
    });
  }

  function saveMany<C extends CollectionName>(
    collection: C,
    entries: readonly Save<RecordOf[C]>[],
  ): Promise<Stored<RecordOf[C]>[]> {
    let changes: AnyChange[];
    try {
      changes = entries.map((entry) => saveChange(collection, entry.value, entry.baseRevision));
    } catch (error) {
      return Promise.reject(error);
    }
    return write(`save-${collection}`, changes) as Promise<Stored<RecordOf[C]>[]>;
  }

  // Audit fields a caller sent are not its to set: every write stores new ones.
  // withoutAudit copies, so a caller changing its value later changes nothing stored.
  function saveChange<C extends CollectionName>(
    collection: C,
    value: RecordOf[C],
    base: Revision | null,
  ): AnyChange {
    const parsed = withoutAudit(parseIn(collection, value)) as RecordOf[C];
    return {
      collection,
      id: recordId(collection, parsed),
      value: parsed as unknown as Record<string, unknown>,
      base,
    };
  }

  async function save<C extends CollectionName>(
    collection: C,
    value: RecordOf[C],
    baseRevision: Revision | null,
  ): Promise<Stored<RecordOf[C]>> {
    const [saved] = await saveMany(collection, [{ value, baseRevision }]);
    if (!saved)
      throw new StoreError("unexpected", { cs: "Nic se neuložilo.", en: "Nothing was saved." });
    return saved;
  }

  return {
    available: () => backend.available(),
    async settings() {
      const found = await get("settings", SETTINGS_ID);
      if (!found) throw settingsMissing();
      return found;
    },
    saveSettings: (value, base) => save("settings", value, base),
    listCompanies: () => list("companies"),
    getCompany: (id) => get("companies", id),
    saveCompany: (value, base) => save("companies", value, base),
    listContacts: () => list("contacts"),
    getContact: (id) => get("contacts", id),
    saveContact: (value, base) => save("contacts", value, base),
    listDeals: () => list("deals"),
    getDeal: (id) => get("deals", id),
    saveDeal: (value, base) => save("deals", value, base),
    listActivities: () => list("activities"),
    getActivity: (id) => get("activities", id),
    saveActivity: (value, base) => save("activities", value, base),
    list: (collection) => list(collection),
    get: (collection, id) => get(collection, id),
    save: (collection, value, base) => save(collection, value, base),
    async saveAll(changes: readonly Change[]) {
      const prepared = changes.map(
        (change): AnyChange =>
          "remove" in change
            ? {
                collection: change.collection,
                id: change.remove,
                value: null,
                base: change.baseRevision,
              }
            : saveChange(change.collection, change.value as never, change.baseRevision),
      );
      return write("save-records", prepared);
    },
    async remove(collection, id, base) {
      await write(`remove-${collection}`, [{ collection, id, value: null, base }]);
    },
    readData: () => backend.read((snapshot): DataSet => dataSetOf(snapshot)),
    check: (locale = "cs", today = localToday()) =>
      backend.read((snapshot): RuleIssue[] => [
        ...snapshot.problems.map((problem) => ({
          record: problem.record,
          severity: "error" as const,
          code: "invalid_document",
          message: problem.message[locale],
        })),
        ...checkRules(dataSetOf(snapshot), { locale, today }),
      ]),
    draft: (locale = "cs") => backend.draft(locale),
    async publish(input) {
      // The rules across records gate a publication; the data repository's
      // validator checks the shape of each record when it is sent.
      await backend.read((snapshot) => assertPublishable(dataSetOf(snapshot)));
      await backend.publish(input);
    },
    finishSend: (head) => backend.finishSend(head),
    discard: (scope, revision) => backend.discard(scope, revision),
    pull: () => backend.pull(),
    subscribe: (listener) => backend.subscribe(listener),
    close: () => backend.close(),
  };
}
