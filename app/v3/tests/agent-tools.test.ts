import { describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolAuditEvent } from "@lazurio/module-kit/tools";
import {
  gatewayRequest,
  hostedEnvironment,
  mcpCall,
  mcpTool,
  mcpToolNames,
  mcpTools,
  pageTool,
  TEST_ORIGIN,
} from "@lazurio/module-kit/tools/testing";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import type { DealsStore } from "../src/data/store.ts";
import type { Locale } from "../src/i18n/locale.ts";
import { accessOf, LISTENER } from "../src/server/access.ts";
import { createAgentTools, createAgentToolsHandler } from "../src/server/agent-tools.ts";
import { CHANNEL_HEADER, createApi } from "../src/server/api.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";
import { sampleData, TODAY } from "./support/seed.ts";

const READ_TOOLS = [
  "check_data",
  "find_companies",
  "find_contacts",
  "find_deals",
  "get_app_context",
  "get_company",
  "get_contact",
  "get_deal",
  "get_draft",
  "get_forecast",
  "get_settings",
  "get_stats",
];
const WRITE_TOOLS = [
  "add_activity",
  "create_company",
  "create_contact",
  "create_deal",
  "discard_draft",
  "move_deal_stage",
  "update_company",
  "update_contact",
  "update_deal",
];
const PUBLISH_TOOLS = ["publish_draft"];

/** The App's API and its tools over the example in memory, as the
 * Application host runs them: the gateway states who came, `accessOf`
 * reads it as for every click. */
function setup(
  writer: boolean,
  locale: Locale = "en",
  store: DealsStore = createMemoryStore(sampleData()),
) {
  const audits: ToolAuditEvent[] = [];
  const channels: Array<string | null> = [];
  const env = hostedEnvironment({ writer, listener: LISTENER });
  const handle = createApi(store, {
    allowedOrigins: new Set([TEST_ORIGIN]),
    access: (request) => accessOf(request, env),
    today: () => TODAY,
  });
  const api = (request: Request) => {
    channels.push(request.headers.get(CHANNEL_HEADER));
    return handle(request);
  };
  const tools = createAgentTools({
    api,
    origin: TEST_ORIGIN,
    locale,
    env,
    audit: (event) => audits.push(event),
  });
  return { store, tools, audits, channels, api, env };
}

const user = { role: "user" } as const;
const admin = { role: "admin" } as const;

/** A tool's data, or the test fails with its refusal. */
async function ok(tools: ReturnType<typeof setup>["tools"], name: string, input: unknown) {
  const { isError, structured } = await mcpTool(tools, name, input, user);
  if (isError) throw new Error(`${name}: ${JSON.stringify(structured)}`);
  return structured;
}

describe("who sees which tools", () => {
  test("an application user and admin see the reading, writing and publishing tools while the App writes", async () => {
    const { tools } = setup(true);
    const all = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLISH_TOOLS].sort();
    expect(await mcpToolNames(tools, user)).toEqual(all);
    expect(await mcpToolNames(tools, admin)).toEqual(all);
  });

  test("only the publication carries destructiveHint, and reads are read-only", async () => {
    const { tools } = setup(true);
    for (const tool of await mcpTools(tools, admin)) {
      expect({ name: tool.name, destructive: tool.annotations.destructiveHint }).toEqual({
        name: tool.name,
        destructive: PUBLISH_TOOLS.includes(tool.name),
      });
      expect({ name: tool.name, readOnly: tool.annotations.readOnlyHint }).toEqual({
        name: tool.name,
        readOnly: READ_TOOLS.includes(tool.name),
      });
    }
  });

  test("with LAZURIO_RUNTIME_DATA_WRITER=false only the reading tools are listed and a change is refused", async () => {
    const { tools, store } = setup(false);
    expect(await mcpToolNames(tools, user)).toEqual(READ_TOOLS);
    expect(await mcpToolNames(tools, admin)).toEqual(READ_TOOLS);
    const created = await mcpTool(tools, "create_company", { name: "Nová s.r.o." }, user);
    expect(created.isError).toBe(true);
    expect(created.structured.reason).toBe("data_read_only");
    const published = await pageTool(tools, "publish_draft", { expected_revision: "r" }, admin);
    expect(published.status).toBe(403);
    expect(published.body.reason).toBe("data_read_only");
    expect(await store.listCompanies()).toHaveLength(6);
    expect((await mcpTool(tools, "find_deals", {}, user)).isError).toBe(false);
  });

  test("without a role /mcp and the page refuse with identity_unavailable", async () => {
    const { tools } = setup(true);
    const { status, body } = await mcpCall(tools, "tools/list", {}, { caller: { role: "none" } });
    expect(status).toBe(403);
    expect(body.error).toBe("identity_unavailable");
    const page = await pageTool(tools, "find_deals", {}, { role: "none" });
    expect(page.status).toBe(403);
    expect(page.body.reason).toBe("identity_unavailable");
  });
});

