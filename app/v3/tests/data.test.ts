import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, toStableYaml } from "@lazurio/repository-db";
import { readDataDirectory } from "../src/data/directory.ts";
import { LOCALES } from "../src/i18n/locale.ts";
import { sampleData, seedDirectory, TODAY } from "./support/seed.ts";

const STARTS = ["empty", "sample"] as const;

describe("the starts this template ships", () => {
  for (const locale of LOCALES) {
    for (const start of STARTS) {
      test(`${locale}/${start} is valid and in the engine's canonical YAML`, () => {
        const root = seedDirectory(locale, start);
        const read = readDataDirectory(root, TODAY);
        expect(read.issues).toEqual([]);
        for (const collection of readdirSync(root)) {
          for (const file of readdirSync(join(root, collection)).filter((name) =>
            name.endsWith(".yaml"),
          )) {
            const text = readFileSync(join(root, collection, file), "utf8");
            expect(toStableYaml(parseYaml(text))).toBe(text);
          }
        }
      });
    }

    test(`${locale}: the empty start has a ready pipeline and no records of an Organization`, () => {
      const { data, warnings } = readDataDirectory(seedDirectory(locale, "empty"), TODAY);
      expect(data.companies.length + data.contacts.length).toBe(0);
      expect(data.deals.length + data.activities.length).toBe(0);
      expect(warnings).toEqual([]);
      expect(data.settings?.currency).toBe("CZK");
      expect(data.settings?.stages.map((stage) => [stage.kind, stage.probability])).toEqual([
        ["open", 10],
        ["open", 25],
        ["open", 50],
        ["open", 75],
        ["won", 100],
        ["lost", 0],
      ]);
      expect(data.settings?.lossReasons.length).toBeGreaterThan(0);
      expect(data.settings?.owners).toBeUndefined();
      expect(data.settings?.aresLookup).toBe(false);
    });

    test(`${locale}: the sample covers the whole pipeline`, () => {
      const data = sampleData(locale);
      expect(data.companies).toHaveLength(6);
      expect(data.contacts).toHaveLength(10);
      expect(data.deals).toHaveLength(14);
      expect(data.activities).toHaveLength(20);
      const count = (stage: string) => data.deals.filter((deal) => deal.stageId === stage).length;
      expect(count("won")).toBe(3);
      expect(count("lost")).toBe(2);
      for (const deal of data.deals.filter((entry) => entry.stageId === "lost")) {
        expect(deal.lossReasonId).toBeString();
      }
      expect(new Set(data.activities.map((activity) => activity.type))).toEqual(
        new Set(["call", "meeting", "email", "note", "task"]),
      );
    });
  }

  test("the two languages carry the same example", () => {
    const cs = sampleData("cs");
    const en = sampleData("en");
    const shape = (data: typeof cs) => ({
      stages: data.settings.stages.map(({ id, kind, probability }) => [id, kind, probability]),
      reasons: data.settings.lossReasons.map((reason) => reason.id),
      companies: data.companies.map((company) => company.id).sort(),
      contacts: data.contacts.map((contact) => [contact.id, contact.companyId]),
      deals: data.deals.map((deal) => [
        deal.id,
        deal.companyId,
        deal.contactIds,
        deal.stageId,
        deal.value,
        deal.probability,
        deal.createdAt,
        deal.expectedClose,
        deal.closedAt,
        deal.lossReasonId,
      ]),
      activities: data.activities.map((activity) => [
        activity.id,
        activity.dealId,
        activity.type,
        activity.at,
        activity.done,
      ]),
    });
    expect(shape(en)).toEqual(shape(cs));
    const english = JSON.stringify(en);
    expect(english.match(/[ěščřžýáíéůúťďň]/gi) ?? []).toEqual([]);
  });

  test("the example is fictional: reserved domains only, no IČO and no DIČ", () => {
    for (const locale of LOCALES) {
      const data = sampleData(locale);
      for (const company of data.companies) {
        expect(company.ico).toBeUndefined();
        expect(company.dic).toBeUndefined();
        expect(company.website ?? "https://x.example").toMatch(/^https:\/\/[a-z0-9.-]+\.example$/);
      }
      for (const contact of data.contacts) expect(contact.email).toMatch(/@[a-z0-9.-]+\.example$/);
      // Every address-like text of the seed is on a reserved domain.
      const text = JSON.stringify(data);
      for (const domain of text.match(/[a-z0-9-]+(\.[a-z0-9-]+)+(?=["/])/gi) ?? []) {
        if (!/^\d/.test(domain)) expect(domain).toMatch(/(\.example|example\.com)$/);
      }
    }
  });
});
