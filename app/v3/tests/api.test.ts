import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/data/memory-store.ts";
import type { Deal } from "../src/domain/deal.ts";
import { createApi } from "../src/server/api.ts";
import { type AresClient, createAres } from "../src/server/ares.ts";
import { ARES_BODY, aresStub } from "./support/ares.ts";
import { sampleData, TODAY } from "./support/seed.ts";

const ORIGIN = "http://127.0.0.1:24940";

function setup(
  options: {
    ares?: AresClient;
    mayWrite?: boolean;
    aresLookup?: boolean;
    locale?: "cs" | "en";
  } = {},
) {
  const sample = sampleData(options.locale ?? "cs");
  const store = createMemoryStore({
    ...sample,
    settings: { ...sample.settings, aresLookup: options.aresLookup ?? true },
  });
  const api = createApi(store, {
    allowedOrigins: new Set([ORIGIN]),
    access: () => ({ admitted: true, mayWrite: options.mayWrite ?? true }),
    today: () => TODAY,
    ...(options.ares ? { ares: options.ares } : {}),
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = { origin: ORIGIN },
  ) => {
    const response = await api(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { store, call };
}

describe("HTTP API", () => {
  test("reads the settings, companies, contacts, deals and activities", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/settings")).body.value).toMatchObject({ currency: "CZK" });
    expect((await call("GET", "/api/companies")).body).toHaveLength(6);
    expect((await call("GET", "/api/contacts")).body).toHaveLength(10);
    expect((await call("GET", "/api/deals")).body).toHaveLength(14);
    expect((await call("GET", "/api/activities")).body).toHaveLength(20);
    expect((await call("GET", "/api/deals/D-2026-0004")).body.value).toMatchObject({
      probability: 45,
    });
    expect((await call("GET", "/api/deals/D-2026-0404")).status).toBe(404);
    expect((await call("GET", "/api/companies/C-0404")).status).toBe(404);
    expect((await call("GET", "/api/contacts/P-0404")).status).toBe(404);
    const issues = (await call("GET", "/api/check")).body as unknown as { code: string }[];
    expect(issues.map((issue) => issue.code)).toEqual([
      "expected_close_missing",
      "expected_close_past",
    ]);
    expect((await call("GET", "/api/nowhere")).status).toBe(404);
  });

  test("accepts a change only as JSON from the App's own origin", async () => {
    const { call } = setup();
    const input = { record: { name: "Test s.r.o." } };
    expect((await call("POST", "/api/companies", input, {})).status).toBe(403);
    expect(
      (await call("POST", "/api/companies", input, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect((await call("POST", "/api/draft/pull", undefined)).status).toBe(415);
    expect((await call("POST", "/api/companies", { record: { name: "" } })).status).toBe(422);
  });

  test("scenario 1: a new deal of a new company goes through the stages to won", async () => {
    const { call } = setup();
    const company = await call("POST", "/api/companies", {
      record: { name: "Nová Ukázka s.r.o.", address: { city: "Brno" } },
    });
    expect(company.status).toBe(201);
    expect(company.body.value).toMatchObject({ id: "C-0007" });
    // The salesperson is a record, named by its id.
    const unknownOwner = await call("POST", "/api/deals", {
      record: {
        title: "Nový sklad",
        companyId: "C-0007",
        ownerId: "S-0404",
        stageId: "lead",
        value: 1,
      },
    });
    expect(unknownOwner.status).toBe(422);
    const created = await call("POST", "/api/deals", {
      record: {
        title: "Nový sklad",
        companyId: "C-0007",
        ownerId: "S-0001",
        stageId: "lead",
        value: 25_000_000,
        expectedClose: "2027-03-15",
      },
    });
    expect(created.status).toBe(201);
    let deal = created.body as unknown as { value: Deal; revision: string };
    expect(deal.value).toMatchObject({ id: "D-2026-0015", createdAt: TODAY, ownerId: "S-0001" });
    // An open deal is no part of the forecast, whatever its stage.
    const before = (await call("GET", "/api/forecast")).body as unknown as {
      total: { forecast: number };
      unassigned: { dealId: string }[];
    };
    expect(before.total.forecast).toBe(56_456_000);

    for (const stageId of ["qualified", "proposal", "negotiation"]) {
      const moved = await call("POST", `/api/deals/${deal.value.id}/stage`, {
        stageId,
        baseRevision: deal.revision,
      });
      expect(moved.status).toBe(200);
      deal = moved.body as unknown as typeof deal;
      expect(deal.value.stageId).toBe(stageId);
    }
    // Won asks for the value and the day; zero is refused by the rules.
    const zero = await call("POST", `/api/deals/${deal.value.id}/stage`, {
      stageId: "won",
      baseRevision: deal.revision,
      value: 0,
      closedAt: "2026-11-25",
    });
    expect(zero.status).toBe(422);
    // A plan that does not add up to the value is refused too.
    const wrongPlan = await call("POST", `/api/deals/${deal.value.id}/stage`, {
      stageId: "won",
      baseRevision: deal.revision,
      value: 24_500_000,
      closedAt: "2026-11-25",
      paymentPlan: { status: "planned", payments: [{ id: "p1", month: "2026-12", amount: 1 }] },
    });
    expect(wrongPlan.status).toBe(422);
    const won = await call("POST", `/api/deals/${deal.value.id}/stage`, {
      stageId: "won",
      baseRevision: deal.revision,
      value: 24_500_000,
      closedAt: "2026-11-25",
    });
    expect(won.status).toBe(200);
    expect(won.body.value).toMatchObject({
      stageId: "won",
      value: 24_500_000,
      closedAt: "2026-11-25",
      paymentPlan: { status: "unassigned", payments: [] },
    });
    // Won without a plan, it waits among the unassigned.
    const after = (await call("GET", "/api/forecast")).body as unknown as typeof before;
    expect(after.total.forecast).toBe(56_456_000);
    expect(after.unassigned.map((entry) => entry.dealId)).toEqual(["D-2026-0015", "D-2026-0012"]);
    const deals = (await call("GET", "/api/deals")).body as unknown as { value: Deal }[];
    expect(deals.find((entry) => entry.value.id === "D-2026-0015")?.value.stageId).toBe("won");
    expect((await call("GET", "/api/check")).body).toHaveLength(2);
  });

  test("scenario 2: a lost deal with its reason is lost and moves the conversion", async () => {
    const { call } = setup();
    const period = "from=2026-09-01&to=2026-11-30";
    const before = (await call("GET", `/api/stats?${period}`)).body as unknown as {
      conversionBasisPoints: number;
    };
    expect(before.conversionBasisPoints).toBe(6000);
    const opened = (await call("GET", "/api/deals/D-2026-0003")).body as unknown as {
      revision: string;
    };
    const lost = await call("POST", "/api/deals/D-2026-0003/stage", {
      stageId: "lost",
      baseRevision: opened.revision,
      lossReasonId: "timing",
      lossNote: "Rozpočet až příští rok.",
      closedAt: "2026-11-24",
    });
    expect(lost.status).toBe(200);
    expect(lost.body.value).toMatchObject({
      stageId: "lost",
      lossReasonId: "timing",
      lossNote: "Rozpočet až příští rok.",
      closedAt: "2026-11-24",
    });
    // Without a reason it is refused.
    const second = (await call("GET", "/api/deals/D-2026-0001")).body as unknown as {
      revision: string;
    };
    expect(
      (
        await call("POST", "/api/deals/D-2026-0001/stage", {
          stageId: "lost",
          baseRevision: second.revision,
          closedAt: "2026-11-24",
        })
      ).status,
    ).toBe(422);
    const after = (await call("GET", `/api/stats?${period}`)).body as unknown as {
      conversionBasisPoints: number;
      lost: { count: number };
      lostByReason: { reasonId: string; count: number; value: number }[];
    };
    // 3 won / (3 + 3) lost.
    expect(after.conversionBasisPoints).toBe(5000);
    expect(after.lost.count).toBe(3);
    expect(after.lostByReason.find((reason) => reason.reasonId === "timing")).toMatchObject({
      count: 1,
      value: 80_000_000,
    });
    const deals = (await call("GET", "/api/deals")).body as unknown as { value: Deal }[];
    const lostDeals = deals.filter((entry) => entry.value.stageId === "lost");
    expect(lostDeals.map((entry) => [entry.value.id, entry.value.lossReasonId])).toContainEqual([
      "D-2026-0003",
      "timing",
    ]);
  });

  test("scenario 3: the forecast is the payment plans, by year and filtered", async () => {
    const { call } = setup();
    // The numbers of tests/forecast.test.ts, counted by hand over the sample.
    const all = (await call("GET", "/api/forecast")).body as unknown as {
      year: number;
      years: number[];
      total: { forecast: number; paid: number; overdue: number; count: number };
      rows: { key: string }[];
      unassigned: { dealId: string }[];
    };
    expect(all.year).toBe(2026);
    expect(all.years).toEqual([2026, 2027]);
    expect(all.total).toMatchObject({
      forecast: 56_456_000,
      paid: 21_750_000,
      overdue: 17_078_000,
      count: 7,
    });
    expect(all.unassigned.map((deal) => deal.dealId)).toEqual(["D-2026-0012"]);
    const next = (await call("GET", "/api/forecast?year=2027")).body as unknown as typeof all;
    expect(next.rows.map((row) => row.key)).toEqual(["deals/D-2026-0011#p3"]);
    const petr = (await call("GET", "/api/forecast?owner=S-0002")).body as unknown as typeof all;
    expect(petr.total.forecast).toBe(4_800_000);
    const services = (await call("GET", "/api/forecast?type=service&entity=services"))
      .body as unknown as typeof all;
    expect(services.total).toMatchObject({ forecast: 6_650_000, count: 3 });
    // A year that is not four digits falls back to this year.
    expect(((await call("GET", "/api/forecast?year=26")).body as { year: number }).year).toBe(2026);
  });

  test("the statistics compare with the previous period and take filters", async () => {
    const { call } = setup();
    const result = (await call("GET", "/api/stats?from=2026-10-01&to=2026-10-31"))
      .body as unknown as {
      previousPeriod: { from: string; to: string };
      current: { won: { value: number } };
      previous: { won: { value: number }; conversionBasisPoints: number };
      leaderboard: { ownerId: string }[];
    };
    expect(result.previousPeriod).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(result.current.won.value).toBe(50_760_000);
    expect(result.previous.won.value).toBe(19_350_000);
    expect(result.previous.conversionBasisPoints).toBe(5000);
    const petr = (await call("GET", "/api/stats?from=2026-09-01&to=2026-11-30&owner=S-0002"))
      .body as unknown as { conversionBasisPoints: number; leaderboard: { ownerId: string }[] };
    expect(petr.conversionBasisPoints).toBe(5000);
    expect(petr.leaderboard.map((row) => row.ownerId)).toEqual(["S-0002"]);
    const service = (await call("GET", "/api/stats?from=2026-09-01&to=2026-11-30&type=service"))
      .body as unknown as { pipeline: { ids: string[] } };
    expect(service.pipeline.ids).toEqual(["D-2026-0006", "D-2026-0007"]);
  });

  test("the statistics cover the last 90 days unless a period is asked", async () => {
    const { call } = setup();
    const fallback = (await call("GET", "/api/stats")).body as unknown as {
      period: { from: string; to: string };
    };
    expect(fallback.period).toEqual({ from: "2026-08-28", to: TODAY });
    expect((await call("GET", "/api/stats?from=2026-12-01&to=2026-11-01")).status).toBe(400);
    expect((await call("GET", "/api/stats?from=2026-02-30&to=2026-03-01")).status).toBe(400);
  });

  test("scenario 4 at the API: a request that may not write changes nothing", async () => {
    const { call, store } = setup({ mayWrite: false });
    const refused = await call("POST", "/api/companies", { record: { name: "Nová s.r.o." } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("data_read_only");
    expect((await call("GET", "/api/status")).body).toMatchObject({ ok: true, mayWrite: false });
    expect((await store.draft()).records ?? []).toEqual([]);
  });

  test("scenario 5: a stale save after A → B → A is record_changed with current_revision", async () => {
    const { call } = setup();
    const a = (await call("GET", "/api/companies/C-0001")).body as unknown as {
      value: { name: string };
      revision: string;
    };
    const b = await call("PUT", "/api/companies/C-0001", {
      record: { ...a.value, name: "Ukázka B s.r.o." },
      baseRevision: a.revision,
    });
    expect(b.status).toBe(200);
    const back = await call("PUT", "/api/companies/C-0001", {
      record: a.value,
      baseRevision: (b.body as unknown as { revision: string }).revision,
    });
    expect(back.status).toBe(200);
    const current = (back.body as unknown as { revision: string }).revision;
    expect(current).not.toBe(a.revision);
    // An editor who opened A before is refused and learns the revision now.
    const stale = await call("PUT", "/api/companies/C-0001", {
      record: { ...a.value, note: "Pozdě" },
      baseRevision: a.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "record_changed", current_revision: current });
    // The id in the address and in the record agree.
    expect(
      (await call("PUT", "/api/companies/C-0002", { record: a.value, baseRevision: current }))
        .status,
    ).toBe(400);
  });

  test("activities: a new one gets the next id of its year and a task is ticked off", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/activities", {
      record: {
        dealId: "D-2026-0002",
        type: "task",
        at: "2026-11-26T09:00:00+01:00",
        summary: "Poslat smlouvu",
        done: false,
      },
    });
    expect(created.status).toBe(201);
    const task = created.body as unknown as {
      value: { id: string; done: boolean };
      revision: string;
    };
    expect(task.value.id).toBe("A-2026-00021");
    const ticked = await call("PUT", `/api/activities/${task.value.id}`, {
      record: { ...task.value, done: true },
      baseRevision: task.revision,
    });
    expect(ticked.status).toBe(200);
    expect(ticked.body.value).toMatchObject({ done: true });
  });

  test("Draft & Publish through the API", async () => {
    const { call } = setup();
    await call("POST", "/api/companies", { record: { name: "Publikovaná s.r.o." } });
    const card = (await call("GET", "/api/draft")).body as unknown as {
      revision: string;
      records: unknown[];
    };
    expect(card.records).toHaveLength(1);
    expect((await call("POST", "/api/draft/publish", { expectedRevision: "stale" })).status).toBe(
      409,
    );
    expect(
      (await call("POST", "/api/draft/publish", { expectedRevision: card.revision })).status,
    ).toBe(200);
    expect(((await call("GET", "/api/draft")).body as unknown as { records: [] }).records).toEqual(
      [],
    );
  });

  test("answers in the language of the request", async () => {
    const { call } = setup();
    const czech = await call("GET", "/api/deals/D-2026-0404");
    expect(czech.body.message).toBe("Obchodní případ D-2026-0404 neexistuje.");
    const english = await call("GET", "/api/deals/D-2026-0404", undefined, {
      "accept-language": "en",
    });
    expect(english.body.message).toBe("The deal D-2026-0404 does not exist.");
  });
});

describe("HTTP API of 0.2.0", () => {
  test("salespeople and the price list: list, create with the next id, save", async () => {
    const { call } = setup();
    const people = (await call("GET", "/api/salespeople")).body as unknown as {
      value: { id: string; name: string };
    }[];
    expect(people.map((entry) => entry.value.id)).toEqual(["S-0001", "S-0003", "S-0002"]);
    const created = await call("POST", "/api/salespeople", {
      record: { name: "Nová Obchodnice", active: true },
    });
    expect(created.status).toBe(201);
    const person = created.body as unknown as { value: { id: string }; revision: string };
    expect(person.value.id).toBe("S-0004");
    const left = await call("PUT", "/api/salespeople/S-0004", {
      record: { ...person.value, name: "Nová Obchodnice", active: false },
      baseRevision: person.revision,
    });
    expect(left.status).toBe(200);
    expect(left.body.value).toMatchObject({ active: false });
    expect(
      (
        await call("PUT", "/api/salespeople/S-0001", {
          record: { ...person.value, active: true },
          baseRevision: person.revision,
        })
      ).status,
    ).toBe(400);

    const items = (await call("GET", "/api/pricebook")).body as unknown as unknown[];
    expect(items).toHaveLength(8);
    const item = await call("POST", "/api/pricebook", {
      record: { name: "Školení obsluhy", unit: "h", unitPrice: 250_000, active: true },
    });
    expect(item.status).toBe(201);
    expect(item.body.value).toMatchObject({ id: "I-0009" });
    expect(
      (
        await call("POST", "/api/pricebook", {
          record: { name: "Zlomek", unit: "h", unitPrice: 1.5, active: true },
        })
      ).status,
    ).toBe(422);
  });

  test("a quote from a deal and the price list; the deal's value follows it", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/quotes", {
      dealId: "D-2026-0001",
      pricebookItemIds: ["I-0001", "I-0004", "I-0404"],
    });
    expect(created.status).toBe(201);
    const quote = created.body as unknown as {
      value: {
        id: string;
        number: string;
        status: string;
        issuedOn: string;
        validUntil: string;
        customer: { companyId: string; name: string };
        lines: { pricebookItemId: string; sectionId: string; unitPrice: number }[];
      };
      revision: string;
    };
    // Revision 1 of the next number, a draft with the deal's company and the settings' defaults.
    expect(quote.value).toMatchObject({
      id: "Q-2026-0007-r1",
      number: "Q-2026-0007",
      status: "draft",
      issuedOn: TODAY,
      validUntil: "2026-12-25",
      customer: { companyId: "C-0001", name: "Ukázka Nábytek s.r.o." },
    });
    // An item the price list does not have is left out; each line copies its item.
    expect(
      quote.value.lines.map((line) => [line.pricebookItemId, line.sectionId, line.unitPrice]),
    ).toEqual([
      ["I-0001", "items", 1_290_000],
      ["I-0004", "work", 85_000],
    ]);
    const deal = (await call("GET", "/api/deals/D-2026-0001")).body as unknown as {
      value: Deal;
      revision: string;
    };
    // The deal's value is now the quote's subtotal: 12 900 Kč + 850 Kč.
    expect(deal.value.value).toBe(1_375_000);
    // A whole quote saved from its revision: two more desks.
    const saved = await call("PUT", `/api/quotes/${quote.value.id}`, {
      record: {
        ...quote.value,
        lines: quote.value.lines.map((line, index) =>
          index === 0 ? { ...line, quantity: 3 } : line,
        ),
      },
      baseRevision: quote.revision,
    });
    expect(saved.status).toBe(200);
    expect(
      ((await call("GET", "/api/deals/D-2026-0001")).body as unknown as { value: Deal }).value
        .value,
    ).toBe(3 * 1_290_000 + 85_000);
    // A stale save is refused with the revision stored now.
    const stale = await call("PUT", `/api/quotes/${quote.value.id}`, {
      record: quote.value,
      baseRevision: quote.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: "record_changed",
      current_revision: (saved.body as unknown as { revision: string }).revision,
    });
    expect((await call("POST", "/api/quotes", { dealId: "D-2026-0404" })).status).toBe(404);
    expect((await call("GET", "/api/quotes/Q-2026-0404-r1")).status).toBe(404);
  });

  test("a quote sent, revised and approved; the approved one sets the deal's value", async () => {
    const { call } = setup();
    // D-2026-0004 has Q-2026-0002-r1, active, 240 000 Kč.
    const opened = (await call("GET", "/api/quotes/Q-2026-0002-r1")).body as unknown as {
      value: { lines: { quantity: number }[] };
      revision: string;
    };
    const revised = await call("POST", "/api/quotes/Q-2026-0002-r1/revise", {});
    expect(revised.status).toBe(201);
    const second = revised.body as unknown as {
      value: { id: string; version: number; status: string; issuedOn: string; sentOn?: string };
      revision: string;
    };
    expect(second.value).toMatchObject({
      id: "Q-2026-0002-r2",
      version: 2,
      status: "draft",
      issuedOn: TODAY,
    });
    expect(second.value.sentOn).toBeUndefined();
    // The active revision it replaces is superseded, as a draft too.
    const first = (await call("GET", "/api/quotes/Q-2026-0002-r1")).body as unknown as {
      value: { status: string };
      revision: string;
    };
    expect(first.value.status).toBe("superseded");
    expect(first.revision).not.toBe(opened.revision);
    // Sent: active records the day.
    const sent = await call("POST", "/api/quotes/Q-2026-0002-r2/status", {
      status: "active",
      baseRevision: second.revision,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.value).toMatchObject({ status: "active", sentOn: TODAY });
    const approved = await call("POST", "/api/quotes/Q-2026-0002-r2/status", {
      status: "approved",
      baseRevision: (sent.body as unknown as { revision: string }).revision,
    });
    expect(approved.body.value).toMatchObject({ status: "approved", approvedOn: TODAY });
    const deal = (await call("GET", "/api/deals/D-2026-0004")).body as unknown as { value: Deal };
    expect(deal.value.primaryQuoteId).toBe("Q-2026-0002-r2");
    expect(deal.value.value).toBe(24_000_000);
    expect(
      (
        await call("POST", "/api/quotes/Q-2026-0002-r2/status", {
          status: "sent",
          baseRevision: "r",
        })
      ).status,
    ).toBe(422);
    // A revised quote shows in the draft with the deal it moves.
    const card = (await call("GET", "/api/draft")).body as unknown as {
      records: { technicalPath: string }[];
    };
    expect(card.records.map((record) => record.technicalPath).sort()).toEqual([
      "deals/D-2026-0004",
      "quotes/Q-2026-0002-r1",
      "quotes/Q-2026-0002-r2",
    ]);
  });

  test("a won deal's payments: planned, invoiced, paid and taken back", async () => {
    const { call } = setup();
    const deal = (await call("GET", "/api/deals/D-2026-0012")).body as unknown as {
      value: Deal;
      revision: string;
    };
    // A plan that does not add up is refused.
    const wrong = await call("PUT", "/api/deals/D-2026-0012/plan", {
      plan: { status: "planned", payments: [{ id: "p1", month: "2026-12", amount: 1 }] },
      baseRevision: deal.revision,
    });
    expect(wrong.status).toBe(422);
    const planned = await call("PUT", "/api/deals/D-2026-0012/plan", {
      plan: {
        status: "planned",
        payments: [
          { id: "p1", month: "2026-12", amount: 2_915_000, label: "Záloha" },
          { id: "p2", month: "2027-01", amount: 2_915_000 },
        ],
      },
      baseRevision: deal.revision,
    });
    expect(planned.status).toBe(200);
    let revision = (planned.body as unknown as { revision: string }).revision;
    const forecast = (await call("GET", "/api/forecast")).body as unknown as {
      total: { forecast: number };
      unassigned: unknown[];
    };
    expect(forecast.total.forecast).toBe(56_456_000 + 2_915_000);
    expect(forecast.unassigned).toEqual([]);
    const invoiced = await call("POST", "/api/deals/D-2026-0012/payments/p1", {
      baseRevision: revision,
      invoicedOn: "2026-11-25",
    });
    expect(invoiced.status).toBe(200);
    const payment = () => (invoicedBody(invoiced) ?? []).find((entry) => entry.id === "p1");
    expect(payment()).toMatchObject({ invoicedOn: "2026-11-25", dueOn: "2026-12-09" });
    revision = (invoiced.body as unknown as { revision: string }).revision;
    const paid = await call("POST", "/api/deals/D-2026-0012/payments/p1", {
      baseRevision: revision,
      paidOn: "2026-12-01",
    });
    expect(invoicedBody(paid)?.[0]).toMatchObject({ paidOn: "2026-12-01" });
    revision = (paid.body as unknown as { revision: string }).revision;
    const back = await call("POST", "/api/deals/D-2026-0012/payments/p1", {
      baseRevision: revision,
      invoicedOn: null,
    });
    expect(invoicedBody(back)?.[0]).toEqual({
      id: "p1",
      month: "2026-12",
      amount: 2_915_000,
      label: "Záloha",
    });
    expect(
      (
        await call("POST", "/api/deals/D-2026-0012/payments/p9", {
          baseRevision: (back.body as unknown as { revision: string }).revision,
          paidOn: "2026-12-01",
        })
      ).status,
    ).toBe(404);
    // Back among the unassigned.
    const unassigned = await call("PUT", "/api/deals/D-2026-0012/plan", {
      plan: { status: "unassigned", payments: [] },
      baseRevision: (back.body as unknown as { revision: string }).revision,
    });
    expect(unassigned.status).toBe(200);
    expect(
      ((await call("GET", "/api/forecast")).body as unknown as { unassigned: unknown[] })
        .unassigned,
    ).toHaveLength(1);
    // An open deal has no plan.
    const open = (await call("GET", "/api/deals/D-2026-0001")).body as unknown as {
      revision: string;
    };
    expect(
      (
        await call("PUT", "/api/deals/D-2026-0001/plan", {
          plan: { status: "unassigned", payments: [] },
          baseRevision: open.revision,
        })
      ).status,
    ).toBe(422);
  });

  test("manual forecast rows and the notes of a month", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/forecast-entries", {
      record: { month: "2026-12", title: "Paušál navíc", amount: 1_000_000, ownerId: "S-0002" },
    });
    expect(created.status).toBe(201);
    const row = created.body as unknown as { value: { id: string }; revision: string };
    expect(row.value.id).toBe("F-2026-0004");
    const paid = await call("POST", `/api/forecast-entries/${row.value.id}/payment`, {
      baseRevision: row.revision,
      paidOn: "2026-12-10",
    });
    expect(paid.status).toBe(200);
    expect(paid.body.value).toMatchObject({
      invoicedOn: "2026-12-10",
      dueOn: "2026-12-24",
      paidOn: "2026-12-10",
    });
    const december = (await call("GET", "/api/forecast")).body as unknown as {
      months: { month: string; forecast: number; paid: number }[];
    };
    expect(december.months.find((month) => month.month === "2026-12")).toMatchObject({
      forecast: 17_628_000 + 1_000_000,
      paid: 1_000_000,
    });
    expect(
      (
        await call("POST", "/api/forecast-entries", {
          record: { month: "2026-12", title: "X", amount: 1, ownerId: "S-0404" },
        })
      ).status,
    ).toBe(422);
    // Removed with its revision.
    const removed = await call("DELETE", `/api/forecast-entries/${row.value.id}`, {
      baseRevision: (paid.body as unknown as { revision: string }).revision,
    });
    expect(removed.status).toBe(200);
    expect((await call("GET", "/api/forecast-entries")).body).toHaveLength(3);

    const notes = (await call("GET", "/api/forecast-notes")).body as unknown as {
      value: { id: string };
      revision: string;
    }[];
    expect(notes.map((note) => note.value.id)).toEqual(["2026-12"]);
    const written = await call("PUT", "/api/forecast-notes/2027-01", {
      text: "Leden čeká na rozpočet.",
      baseRevision: null,
    });
    expect(written.status).toBe(200);
    expect(written.body.value).toMatchObject({ id: "2027-01", text: "Leden čeká na rozpočet." });
    // An empty text removes the note.
    const cleared = await call("PUT", "/api/forecast-notes/2026-12", {
      text: "",
      baseRevision: notes[0]?.revision ?? "",
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toBeNull();
    expect(
      (
        (await call("GET", "/api/forecast-notes")).body as unknown as { value: { id: string } }[]
      ).map((note) => note.value.id),
    ).toEqual(["2027-01"]);
    expect(
      (await call("PUT", "/api/forecast-notes/2027-13", { text: "x", baseRevision: null })).status,
    ).toBe(400);
  });

  test("a company another record names is not removed: the deal keeps it", async () => {
    const { store } = setup();
    const company = await store.getCompany("C-0006");
    if (!company) throw new Error("C-0006 missing");
    await expect(store.remove("companies", "C-0006", company.revision)).rejects.toMatchObject({
      code: "invalid_record",
    });
  });
});

/** The payments of the deal an API answer carries. */
function invoicedBody(answer: { body: Record<string, unknown> }) {
  return (answer.body.value as Deal | undefined)?.paymentPlan?.payments;
}

describe("ARES through the server", () => {
  test("scenario 6: ARES fills a company in through a stub", async () => {
    const stub = aresStub(() => Response.json(ARES_BODY));
    const { call } = setup({ ares: stub.client });
    const found = await call("GET", "/api/ares/00000001");
    expect(found.status).toBe(200);
    expect(found.body).toEqual({
      ico: "00000001",
      name: "Smyšlená Strojírna s.r.o.",
      dic: "CZ00000001",
      address: {
        street: "Ukázková 1234/12a",
        city: "Brno",
        postalCode: "602 00",
        country: "Česká republika",
      },
    });
    expect(stub.calls).toEqual([
      "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/00000001",
    ]);
    // The form saves what ARES gave as a new company.
    const saved = await call("POST", "/api/companies", {
      record: {
        name: found.body.name,
        ico: found.body.ico,
        dic: found.body.dic,
        address: found.body.address,
      },
    });
    expect(saved.status).toBe(201);
    expect(saved.body.value).toMatchObject({ ico: "00000001", dic: "CZ00000001" });
  });

  test("scenario 6: when ARES is down the company is saved by hand", async () => {
    const stub = aresStub(() => new Response("Service Unavailable", { status: 503 }));
    const { call } = setup({ ares: stub.client });
    const down = await call("GET", "/api/ares/00000001");
    expect(down.status).toBe(502);
    expect(down.body.code).toBe("ares_unavailable");
    const saved = await call("POST", "/api/companies", {
      record: { name: "Ručně Zapsaná s.r.o.", ico: "00000001" },
    });
    expect(saved.status).toBe(201);
  });

  test("is refused while the settings turn it off, and checks the IČO before calling", async () => {
    const stub = aresStub(() => Response.json(ARES_BODY));
    const off = setup({ ares: stub.client, aresLookup: false });
    const disabled = await off.call("GET", "/api/ares/00000001");
    expect(disabled.status).toBe(404);
    expect(disabled.body.code).toBe("ares_disabled");
    const on = setup({ ares: stub.client });
    const invalid = await on.call("GET", "/api/ares/00000002");
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe("invalid_ico");
    expect((await on.call("GET", "/api/ares/abc")).status).toBe(422);
    expect(stub.calls).toEqual([]);
  });

  test("an unknown company and a busy minute are said as such", async () => {
    const stub = aresStub(() => new Response("{}", { status: 404 }));
    const { call } = setup({ ares: stub.client });
    const unknown = await call("GET", "/api/ares/00000001");
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("ares_not_found");
    const busy = setup({
      ares: createAres({ fetch: async () => Response.json(ARES_BODY), perMinute: 0 }),
    });
    const limited = await busy.call("GET", "/api/ares/00000001");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("ares_rate_limited");
  });
});
