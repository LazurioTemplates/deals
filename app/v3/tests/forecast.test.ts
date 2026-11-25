import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { emptyDataSet } from "../src/domain/collections.ts";
import { forecast } from "../src/domain/forecast.ts";
import { stats } from "../src/domain/stats.ts";
import { createService } from "../src/service/deals-service.ts";
import { sampleData, TODAY } from "./support/seed.ts";

/**
 * The forecast and the statistics of the sample, counted by hand. Amounts
 * are haléře; today is 2026-11-25. The open deals of the sample:
 *
 *   deal         stage        value        probability  expected close
 *   D-2026-0001  lead         12 000 000   10 (stage)   2027-01-29
 *   D-2026-0002  proposal     34 500 000   50 (stage)   2026-12-15
 *   D-2026-0003  qualified    80 000 000   25 (stage)   2027-02-26
 *   D-2026-0004  negotiation  21 999 990   45 (own)     2026-12-18
 *   D-2026-0005  proposal      4 750 050   33 (own)     2026-12-31
 *   D-2026-0006  negotiation  15 600 000   75 (stage)   2027-01-15
 *   D-2026-0007  lead          9 000 000   10 (stage)   none           → without a date
 *   D-2026-0008  qualified    52 000 000   25 (stage)   2026-10-30     → past, without a date
 *   D-2026-0009  proposal      7 300 010   65 (own)     2027-01-29
 *
 * Weighted, in hundredths of a haléř (value × probability):
 *
 *   2026-12: 1 725 000 000 + 989 999 550 + 156 751 650 = 2 871 751 200 → 28 717 512
 *            (rounded deal by deal it would be 17 250 000 + 9 899 996 + 1 567 517
 *            = 28 717 513: the haléře round only in the month's sum)
 *   2027-01: 120 000 000 + 1 170 000 000 + 474 500 650 = 1 764 500 650 → 17 645 006,5
 *            → 17 645 007 half up (banker's rounding would give 17 645 006)
 *   2027-02: 2 000 000 000 → 20 000 000
 *   no date: 90 000 000 + 1 300 000 000 = 1 390 000 000 → 13 900 000
 *   total:   28 717 512 + 17 645 007 + 20 000 000 + 13 900 000 = 80 262 519
 *
 * Unweighted: 2026-12 61 250 040, 2027-01 34 900 010, 2027-02 80 000 000,
 * no date 61 000 000, total 237 150 050 over 9 deals.
 *
 * Won (by closing month): D-2026-0010 18 600 000 on 2026-09-14 (created
 * 2026-07-01, 75 days), D-2026-0011 42 000 000 on 2026-10-20 (created
 * 2026-08-10, 71 days), D-2026-0012 9 950 000 on 2026-11-06 (created
 * 2026-09-01, 66 days). Lost: D-2026-0013 26 000 000 on 2026-09-30 for the
 * price, D-2026-0014 11 000 000 on 2026-11-03 to a competitor.
 *
 * September to November 2026: 3 won and 2 lost, conversion 3 / 5 = 60,00 %
 * (6000 basis points); the average won value 70 550 000 / 3 = 23 516 666,67
 * → 23 516 667; the average cycle (75 + 71 + 66) / 3 = 70,67 → 71 days.
 */
const PERIOD = { from: "2026-09-01", to: "2026-11-30" };