describe("reading tools", () => {
  test("get_settings gives the stages, the loss reasons and the salespeople", async () => {
    const { tools } = setup(true);
    const settings = await ok(tools, "get_settings", {});
    expect(settings.currency).toBe("CZK");
    expect((settings.stages as { id: string }[]).map((stage) => stage.id)).toEqual([
      "lead",
      "qualified",
      "proposal",
      "negotiation",
      "won",
      "lost",
    ]);
    expect((settings.loss_reasons as { id: string }[]).map((reason) => reason.id)).toEqual([
      "price",
      "competitor",
      "timing",
      "no-decision",
    ]);
    expect(settings.owners).toEqual(["Jana Ukázková", "Petr Vzorný"]);
  });

  test("find_deals filters by state, stage, company, owner and words", async () => {
    const { tools } = setup(true);
    const ids = async (input: object) =>
      ((await ok(tools, "find_deals", input)).deals as { id: string }[]).map((deal) => deal.id);
    expect(await ids({})).toHaveLength(14);
    expect(await ids({ status: "won" })).toEqual(["D-2026-0012", "D-2026-0011", "D-2026-0010"]);
    expect(await ids({ status: "lost" })).toEqual(["D-2026-0014", "D-2026-0013"]);
    expect(await ids({ stage_id: "proposal" })).toEqual([
      "D-2026-0009",
      "D-2026-0005",
      "D-2026-0002",
    ]);
    expect(await ids({ company_id: "C-0002", status: "open" })).toEqual([
      "D-2026-0004",
      "D-2026-0003",
    ]);
    expect(await ids({ owner: "petr vzorný", status: "open" })).toEqual([
      "D-2026-0009",
      "D-2026-0007",
      "D-2026-0004",
      "D-2026-0003",
    ]);
    expect(await ids({ search: "nábytek patro" })).toEqual(["D-2026-0002"]);
    const [newest] = (await ok(tools, "find_deals", { status: "lost" })).deals as {
      created_at: string;
      closed_at: string;
    }[];
    expect(newest).toMatchObject({ created_at: "2026-08-20", closed_at: "2026-11-03" });
    const negotiation = (await ok(tools, "find_deals", { stage_id: "negotiation" })).deals as {
      id: string;
      probability: number;
      stage: string;
    }[];
    // The deal's own probability, else the stage's.
    expect(negotiation.map(({ id, stage, probability }) => [id, stage, probability])).toEqual([
      ["D-2026-0006", "Jednání", 75],
      ["D-2026-0004", "Jednání", 45],
    ]);
  });

  test("get_deal, get_company and get_contact give the record, its revision and what belongs to it", async () => {
    const { tools } = setup(true);
    const deal = await ok(tools, "get_deal", { id: "D-2026-0004" });
    expect(deal.deal).toMatchObject({ title: "Chladicí vozy do flotily", value: 21_999_990 });
    expect(String(deal.revision).length).toBeGreaterThan(0);
    expect((deal.company as { name: string }).name).toBe("Vzorová Logistika a.s.");
    expect((deal.contacts as { id: string }[]).map((contact) => contact.id)).toEqual([
      "P-0003",
      "P-0004",
    ]);
    expect((deal.activities as { id: string }[]).map((activity) => activity.id)).toEqual([
      "A-2026-00015",
      "A-2026-00014",
    ]);
    const company = await ok(tools, "get_company", { id: "C-0002" });
    expect((company.deals as unknown[]).length).toBe(3);
    expect((company.contacts as unknown[]).length).toBe(2);
    const contact = await ok(tools, "get_contact", { id: "P-0004" });
    expect((contact.deals as { id: string }[]).map((entry) => entry.id)).toEqual([
      "D-2026-0013",
      "D-2026-0004",
      "D-2026-0003",
    ]);
    const missing = await mcpTool(tools, "get_deal", { id: "D-2026-0404" }, user);
    expect(missing.isError).toBe(true);
    expect(missing.structured.reason).toBe("not_found");
  });

  test("find_companies and find_contacts", async () => {
    const { tools } = setup(true);
    const companies = (await ok(tools, "find_companies", { search: "logistika" })).companies as {
      id: string;
    }[];
    expect(companies.map((company) => company.id)).toEqual(["C-0002"]);
    const contacts = (await ok(tools, "find_contacts", { company_id: "C-0004" })).contacts as {
      id: string;
    }[];
    expect(contacts.map((contact) => contact.id).sort()).toEqual(["P-0006", "P-0007"]);
  });

  test("get_forecast, get_stats and check_data give the numbers counted by hand", async () => {
    const { tools } = setup(true);
    const forecast = await ok(tools, "get_forecast", {});
    expect(forecast.total).toEqual({ count: 9, value: 237_150_050, weighted: 80_262_519 });
    expect(forecast.noDate).toEqual({ count: 2, value: 61_000_000, weighted: 13_900_000 });
    const stats = await ok(tools, "get_stats", { from: "2026-09-01", to: "2026-11-30" });
    expect(stats).toMatchObject({
      conversionBasisPoints: 6000,
      averageWonValue: 23_516_667,
      averageCycleDays: 71,
    });
    const fallback = await ok(tools, "get_stats", {});
    expect(fallback.period).toEqual({ from: "2026-08-28", to: TODAY });
    const checked = await ok(tools, "check_data", {});
    expect(checked.errors).toEqual([]);
    expect((checked.warnings as { code: string }[]).map((issue) => issue.code)).toEqual([
      "expected_close_missing",
      "expected_close_past",
    ]);
  });
});

