import { describe, expect, test } from "bun:test";
import { PERIOD_LABELS, PERIOD_PRESETS, periodOf } from "../src/domain/periods.ts";
import {
  bucketsOf,
  changeBasisPoints,
  mondayOf,
  previousPeriod,
  stats,
} from "../src/domain/stats.ts";
import { sampleData, TODAY } from "./support/seed.ts";

/**
 * The statistics of 0.2.0 over the sample, counted by hand: the comparison
 * with the previous period, the buckets of the charts, the leaderboard of
 * the salespeople and the won value summed day by day.
 */
const PERIOD = { from: "2026-09-01", to: "2026-11-30" };

describe("the previous period and the buckets", () => {
  test("the previous period has the same length and ends the day before", () => {
    expect(previousPeriod(PERIOD)).toEqual({ from: "2026-06-02", to: "2026-08-31" });
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-08-31",
      to: "2026-09-30",
    });
    expect(previousPeriod({ from: TODAY, to: TODAY })).toEqual({
      from: "2026-11-24",
      to: "2026-11-24",
    });
    // Across a leap day: 1–31 March 2028 (31 days) follows 30 January – 29 February.
    expect(previousPeriod({ from: "2028-03-01", to: "2028-03-31" })).toEqual({
      from: "2028-01-30",
      to: "2028-02-29",
    });
  });

  test("weeks start on Monday and months on the first, each clipped to the period", () => {
    expect(mondayOf("2026-11-25")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    const weeks = bucketsOf(PERIOD, "week");
    expect(weeks).toHaveLength(14);
    expect(weeks[0]).toEqual({ from: "2026-09-01", to: "2026-09-06" });
    expect(weeks[1]).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(weeks.at(-1)).toEqual({ from: "2026-11-30", to: "2026-11-30" });
    expect(bucketsOf({ from: "2026-01-15", to: "2026-03-10" }, "month")).toEqual([
      { from: "2026-01-15", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-10" },
    ]);
  });

  test("weeks up to 120 days, months beyond", () => {
    expect(stats(sampleData(), PERIOD).bucket).toBe("week");
    const year = stats(sampleData(), { from: "2026-01-01", to: "2026-12-31" });
    expect(year.bucket).toBe("month");
    expect(year.createdByBucket).toHaveLength(12);
    expect(year.quotesByBucket).toHaveLength(12);
  });
});

