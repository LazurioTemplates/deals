import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { emptyDataSet } from "../src/domain/collections.ts";
import { forecast, forecastRows } from "../src/domain/forecast.ts";
import { splitValue } from "../src/domain/payment-plan.ts";
import { stats } from "../src/domain/stats.ts";
import { createService } from "../src/service/deals-service.ts";
import { sampleData, TODAY } from "./support/seed.ts";

/**
 * The forecast and the statistics of the sample, counted by hand. Amounts
 * are haléře; today is 2026-11-25.
 *
 * The forecast is what the Organization invoices: the payments of won deals'
 * payment plans and the manual rows, never a weighted guess over open deals.
 *
 *   row                    month    amount       state
 *   D-2026-0010 p1         2026-09   9 675 000   paid (26 Sep)
 *   D-2026-0010 p2         2026-10   9 675 000   paid (2 Nov)
 *   D-2026-0011 p1         2026-10  15 228 000   overdue (invoiced 21 Oct, due 4 Nov)
 *   F-2026-0003            2026-10   1 850 000   overdue (invoiced 5 Oct, due 19 Oct)
 *   F-2026-0001            2026-11   2 400 000   paid (12 Nov)
 *   D-2026-0011 p2         2026-12  15 228 000   planned
 *   F-2026-0002            2026-12   2 400 000   planned
 *   D-2026-0011 p3         2027-02  20 304 000   planned (next year)
 *
 * 2026: 19 350 000 + 30 456 000 + 1 850 000 + 4 800 000 = 56 456 000 over 7
 * rows; paid 9 675 000 × 2 + 2 400 000 = 21 750 000; overdue 15 228 000 +
 * 1 850 000 = 17 078 000; invoiced (paid or not) 38 828 000. D-2026-0011's
 * payments are 30 %, 30 % and 40 % of its 50 760 000. D-2026-0012 (won,
 * 5 830 000) has no plan yet: it waits among the unassigned.
 *
 * By salesperson: Jana (S-0001) 19 350 000 + 30 456 000 + 1 850 000 =
 * 51 656 000, Petr (S-0002) 4 800 000. The deals name no billing entity, so
 * they count for the first one (`trade`): 49 806 000; the manual rows are
 * `services`: 6 650 000.
 */
const PERIOD = { from: "2026-09-01", to: "2026-11-30" };

