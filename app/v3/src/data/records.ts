import type { z } from "zod";
import {
  type CollectionName,
  collections,
  type DataSet,
  type RecordOf,
  recordId,
} from "../domain/collections.ts";
import { checkRulesLocalized, errorsOf } from "../domain/rules.ts";
import type { Locale, Localized } from "../i18n/locale.ts";
import { StoreError } from "./store.ts";

type Issue = z.core.$ZodIssue;

/** One problem Zod found, in both languages. */
export function issueText(issue: Issue): Localized {
  const raw = issue as Issue & {
    expected?: unknown;
    minimum?: unknown;
    maximum?: unknown;
    origin?: unknown;
    keys?: string[];
    input?: unknown;
  };
  switch (issue.code) {
    case "invalid_type":
      return raw.input === undefined
        ? { cs: "povinné", en: "required" }
        : { cs: `čeká se ${String(raw.expected)}`, en: `expected ${String(raw.expected)}` };
    case "too_small":
      if (raw.origin === "string" && Number(raw.minimum) === 1)
        return { cs: "povinné", en: "required" };
      if (raw.origin === "array") {
        return {
          cs: `aspoň ${String(raw.minimum)} položek`,
          en: `at least ${String(raw.minimum)} item(s)`,
        };
      }
      return { cs: `nejméně ${String(raw.minimum)}`, en: `at least ${String(raw.minimum)}` };
    case "too_big":
      return { cs: `nejvýš ${String(raw.maximum)}`, en: `at most ${String(raw.maximum)}` };
    case "invalid_format":
      return { cs: "nesprávný formát", en: issue.message };
    case "not_multiple_of":
      return { cs: "příliš mnoho desetinných míst", en: "too many decimal places" };
    case "unrecognized_keys":
      return {
        cs: `neznámé pole: ${(raw.keys ?? []).join(", ")}`,
        en: `unknown field: ${(raw.keys ?? []).join(", ")}`,
      };
    case "invalid_value":
      return { cs: "nepovolená hodnota", en: "not an allowed value" };
    default:
      return { cs: issue.message, en: issue.message };
  }
}

/** The problems of a failed parse, by field path, in both languages. */
export function issuesOf(issues: readonly Issue[], drop: readonly (string | number)[] = []) {
  return issues.map((issue) => ({
    path:
      issue.path.filter((part) => !drop.includes(part as string | number)).join(".") || "(record)",
    message: issueText(issue),
  }));
}

/** Parse one record with its schema, or refuse it with every issue named. */
export function parseRecord<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = issuesOf(result.error.issues);
  const list = (locale: Locale) =>
    issues.map((issue) => `${issue.path}: ${issue.message[locale]}`).join("; ");
  throw new StoreError(
    "invalid_record",
    {
      cs: `${label} neodpovídá schématu: ${list("cs")}`,
      en: `${label} does not match its schema: ${list("en")}`,
    },
    issues,
  );
}

export function parseIn<C extends CollectionName>(
  collection: C,
  value: unknown,
  label: string = collection,
): RecordOf[C] {
  return parseRecord(
    collections[collection].record as unknown as z.ZodType<RecordOf[C]>,
    value,
    label,
  );
}

/**
 * The audit fields of a stored record (`record.revision`, `record.updatedAt`,
 * `record.updatedBy`): every write of the port stores new ones, and the
 * values the port hands out leave them out. They are repository-db's audit
 * bundle, never business data, and never a caller's to set.
 */
export const AUDIT_FIELDS = ["revision", "updatedAt", "updatedBy"] as const;

/** A record without its audit fields, as the port hands it out and compares it. */
export function withoutAudit<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rest = { ...(value as Record<string, unknown>) };
  for (const field of AUDIT_FIELDS) delete rest[field];
  return rest as T;
}

