import { describe, expect, test } from "bun:test";
import { changeText, monthShort, withoutZeroCents } from "../src/ui/components/charts/format.ts";
import {
  axisOf,
  bandsOf,
  barPath,
  columnPath,
  compactMoney,
  compactNumber,
  labelEvery,
  linePath,
  nearestIndex,
  niceStep,
  scaleOf,
} from "../src/ui/components/charts/geometry.ts";

describe("the geometry of the charts", () => {
  test("an axis reaches a clean number at or above the largest value", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(180)).toBe(200);
    expect(niceStep(230)).toBe(250);
    expect(niceStep(7)).toBe(10);
    expect(axisOf(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(axisOf(900)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] });
    // 3 deals: whole steps only.
    expect(axisOf(3, 4, true)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(axisOf(50_760_000).max).toBeGreaterThanOrEqual(50_760_000);
  });

  test("values scale from the baseline and never below it", () => {
    const axis = axisOf(1000);
    expect(scaleOf(500, axis, 200)).toBe(100);
    expect(scaleOf(-5, axis, 200)).toBe(0);
  });

  test("bars are capped at 24 px and centred in their band", () => {
    const wide = bandsOf(4, 2, 800);
    expect(wide.step).toBe(200);
    expect(wide.bar).toBe(24);
    // Two bars and a 2 px gap: 50 px, centred in the first band of 200.
    expect(wide.start(0)).toBe(75);
    const narrow = bandsOf(12, 2, 240);
    expect(narrow.bar).toBeLessThan(24);
    expect(narrow.start(0)).toBeGreaterThanOrEqual(0);
  });

  test("a column is rounded at its data end and square at the baseline", () => {
    expect(columnPath(0, 50, 20, 100)).toBe("M0,100 V54 Q0,50 4,50 H16 Q20,50 20,54 V100 Z");
    // Lower than the radius: rounded by its height.
    expect(columnPath(0, 98, 20, 100)).toBe("M0,100 V100 Q0,98 2,98 H18 Q20,98 20,100 V100 Z");
    expect(columnPath(0, 100, 20, 100)).toBe("");
    expect(barPath(0, 0, 0, 10)).toBe("");
    expect(barPath(0, 0, 50, 10)).toBe("M0,0 H46 Q50,0 50,4 V6 Q50,10 46,10 H0 Z");
    expect(
      linePath([
        [0, 10],
        [5.555, 2],
      ]),
    ).toBe("M0,10 L5.56,2");
  });

  test("labels thin out evenly and a pointer finds the nearest point", () => {
    expect(labelEvery(12, 12)).toBe(1);
    expect(labelEvery(13, 6)).toBe(3);
    expect(labelEvery(0, 6)).toBe(1);
    expect(nearestIndex(0, 90, 300)).toBe(0);
    expect(nearestIndex(300, 90, 300)).toBe(89);
    expect(nearestIndex(-20, 90, 300)).toBe(0);
    expect(nearestIndex(151, 3, 300)).toBe(1);
  });

  test("ticks are in full under 10 000 and compact above, in both languages", () => {
    expect(compactNumber(9000, "cs")).toBe("9 000");
    expect(compactNumber(9000, "en")).toBe("9,000");
    expect(compactNumber(12_500, "cs")).toBe("12,5 tis.");
    expect(compactNumber(12_500, "en")).toBe("12.5K");
    expect(compactNumber(3_000_000, "cs")).toBe("3 mil.");
    expect(compactNumber(1_240_000_000, "en")).toBe("1.2B");
    // Haléře: 507 600,00 Kč.
    expect(compactMoney(50_760_000, "cs")).toBe("507,6 tis.");
    expect(compactMoney(50_760_000, "en")).toBe("507.6K");
  });
});

describe("the words of the charts", () => {
  const rate = (basisPoints: number) => `${basisPoints / 100} %`;
  test("a change reads as up, down, equal or new", () => {
    expect(changeText(1250, rate, "cs")).toBe("▲ 12.5 %");
    expect(changeText(-300, rate, "cs")).toBe("▼ 3 %");
    expect(changeText(0, rate, "en")).toBe("= 0 %");
    expect(changeText(null, rate, "cs")).toBe("nové");
    expect(changeText(null, rate, "en")).toBe("new");
  });

  test("months and whole amounts", () => {
    expect(monthShort("2026-11", "cs")).toBe("lis 26");
    expect(monthShort("2026-11", "en", false)).toBe("Nov");
    expect(withoutZeroCents("1 234,00 Kč")).toBe("1 234 Kč");
    expect(withoutZeroCents("CZK 1,234.00")).toBe("CZK 1,234");
    expect(withoutZeroCents("1 234,50 Kč")).toBe("1 234,50 Kč");
  });
});