describe("the figures of 0.2.0", () => {
  const result = stats(sampleData(), PERIOD);

  test("new deals by bucket, split by where they stand now", () => {
    // D-2026-0012 was created on 1 September and is won; D-2026-0006 on 8
    // September and is open; D-2026-0002 on 22 September.
    const [first, second, , fourth] = result.createdByBucket;
    expect(first).toMatchObject({
      from: "2026-09-01",
      won: { count: 1, value: 5_830_000, ids: ["D-2026-0012"] },
      open: { count: 0 },
    });
    expect(second?.open).toEqual({ count: 1, value: 15_600_000, ids: ["D-2026-0006"] });
    expect(fourth?.open.ids).toEqual(["D-2026-0002"]);
    const created = result.createdByBucket.reduce(
      (sum, bucket) => sum + bucket.open.count + bucket.won.count + bucket.lost.count,
      0,
    );
    expect(created).toBe(result.current.created.count);
  });

  test("quotes by the week they were written", () => {
    expect(
      result.quotesByBucket
        .filter((bucket) => bucket.count > 0)
        .map((bucket) => [bucket.from, bucket.ids, bucket.value]),
    ).toEqual([
      ["2026-09-28", ["Q-2026-0005-r1"], 50_760_000],
      ["2026-10-12", ["Q-2026-0001-r1"], 40_960_000],
      ["2026-10-19", ["Q-2026-0006-r1"], 5_830_000],
      ["2026-11-02", ["Q-2026-0001-r2"], 39_400_000],
      ["2026-11-09", ["Q-2026-0002-r1"], 24_000_000],
      ["2026-11-16", ["Q-2026-0003-r1"], 4_290_000],
    ]);
  });

  test("the leaderboard: won in the period, before, and open now", () => {
    expect(
      result.leaderboard.map((row) => [
        row.ownerId,
        row.won.count,
        row.won.value,
        row.previous.value,
        row.open.count,
        row.open.value,
      ]),
    ).toEqual([
      // Jana: D-0010 and D-0011 won; D-0001, 0002, 0005, 0006 and 0008 open.
      ["S-0001", 2, 70_110_000, 0, 5, 123_290_000],
      // Petr: D-0012 won; D-0003, 0004, 0007 and 0009 open.
      ["S-0002", 1, 5_830_000, 0, 4, 120_300_010],
    ]);
    // Karel (S-0003) has nothing, so he has no row.
  });

  test("the won value summed day by day against the previous period", () => {
    expect(result.cumulative).toHaveLength(91);
    expect(result.cumulative[0]).toEqual({ day: 0, date: "2026-09-01", value: 0, previous: 0 });
    const on = (date: string) => result.cumulative.find((point) => point.date === date)?.value;
    expect(on("2026-09-13")).toBe(0);
    expect(on("2026-09-14")).toBe(19_350_000);
    expect(on("2026-10-20")).toBe(70_110_000);
    expect(result.cumulative.at(-1)).toEqual({
      day: 90,
      date: "2026-11-30",
      value: 75_940_000,
      previous: 0,
    });
    // October against September: D-0010 on 14 September is day 14 of the previous period.
    const october = stats(sampleData(), { from: "2026-10-01", to: "2026-10-31" });
    expect(october.previous.won.value).toBe(19_350_000);
    expect(october.previous.conversionBasisPoints).toBe(5000);
    expect(october.cumulative[13]?.previous).toBe(0);
    expect(october.cumulative[14]?.previous).toBe(19_350_000);
    expect(october.cumulative.at(-1)).toMatchObject({ value: 50_760_000, previous: 19_350_000 });
  });

  test("won by month: the twelve months up to the period's end", () => {
    expect(result.wonByMonth).toHaveLength(12);
    expect(result.wonByMonth[0]?.month).toBe("2025-12");
    expect(
      result.wonByMonth.slice(-3).map(({ month, count, value }) => [month, count, value]),
    ).toEqual([
      ["2026-09", 1, 19_350_000],
      ["2026-10", 1, 50_760_000],
      ["2026-11", 1, 5_830_000],
    ]);
  });

  test("a filter by salesperson or deal type narrows every figure", () => {
    const petr = stats(sampleData(), PERIOD, { ownerId: "S-0002" });
    expect(petr.current.won.ids).toEqual(["D-2026-0012"]);
    expect(petr.current.lost.ids).toEqual(["D-2026-0013"]);
    expect(petr.conversionBasisPoints).toBe(5000);
    expect(petr.current.quotes.ids).toEqual(["Q-2026-0002-r1", "Q-2026-0006-r1"]);
    expect(petr.leaderboard.map((row) => row.ownerId)).toEqual(["S-0002"]);
    expect(petr.pipeline).toMatchObject({ count: 4, value: 120_300_010 });
    const service = stats(sampleData(), PERIOD, { dealTypeId: "service" });
    expect(service.pipeline.ids).toEqual(["D-2026-0006", "D-2026-0007"]);
    expect(service.current.lost.ids).toEqual(["D-2026-0013"]);
    expect(service.current.quotes.count).toBe(0);
  });

  test("the change against the previous period, half up; none from zero", () => {
    // October 50 760 000 against September 19 350 000: +162,33 %.
    expect(changeBasisPoints(50_760_000, 19_350_000)).toBe(16_233);
    expect(changeBasisPoints(5, 10)).toBe(-5000);
    // −1/3 = −33,333 % → −3333; half away from zero: −1/8 = −12,5 % exactly.
    expect(changeBasisPoints(2, 3)).toBe(-3333);
    expect(changeBasisPoints(7, 8)).toBe(-1250);
    expect(changeBasisPoints(10, 0)).toBeNull();
    expect(changeBasisPoints(0, 0)).toBeNull();
  });
});

describe("the periods a person picks", () => {
  // 25 November 2026 is a Wednesday.
  const of = (preset: (typeof PERIOD_PRESETS)[number], today = TODAY, earliest?: string) =>
    periodOf(preset, today, earliest);

  test("relative to today, both ends included", () => {
    expect(of("today")).toEqual({ from: TODAY, to: TODAY });
    expect(of("yesterday")).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(of("last7")).toEqual({ from: "2026-11-19", to: TODAY });
    expect(of("thisWeek")).toEqual({ from: "2026-11-23", to: TODAY });
    expect(of("lastWeek")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(of("last30")).toEqual({ from: "2026-10-27", to: TODAY });
    expect(of("lastMonth")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(of("last90")).toEqual({ from: "2026-08-28", to: TODAY });
    expect(of("thisQuarter")).toEqual({ from: "2026-10-01", to: TODAY });
    expect(of("lastQuarter")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(of("thisYear")).toEqual({ from: "2026-01-01", to: TODAY });
    expect(of("last365")).toEqual({ from: "2025-11-26", to: TODAY });
    expect(of("lastYear")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  test("across the turn of a year and a leap February", () => {
    expect(of("lastMonth", "2027-01-10")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(of("lastQuarter", "2027-02-01")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(of("lastWeek", "2027-01-01")).toEqual({ from: "2026-12-21", to: "2026-12-27" });
    expect(of("lastMonth", "2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  test("all starts at the oldest date of the data, else at the start of last year", () => {
    expect(of("all", TODAY, "2026-06-15")).toEqual({ from: "2026-06-15", to: TODAY });
    expect(of("all")).toEqual({ from: "2025-01-01", to: TODAY });
    expect(of("all", TODAY, "2027-01-01")).toEqual({ from: "2025-01-01", to: TODAY });
  });

  test("every preset has a label in both languages", () => {
    for (const preset of PERIOD_PRESETS) {
      const label = PERIOD_LABELS[preset];
      expect(label.cs.length).toBeGreaterThan(0);
      expect(label.en).not.toMatch(/[ěščřžýáíéůú]/i);
      const period = of(preset);
      expect(period.from <= period.to).toBe(true);
    }
  });
});
