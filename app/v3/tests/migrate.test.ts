import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml, toStableYaml } from "@lazurio/repository-db";
import { validateRepository } from "../../../templates/data-repo/scripts/validate.ts";
import { applyMigration, planMigration } from "../src/cli/migrate.ts";
import { readDataDirectory } from "../src/data/directory.ts";
import type { Locale } from "../src/i18n/locale.ts";
import { DATA_REPO_TEMPLATE, seedDirectory, TODAY } from "./support/seed.ts";

/**
 * The migration from 0.1.x to 0.2.0 over a data directory as a 0.1 data
 * repository holds it: settings v1 with the salespeople as names, deals v1
 * with a free-text owner and a quote of the neighbouring Quotes Module; the
 * companies, contacts and activities are the same in both versions.
 */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, collection: string, id: string, document: object) {
  mkdirSync(join(root, collection), { recursive: true });
  writeFileSync(join(root, collection, `${id}.yaml`), toStableYaml(document));
}

/** A 0.1 data directory: the sample's companies and contacts, 0.1 deals and an activity. */
function dataOf01(locale: Locale = "cs"): string {
  const root = mkdtempSync(join(tmpdir(), "deals-migrate-"));
  roots.push(root);
  const seed = seedDirectory(locale, "sample");
  for (const collection of ["companies", "contacts"]) {
    cpSync(join(seed, collection), join(root, collection), { recursive: true });
  }
  write(root, "activities", "A-2026-00001", {
    schemaVersion: "deals.activity.v1",
    id: "A-2026-00001",
    record: {
      id: "A-2026-00001",
      dealId: "D-2026-0002",
      type: "call",
      at: "2026-10-01T10:00:00+02:00",
      summary: "Hovor",
    },
  });
  write(root, "settings", "settings", {
    schemaVersion: "deals.settings.v1",
    id: "settings",
    record: {
      currency: "CZK",
      stages: [
        { id: "lead", label: "Nový kontakt", kind: "open", probability: 10 },
        { id: "proposal", label: "Nabídka", kind: "open", probability: 50 },
        { id: "won", label: "Vyhráno", kind: "won", probability: 100 },
        { id: "lost", label: "Prohráno", kind: "lost", probability: 0 },
      ],
      lossReasons: [{ id: "price", label: "Cena" }],
      owners: ["Jana Ukázková", "Petr Vzorný"],
      aresLookup: false,
    },
  });
  const deal = (id: string, record: object) =>
    write(root, "deals", id, {
      schemaVersion: "deals.deal.v1",
      id,
      record: { id, companyId: "C-0001", createdAt: "2026-09-01", ...record },
    });
  deal("D-2026-0001", {
    title: "Otevřený",
    owner: "Jana Ukázková",
    stageId: "lead",
    value: 1_000_000,
    expectedClose: "2027-01-29",
  });
  deal("D-2026-0002", {
    title: "S nabídkou",
    owner: "Petr Vzorný",
    stageId: "proposal",
    value: 2_000_000,
    expectedClose: "2027-01-29",
    description: "Druhé patro.",
    quoteRef: { id: "NAB-2026-0007" },
  });
  deal("D-2026-0003", {
    title: "Vyhraný",
    owner: "Někdo Mimo Seznam",
    stageId: "won",
    value: 3_000_000,
    closedAt: "2026-10-20",
  });
  deal("D-2026-0004", {
    title: "Ztracený",
    owner: " ",
    stageId: "lost",
    value: 4_000_000,
    closedAt: "2026-10-21",
    lossReasonId: "price",
  });
  return root;
}

const NOW = "2026-11-26T09:30:00.000Z";