describe("writing tools", () => {
  test("a company, a contact and a deal from a message, then an activity, all as a draft", async () => {
    const { tools, store, audits, channels } = setup(true);
    const company = await ok(tools, "create_company", {
      name: "Nová Ukázka s.r.o.",
      city: "Brno",
      country: "Česká republika",
    });
    expect(company).toMatchObject({ id: "C-0007", record: { address: { city: "Brno" } } });
    const contact = await ok(tools, "create_contact", {
      name: "Nová Osoba",
      company_id: "C-0007",
      email: "nova.osoba@nova-ukazka.example",
    });
    expect(contact).toMatchObject({ id: "P-0011", record: { companyId: "C-0007" } });
    const deal = await ok(tools, "create_deal", {
      title: "Vybavení showroomu",
      company_id: "C-0007",
      contact_ids: ["P-0011"],
      owner: "Jana Ukázková",
      value: 12_500_000,
      expected_close: "2027-02-15",
    });
    expect(deal).toMatchObject({
      id: "D-2026-0015",
      record: {
        stageId: "lead",
        createdAt: TODAY,
        contactIds: ["P-0011"],
        expectedClose: "2027-02-15",
      },
    });
    // The date the message gave puts the deal into its month of the forecast,
    // not among the deals without a date (lead counts 10 %).
    const forecast = await ok(tools, "get_forecast", {});
    expect(forecast.noDate).toEqual({ count: 2, value: 61_000_000, weighted: 13_900_000 });
    const february = (forecast.months as { month: string; count: number; value: number }[]).find(
      (month) => month.month === "2027-02",
    );
    expect(february).toMatchObject({ count: 2, value: 92_500_000 });
    const activity = await ok(tools, "add_activity", {
      deal_id: "D-2026-0015",
      type: "call",
      at: "2026-11-25T10:00:00+01:00",
      summary: "První hovor",
      contact_ids: ["P-0011"],
    });
    expect(activity.id).toBe("A-2026-00021");
    expect(channels.at(-1)).toBe("mcp");
    expect(audits.at(-1)).toMatchObject({
      tool: "add_activity",
      effect: "write",
      channel: "mcp",
      outcome: "ok",
    });
    const draft = await ok(tools, "get_draft", {});
    expect(draft.state).toBe("draft");
    expect((draft.records as unknown[]).length).toBe(4);
    expect((await store.draft()).records).toHaveLength(4);
    // An IČO with a wrong check digit is refused by the rules.
    const wrong = await mcpTool(
      tools,
      "create_company",
      { name: "X s.r.o.", ico: "00000002" },
      user,
    );
    expect(wrong.structured.reason).toBe("invalid_record");
  });

  test("move_deal_stage asks for what closing needs and moves the deal", async () => {
    const { tools } = setup(true);
    const opened = await ok(tools, "get_deal", { id: "D-2026-0002" });
    const base = { id: "D-2026-0002", base_revision: opened.revision };
    for (const move of [
      { stage_id: "won", closed_at: "2026-11-25" },
      { stage_id: "won", value: 34_000_000 },
      { stage_id: "lost", closed_at: "2026-11-25" },
      { stage_id: "paused" },
    ]) {
      const refused = await mcpTool(tools, "move_deal_stage", { ...base, ...move }, user);
      expect({ move, reason: refused.structured.reason }).toEqual({
        move,
        reason: "invalid_input",
      });
    }
    const zero = await mcpTool(
      tools,
      "move_deal_stage",
      { ...base, stage_id: "won", value: 0, closed_at: "2026-11-25" },
      user,
    );
    expect(zero.structured.reason).toBe("invalid_record");
    const won = await ok(tools, "move_deal_stage", {
      ...base,
      stage_id: "won",
      value: 34_000_000,
      closed_at: "2026-11-25",
    });
    expect(won.record).toMatchObject({ stageId: "won", value: 34_000_000, closedAt: "2026-11-25" });
    const reopened = await ok(tools, "move_deal_stage", {
      id: "D-2026-0002",
      base_revision: won.revision,
      stage_id: "negotiation",
    });
    expect(reopened.record).not.toHaveProperty("closedAt");
    const lost = await ok(tools, "move_deal_stage", {
      id: "D-2026-0002",
      base_revision: reopened.revision,
      stage_id: "lost",
      closed_at: "2026-11-25",
      loss_reason_id: "competitor",
      loss_note: "Vybrali jiného dodavatele.",
    });
    expect(lost.record).toMatchObject({
      stageId: "lost",
      lossReasonId: "competitor",
      lossNote: "Vybrali jiného dodavatele.",
    });
  });

  test("an update changes only what it names, null takes a field away", async () => {
    const { tools } = setup(true);
    const opened = await ok(tools, "get_deal", { id: "D-2026-0004" });
    const updated = await ok(tools, "update_deal", {
      id: "D-2026-0004",
      base_revision: opened.revision,
      changes: { value: 23_000_000, probability: null, quote_id: "NAB-2026-0099" },
    });
    expect(updated.record).toMatchObject({
      title: "Chladicí vozy do flotily",
      stageId: "negotiation",
      value: 23_000_000,
      quoteRef: { id: "NAB-2026-0099" },
    });
    expect(updated.record).not.toHaveProperty("probability");
    const company = await ok(tools, "get_company", { id: "C-0001" });
    const moved = await ok(tools, "update_company", {
      id: "C-0001",
      base_revision: company.revision,
      changes: { city: "Olomouc", street: null, note: null },
    });
    expect(moved.record).toMatchObject({
      name: "Ukázka Nábytek s.r.o.",
      address: { city: "Olomouc", postalCode: "602 00" },
    });
    expect((moved.record as { address: object }).address).not.toHaveProperty("street");
    expect(moved.record).not.toHaveProperty("note");
    const contact = await ok(tools, "get_contact", { id: "P-0001" });
    const renamed = await ok(tools, "update_contact", {
      id: "P-0001",
      base_revision: contact.revision,
      changes: { role: "ředitelka" },
    });
    expect(renamed.record).toMatchObject({ role: "ředitelka", companyId: "C-0001" });
  });

  test("a stale revision after A → B → A is record_changed with current_revision", async () => {
    const { tools, store } = setup(true);
    const a = await ok(tools, "get_company", { id: "C-0003" });
    const b = await ok(tools, "update_company", {
      id: "C-0003",
      base_revision: a.revision,
      changes: { name: "Pekárna B s.r.o." },
    });
    const back = await ok(tools, "update_company", {
      id: "C-0003",
      base_revision: b.revision,
      changes: { name: "Pokusná Pekárna s.r.o." },
    });
    expect(back.revision).not.toBe(a.revision);
    for (const stale of [a.revision, b.revision]) {
      const refused = await mcpTool(
        tools,
        "update_company",
        { id: "C-0003", base_revision: stale, changes: { note: "Pozdě" } },
        user,
      );
      expect(refused.isError).toBe(true);
      expect(refused.structured).toMatchObject({
        reason: "record_changed",
        current_revision: back.revision,
      });
    }
    // The move of a stage goes straight to the API, which says the same.
    const deal = await ok(tools, "get_deal", { id: "D-2026-0001" });
    await ok(tools, "update_deal", {
      id: "D-2026-0001",
      base_revision: deal.revision,
      changes: { title: "Zasedačka" },
    });
    const now = (await store.getDeal("D-2026-0001"))?.revision;
    const stale = await mcpTool(
      tools,
      "move_deal_stage",
      { id: "D-2026-0001", base_revision: deal.revision, stage_id: "qualified" },
      user,
    );
    expect(stale.structured).toMatchObject({ reason: "record_changed", current_revision: now });
  });
});

