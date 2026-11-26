import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { icoCheckDigit } from "../src/domain/company.ts";
import { parseCsv } from "../src/domain/csv.ts";
import { createApi } from "../src/server/api.ts";
import {
  guessMapping,
  type ImportField,
  type ImportInput,
  type ImportKind,
  type ImportReport,
  importRecords,
  parseImportDate,
  planImport,
} from "../src/service/import.ts";
import { sampleData, TODAY } from "./support/seed.ts";

const ORIGIN = "http://127.0.0.1:24941";

/** A valid IČO computed from seven digits, never a real company's number from a list. */
const ico = (first7: string) => `${first7}${icoCheckDigit(first7)}`;

/** The mapped rows of a CSV text, with the guessed mapping. */
function rowsOf(kind: ImportKind, text: string): ImportInput["rows"] {
  const table = parseCsv(text);
  const mapping = guessMapping(kind, table.headers);
  return table.rows.map((row, index) => ({
    row: table.rowNumbers[index] ?? index + 2,
    values: Object.fromEntries(
      mapping.flatMap((field, column) => (field ? [[field, row[column] ?? ""]] : [])),
    ) as Partial<Record<ImportField, string>>,
  }));
}

function input(kind: ImportKind, text: string, extra: Partial<ImportInput> = {}): ImportInput {
  return {
    kind,
    rows: rowsOf(kind, text),
    createCompanies: false,
    numberLocale: "cs",
    ...extra,
  };
}

describe("the column guesses", () => {
  test("recognise HubSpot, English and Czech headers", () => {
    expect(
      guessMapping("deals", [
        "Deal Name",
        "Amount",
        "Deal Stage",
        "Close Date",
        "Create Date",
        "Deal owner",
        "Associated Company",
        "Pipeline",
      ]),
    ).toEqual(["title", "value", "stage", "closeDate", "createdAt", "owner", "company", null]);
    expect(
      guessMapping("contacts", [
        "First Name",
        "Last Name",
        "Email",
        "Phone Number",
        "Job Title",
        "Company Name",
      ]),
    ).toEqual(["firstName", "lastName", "email", "phone", "role", "company"]);
    expect(
      guessMapping("companies", ["Company name", "City", "Website URL", "IČO", "PSČ", "DIČ"]),
    ).toEqual(["name", "city", "website", "ico", "postalCode", "dic"]);
    expect(guessMapping("contacts", ["Jméno", "Příjmení", "E-mail", "Telefon"])).toEqual([
      "firstName",
      "lastName",
      "email",
      "phone",
    ]);
    expect(guessMapping("deals", ["Název", "Firma", "Hodnota (Kč)", "Fáze", "Obchodník"])).toEqual([
      "title",
      "company",
      "value",
      "stage",
      "owner",
    ]);
  });

  test("give a field to one column only", () => {
    expect(guessMapping("companies", ["Name", "Company name"])).toEqual(["name", null]);
  });
});

describe("the dates of an import", () => {
  test("read ISO, Czech and American dates", () => {
    expect(parseImportDate("2026-11-05")).toBe("2026-11-05");
    expect(parseImportDate("2026-11-05 14:30")).toBe("2026-11-05");
    expect(parseImportDate("5. 11. 2026")).toBe("2026-11-05");
    expect(parseImportDate("5.11.2026")).toBe("2026-11-05");
    expect(parseImportDate("11/5/2026")).toBe("2026-11-05");
  });

  test("refuse a day the calendar does not have and anything else", () => {
    expect(parseImportDate("2027-02-29")).toBeNull();
    expect(parseImportDate("31. 4. 2026")).toBeNull();
    expect(parseImportDate("13/1/2026")).toBeNull();
    expect(parseImportDate("listopad")).toBeNull();
    expect(parseImportDate("")).toBeNull();
  });
});

