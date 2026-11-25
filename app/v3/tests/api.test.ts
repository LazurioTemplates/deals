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
    const created = await call("POST", "/api/deals", {
      record: {
        title: "Nový sklad",
        companyId: "C-0007",
        owner: "Jana Ukázková",
        stageId: "lead",
        value: 25_000_000,
        expectedClose: "2027-03-15",
      },
    });
    expect(created.status).toBe(201);
    let deal = created.body as unknown as { value: Deal; revision: string };
    expect(deal.value).toMatchObject({ id: "D-2026-0015", createdAt: TODAY });
    const before = (await call("GET", "/api/forecast")).body as unknown as {
      months: { month: string; count: number }[];
      total: { count: number };
    };
    expect(before.months.find((month) => month.month === "2027-03")?.count).toBe(1);
    expect(before.total.count).toBe(10);

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
    });

    const after = (await call("GET", "/api/forecast")).body as unknown as typeof before & {
      won: { month: string; count: number; value: number }[];
    };
    expect(after.months.find((month) => month.month === "2027-03")).toBeUndefined();
    expect(after.total.count).toBe(9);
    expect(after.won.at(-1)).toEqual({ month: "2026-11", count: 2, value: 34_450_000 });
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

  test("scenario 3: the forecast by month matches the sum counted by hand", async () => {
    const { call } = setup();
    // The numbers of tests/forecast.test.ts, counted by hand over the sample.
    expect((await call("GET", "/api/forecast")).body).toEqual({
      currency: "CZK",
      months: [
        { month: "2026-12", count: 3, value: 61_250_040, weighted: 28_717_512 },
        { month: "2027-01", count: 3, value: 34_900_010, weighted: 17_645_007 },
        { month: "2027-02", count: 1, value: 80_000_000, weighted: 20_000_000 },
      ],
      noDate: { count: 2, value: 61_000_000, weighted: 13_900_000 },
      total: { count: 9, value: 237_150_050, weighted: 80_262_519 },
      won: [
        { month: "2026-09", count: 1, value: 18_600_000 },
        { month: "2026-10", count: 1, value: 42_000_000 },
        { month: "2026-11", count: 1, value: 9_950_000 },
      ],
    });
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
