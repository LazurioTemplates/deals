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
  "get_quote",
  "get_settings",
  "get_stats",
  "list_pricebook",
  "list_quotes",
  "list_salespeople",
];
const WRITE_TOOLS = [
  "add_activity",
  "create_company",
  "create_contact",
  "create_deal",
  "create_forecast_entry",
  "create_quote",
  "discard_draft",
  "mark_payment",
  "move_deal_stage",
  "plan_payments",
  "revise_quote",
  "save_quote",
  "set_quote_status",
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
  test("get_settings gives the stages, the loss reasons, the deal types and the quote defaults", async () => {
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
    expect((settings.deal_types as { id: string }[]).map((type) => type.id)).toEqual([
      "delivery",
      "service",
      "licence",
    ]);
    expect(settings.billing_entities).toEqual([
      { id: "trade", name: "Vzorová obchodní s.r.o." },
      { id: "services", name: "Vzorové služby s.r.o." },
    ]);
    expect(settings.quote_defaults).toMatchObject({ vat_rate: 2100, validity_days: 30 });
    expect(settings.payment_due_days).toBe(14);
    expect(settings).not.toHaveProperty("owners");
  });

  test("list_salespeople and list_pricebook give the ids a deal and a quote name", async () => {
    const { tools } = setup(true);
    const people = (await ok(tools, "list_salespeople", {})).salespeople as {
      id: string;
      name: string;
      active: boolean;
    }[];
    expect(people.map((person) => [person.id, person.name, person.active])).toEqual([
      ["S-0001", "Jana Ukázková", true],
      ["S-0003", "Karel Příkladný", false],
      ["S-0002", "Petr Vzorný", true],
    ]);
    const active = (await ok(tools, "list_salespeople", { active_only: true, search: "petr" }))
      .salespeople as { id: string }[];
    expect(active.map((person) => person.id)).toEqual(["S-0002"]);
    const items = (await ok(tools, "list_pricebook", { search: "stůl 160" })).items as {
      id: string;
      unit_price: number;
      section_id: string;
    }[];
    expect(items).toEqual([
      expect.objectContaining({ id: "I-0001", unit_price: 1_290_000, section_id: "items" }),
    ]);
    expect(((await ok(tools, "list_pricebook", {})).items as unknown[]).length).toBe(8);
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
    expect(await ids({ owner_id: "S-0002", status: "open" })).toEqual([
      "D-2026-0009",
      "D-2026-0007",
      "D-2026-0004",
      "D-2026-0003",
    ]);
    expect(await ids({ search: "nábytek patro" })).toEqual(["D-2026-0002"]);
    expect(await ids({ deal_type_id: "service" })).toEqual([
      "D-2026-0013",
      "D-2026-0007",
      "D-2026-0006",
    ]);
    const [won] = (await ok(tools, "find_deals", { status: "won" })).deals as {
      owner_id: string;
      owner: string;
      payment_plan: string;
    }[];
    expect(won).toMatchObject({
      owner_id: "S-0002",
      owner: "Petr Vzorný",
      payment_plan: "unassigned",
    });
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
    expect(deal.deal).toMatchObject({ title: "Chladicí vozy do flotily", value: 24_000_000 });
    expect((deal.owner as { name: string }).name).toBe("Petr Vzorný");
    expect(deal.quotes).toEqual([
      expect.objectContaining({ id: "Q-2026-0002-r1", status: "active", subtotal: 24_000_000 }),
    ]);
    expect(deal.primary_quote_id).toBe("Q-2026-0002-r1");
    expect(deal.payment_plan).toBeNull();
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
    expect(forecast.total).toMatchObject({
      forecast: 56_456_000,
      paid: 21_750_000,
      overdue: 17_078_000,
      count: 7,
    });
    expect((forecast.unassigned as { dealId: string }[]).map((deal) => deal.dealId)).toEqual([
      "D-2026-0012",
    ]);
    const overdue = (forecast.rows as { key: string; state: string }[])
      .filter((row) => row.state === "overdue")
      .map((row) => row.key);
    expect(overdue).toEqual(["deals/D-2026-0011#p1", "forecastEntries/F-2026-0003"]);
    const next = await ok(tools, "get_forecast", { year: 2027, owner_id: "S-0001" });
    expect(next.total).toMatchObject({ forecast: 20_304_000, count: 1 });
    const services = await ok(tools, "get_forecast", {
      deal_type_id: "service",
      billing_entity_id: "services",
    });
    expect(services.total).toMatchObject({ forecast: 6_650_000 });
    const stats = await ok(tools, "get_stats", { from: "2026-09-01", to: "2026-11-30" });
    expect(stats).toMatchObject({
      conversionBasisPoints: 6000,
      averageWonValue: 25_313_333,
      averageCycleDays: 71,
      previousPeriod: { from: "2026-06-02", to: "2026-08-31" },
    });
    const petr = await ok(tools, "get_stats", {
      from: "2026-09-01",
      to: "2026-11-30",
      owner_id: "S-0002",
    });
    expect(petr.conversionBasisPoints).toBe(5000);
    const fallback = await ok(tools, "get_stats", {});
    expect(fallback.period).toEqual({ from: "2026-08-28", to: TODAY });
    const checked = await ok(tools, "check_data", {});
    expect(checked.errors).toEqual([]);
    expect((checked.warnings as { code: string }[]).map((issue) => issue.code)).toEqual([
      "expected_close_missing",
      "expected_close_past",
    ]);
  });

  test("list_quotes and get_quote give the quotes with their amounts and revisions", async () => {
    const { tools } = setup(true);
    const all = (await ok(tools, "list_quotes", {})).quotes as { id: string }[];
    expect(all).toHaveLength(7);
    const latest = (await ok(tools, "list_quotes", { deal_id: "D-2026-0002", latest_only: true }))
      .quotes as { id: string; subtotal: number; vat: number; total: number }[];
    expect(latest).toEqual([
      expect.objectContaining({
        id: "Q-2026-0001-r2",
        subtotal: 39_400_000,
        vat: 8_274_000,
        total: 47_674_000,
      }),
    ]);
    const approved = (await ok(tools, "list_quotes", { status: "approved" })).quotes as {
      id: string;
    }[];
    expect(approved.map((entry) => entry.id)).toEqual([
      "Q-2026-0006-r1",
      "Q-2026-0005-r1",
      "Q-2026-0004-r1",
    ]);
    const quote = await ok(tools, "get_quote", { id: "Q-2026-0001-r1" });
    expect(quote.quote).toMatchObject({ status: "superseded", version: 1 });
    expect(String(quote.revision).length).toBeGreaterThan(0);
    expect(quote.totals).toMatchObject({ subtotal: 40_960_000 });
    expect(quote.revisions).toEqual([
      { id: "Q-2026-0001-r2", version: 2, status: "active", issued_on: "2026-11-02" },
      { id: "Q-2026-0001-r1", version: 1, status: "superseded", issued_on: "2026-10-12" },
    ]);
    expect(quote.deal).toMatchObject({ id: "D-2026-0002", value: 39_400_000, primary: false });
    const missing = await mcpTool(tools, "get_quote", { id: "Q-2026-0404-r1" }, user);
    expect(missing.structured.reason).toBe("not_found");
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
      owner_id: "S-0001",
      deal_type_id: "delivery",
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
        ownerId: "S-0001",
        dealTypeId: "delivery",
      },
    });
    // An open deal is no part of the forecast: it counts once it is won and planned.
    const forecast = await ok(tools, "get_forecast", {});
    expect((forecast.total as { forecast: number }).forecast).toBe(56_456_000);
    // A salesperson who does not exist is refused by the rules.
    const nobody = await mcpTool(
      tools,
      "create_deal",
      { title: "Bez obchodníka", company_id: "C-0007", owner_id: "S-0404", value: 1 },
      user,
    );
    expect(nobody.structured.reason).toBe("invalid_record");
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
      changes: { probability: null, owner_id: "S-0001", deal_type_id: "service" },
    });
    expect(updated.record).toMatchObject({
      title: "Chladicí vozy do flotily",
      stageId: "negotiation",
      ownerId: "S-0001",
      dealTypeId: "service",
    });
    expect(updated.record).not.toHaveProperty("probability");
    // While the deal has a quote with lines, its value follows the quote.
    const followed = await ok(tools, "update_deal", {
      id: "D-2026-0004",
      base_revision: updated.revision,
      changes: { value: 23_000_000 },
    });
    expect(followed.record).toMatchObject({ value: 24_000_000 });
    // A deal without a quote keeps the value it is given.
    const plain = await ok(tools, "get_deal", { id: "D-2026-0003" });
    const valued = await ok(tools, "update_deal", {
      id: "D-2026-0003",
      base_revision: plain.revision,
      changes: { value: 81_000_000, deal_type_id: null },
    });
    expect(valued.record).toMatchObject({ value: 81_000_000 });
    expect(valued.record).not.toHaveProperty("dealTypeId");
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