describe("planning an import", () => {
  const sample = sampleData("cs");

  test("companies: a new one, matched by IČO or name, and a broken IČO", () => {
    const fresh = ico("1234567");
    const plan = planImport(
      sample,
      sample.settings,
      input(
        "companies",
        [
          "Company name;IČO;City",
          `Nová Firma s.r.o.;${fresh};Brno`,
          "ukázka nábytek s.r.o.;;Praha",
          `Ještě Jedna s.r.o.;${fresh};Olomouc`,
          "Špatné IČO s.r.o.;12345678;Ostrava",
        ].join("\n"),
      ),
      TODAY,
    );
    expect(plan.created.companies).toBe(1);
    expect(plan.rows.map((row) => row.skipped)).toEqual([false, true, true, true]);
    expect(plan.rows[0]?.creates).toEqual([
      { collection: "companies", id: "C-0007", name: "Nová Firma s.r.o." },
    ]);
    expect(plan.rows[1]?.errors[0]?.en).toContain("already exists (C-0001)");
    expect(plan.rows[2]?.errors[0]?.en).toContain("already in the import on row 2");
    expect(plan.rows[3]?.errors[0]?.cs).toContain("není platné");
  });

  test("contacts: matched by e-mail, the name from its parts, the company by name", () => {
    const plan = planImport(
      sample,
      sample.settings,
      input(
        "contacts",
        [
          "First Name,Last Name,Email,Company Name",
          "Nová,Osoba,nova@example.com,Vzorová Logistika a.s.",
          "Eva,Smyšlená,EVA.SMYSLENA@ukazka-nabytek.example,",
          "Bez,Firmy,bez@example.com,Neznámá s.r.o.",
        ].join("\n"),
      ),
      TODAY,
    );
    expect(plan.rows.map((row) => row.skipped)).toEqual([false, true, false]);
    const [first, third] = plan.changes.map((change) => ("value" in change ? change.value : null));
    expect(first).toMatchObject({ id: "P-0011", name: "Nová Osoba", companyId: "C-0002" });
    expect(third).toMatchObject({ id: "P-0012", name: "Bez Firmy" });
    expect(third).not.toHaveProperty("companyId");
    expect(plan.rows[2]?.warnings[0]?.en).toContain("Neznámá s.r.o. does not exist");
  });

  test("deals: stages, amounts, dates, a new salesperson and a new company when ticked", () => {
    const text = [
      "Deal Name,Company,Amount,Deal Stage,Close Date,Create Date,Deal owner",
      'Recepce,Ukázka Nábytek s.r.o.,"1 234,50",Nabídka,2027-03-31,2026-11-01,Jana Ukázková',
      "Sklad,Nová Firma s.r.o.,50000,closedwon,5. 11. 2026,1. 10. 2026,Nový Kolega",
      "Bez data,Ukázka Nábytek s.r.o.,1000,Vyhráno,,,Jana Ukázková",
      "Neznámá fáze,Ukázka Nábytek s.r.o.,,appointmentscheduled,,,Petr Vzorný",
      "Špatná částka,Ukázka Nábytek s.r.o.,tisíc,,,,Petr Vzorný",
    ].join("\n");
    const plan = planImport(
      sample,
      sample.settings,
      input("deals", text, { createCompanies: true }),
      TODAY,
    );
    expect(plan.rows.map((row) => row.skipped)).toEqual([false, false, true, false, true]);
    expect(plan.created).toEqual({ companies: 1, contacts: 0, deals: 3, salespeople: 1 });
    const values = plan.changes.map((change) => ("value" in change ? change.value : null));
    expect(values).toContainEqual(
      expect.objectContaining({
        title: "Recepce",
        companyId: "C-0001",
        ownerId: "S-0001",
        stageId: "proposal",
        value: 123_450,
        createdAt: "2026-11-01",
        expectedClose: "2027-03-31",
      }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({
        title: "Sklad",
        companyId: "C-0007",
        ownerId: "S-0004",
        stageId: "won",
        value: 5_000_000,
        closedAt: "2026-11-05",
        createdAt: "2026-10-01",
      }),
    );
    expect(values).toContainEqual(expect.objectContaining({ id: "S-0004", name: "Nový Kolega" }));
    expect(values).toContainEqual(
      expect.objectContaining({ id: "C-0007", name: "Nová Firma s.r.o." }),
    );
    expect(values).toContainEqual(
      expect.objectContaining({ title: "Neznámá fáze", stageId: "lead", value: 0 }),
    );
    expect(plan.rows[2]?.errors[0]?.en).toBe("A deal in the stage Vyhráno needs its close date.");
    expect(plan.rows[3]?.warnings[0]?.en).toContain("goes to Nový kontakt");
    expect(plan.rows[4]?.errors[0]?.cs).toContain("tisíc");
  });

  test("deals: a missing company is refused unless the person ticked creating it", () => {
    const plan = planImport(
      sample,
      sample.settings,
      input("deals", "Deal Name,Company,Deal owner\nNový,Neexistující s.r.o.,Jana Ukázková"),
      TODAY,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.rows[0]?.errors[0]?.en).toContain("Neexistující s.r.o. does not exist");
  });

  test("deals: amounts as English writes them", () => {
    const plan = planImport(
      sample,
      sample.settings,
      input(
        "deals",
        'Deal Name,Company,Amount,Deal owner\nA,Ukázka Nábytek s.r.o.,"1,234.5",S-0002',
        {
          numberLocale: "en",
        },
      ),
      TODAY,
    );
    expect(plan.changes[0]).toMatchObject({ value: { value: 123_450, ownerId: "S-0002" } });
  });

  test("deals: a lost one needs a reason from the settings", () => {
    const plan = planImport(
      sample,
      sample.settings,
      input(
        "deals",
        [
          "Deal Name,Company,Deal Stage,Close Date,Closed Lost Reason,Deal owner",
          "A,Ukázka Nábytek s.r.o.,Prohráno,2026-11-02,Cena,Jana Ukázková",
          "B,Ukázka Nábytek s.r.o.,closedlost,2026-11-02,Nevím,Jana Ukázková",
        ].join("\n"),
      ),
      TODAY,
    );
    expect(plan.rows.map((row) => row.skipped)).toEqual([false, true]);
    expect(plan.changes[0]).toMatchObject({
      value: { stageId: "lost", lossReasonId: "price", closedAt: "2026-11-02" },
    });
  });
});

describe("importing", () => {
  test("writes every new record in one draft and publishes nothing", async () => {
    const store = createMemoryStore(sampleData("cs"));
    let writes = 0;
    const saveAll = store.saveAll.bind(store);
    store.saveAll = async (changes) => {
      writes += 1;
      return saveAll(changes);
    };
    const report = await importRecords(
      store,
      input(
        "deals",
        "Deal Name,Company,Amount,Deal owner\nA,Nová s.r.o.,100,Nový Obchodník\nB,Nová s.r.o.,200,Nový Obchodník",
        { createCompanies: true },
      ),
      { today: TODAY, locale: "en" },
    );
    expect(writes).toBe(1);
    expect(report.created).toEqual({ companies: 1, contacts: 0, deals: 2, salespeople: 1 });
    expect(report.skipped).toEqual([]);
    expect((await store.listDeals()).length).toBe(16);
    expect((await store.list("salespeople")).length).toBe(4);
    // Four new records in the draft, nothing published.
    expect((await store.draft("en")).records?.length).toBe(4);
  });

  test("the API answers what it created and skipped, in the person's language", async () => {
    const store = createMemoryStore(sampleData("cs"));
    const api = createApi(store, {
      allowedOrigins: new Set([ORIGIN]),
      access: () => ({ admitted: true, mayWrite: true }),
      today: () => TODAY,
    });
    const post = (body: unknown, language: string) =>
      api(
        new Request(`${ORIGIN}/api/import`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            "accept-language": language,
          },
          body: JSON.stringify(body),
        }),
      );
    const body = input(
      "companies",
      "Company name,City\nNová Firma s.r.o.,Brno\nUkázka Nábytek s.r.o.,Praha",
    );
    const response = await post(body, "en");
    expect(response.status).toBe(200);
    const report = (await response.json()) as ImportReport;
    expect(report.created.companies).toBe(1);
    expect(report.skipped).toEqual([
      {
        row: 3,
        label: "Ukázka Nábytek s.r.o.",
        reasons: ["The company Ukázka Nábytek s.r.o. already exists (C-0001)."],
      },
    ]);
    const czech = (await (await post(body, "cs")).json()) as ImportReport;
    expect(czech.created.companies).toBe(0);
    expect(czech.skipped[0]?.reasons[0]).toBe("Firma Nová Firma s.r.o. už existuje (C-0007).");

    const refused = await post({ ...body, rows: [] }, "en");
    expect(refused.status).toBe(422);
  });

  test("a copy that may not write refuses an import", async () => {
    const store = createMemoryStore(sampleData("cs"));
    const api = createApi(store, {
      allowedOrigins: new Set([ORIGIN]),
      access: () => ({ admitted: true, mayWrite: false }),
      today: () => TODAY,
    });
    const response = await api(
      new Request(`${ORIGIN}/api/import`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(input("companies", "Company name\nX s.r.o.")),
      }),
    );
    expect(response.status).toBe(409);
    expect((await store.listCompanies()).length).toBe(6);
  });
});
