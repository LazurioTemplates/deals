// The migration of a Deals data directory from 0.1.x to 0.2.0.
//
//   bun run migrate <data directory> [--lang cs|en] [--write]
//
// The directory is laid out like db/data/ (the data checkout's `data`, or a
// start of seed/). Without --write it only says what it would change.
//
// What changes:
// - settings `deals.settings.v1` → `v2`: the names in `owners` become
//   salespeople records (`salespeople/S-0001` …); the settings gain what a
//   new quote starts with (`quotes`) and the days an invoice is due
//   (`paymentDueDays`), in the language given.
// - deals `deals.deal.v1` → `v2`: the free-text `owner` becomes `ownerId`, a
//   salesperson (a name not in `owners` gets a record of its own); a
//   `quoteRef` of the neighbouring Quotes Module is kept as a line of the
//   description; a won deal waits in the forecast as unassigned until
//   somebody plans its payments.
//
// Every record it writes gets a new `revision` and `updatedAt`, as the Module
// Standard asks of a change made past the App ("One data port"). After it,
// `bun run validate:db` checks the result, and the person reviews and
// publishes the change in the App („Koncept a publikování“).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toStableYaml } from "@lazurio/repository-db";
import { collections } from "../domain/collections.ts";
import { nextSalespersonId } from "../domain/salesperson.ts";
import type { Locale } from "../i18n/locale.ts";

type Doc = { schemaVersion: string; id: string; record: Record<string, unknown> };

export interface MigrationResult {
  /** `<collection>/<id>` of every record written or created. */
  changed: string[];
  /** Files to write: path relative to the directory and the document. */
  files: { path: string; document: Doc }[];
}

/** What a new quote starts with, in a language. */
export function quoteDefaultsFor(locale: Locale) {
  return locale === "en"
    ? {
        vatRate: 2100,
        validityDays: 30,
        sections: [
          { id: "items", label: "Items" },
          { id: "work", label: "Work" },
        ],
        units: ["pcs", "h", "day", "m", "km", "month"],
      }
    : {
        vatRate: 2100,
        validityDays: 30,
        sections: [
          { id: "items", label: "Položky" },
          { id: "work", label: "Práce" },
        ],
        units: ["ks", "h", "MD", "m", "km", "měs."],
      };
}

function readDocs(root: string, collection: string): Doc[] {
  const directory = join(root, collection);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => Bun.YAML.parse(readFileSync(join(directory, file), "utf8")) as Doc);
}

function audit(record: Record<string, unknown>, now: string): Record<string, unknown> {
  const { revision: _r, updatedAt: _u, updatedBy: _b, ...rest } = record;
  return { ...rest, revision: crypto.randomUUID(), updatedAt: now };
}

/** Plans the migration of a data directory; writes nothing. */
export function planMigration(
  root: string,
  locale: Locale,
  options: { now?: string; stamp?: boolean } = {},
): MigrationResult {
  const now = options.now ?? new Date().toISOString();
  const stamp = options.stamp ?? true;
  const files: MigrationResult["files"] = [];
  const write = (
    collection: keyof typeof collections,
    id: string,
    record: Record<string, unknown>,
  ) =>
    files.push({
      path: join(collection, `${id}.yaml`),
      document: {
        schemaVersion: collections[collection].schemaVersion,
        id,
        record: stamp ? audit(record, now) : record,
      },
    });

  const [settingsDoc] = readDocs(root, "settings");
  const people = readDocs(root, "salespeople");
  const byName = new Map<string, string>(
    people.map((doc) => [String(doc.record.name), doc.id] as [string, string]),
  );
  const used = people.map((doc) => doc.id);
  const personFor = (name: string): string => {
    const found = byName.get(name);
    if (found) return found;
    const id = nextSalespersonId(used);
    used.push(id);
    byName.set(name, id);
    write("salespeople", id, { id, name, active: true });
    return id;
  };

  let wonStages = new Set<string>();
  if (settingsDoc && settingsDoc.schemaVersion === "deals.settings.v1") {
    const { owners, ...rest } = settingsDoc.record as { owners?: string[] } & Record<
      string,
      unknown
    >;
    for (const name of owners ?? []) personFor(name);
    write("settings", "settings", {
      ...rest,
      quotes: quoteDefaultsFor(locale),
      paymentDueDays: 14,
    });
  }
  if (settingsDoc) {
    const stages = (settingsDoc.record.stages ?? []) as { id: string; kind: string }[];
    wonStages = new Set(stages.filter((stage) => stage.kind === "won").map((stage) => stage.id));
  }

  for (const doc of readDocs(root, "deals")) {
    if (doc.schemaVersion !== "deals.deal.v1") continue;
    const { owner, quoteRef, ...rest } = doc.record as {
      owner?: string;
      quoteRef?: { id: string };
    } & Record<string, unknown>;
    const record: Record<string, unknown> = {
      ...rest,
      ownerId: personFor(owner?.trim() || (locale === "en" ? "Unassigned" : "Nepřiřazeno")),
    };
    if (quoteRef?.id) {
      const line = locale === "en" ? `Quote: ${quoteRef.id}` : `Nabídka: ${quoteRef.id}`;
      record.description = record.description ? `${record.description}\n\n${line}` : line;
    }
    if (wonStages.has(String(record.stageId)) && record.paymentPlan === undefined) {
      record.paymentPlan = { status: "unassigned", payments: [] };
    }
    write("deals", doc.id, record);
  }
  // A salesperson created for a deal is written once, as its last version.
  const seen = new Set<string>();
  const unique = files
    .reverse()
    .filter((file) => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    })
    .reverse();
  return {
    files: unique,
    changed: unique.map((file) => file.path.replace(/\.yaml$/, "")),
  };
}

export function applyMigration(root: string, result: MigrationResult): void {
  for (const file of result.files) {
    const path = join(root, file.path);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, toStableYaml(file.document));
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = args.find((arg) => !arg.startsWith("--"));
  const langAt = args.indexOf("--lang");
  const locale = (langAt >= 0 ? args[langAt + 1] : "cs") as Locale;
  if (!root || (locale !== "cs" && locale !== "en")) {
    console.error("Usage: bun run migrate <data directory> [--lang cs|en] [--write]");
    process.exit(2);
  }
  const stamp = !args.includes("--no-audit");
  const result = planMigration(root, locale, { stamp });
  if (result.changed.length === 0) {
    console.log("Nothing to migrate: the data is already 0.2.0.");
    process.exit(0);
  }
  if (!args.includes("--write")) {
    console.log(`Would change ${result.changed.length} record(s):\n${result.changed.join("\n")}`);
    console.log("Run again with --write to write them.");
    process.exit(0);
  }
  applyMigration(root, result);
  console.log(`Migrated ${result.changed.length} record(s) in ${root}.`);
}
