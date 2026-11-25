import { describe, expect, test } from "bun:test";
import {
  averageAmount,
  formatAmount,
  formatBasisPoints,
  formatMoney,
  money,
  parseMoney,
  roundDiv,
  sumAmounts,
  weightedHundredths,
  weightedTotal,
} from "../src/domain/money.ts";

describe("money in haléře", () => {
  test("is a whole non-negative number of minor units", () => {
    expect(money.safeParse(139000).success).toBe(true);
    expect(money.safeParse(0).success).toBe(true);
    expect(money.safeParse(1390.5).success).toBe(false);
    expect(money.safeParse(-1).success).toBe(false);
  });

  test("rounds half up, never to the even neighbour", () => {
    expect(roundDiv(5n, 10n)).toBe(1n);
    expect(roundDiv(15n, 10n)).toBe(2n);
    // Banker's rounding would give 2 here; half up gives 3.
    expect(roundDiv(25n, 10n)).toBe(3n);
    expect(roundDiv(4n, 10n)).toBe(0n);
    expect(roundDiv(-5n, 10n)).toBe(-1n);
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
  });

  test("a weighted amount stays exact until the sum is rounded", () => {
    // 21 999,90 Kč × 45 % = 9 899,9955 Kč and 47 500,50 Kč × 33 % = 15 675,1650 Kč.
    const a = weightedHundredths(2_199_990, 45);
    const b = weightedHundredths(4_750_050, 33);
    expect(a).toBe(98_999_550n);
    expect(b).toBe(156_751_650n);
    // Each alone rounds up by half a haléř; their exact sum is whole, one haléř less.
    expect(weightedTotal(a) + weightedTotal(b)).toBe(989_996 + 1_567_517);
    expect(weightedTotal(a + b)).toBe(2_557_512);
    // Half a haléř rounds up.
    expect(weightedTotal(50n)).toBe(1);
    expect(weightedTotal(49n)).toBe(0);
    // Far beyond a float's exact range, still exact.
    expect(weightedTotal(weightedHundredths(99_999_999_999_999, 99))).toBe(98_999_999_999_999);
  });

  test("sums and averages exactly, half up", () => {
    expect(sumAmounts([18_600_000, 42_000_000, 9_950_000])).toBe(70_550_000);
    expect(averageAmount([18_600_000, 42_000_000, 9_950_000])).toBe(23_516_667);
    expect(averageAmount([1, 2])).toBe(2);
    expect(averageAmount([])).toBeNull();
    expect(() => sumAmounts([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  test("reads amounts as people type them, in Czech and in English", () => {
    expect(parseMoney("1 234,50")).toBe(123450);
    expect(parseMoney("1 234,5 Kč")).toBe(123450);
    expect(parseMoney("1.234,50")).toBe(123450);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("1290")).toBe(129000);
    expect(parseMoney("1,005")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1,234.50", "en")).toBe(123450);
    expect(parseMoney("CZK 1,234", "en")).toBe(123400);
    expect(parseMoney("1.2.3", "en")).toBeNull();
  });

  test("writes amounts and rates the Czech and the English way", () => {
    // Czech groups thousands and parts a unit with non-breaking spaces.
    const nb = (value: string) => value.replaceAll(" ", "\u00a0");
    expect(formatAmount(123450)).toBe(nb("1 234,50"));
    expect(formatAmount(5)).toBe("0,05");
    expect(formatMoney(139000)).toBe(nb("1 390,00 Kč"));
    expect(formatMoney(139000, "EUR")).toBe(nb("1 390,00 €"));
    expect(formatMoney(139000, "CZK", "en")).toBe(nb("CZK 1,390.00"));
    expect(formatMoney(-50)).toBe(nb("−0,50 Kč"));
    expect(formatBasisPoints(6000)).toBe(nb("60 %"));
    expect(formatBasisPoints(6000, "en")).toBe("60%");
    expect(formatBasisPoints(3333)).toBe(nb("33,33 %"));
    expect(formatBasisPoints(1250, "en")).toBe("12.5%");
  });
});
