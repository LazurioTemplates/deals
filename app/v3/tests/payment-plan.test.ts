import { describe, expect, test } from "bun:test";
import {
  addMonths,
  equalShares,
  isSettled,
  nextPaymentId,
  type Payment,
  paymentState,
  plannedTotal,
  shareOfValue,
  singlePayment,
  splitValue,
  withInvoice,
  withPaid,
} from "../src/domain/payment-plan.ts";

const payment: Payment = { id: "p1", month: "2026-12", amount: 1_000_000 };

describe("splitting a value into payments", () => {
  test("every payment but the last is its share half up; the last takes the rest", () => {
    expect(splitValue(50_760_000, [3000, 3000, 4000], "2026-10")).toEqual([
      { id: "p1", month: "2026-10", amount: 15_228_000 },
      { id: "p2", month: "2026-11", amount: 15_228_000 },
      { id: "p3", month: "2026-12", amount: 20_304_000 },
    ]);
    // Thirds of 100 haléřů: 33,34 → 33, 33,33 → 33, the rest 34; across the year.
    const thirds = splitValue(100, equalShares(3), "2026-11");
    expect(thirds.map((entry) => [entry.month, entry.amount])).toEqual([
      ["2026-11", 33],
      ["2026-12", 33],
      ["2027-01", 34],
    ]);
    // Half of one haléř is 0,5 → 1, so the rest is 0.
    expect(splitValue(1, [5000, 5000], "2026-01").map((entry) => entry.amount)).toEqual([1, 0]);
    // The amounts always sum to the value.
    for (const value of [1, 99, 1_000_001, 7_300_010]) {
      for (const count of [1, 2, 3, 7, 12]) {
        expect(plannedTotal({ payments: splitValue(value, equalShares(count), "2026-01") })).toBe(
          value,
        );
      }
    }
  });

  test("a plan has 1 to 12 payments", () => {
    expect(() => splitValue(100, [], "2026-01")).toThrow(RangeError);
    expect(() => splitValue(100, equalShares(13), "2026-01")).toThrow(RangeError);
    expect(singlePayment(5_830_000, "2026-12")).toEqual({
      status: "planned",
      payments: [{ id: "p1", month: "2026-12", amount: 5_830_000 }],
    });
  });

  test("equal shares of 10 000 basis points; a share of a value", () => {
    expect(equalShares(3)).toEqual([3334, 3333, 3333]);
    expect(equalShares(4)).toEqual([2500, 2500, 2500, 2500]);
    expect(equalShares(7).reduce((sum, share) => sum + share, 0)).toBe(10_000);
    expect(shareOfValue(15_228_000, 50_760_000)).toBe(3000);
    expect(shareOfValue(1, 3)).toBe(3333);
    expect(shareOfValue(2, 3)).toBe(6667);
    expect(shareOfValue(5, 0)).toBe(0);
  });

  test("months forward and back across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
    expect(addMonths("2026-05", 24)).toBe("2028-05");
  });

  test("a free payment id", () => {
    expect(nextPaymentId([{ id: "p1" }, { id: "p2" }])).toBe("p3");
    expect(nextPaymentId([{ id: "p1" }, { id: "p3" }])).toBe("p4");
    expect(nextPaymentId([])).toBe("p1");
  });
});

describe("the state of a payment", () => {
  test("planned, invoiced, overdue after its due date, paid", () => {
    const today = "2026-11-25";
    expect(paymentState(payment, today)).toBe("planned");
    expect(paymentState({ invoicedOn: "2026-11-20", dueOn: "2026-12-04" }, today)).toBe("invoiced");
    // Due today is not overdue yet.
    expect(paymentState({ invoicedOn: "2026-11-11", dueOn: today }, today)).toBe("invoiced");
    expect(paymentState({ invoicedOn: "2026-11-10", dueOn: "2026-11-24" }, today)).toBe("overdue");
    expect(paymentState({ invoicedOn: "2026-11-10" }, today)).toBe("invoiced");
    expect(
      paymentState({ invoicedOn: "2026-11-10", dueOn: "2026-11-24", paidOn: today }, today),
    ).toBe("paid");
    expect(isSettled(payment)).toBe(false);
    expect(isSettled({ ...payment, invoicedOn: today })).toBe(true);
    expect(isSettled({ ...payment, paidOn: today })).toBe(true);
  });

  test("an invoice sets its due date; taking it back takes the payment too", () => {
    const invoiced = withInvoice(payment, "2026-11-25", 14);
    expect(invoiced).toEqual({ ...payment, invoicedOn: "2026-11-25", dueOn: "2026-12-09" });
    // Invoiced again on another day: the due date follows.
    expect(withInvoice(invoiced, "2026-12-30", 30)).toMatchObject({
      invoicedOn: "2026-12-30",
      dueOn: "2027-01-29",
    });
    const paid = withPaid(invoiced, "2026-12-01", 14);
    expect(withInvoice(paid, null, 14)).toEqual(payment);
  });

  test("paid without an invoice is invoiced the same day; taking it back keeps the invoice", () => {
    expect(withPaid(payment, "2026-11-25", 14)).toEqual({
      ...payment,
      invoicedOn: "2026-11-25",
      dueOn: "2026-12-09",
      paidOn: "2026-11-25",
    });
    const invoiced = withInvoice(payment, "2026-11-01", 14);
    const paid = withPaid(invoiced, "2026-11-20", 30);
    expect(paid).toEqual({ ...invoiced, paidOn: "2026-11-20" });
    expect(withPaid(paid, null, 14)).toEqual(invoiced);
  });
});