describe("the forecast of the sample: the payment plans of won deals", () => {
  const result = forecast(sampleData(), { today: TODAY });

  test("by month of the year, with what is invoiced, paid and overdue", () => {
    expect(result.currency).toBe("CZK");
    expect(result.year).toBe(2026);
    expect(result.years).toEqual([2026, 2027]);
    expect(result.months).toHaveLength(12);
    expect(result.months.filter((month) => month.count > 0)).toEqual([
      {
        month: "2026-09",
        forecast: 9_675_000,
        invoiced: 9_675_000,
        paid: 9_675_000,
        overdue: 0,
        onTheWay: 0,
        count: 1,
      },
      {
        month: "2026-10",
        forecast: 26_753_000,
        invoiced: 26_753_000,
        paid: 9_675_000,
        overdue: 17_078_000,
        onTheWay: 17_078_000,
        count: 3,
      },
      {
        month: "2026-11",
        forecast: 2_400_000,
        invoiced: 2_400_000,
        paid: 2_400_000,
        overdue: 0,
        onTheWay: 0,
        count: 1,
      },
      {
        month: "2026-12",
        forecast: 17_628_000,
        invoiced: 0,
        paid: 0,
        overdue: 0,
        onTheWay: 0,
        count: 2,
      },
    ]);
    expect(result.total).toEqual({
      forecast: 56_456_000,
      invoiced: 38_828_000,
      paid: 21_750_000,
      overdue: 17_078_000,
      onTheWay: 17_078_000,
      count: 7,
    });
    expect(
      result.quarters.map(({ quarter, forecast, count }) => [quarter, forecast, count]),
    ).toEqual([
      [1, 0, 0],
      [2, 0, 0],
      [3, 9_675_000, 1],
      [4, 46_781_000, 6],
    ]);
  });

  test("each row names its deal or manual row, its share and its state", () => {
    expect(result.rows.map((row) => [row.key, row.month, row.amount, row.state])).toEqual([
      ["deals/D-2026-0010#p1", "2026-09", 9_675_000, "paid"],
      ["deals/D-2026-0011#p1", "2026-10", 15_228_000, "overdue"],
      ["forecastEntries/F-2026-0003", "2026-10", 1_850_000, "overdue"],
      ["deals/D-2026-0010#p2", "2026-10", 9_675_000, "paid"],
      ["forecastEntries/F-2026-0001", "2026-11", 2_400_000, "paid"],
      ["deals/D-2026-0011#p2", "2026-12", 15_228_000, "planned"],
      ["forecastEntries/F-2026-0002", "2026-12", 2_400_000, "planned"],
    ]);
    const first = result.rows.find((row) => row.key === "deals/D-2026-0011#p1");
    expect(first).toMatchObject({
      kind: "payment",
      dealId: "D-2026-0011",
      paymentId: "p1",
      ownerId: "S-0001",
      share: 3000,
      of: { index: 1, count: 3 },
      label: "Záloha",
      billingEntityId: "trade",
    });
    const manual = result.rows.find((row) => row.key === "forecastEntries/F-2026-0003");
    expect(manual).toMatchObject({ kind: "entry", entryId: "F-2026-0003", ownerId: "S-0001" });
    expect(manual?.share).toBeUndefined();
  });

  test("a won deal without a plan waits among the unassigned, in any year", () => {
    expect(result.unassigned).toEqual([
      {
        dealId: "D-2026-0012",
        title: "Ordinace v přízemí",
        value: 5_830_000,
        closedAt: "2026-11-06",
        companyId: "C-0006",
        ownerId: "S-0002",
        dealTypeId: "delivery",
        billingEntityId: "trade",
      },
    ]);
    expect(forecast(sampleData(), { today: TODAY, year: 2027 }).unassigned).toEqual(
      result.unassigned,
    );
  });

  test("by salesperson, deal type and billing entity, the largest first", () => {
    const pick = (groups: { id: string | null; forecast: number; count: number }[]) =>
      groups.map(({ id, forecast, count }) => [id, forecast, count]);
    expect(pick(result.groups.owner)).toEqual([
      ["S-0001", 51_656_000, 5],
      ["S-0002", 4_800_000, 2],
    ]);
    expect(pick(result.groups.dealType)).toEqual([
      ["delivery", 49_806_000, 4],
      ["service", 6_650_000, 3],
    ]);
    expect(pick(result.groups.billingEntity)).toEqual([
      ["trade", 49_806_000, 4],
      ["services", 6_650_000, 3],
    ]);
  });

  test("a filter narrows the rows, the totals and the unassigned", () => {
    const petr = forecast(sampleData(), { today: TODAY, filter: { ownerId: "S-0002" } });
    expect(petr.total.forecast).toBe(4_800_000);
    expect(petr.rows.map((row) => row.key)).toEqual([
      "forecastEntries/F-2026-0001",
      "forecastEntries/F-2026-0002",
    ]);
    expect(petr.unassigned.map((deal) => deal.dealId)).toEqual(["D-2026-0012"]);
    const jana = forecast(sampleData(), { today: TODAY, filter: { ownerId: "S-0001" } });
    expect(jana.total.forecast).toBe(51_656_000);
    expect(jana.unassigned).toEqual([]);
    const services = forecast(sampleData(), {
      today: TODAY,
      filter: { billingEntityId: "services", dealTypeId: "service" },
    });
    expect(services.total).toMatchObject({ forecast: 6_650_000, count: 3, overdue: 1_850_000 });
  });

  test("another year shows its own months; every year with a row is offered", () => {
    const next = forecast(sampleData(), { today: TODAY, year: 2027 });
    expect(next.rows.map((row) => [row.key, row.share])).toEqual([["deals/D-2026-0011#p3", 4000]]);
    expect(next.total.forecast).toBe(20_304_000);
    expect(next.months.find((month) => month.month === "2027-02")?.forecast).toBe(20_304_000);
    expect(next.years).toEqual([2026, 2027]);
    expect(forecastRows(sampleData(), TODAY)).toHaveLength(8);
  });

  test("an invoice due today is not overdue yet; the next day it is", () => {
    const state = (today: string) =>
      forecast(sampleData(), { today }).rows.find((row) => row.key === "deals/D-2026-0011#p1")
        ?.state;
    expect(state("2026-11-04")).toBe("invoiced");
    expect(state("2026-11-05")).toBe("overdue");
  });

  test("the same in English", () => {
    const english = forecast(sampleData("en"), { today: TODAY });
    const numbers = (value: typeof result) => ({
      months: value.months,
      total: value.total,
      // Within a month the rows go by title, which is in the start's language.
      keys: value.rows.map((row) => `${row.key} ${row.month} ${row.amount} ${row.state}`).sort(),
      unassigned: value.unassigned.map((deal) => [deal.dealId, deal.value]),
    });
    expect(numbers(english)).toEqual(numbers(result));
  });

  test("without settings or plans there is nothing to forecast", () => {
    const empty = forecast(emptyDataSet(), { today: TODAY });
    expect(empty.currency).toBe("CZK");
    expect(empty.years).toEqual([2026]);
    expect(empty.rows).toEqual([]);
    expect(empty.unassigned).toEqual([]);
    expect(empty.total).toEqual({
      forecast: 0,
      invoiced: 0,
      paid: 0,
      overdue: 0,
      onTheWay: 0,
      count: 0,
    });
    // Open deals never count, whatever their probability.
    const data = sampleData();
    const openOnly = {
      ...data,
      deals: data.deals.filter((deal) => !deal.paymentPlan),
      forecastEntries: [],
    };
    expect(forecast(openOnly, { today: TODAY }).total.forecast).toBe(0);
  });
});