describe("the weighted forecast of the sample", () => {
  const result = forecast(sampleData(), { today: TODAY });

  test("by month of the expected close, rounded once per month, half up", () => {
    expect(result.currency).toBe("CZK");
    expect(result.months).toEqual([
      { month: "2026-12", count: 3, value: 61_250_040, weighted: 28_717_512 },
      { month: "2027-01", count: 3, value: 34_900_010, weighted: 17_645_007 },
      { month: "2027-02", count: 1, value: 80_000_000, weighted: 20_000_000 },
    ]);
  });

  test("open deals without a date or past it count without a date", () => {
    expect(result.noDate).toEqual({ count: 2, value: 61_000_000, weighted: 13_900_000 });
    expect(result.total).toEqual({ count: 9, value: 237_150_050, weighted: 80_262_519 });
  });

  test("won deals count by the month they were closed, never as open", () => {
    expect(result.won).toEqual([
      { month: "2026-09", count: 1, value: 18_600_000 },
      { month: "2026-10", count: 1, value: 42_000_000 },
      { month: "2026-11", count: 1, value: 9_950_000 },
    ]);
  });

  test("the same in English", () => {
    expect(forecast(sampleData("en"), { today: TODAY })).toEqual(result);
  });

  test("an expected close today still counts in its month", () => {
    const data = sampleData();
    const early = forecast(data, { today: "2026-10-30" });
    // D-2026-0008 is expected on 2026-10-30: on that day it is still dated.
    expect(early.months[0]).toEqual({
      month: "2026-10",
      count: 1,
      value: 52_000_000,
      weighted: 13_000_000,
    });
    expect(early.noDate).toEqual({ count: 1, value: 9_000_000, weighted: 900_000 });
    expect(early.total.weighted).toBe(result.total.weighted);
  });

  test("without settings there is nothing to forecast", () => {
    expect(forecast(emptyDataSet(), { today: TODAY })).toEqual({
      currency: "CZK",
      months: [],
      noDate: { count: 0, value: 0, weighted: 0 },
      total: { count: 0, value: 0, weighted: 0 },
      won: [],
    });
  });
});

describe("the statistics of the sample", () => {
  test("September to November 2026", () => {
    const result = stats(sampleData(), PERIOD);
    expect(result.won).toEqual({ count: 3, value: 70_550_000 });
    expect(result.lost).toEqual({ count: 2, value: 37_000_000 });
    expect(result.conversionBasisPoints).toBe(6000);
    expect(result.averageWonValue).toBe(23_516_667);
    expect(result.averageCycleDays).toBe(71);
    expect(result.byStage.map(({ stageId, count, value }) => [stageId, count, value])).toEqual([
      // Open stages: the deals in them now.
      ["lead", 2, 21_000_000],
      ["qualified", 2, 132_000_000],
      ["proposal", 3, 46_550_060],
      ["negotiation", 2, 37_599_990],
      // Won and lost: closed in the period.
      ["won", 3, 70_550_000],
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
  });

  test("a single month, with both ends of the period included", () => {
    // October: D-2026-0011 won, nothing lost.
    const october = stats(sampleData(), { from: "2026-10-01", to: "2026-10-31" });
    expect(october.conversionBasisPoints).toBe(10_000);
    expect(october.averageWonValue).toBe(42_000_000);
    expect(october.averageCycleDays).toBe(71);
    // November: D-2026-0012 won on the 6th, D-2026-0014 lost on the 3rd.
    const november = stats(sampleData(), { from: "2026-11-03", to: "2026-11-06" });
    expect(november.won).toEqual({ count: 1, value: 9_950_000 });
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
    // One more lost deal in the period: 3 / 6 won; two more: 3 / 7 = 42,857 % → 4286.
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
      expect(await service.stats(PERIOD)).toEqual(stats(sampleData(), PERIOD));
      // A deal won today moves from the open pipeline to November's won.
      const opened = await store.getDeal("D-2026-0002");
      if (!opened) throw new Error("D-2026-0002 missing");
      await store.saveDeal({ ...opened.value, stageId: "won", closedAt: TODAY }, opened.revision);
      const after = await service.forecast();
      expect(after.months[0]).toEqual({
        month: "2026-12",
        count: 2,
        value: 26_750_040,
        weighted: 11_467_512,
      });
      expect(after.won.at(-1)).toEqual({ month: "2026-11", count: 2, value: 44_450_000 });
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
        owner: "Jana Ukázková",
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
      expect([company.value.id, contact.value.id, deal.value.id, activity.value.id]).toEqual([
        "C-0007",
        "P-0011",
        "D-2026-0015",
        "A-2027-00001",
      ]);
      expect(deal.value.createdAt).toBe(TODAY);
    } finally {
      store.close();
    }
  });
});