describe("the draft", () => {
  test("discard_draft returns one record or the whole draft", async () => {
    const { tools, store } = setup(true);
    await ok(tools, "create_company", { name: "První s.r.o." });
    await ok(tools, "create_company", { name: "Druhá s.r.o." });
    const draft = await ok(tools, "get_draft", {});
    const [first] = draft.records as { path: string; label: string }[];
    if (!first) throw new Error("no record");
    expect(
      (await mcpTool(tools, "discard_draft", { expected_revision: "stale" }, user)).structured
        .reason,
    ).toBe("draft_changed");
    await ok(tools, "discard_draft", { expected_revision: draft.revision, path: first.path });
    expect((await store.draft()).records).toHaveLength(1);
    const rest = await ok(tools, "get_draft", {});
    await ok(tools, "discard_draft", { expected_revision: rest.revision });
    expect((await store.draft()).records ?? []).toEqual([]);
    expect(await store.listCompanies()).toHaveLength(6);
  });

  test("get_draft shows every changed field with its whole value before and after", async () => {
    const { tools, store } = setup(true);
    // A colleague changes a company on the same writer, past the tools: one
    // nested field, a long note and the website.
    const company = await store.getCompany("C-0002");
    if (!company) throw new Error("C-0002 missing");
    const note = `${"Dlouhá poznámka kolegy. ".repeat(20)}Konec.`;
    await store.saveCompany(
      {
        ...company.value,
        note,
        website: "https://kolega.example",
        address: { ...company.value.address, city: "Jinde" },
      },
      company.revision,
    );
    // The agent changes a deal: its title, value and contacts.
    const deal = await ok(tools, "get_deal", { id: "D-2026-0004" });
    await ok(tools, "update_deal", {
      id: "D-2026-0004",
      base_revision: deal.revision,
      changes: { title: "Nový název", value: 1_234_500, contact_ids: ["P-0004", "P-0001"] },
    });
    const draft = await ok(tools, "get_draft", {});
    const records = draft.records as {
      path: string;
      fields: { field: string; label: string; before: unknown; after: unknown }[];
    }[];
    const companyFields = records.find((record) => record.path.includes("C-0002"))?.fields;
    expect(companyFields).toEqual([
      {
        field: "address/city",
        label: "Address",
        before: company.value.address?.city ?? null,
        after: "Jinde",
      },
      { field: "note", label: "Note", before: company.value.note ?? null, after: note },
      {
        field: "website",
        label: "Website",
        before: company.value.website ?? null,
        after: "https://kolega.example",
      },
    ]);
    // The long note is whole, never shortened.
    expect(companyFields?.find((field) => field.field === "note")?.after).toBe(note);
    const dealFields = records.find((record) => record.path.includes("D-2026-0004"))?.fields;
    expect(dealFields?.map((field) => field.field)).toEqual(["contactIds", "title", "value"]);
    expect(dealFields?.find((field) => field.field === "contactIds")?.after).toEqual([
      "P-0004",
      "P-0001",
    ]);
    expect(dealFields?.find((field) => field.field === "value")?.after).toBe(1_234_500);
    // No audit field is shown as a change.
    for (const record of records) {
      for (const field of record.fields) {
        expect(["revision", "updatedAt", "updatedBy"]).not.toContain(field.field);
      }
    }
  });

  test("a change get_draft cannot show whole is left to the person: publish_draft refuses it", async () => {
    // The real repository-db: a company changed through the tools and, in
    // the same data checkout, a file that is no record of Deals.
    const fixture = createFixtureRepo();
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
      writes: true,
    });
    try {
      const { tools } = setup(true, "en", store);
      const company = await ok(tools, "get_company", { id: "C-0002" });
      await ok(tools, "update_company", {
        id: "C-0002",
        base_revision: company.revision,
        changes: { note: "Poznámka" },
      });
      appendFileSync(join(fixture.mountRoot, "README.md"), "\nA line nobody reviewed.\n");
      const draft = await ok(tools, "get_draft", {});
      expect(draft.complete).toBe(false);
      const records = draft.records as { path: string; reviewable: boolean; fields: unknown[] }[];
      expect(records.find((record) => record.path === "README.md")).toMatchObject({
        reviewable: false,
        fields: [],
      });
      expect(records.find((record) => record.path.includes("C-0002"))).toMatchObject({
        reviewable: true,
        fields: [{ field: "note", after: "Poznámka" }],
      });
      // Even on the person's word, the tool does not publish what it cannot show.
      const refused = await mcpTool(
        tools,
        "publish_draft",
        { expected_revision: draft.revision },
        user,
      );
      expect(refused.isError).toBe(true);
      expect(refused.structured.reason).toBe("draft_not_reviewable");
      expect(String(refused.structured.message)).toContain("README.md");
      expect((await store.draft()).status?.state).toBe("draft");

      // Without the foreign file the same tool publishes the draft shown.
      git(fixture.mountRoot, ["checkout", "--", "README.md"]);
      const shown = await ok(tools, "get_draft", {});
      expect(shown.complete).toBe(true);
      expect(await ok(tools, "publish_draft", { expected_revision: shown.revision })).toEqual({
        published: true,
      });
    } finally {
      store.close();
      fixture.cleanup();
    }
  }, 60_000);

  test("publish_draft publishes exactly the draft shown and is audited as a publication", async () => {
    const { tools, store, audits } = setup(true);
    await ok(tools, "create_company", { name: "Publikovaná s.r.o." });
    const draft = await ok(tools, "get_draft", {});
    await ok(tools, "create_company", { name: "Další s.r.o." });
    const changed = await mcpTool(
      tools,
      "publish_draft",
      { expected_revision: draft.revision },
      user,
    );
    expect(changed.structured.reason).toBe("draft_changed");
    const current = await ok(tools, "get_draft", {});
    expect(
      await ok(tools, "publish_draft", {
        expected_revision: current.revision,
        summary: "Dvě firmy",
      }),
    ).toEqual({ published: true });
    expect((await store.draft()).status?.state).toBe("published");
    expect(audits.at(-1)).toMatchObject({
      tool: "publish_draft",
      effect: "publish",
      outcome: "ok",
    });
  });

  test("a draft that breaks a rule across records is not published", async () => {
    const { tools } = setup(true);
    await ok(tools, "create_company", { name: "Krátká s.r.o." });
    await ok(tools, "create_deal", {
      title: "Případ",
      company_id: "C-0007",
      owner: "Jana Ukázková",
      value: 100,
    });
    const draft = await ok(tools, "get_draft", {});
    const company = (draft.records as { path: string; label: string }[]).find((record) =>
      record.label.includes("Krátká"),
    );
    if (!company) throw new Error("no company in the draft");
    await ok(tools, "discard_draft", { expected_revision: draft.revision, path: company.path });
    const left = await ok(tools, "get_draft", {});
    const refused = await mcpTool(
      tools,
      "publish_draft",
      { expected_revision: left.revision },
      user,
    );
    expect(refused.structured.reason).toBe("rules_failed");
  });
});