describe("the statistics of the sample", () => {
  /**
   * September to November 2026 (91 days; the previous period is 2 June to
   * 31 August): won D-2026-0010 19 350 000 (75 days from creation),
   * D-2026-0011 50 760 000 (71 days), D-2026-0012 5 830 000 (66 days), together
   * 75 940 000; lost D-2026-0013 26 000 000 for the price and D-2026-0014
   * 11 000 000 to a competitor. The conversion 3 / 5 = 6000 basis points; the
   * average win 75 940 000 / 3 = 25 313 333,33 → 25 313 333; the average cycle
   * (75 + 71 + 66) / 3 = 70,67 → 71 days.
   */
  test("September to November 2026", () => {
    const result = stats(sampleData(), PERIOD);
    expect(result.won).toEqual({ count: 3, value: 75_940_000 });
    expect(result.lost).toEqual({ count: 2, value: 37_000_000 });
    expect(result.conversionBasisPoints).toBe(6000);
    expect(result.averageWonValue).toBe(25_313_333);
    expect(result.averageCycleDays).toBe(71);
    expect(result.current.won.ids).toEqual(["D-2026-0010", "D-2026-0011", "D-2026-0012"]);
    expect(result.byStage.map(({ stageId, count, value }) => [stageId, count, value])).toEqual([
      // Open stages: the deals in them now.
      ["lead", 2, 21_000_000],
      ["qualified", 2, 132_000_000],
      ["proposal", 3, 50_990_010],
      ["negotiation", 2, 39_600_000],
      // Won and lost: closed in the period.
      ["won", 3, 75_940_000],
      ["lost", 2, 37_000_000],
    ]);
    expect(
      result.lostByReason.map(({ reasonId, count, value }) => [reasonId, count, value]),
    ).toEqual([
      ["price", 1, 26_000_000],
      ["competitor", 1, 11_000_000],
      ["timing", 0, 0],
      ["no-decision", 0, 0],
    ]);
    // The pipeline now: the nine open deals.
    expect(result.pipeline).toMatchObject({ count: 9, value: 243_590_010 });
  });

  test("new deals and quotes of the period, against the previous one", () => {
    const result = stats(sampleData(), PERIOD);
    expect(result.previousPeriod).toEqual({ from: "2026-06-02", to: "2026-08-31" });
    // Created in the period: D-0001, 0002, 0003, 0005, 0006, 0007, 0009, 0012.
    expect(result.current.created).toMatchObject({ count: 8, value: 173_420_010 });
    expect(result.previous.created).toMatchObject({ count: 6, value: 183_110_000 });
    // Quotes by the day they were written, valued without VAT.
    expect(result.current.quotes).toMatchObject({ count: 6, value: 165_240_000 });
    expect(result.previous.quotes).toEqual({
      count: 1,
      value: 19_350_000,
      ids: ["Q-2026-0004-r1"],
    });
    expect(result.previous.won).toEqual({ count: 0, value: 0, ids: [] });
    expect(result.previous.conversionBasisPoints).toBeNull();
  });

  test("a single month, with both ends of the period included", () => {
    // October: D-2026-0011 won, nothing lost.
    const october = stats(sampleData(), { from: "2026-10-01", to: "2026-10-31" });
    expect(october.conversionBasisPoints).toBe(10_000);
    expect(october.averageWonValue).toBe(50_760_000);
    expect(october.averageCycleDays).toBe(71);
    // November 3 to 6: D-2026-0012 won on the 6th, D-2026-0014 lost on the 3rd.
    const november = stats(sampleData(), { from: "2026-11-03", to: "2026-11-06" });
    expect(november.won).toEqual({ count: 1, value: 5_830_000 });
    expect(november.lost).toEqual({ count: 1, value: 11_000_000 });
    expect(november.conversionBasisPoints).toBe(5000);
    expect(november.averageCycleDays).toBe(66);
  });

  test("a period with nothing closed has no rates", () => {
    const august = stats(sampleData(), { from: "2026-08-01", to: "2026-08-31" });
    expect(august.won).toEqual({ count: 0, value: 0 });
    expect(august.conversionBasisPoints).toBeNull();
    expect(august.averageWonValue).toBeNull();
    expect(august.averageCycleDays).toBeNull();
    expect(august.lostByReason.every((reason) => reason.count === 0)).toBe(true);
    expect(() => stats(sampleData(), { from: "2026-12-01", to: "2026-11-01" })).toThrow(RangeError);
  });

  test("a conversion that does not divide evenly rounds half up", () => {
    const data = sampleData();
    // Two more lost deals in the period: 3 / 7 = 42,857 % → 4286.
    const lost = (id: string) => ({
      ...data.deals.find((deal) => deal.id === "D-2026-0014"),
      id,
    });
    const more = { ...data, deals: [...data.deals, lost("D-2026-0098"), lost("D-2026-0099")] };
    expect(stats(more as typeof data, PERIOD).conversionBasisPoints).toBe(4286);
  });
});

