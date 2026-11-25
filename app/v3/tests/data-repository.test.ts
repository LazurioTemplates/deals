import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, validateRepository } from "../../../templates/data-repo/scripts/validate.ts";
import { renderSchemas } from "../src/cli/schema.ts";
import { collections } from "../src/domain/collections.ts";
import { createFixtureRepo } from "./support/fixture-repo.ts";
import {
  DATA_REPO_TEMPLATE,
  newActivity,
  newCompany,
  newContact,
  newDeal,
  sampleData,
} from "./support/seed.ts";

// The last test builds four data repositories with real Git; on a Windows
// runner that takes longer than bun's default of 5 s per test.
setDefaultTimeout(60_000);

const schema = (file: string) =>
  JSON.parse(readFileSync(join(DATA_REPO_TEMPLATE, "schemas", file), "utf8"));

describe("data repository template", () => {
  test("its JSON Schemas are the ones generated from the Zod schemas", () => {
    for (const { file, text } of renderSchemas()) {
      expect(readFileSync(join(DATA_REPO_TEMPLATE, "schemas", file), "utf8")).toBe(text);
    }
  });

  test("its validator agrees with the Zod schemas on the shape of a record", () => {
    const envelope = (schemaVersion: string, id: string, record: unknown) => ({
      schemaVersion,
      id,
      record,
    });
    const sample = sampleData();
    const cases: { collection: keyof typeof collections; values: unknown[] }[] = [
      {
        collection: "settings",
        values: [
          sample.settings,
          { ...sample.settings, currency: "czk" },
          { ...sample.settings, stages: sample.settings.stages.slice(0, 2) },
          { ...sample.settings, lossReasons: [] },
          { ...sample.settings, aresLookup: "yes" },
          {
            ...sample.settings,
            stages: sample.settings.stages.map((stage) => ({ ...stage, kind: "paused" })),
          },
          {
            ...sample.settings,
            stages: sample.settings.stages.map((stage) => ({ ...stage, probability: 12.5 })),
          },
        ],
      },
      {
        collection: "companies",
        values: [
          ...sample.companies,
          newCompany(),
          { ...newCompany(), ico: "1234567" },
          { ...newCompany(), ico: "00000001" },
          { ...newCompany(), id: "X-1" },
          { ...newCompany(), address: { town: "Brno" } },
          { ...newCompany(), extra: 1 },
        ],
      },
      {
        collection: "contacts",
        values: [...sample.contacts, newContact(), { ...newContact(), companyId: "7" }],
      },
      {
        collection: "deals",
        values: [
          ...sample.deals,
          newDeal(),
          { ...newDeal(), value: 10.5 },
          { ...newDeal(), value: -1 },
          { ...newDeal(), probability: 101 },
          { ...newDeal(), expectedClose: "2026-13-01" },
          { ...newDeal(), id: "D-26-1" },
          { ...newDeal(), quoteRef: { id: "" } },
          { ...newDeal(), owner: "" },
        ],
      },
      {
        collection: "activities",
        values: [
          ...sample.activities,
          newActivity(),
          { ...newActivity(), type: "visit" },
          { ...newActivity(), at: "2026-11-24" },
          { ...newActivity(), at: "2026-11-24T10:00:00" },
          { ...newActivity(), at: "2026-11-24T10:00Z" },
          { ...newActivity(), done: "no" },
          { ...newActivity(), id: "A-2026-1" },
        ],
      },
    ];
    for (const { collection, values } of cases) {
      const spec = collections[collection];
      const json = schema(`${collection}.schema.json`);
      for (const value of values) {
        const ok = spec.record.safeParse(value).success;
        expect({
          collection,
          value,
          ok: check(json, envelope(spec.schemaVersion, "X", value)).length === 0,
        }).toEqual({ collection, value, ok });
      }
    }
    expect(
      check(schema("deals.schema.json"), {
        schemaVersion: "deals.deal.v2",
        id: "X",
        record: newDeal(),
      }),
    ).not.toEqual([]);
  });

  test("the validator passes every start in both languages and refuses a broken record", () => {
    const fixtures = (["cs", "en"] as const).flatMap((locale) =>
      (["empty", "sample"] as const).map((start) => createFixtureRepo({ locale, start })),
    );
    try {
      for (const fixture of fixtures) expect(validateRepository(fixture.mountRoot)).toEqual([]);
      const [first] = fixtures;
      if (!first) throw new Error("no fixture");
      writeFileSync(
        join(first.mountRoot, "data", "companies", "C-0999.yaml"),
        "id: OTHER\nrecord:\n  id: C-0999\nschemaVersion: deals.company.v1\n",
      );
      const errors = validateRepository(first.mountRoot);
      expect(errors.some((error) => error.includes("/record/name: is required"))).toBe(true);
      expect(errors.some((error) => error.includes("the id must be the file name"))).toBe(true);
    } finally {
      for (const fixture of fixtures) fixture.cleanup();
    }
  });
});
