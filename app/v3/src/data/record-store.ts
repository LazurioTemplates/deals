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
 * what it stored.
 */
export type Put = <C extends CollectionName>(
  collection: C,
  id: string,
  value: RecordOf[C],
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
  companies: { cs: "Firma", en: "Company" },
  contacts: { cs: "Kontakt", en: "Contact" },
  deals: { cs: "Obchodní případ", en: "Deal" },
  activities: { cs: "Aktivita", en: "Activity" },
};

const stored = <T>(entry: Entry<T>): Stored<T> => ({
  value: entry.value,
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

  function saveMany<C extends CollectionName>(
    collection: C,
    entries: readonly Save<RecordOf[C]>[],
  ): Promise<Stored<RecordOf[C]>[]> {
    // Audit fields a caller sent are not its to set: every write stores new ones.
    const parsed = entries.map((entry) => ({
      value: withoutAudit(parseIn(collection, entry.value)),
      base: entry.baseRevision,
    }));
    const ids = parsed.map((entry) => recordId(collection, entry.value));
    if (new Set(ids).size !== ids.length) {
      return Promise.reject(
        new StoreError("bad_request", {
          cs: "Stejný záznam je v ukládání dvakrát.",
          en: "The same record is saved twice.",
        }),
      );
    }
    // The person the write is for, taken before the write waits in the queue.
    const by = currentOrigin()?.subject ?? null;
    return backend.write(`save-${collection}`, (snapshot, put) => {
      const records = snapshot[collection] as Map<string, Entry<RecordOf[C]>>;
      parsed.forEach((entry, index) => {
        const id = ids[index] as string;
        const existing = records.get(id);
        const { cs, en } = LABELS[collection];
        if (entry.base === null && existing) {
          throw new StoreError("record_changed", {
            cs: `${cs} ${id} už existuje.`,
            en: `${en} ${id} already exists.`,
          });
        }
        if (entry.base !== null && !existing) {
          throw new StoreError("record_changed", {
            cs: `${cs} ${id} mezitím zmizel nebo se vrátil.`,
            en: `${en} ${id} was deleted or returned meanwhile.`,
          });
        }
        if (existing && entry.base !== existing.revision) {
          throw new StoreError("record_changed", {
            cs: `${cs} ${id} mezitím uložil někdo jiný.`,
            en: `Someone else saved ${en.toLowerCase()} ${id} meanwhile.`,
          });
        }
      });
      // A save that changes nothing writes nothing and keeps the revision: no
      // write, no new revision, and no record in the draft that changed nothing.
      const unchangedAt = parsed.map((entry, index) => {
        const existing = records.get(ids[index] as string);
        return existing !== undefined &&
          canonicalJson(existing.value) === canonicalJson(entry.value)
          ? existing
          : null;
      });
      parsed.forEach((entry, index) => {
        if (unchangedAt[index]) return;
        records.set(ids[index] as string, { value: entry.value, revision: "" });
      });
      assertRulesFor(
        ids.map((id) => recordKey(collection, id)),
        dataSetOf(snapshot),
      );
      // Every record this write changes gets its own new write revision.
      return parsed.map((entry, index) => {
        const kept = unchangedAt[index];
        if (kept) return stored(kept);
        return {
          value: entry.value,
          revision: put(
            collection,
            ids[index] as string,
            { ...entry.value, ...newAudit(by) },
            entry.base,
          ),
        };
      });
    });
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