describe("quotes, payment plans and the forecast", () => {
  test("a quote from the price list as a draft; the deal's value follows it", async () => {
    const { tools, store } = setup(true);
    // An item the price list does not sell is refused: a price is never made up.
    const unknown = await mcpTool(
      tools,
      "create_quote",
      { deal_id: "D-2026-0001", items: [{ pricebook_item_id: "I-0404" }] },
      user,
    );
    expect(unknown.structured.reason).toBe("invalid_input");
    const created = await ok(tools, "create_quote", {
      deal_id: "D-2026-0001",
      items: [
        { pricebook_item_id: "I-0001", quantity: 4, discount: 1000 },
        { pricebook_item_id: "I-0004", quantity: 6 },
      ],
    });
    // 4 desks of 12 900 Kč less 10 % = 46 440 Kč; 6 h of 850 Kč = 5 100 Kč.
    expect(created).toMatchObject({
      id: "Q-2026-0007-r1",
      record: { status: "draft", version: 1, dealId: "D-2026-0001" },
      totals: { subtotal: 5_154_000, vat: 1_082_340, total: 6_236_340 },
    });
    expect((await store.getDeal("D-2026-0001"))?.value.value).toBe(5_154_000);
    // A line the person priced, saved whole from its revision.
    const record = created.record as { lines: object[] };
    const saved = await ok(tools, "save_quote", {
      base_revision: created.revision,
      record: {
        ...record,
        lines: [
          ...record.lines,
          {
            id: "l3",
            sectionId: "work",
            name: "Doprava po Brně",
            quantity: 1,
            unit: "km",
            unitPrice: 60_000,
          },
        ],
      },
    });
    expect(saved.totals).toMatchObject({ subtotal: 5_214_000 });
    const stale = await mcpTool(
      tools,
      "save_quote",
      { base_revision: created.revision, record },
      user,
    );
    expect(stale.structured).toMatchObject({
      reason: "record_changed",
      current_revision: saved.revision,
    });
    // Marked sent only on the person's word, then revised and approved.
    const sent = await ok(tools, "set_quote_status", {
      id: "Q-2026-0007-r1",
      base_revision: saved.revision,
      status: "active",
    });
    expect(sent.record).toMatchObject({ status: "active", sentOn: TODAY });
    const revised = await ok(tools, "revise_quote", { id: "Q-2026-0007-r1" });
    expect(revised).toMatchObject({
      id: "Q-2026-0007-r2",
      record: { status: "draft", version: 2 },
    });
    expect((await store.get("quotes", "Q-2026-0007-r1"))?.value.status).toBe("superseded");
    const approved = await ok(tools, "set_quote_status", {
      id: "Q-2026-0007-r2",
      base_revision: revised.revision,
      status: "approved",
    });
    expect(approved.record).toMatchObject({ approvedOn: TODAY });
    expect((await store.getDeal("D-2026-0001"))?.value.primaryQuoteId).toBe("Q-2026-0007-r2");
    // Everything is a draft, nothing published.
    expect((await store.draft()).status?.state).toBe("draft");
  });

  test("winning plans the payments, or leaves the deal unassigned until plan_payments", async () => {
    const { tools } = setup(true);
    const opened = await ok(tools, "get_deal", { id: "D-2026-0006" });
    // Payments belong to won only.
    const early = await mcpTool(
      tools,
      "move_deal_stage",
      {
        id: "D-2026-0006",
        base_revision: opened.revision,
        stage_id: "negotiation",
        payments: [{ month: "2026-12", amount: 1 }],
      },
      user,
    );
    expect(early.structured.reason).toBe("invalid_input");
    // A plan that does not add up to the value is refused by the rules.
    const wrong = await mcpTool(
      tools,
      "move_deal_stage",
      {
        id: "D-2026-0006",
        base_revision: opened.revision,
        stage_id: "won",
        value: 15_600_000,
        closed_at: TODAY,
        payments: [{ month: "2026-12", amount: 1 }],
      },
      user,
    );
    expect(wrong.structured.reason).toBe("invalid_record");
    const won = await ok(tools, "move_deal_stage", {
      id: "D-2026-0006",
      base_revision: opened.revision,
      stage_id: "won",
      value: 15_600_000,
      closed_at: TODAY,
      payments: [
        { month: "2026-12", amount: 7_800_000, label: "Záloha" },
        { month: "2027-01", amount: 7_800_000 },
      ],
    });
    expect(won.record).toMatchObject({
      paymentPlan: {
        status: "planned",
        payments: [
          { id: "p1", month: "2026-12", amount: 7_800_000, label: "Záloha" },
          { id: "p2", month: "2027-01", amount: 7_800_000 },
        ],
      },
    });
    // Without payments a won deal waits unassigned; plan_payments plans it.
    const second = await ok(tools, "get_deal", { id: "D-2026-0009" });
    const plain = await ok(tools, "move_deal_stage", {
      id: "D-2026-0009",
      base_revision: second.revision,
      stage_id: "won",
      value: 7_300_010,
      closed_at: TODAY,
    });
    expect(plain.record).toMatchObject({ paymentPlan: { status: "unassigned", payments: [] } });
    for (const input of [
      { payments: [{ month: "2026-12", amount: 1 }], unassigned: true },
      { first_month: "2026-12", count: 2, shares: [5000, 5000] },
      { count: 2 },
      { first_month: "2026-12", shares: [5000, 4000] },
      {},
    ]) {
      const refused = await mcpTool(
        tools,
        "plan_payments",
        { deal_id: "D-2026-0009", base_revision: plain.revision, ...input },
        user,
      );
      expect({ input, reason: refused.structured.reason }).toEqual({
        input,
        reason: "invalid_input",
      });
    }
    // Three equal shares (33,34 %, 33,33 %, 33,33 %) of 73 000,10 Kč: 7 300 010 × 3334
    // / 10 000 = 2 433 823,33 → 2 433 823; × 3333 → 2 433 093,33 → 2 433 093; the
    // last takes the rest, 2 433 094.
    const thirds = await ok(tools, "plan_payments", {
      deal_id: "D-2026-0009",
      base_revision: plain.revision,
      first_month: "2026-12",
      count: 3,
      reverse_charge: true,
    });
    expect(thirds.record).toMatchObject({
      paymentPlan: {
        status: "planned",
        reverseCharge: true,
        payments: [
          { id: "p1", month: "2026-12", amount: 2_433_823 },
          { id: "p2", month: "2027-01", amount: 2_433_093 },
          { id: "p3", month: "2027-02", amount: 2_433_094 },
        ],
      },
    });
    const forecast = await ok(tools, "get_forecast", {});
    expect((forecast.total as { forecast: number }).forecast).toBe(
      56_456_000 + 7_800_000 + 2_433_823,
    );
    expect((forecast.unassigned as { dealId: string }[]).map((deal) => deal.dealId)).toEqual([
      "D-2026-0012",
    ]);
    // Back among the unassigned.
    const back = await ok(tools, "plan_payments", {
      deal_id: "D-2026-0009",
      base_revision: thirds.revision,
      unassigned: true,
    });
    expect(back.record).toMatchObject({ paymentPlan: { status: "unassigned", payments: [] } });
  });

  test("mark_payment invoices, pays and takes back; an invoiced payment stays in a new plan", async () => {
    const { tools } = setup(true);
    const deal = await ok(tools, "get_deal", { id: "D-2026-0011" });
    for (const input of [
      { deal_id: "D-2026-0011", invoiced_on: TODAY },
      { deal_id: "D-2026-0011", payment_id: "p2", entry_id: "F-2026-0002", invoiced_on: TODAY },
      { deal_id: "D-2026-0011", payment_id: "p2" },
    ]) {
      const refused = await mcpTool(
        tools,
        "mark_payment",
        { base_revision: deal.revision, ...input },
        user,
      );
      expect({ input, reason: refused.structured.reason }).toEqual({
        input,
        reason: "invalid_input",
      });
    }
    const paid = await ok(tools, "mark_payment", {
      deal_id: "D-2026-0011",
      payment_id: "p1",
      base_revision: deal.revision,
      paid_on: TODAY,
    });
    const first = (paid.record as { paymentPlan: { payments: object[] } }).paymentPlan.payments[0];
    expect(first).toMatchObject({ invoicedOn: "2026-10-21", dueOn: "2026-11-04", paidOn: TODAY });
    const overdue = await ok(tools, "get_forecast", {});
    expect((overdue.total as { overdue: number }).overdue).toBe(1_850_000);
    // A new plan must keep the invoiced payment as it is.
    const dropped = await mcpTool(
      tools,
      "plan_payments",
      {
        deal_id: "D-2026-0011",
        base_revision: paid.revision,
        payments: [{ month: "2026-12", amount: 50_760_000 }],
      },
      user,
    );
    expect(dropped.structured.reason).toBe("invalid_input");
    expect(String(dropped.structured.message)).toContain("p1");
    const split = await mcpTool(
      tools,
      "plan_payments",
      { deal_id: "D-2026-0011", base_revision: paid.revision, first_month: "2027-01", count: 2 },
      user,
    );
    expect(split.structured.reason).toBe("invalid_input");
    const kept = await ok(tools, "plan_payments", {
      deal_id: "D-2026-0011",
      base_revision: paid.revision,
      payments: [
        { id: "p1", month: "2026-10", amount: 15_228_000 },
        { month: "2027-01", amount: 35_532_000, label: "Doplatek" },
      ],
    });
    const payments = (kept.record as { paymentPlan: { payments: object[] } }).paymentPlan.payments;
    expect(payments).toEqual([
      {
        id: "p1",
        month: "2026-10",
        amount: 15_228_000,
        // Not restated, its label stays.
        label: "Záloha",
        invoicedOn: "2026-10-21",
        dueOn: "2026-11-04",
        paidOn: TODAY,
      },
      { id: "p4", month: "2027-01", amount: 35_532_000, label: "Doplatek" },
    ]);
    // Taken back: the invoice, the due date and the payment go.
    const back = await ok(tools, "mark_payment", {
      deal_id: "D-2026-0011",
      payment_id: "p1",
      base_revision: kept.revision,
      invoiced_on: null,
    });
    expect(
      (back.record as { paymentPlan: { payments: object[] } }).paymentPlan.payments[0],
    ).toEqual({
      id: "p1",
      month: "2026-10",
      amount: 15_228_000,
      label: "Záloha",
    });
    const planned = await ok(tools, "get_forecast", {});
    expect(
      (planned.rows as { key: string; state: string }[]).find(
        (entry) => entry.key === "deals/D-2026-0011#p1",
      )?.state,
    ).toBe("planned");
  });

  test("create_forecast_entry adds a manual row, and mark_payment pays it", async () => {
    const { tools, store } = setup(true);
    const created = await ok(tools, "create_forecast_entry", {
      month: "2027-01",
      title: "Servisní paušál – leden",
      amount: 2_400_000,
      company_id: "C-0004",
      owner_id: "S-0002",
      deal_type_id: "service",
      billing_entity_id: "services",
    });
    expect(created).toMatchObject({
      id: "F-2027-0001",
      record: { ownerId: "S-0002", dealTypeId: "service", billingEntityId: "services" },
    });
    const next = await ok(tools, "get_forecast", { year: 2027, owner_id: "S-0002" });
    expect(next.total).toMatchObject({ forecast: 2_400_000, count: 1 });
    const paid = await ok(tools, "mark_payment", {
      entry_id: "F-2027-0001",
      base_revision: created.revision,
      paid_on: "2027-01-20",
    });
    expect(paid.record).toMatchObject({
      invoicedOn: "2027-01-20",
      dueOn: "2027-02-03",
      paidOn: "2027-01-20",
    });
    const refused = await mcpTool(
      tools,
      "create_forecast_entry",
      { month: "2027-01", title: "X", amount: 1, owner_id: "S-0404" },
      user,
    );
    expect(refused.structured.reason).toBe("invalid_record");
    expect((await store.draft()).status?.state).toBe("draft");
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
      changes: { title: "Nový název", owner_id: "S-0001", contact_ids: ["P-0004", "P-0001"] },
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
    expect(dealFields?.map((field) => field.field)).toEqual(["contactIds", "ownerId", "title"]);
    expect(dealFields?.find((field) => field.field === "contactIds")?.after).toEqual([
      "P-0004",
      "P-0001",
    ]);
    expect(dealFields?.find((field) => field.field === "ownerId")).toMatchObject({
      before: "S-0002",
      after: "S-0001",
    });
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

  test("a record file changed outside its fields (a comment) is not shown as whole either", async () => {
    const fixture = createFixtureRepo();
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
      writes: true,
    });
    try {
      const { tools } = setup(true, "en", store);
      // A comment in a company's file: the parsed record stays the same.
      const file = join(fixture.mountRoot, "data", "companies", "C-0002.yaml");
      appendFileSync(file, "# A comment nobody reviewed.\n");
      const draft = await ok(tools, "get_draft", {});
      expect(draft.complete).toBe(false);
      expect(draft.records).toEqual([
        expect.objectContaining({
          path: "data/companies/C-0002.yaml",
          reviewable: false,
          fields: [],
        }),
      ]);
      const refused = await mcpTool(
        tools,
        "publish_draft",
        { expected_revision: draft.revision },
        user,
      );
      expect(refused.structured.reason).toBe("draft_not_reviewable");
      expect(String(refused.structured.message)).toContain("data/companies/C-0002.yaml");
      expect((await store.draft()).status?.state).toBe("draft");

      // A change of its fields through the App rewrites the file canonically:
      // the comment is gone, and the draft is whole again.
      git(fixture.mountRoot, ["checkout", "--", "data/companies/C-0002.yaml"]);
      const company = await ok(tools, "get_company", { id: "C-0002" });
      await ok(tools, "update_company", {
        id: "C-0002",
        base_revision: company.revision,
        changes: { note: "Poznámka" },
      });
      const whole = await ok(tools, "get_draft", {});
      expect(whole.complete).toBe(true);
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
      owner_id: "S-0001",
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