describe("the migration from 0.1.x", () => {
  test("produces data that validates against the schemas and the rules", () => {
    const root = dataOf01();
    // 0.1 data does not read as 0.2.0.
    expect(readDataDirectory(root, TODAY).issues.length).toBeGreaterThan(0);
    const plan = planMigration(root, "cs", { now: NOW });
    expect(plan.changed).toEqual([
      "salespeople/S-0001",
      "salespeople/S-0002",
      "settings/settings",
      "deals/D-2026-0001",
      "deals/D-2026-0002",
      "salespeople/S-0003",
      "deals/D-2026-0003",
      "salespeople/S-0004",
      "deals/D-2026-0004",
    ]);
    applyMigration(root, plan);
    const read = readDataDirectory(root, TODAY);
    expect(read.issues).toEqual([]);
    expect(read.data.salespeople.map((person) => [person.id, person.name, person.active])).toEqual([
      ["S-0001", "Jana Ukázková", true],
      ["S-0002", "Petr Vzorný", true],
      ["S-0003", "Někdo Mimo Seznam", true],
      ["S-0004", "Nepřiřazeno", true],
    ]);
    const deals = new Map(read.data.deals.map((deal) => [deal.id, deal]));
    expect(deals.get("D-2026-0001")?.ownerId).toBe("S-0001");
    // The quote of the neighbouring Module stays as a line of the description.
    expect(deals.get("D-2026-0002")).toMatchObject({
      ownerId: "S-0002",
      description: "Druhé patro.\n\nNabídka: NAB-2026-0007",
    });
    // A won deal waits unassigned in the forecast until somebody plans it.
    expect(deals.get("D-2026-0003")?.paymentPlan).toEqual({ status: "unassigned", payments: [] });
    expect(deals.get("D-2026-0004")?.paymentPlan).toBeUndefined();
    // The settings gain what a new quote and an invoice start with.
    expect(read.data.settings).toMatchObject({
      quotes: { vatRate: 2100, validityDays: 30 },
      paymentDueDays: 14,
    });
    expect(read.data.settings).not.toHaveProperty("owners");
    // Every record it wrote carries a new write revision and the instant.
    for (const file of plan.files) {
      const document = parseYaml(readFileSync(join(root, file.path), "utf8")) as {
        record: { revision?: string; updatedAt?: string; updatedBy?: string };
      };
      expect(document.record.revision).toMatch(/^[0-9a-f-]{36}$/);
      expect(document.record.updatedAt).toBe(NOW);
      expect(document.record.updatedBy).toBeUndefined();
    }
    // The data repository's own validator accepts it too.
    const repository = mkdtempSync(join(tmpdir(), "deals-migrate-repo-"));
    roots.push(repository);
    cpSync(join(DATA_REPO_TEMPLATE, "schemas"), join(repository, "schemas"), { recursive: true });
    cpSync(root, join(repository, "data"), { recursive: true });
    expect(validateRepository(repository)).toEqual([]);
  });

  test("is idempotent: a second run changes nothing", () => {
    const root = dataOf01();
    applyMigration(root, planMigration(root, "cs", { now: NOW }));
    const again = planMigration(root, "cs", { now: NOW });
    expect(again).toEqual({ changed: [], files: [] });
  });

  test("writes nothing while it only plans", () => {
    const root = dataOf01();
    const before = readFileSync(join(root, "deals", "D-2026-0001.yaml"), "utf8");
    planMigration(root, "cs");
    expect(readFileSync(join(root, "deals", "D-2026-0001.yaml"), "utf8")).toBe(before);
  });

  test("speaks the language given; without audit it is the same every time", () => {
    const root = dataOf01("en");
    const first = planMigration(root, "en", { stamp: false });
    expect(first).toEqual(planMigration(root, "en", { stamp: false }));
    const settings = first.files.find((file) => file.path.startsWith("settings"));
    expect(settings?.document.record).toMatchObject({
      quotes: {
        sections: [
          { id: "items", label: "Items" },
          { id: "work", label: "Work" },
        ],
      },
    });
    expect(settings?.document.record).not.toHaveProperty("revision");
    const lost = first.files.find((file) => file.path.endsWith("D-2026-0004.yaml"));
    expect(lost?.document.record.ownerId).toBe("S-0004");
    const unassigned = first.files.find((file) => file.path.endsWith("S-0004.yaml"));
    expect(unassigned?.document.record.name).toBe("Unassigned");
  });

  test("data already at 0.2.0, the starts, have nothing to migrate", () => {
    for (const locale of ["cs", "en"] as const) {
      for (const start of ["empty", "sample"] as const) {
        expect(planMigration(seedDirectory(locale, start), locale).changed).toEqual([]);
      }
    }
  });
});