/**
 * The audit fields of one write: a new random write revision, never derived
 * from the content and never a counter (Lazurio Module Standard, "One data
 * port"), the instant of the write, and the person it was written for, as
 * the writer knows them (`subject`); a write without a known person names
 * none.
 */
export function newAudit(by: string | null = null): {
  revision: string;
  updatedAt: string;
  updatedBy?: string;
} {
  return {
    revision: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    ...(by ? { updatedBy: by } : {}),
  };
}

/** The key of a record across collections: `deals/D-2026-0001`. */
export function recordKey(collection: CollectionName, id: string): string {
  return `${collection}/${id}`;
}

/** One stored record of any collection. */
export interface Entry<T = unknown> {
  value: T;
  revision: string;
}

/** A record that could not be read, with why in both languages. */
export interface Problem {
  record: string;
  message: Localized;
}

/** Every record by collection and id, plus records that could not be read. */
export type Snapshot = { [C in CollectionName]: Map<string, Entry<RecordOf[C]>> } & {
  problems: Problem[];
};

export function emptySnapshot(): Snapshot {
  return {
    settings: new Map(),
    companies: new Map(),
    contacts: new Map(),
    deals: new Map(),
    activities: new Map(),
    problems: [],
  };
}

export function dataSetOf(snapshot: Snapshot): DataSet {
  const values = <C extends CollectionName>(collection: C) =>
    [...snapshot[collection].values()].map((entry) => entry.value as RecordOf[C]);
  return {
    settings: snapshot.settings.get("settings")?.value ?? null,
    companies: values("companies"),
    contacts: values("contacts"),
    deals: values("deals"),
    activities: values("activities"),
  };
}

/** Errors of the rules across records as one refusal, in both languages. */
function refusal(code: string, issues: { path: string; message: Localized }[]): StoreError {
  return new StoreError(
    code,
    {
      cs: issues.map((issue) => `${issue.path}: ${issue.message.cs}`).join("; "),
      en: issues.map((issue) => `${issue.path}: ${issue.message.en}`).join("; "),
    },
    issues,
  );
}

/**
 * Refuse a save that would break a rule across records (an unknown company,
 * contact or stage, a won deal without a value). Only errors about the saved
 * records count, so an older problem elsewhere never blocks an unrelated
 * edit, and a warning never blocks.
 */
export function assertRulesFor(keys: readonly string[], data: DataSet): void {
  const wanted = new Set(keys);
  const issues = errorsOf(checkRulesLocalized(data))
    .filter((issue) => wanted.has(issue.record))
    .map((issue) => ({ path: issue.record, message: issue.message }));
  if (issues.length > 0) throw refusal("invalid_record", issues);
}

/** Refuse a publication while any rule across records is broken; warnings pass. */
export function assertPublishable(data: DataSet): void {
  const issues = errorsOf(checkRulesLocalized(data)).map((issue) => ({
    path: issue.record,
    message: issue.message,
  }));
  if (issues.length > 0) throw refusal("rules_failed", issues);
}

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, "cs") || 0;

/** The records of a collection in the order the port promises. */
export function ordered<C extends CollectionName>(
  snapshot: Snapshot,
  collection: C,
): Entry<RecordOf[C]>[] {
  const entries = [...snapshot[collection].values()] as Entry<RecordOf[C]>[];
  switch (collection) {
    case "companies":
    case "contacts":
      return entries.sort(
        (left, right) =>
          byName(left.value as { name: string }, right.value as { name: string }) ||
          (left.value as { id: string }).id.localeCompare((right.value as { id: string }).id),
      );
    case "deals":
      return entries.sort((left, right) =>
        (right.value as RecordOf["deals"]).id.localeCompare((left.value as RecordOf["deals"]).id),
      );
    case "activities":
      return entries.sort((left, right) => {
        const a = left.value as RecordOf["activities"];
        const b = right.value as RecordOf["activities"];
        return Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id);
      });
    default:
      return entries;
  }
}

export { recordId };