describe("the page", () => {
  test("calls the same tools with its own session and channel", async () => {
    const { tools, channels, audits } = setup(true);
    const { status, body } = await pageTool(tools, "find_deals", { status: "won" }, user);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(channels.at(-1)).toBe("webmcp");
    expect(audits.at(-1)).toMatchObject({ tool: "find_deals", channel: "webmcp" });
    const created = await pageTool(tools, "create_company", { name: "Ze stránky s.r.o." }, user);
    expect(created.status).toBe(200);
    expect(audits.at(-1)).toMatchObject({ tool: "create_company", effect: "write" });
  });

  test("the tools speak the language the caller states, else Czech", async () => {
    const env = hostedEnvironment({ writer: true });
    const store = createMemoryStore(sampleData());
    const api = createApi(store, {
      allowedOrigins: new Set([TEST_ORIGIN]),
      access: (request) => accessOf(request, env),
    });
    const handler = createAgentToolsHandler({ api, origin: TEST_ORIGIN, env, audit: () => {} });
    const manifest = async (headers: Record<string, string>) => {
      const response = await handler.handlePage(
        gatewayRequest("/api/agent-tools", { caller: user, headers }),
      );
      const body = (await response?.json()) as {
        tools: Array<{ name: string; description: string }>;
      };
      return body.tools.find((tool) => tool.name === "find_deals")?.description;
    };
    expect(await manifest({ "accept-language": "en-GB,en;q=0.8" })).toStartWith("Finds");
    expect(await manifest({})).toStartWith("Najde");
    expect(await handler.handlePage(gatewayRequest("/api/deals", { caller: user }))).toBeNull();
  });
});
