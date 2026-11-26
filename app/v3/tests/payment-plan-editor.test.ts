import { describe, expect, test } from "bun:test";
import type { Payment } from "../src/domain/payment-plan.ts";
import {
  addPayment,
  amountForShare,
  balanceLast,
  difference,
  equalSplit,
  initialPlan,
  parseShare,
  planComplete,
  removePayment,
  resplit,
  shareForAmount,
  shareText,
} from "../src/ui/components/forecast/plan-math.ts";

// 507 600,00 Kč in haléře.
const TOTAL = 50_760_000;
const TODAY = "2026-11-25";

describe("the arithmetic of the payment plan editor", () => {
  test("a share is typed in percent with two decimals and kept in basis points", () => {
    expect(parseShare("33,33", "cs")).toBe(3333);
    expect(parseShare("33.33", "en")).toBe(3333);
    expect(parseShare("50", "cs")).toBe(5000);
    expect(parseShare("12,345", "cs")).toBeNull();
    expect(parseShare("101", "cs")).toBeNull();
    expect(parseShare("", "cs")).toBeNull();
    expect(shareText(3333, "cs")).toBe("33,33");
    expect(shareText(3330, "en")).toBe("33.3");
    expect(shareText(5000, "cs")).toBe("50");
  });

  test("a share gives its amount and an amount its share, rounded half up", () => {
    expect(amountForShare(TOTAL, 3000)).toBe(15_228_000);
    expect(amountForShare(100, 3333)).toBe(33);
    expect(shareForAmount(15_228_000, TOTAL)).toBe(3000);
    expect(shareForAmount(1, 3)).toBe(3333);
    expect(shareForAmount(5, 0)).toBe(0);
  });

  test("a new plan is one payment of the whole value this month", () => {
    const plan = initialPlan(TOTAL, TODAY);
    expect(plan).toEqual({
      status: "planned",
      payments: [{ id: "p1", month: "2026-11", amount: TOTAL }],
    });
    expect(planComplete(plan, TOTAL)).toBe(true);
    expect(initialPlan(TOTAL, TODAY, true).reverseCharge).toBe(true);
  });

  test("a split always sums to the value and keeps what the rows know", () => {
    const first: Payment[] = [
      { id: "p1", month: "2026-12", amount: TOTAL, label: "Záloha", invoicedOn: "2026-12-01" },
    ];
    const split = resplit(first, TOTAL, [3000, 4000, 3000], "2026-11");
    expect(split.map((entry) => entry.amount)).toEqual([15_228_000, 20_304_000, 15_228_000]);
    expect(split.map((entry) => entry.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(split[0]).toMatchObject({ id: "p1", label: "Záloha", invoicedOn: "2026-12-01" });
    expect(new Set(split.map((entry) => entry.id)).size).toBe(3);
    const thirds = equalSplit(first, 100, 3, "2026-11");
    expect(thirds.map((entry) => entry.amount)).toEqual([33, 33, 34]);
    expect(equalSplit(first, 100, 40, "2026-11")).toHaveLength(12);
    expect(equalSplit([], 100, 2, "2026-11")[0]?.month).toBe("2026-11");
  });

  test("rows are added with what is missing and removed down to one", () => {
    const one: Payment[] = [{ id: "p1", month: "2026-11", amount: 60 }];
    const two = addPayment(one, 100, TODAY);
    expect(two[1]).toEqual({ id: "p2", month: "2026-12", amount: 40 });
    const over = addPayment([{ id: "p1", month: "2026-11", amount: 120 }], 100, TODAY);
    expect(over[1]?.amount).toBe(0);
    expect(addPayment([], 100, TODAY)).toEqual([{ id: "p1", month: "2026-11", amount: 100 }]);
    expect(removePayment(two, 0)).toEqual([{ id: "p2", month: "2026-12", amount: 40 }]);
    expect(removePayment(one, 0)).toEqual(one);
  });

  test("the difference and „Dorovnat poslední“", () => {
    const rows: Payment[] = [
      { id: "p1", month: "2026-11", amount: 30 },
      { id: "p2", month: "2026-12", amount: 30 },
    ];
    expect(difference(rows, 100)).toBe(40);
    expect(balanceLast(rows, 100).map((entry) => entry.amount)).toEqual([30, 70]);
    // The others alone exceed the total: nothing to balance.
    expect(balanceLast(rows, 20)).toEqual(rows);
    expect(difference(balanceLast(rows, 100), 100)).toBe(0);
  });

  test("a plan is complete only when planned and summing exactly to the value", () => {
    const rows: Payment[] = [
      { id: "p1", month: "2026-11", amount: 50 },
      { id: "p2", month: "2026-12", amount: 50 },
    ];
    expect(planComplete({ status: "planned", payments: rows }, 100)).toBe(true);
    expect(planComplete({ status: "planned", payments: rows }, 101)).toBe(false);
    expect(planComplete({ status: "unassigned", payments: rows }, 100)).toBe(false);
    expect(planComplete({ status: "planned", payments: [] }, 0)).toBe(false);
    expect(
      planComplete(
        { status: "planned", payments: [{ id: "p1", month: "2026-13", amount: 100 }] },
        100,
      ),
    ).toBe(false);
  });
});