describe("the forecast and the statistics over the store", () => {
  test("are computed from one read of the data, today injected", async () => {
    const store = createMemoryStore(sampleData());
    try {
      const service = createService(store, { today: () => TODAY });
      expect(await service.forecast()).toEqual(forecast(sampleData(), { today: TODAY }));
      expect(await service.forecast(2027, { ownerId: "S-0001" })).toEqual(
        forecast(sampleData(), { today: TODAY, year: 2027, filter: { ownerId: "S-0001" } }),
      );
      expect(await service.stats(PERIOD)).toEqual(stats(sampleData(), PERIOD));
      expect(await service.stats(PERIOD, { ownerId: "S-0002" })).toEqual(
        stats(sampleData(), PERIOD, { ownerId: "S-0002" }),
      );
    } finally {
      store.close();
    }
  });

  test("winning a deal plans its payments or leaves it unassigned", async () => {
    const store = createMemoryStore(sampleData());
    try {
      const service = createService(store, { today: () => TODAY });
      // Won with a plan: half in December, half in January.
      const opened = await store.getDeal("D-2026-0002");
      if (!opened) throw new Error("D-2026-0002 missing");
      const won = await service.moveDeal("D-2026-0002", {
        stageId: "won",
        baseRevision: opened.revision,
        closedAt: TODAY,
        paymentPlan: {
          status: "planned",
          payments: splitValue(39_400_000, [5000, 5000], "2026-12"),
        },
      });
      expect(won.value.paymentPlan?.payments.map((entry) => entry.amount)).toEqual([
        19_700_000, 19_700_000,
      ]);
      const after = await service.forecast();
      expect(after.total.forecast).toBe(56_456_000 + 19_700_000);
      expect(after.months.find((month) => month.month === "2026-12")?.forecast).toBe(
        17_628_000 + 19_700_000,
      );
      // Won without a plan: unassigned until somebody plans it.
      const second = await store.getDeal("D-2026-0004");
      if (!second) throw new Error("D-2026-0004 missing");
      const plain = await service.moveDeal("D-2026-0004", {
        stageId: "won",
        baseRevision: second.revision,
        closedAt: TODAY,
      });
      expect(plain.value.paymentPlan).toEqual({ status: "unassigned", payments: [] });
      expect((await service.forecast()).unassigned.map((deal) => deal.dealId)).toEqual([
        "D-2026-0004",
        "D-2026-0012",
      ]);
      // Reopened, a deal forgets its plan and leaves the forecast.
      const reopened = await service.moveDeal("D-2026-0002", {
        stageId: "negotiation",
        baseRevision: won.revision,
      });
      expect(reopened.value.paymentPlan).toBeUndefined();
      expect((await service.forecast()).total.forecast).toBe(56_456_000);
    } finally {
      store.close();
    }
  });

  test("marking a payment invoiced and paid moves it through its states", async () => {
    const store = createMemoryStore(sampleData());
    try {
      const service = createService(store, { today: () => TODAY });
      const state = async () =>
        (await service.forecast()).rows.find((row) => row.key === "deals/D-2026-0011#p2");
      let deal = await store.getDeal("D-2026-0011");
      if (!deal) throw new Error("D-2026-0011 missing");
      deal = await service.changePayment("D-2026-0011", "p2", {
        baseRevision: deal.revision,
        invoicedOn: "2026-11-20",
      });
      // Due after the settings' 14 days, unless the company has its own.
      expect(await state()).toMatchObject({
        state: "invoiced",
        invoicedOn: "2026-11-20",
        dueOn: "2026-12-04",
      });
      deal = await service.changePayment("D-2026-0011", "p2", {
        baseRevision: deal.revision,
        paidOn: "2026-11-24",
      });
      expect(await state()).toMatchObject({ state: "paid", paidOn: "2026-11-24" });
      // Taken back: the invoice, its due date and the payment go.
      await service.changePayment("D-2026-0011", "p2", {
        baseRevision: deal.revision,
        invoicedOn: null,
      });
      const back = await state();
      expect(back?.state).toBe("planned");
      expect(back?.invoicedOn).toBeUndefined();
      expect(back?.paidOn).toBeUndefined();
      // A payment the plan does not have is not found.
      const current = await store.getDeal("D-2026-0011");
      await expect(
        service.changePayment("D-2026-0011", "p9", {
          baseRevision: current?.revision ?? "",
          paidOn: TODAY,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      store.close();
    }
  });

  test("new records get the next free id of their year", async () => {
    const store = createMemoryStore(sampleData());
    try {
      const service = createService(store, { today: () => TODAY });
      const company = await service.createCompany({ name: "Nová Ukázka s.r.o." });
      const contact = await service.createContact({
        name: "Nová Osoba",
        companyId: company.value.id,
      });
      const deal = await service.createDeal({
        title: "Nový případ",
        companyId: company.value.id,
        contactIds: [contact.value.id],
        ownerId: "S-0001",
        stageId: "lead",
        value: 100_000,
      });
      const activity = await service.logActivity({
        dealId: deal.value.id,
        type: "task",
        at: "2027-01-05T09:00:00+01:00",
        summary: "Poslat podklady",
        done: false,
      });
      const person = await service.createSalesperson({ name: "Nová Obchodnice", active: true });
      const item = await service.createPricebookItem({
        name: "Školení",
        unit: "h",
        unitPrice: 250_000,
        active: true,
      });
      const row = await service.createForecastEntry({
        month: "2027-03",
        title: "Paušál – březen",
        amount: 2_400_000,
      });
      const quote = await service.createQuote({ dealId: deal.value.id });
      expect([
        company.value.id,
        contact.value.id,
        deal.value.id,
        activity.value.id,
        person.value.id,
        item.value.id,
        row.value.id,
        quote.value.id,
      ]).toEqual([
        "C-0007",
        "P-0011",
        "D-2026-0015",
        "A-2027-00001",
        "S-0004",
        "I-0009",
        "F-2027-0001",
        "Q-2026-0007-r1",
      ]);
      expect(deal.value.createdAt).toBe(TODAY);
    } finally {
      store.close();
    }
  });
});
