import { describe, expect, test } from "bun:test";
import { lineAmount } from "../src/domain/money.ts";
import {
  latestRevisions,
  nextLineId,
  nextQuoteNumber,
  primaryQuote,
  type Quote,
  type QuoteLine,
  quoteRevisionId,
  quoteTotals,
  termsBlocks,
  valueFromQuotes,
} from "../src/domain/quote.ts";
import { newQuote, sampleData } from "./support/seed.ts";

/** A quote of the given lines, everything else as `newQuote` has it. */
function quoteOf(lines: QuoteLine[], extra: Partial<Quote> = {}): Quote {
  return { ...newQuote(), lines, ...extra };
}

const line = (id: string, unitPrice: number, quantity: number, extra: Partial<QuoteLine> = {}) =>
  ({ id, sectionId: "items", name: id, unit: "ks", unitPrice, quantity, ...extra }) as QuoteLine;

describe("the totals of a quote", () => {
  test("each line is price × quantity less its discount, rounded half up once", () => {
    // 997 × 0,5 = 498,5 → 499 (to the even neighbour it would be 498).
    expect(lineAmount(997, 0.5)).toBe(499);
    // 333 × 1,5 = 499,5 → 500.
    expect(lineAmount(333, 1.5)).toBe(500);
    // 1 001 less 0,5 % = 995,995 → 996.
    expect(lineAmount(1001, 1, 50)).toBe(996);
    // A quantity with three decimals is counted in thousandths, never as a float.
    expect(lineAmount(100, 0.125)).toBe(13);
    expect(lineAmount(12_345, 3)).toBe(37_035);
  });

  test("the sections and the subtotal are the sums of the rounded lines", () => {
    const totals = quoteTotals(
      quoteOf([
        line("l1", 997, 0.5),
        line("l2", 997, 0.5),
        line("l3", 85_000, 16, { sectionId: "work" }),
      ]),
    );
    // Rounded line by line: 499 + 499; the unrounded sum would be 997.
    expect(totals.lines).toEqual({ l1: 499, l2: 499, l3: 1_360_000 });
    expect(totals.sections).toEqual([
      { sectionId: "items", label: "Dodávka", count: 2, amount: 998 },
      { sectionId: "work", label: "Práce", count: 1, amount: 1_360_000 },
    ]);
    expect(totals.subtotal).toBe(1_360_998);
  });

  test("VAT is one rate of the subtotal, rounded half up", () => {
    // 21 % of 50 = 10,5 → 11 (to the even neighbour it would be 10).
    expect(quoteTotals(quoteOf([line("l1", 50, 1)]))).toMatchObject({
      subtotal: 50,
      vat: 11,
      total: 61,
    });
    // 12 % of 1 234 = 148,08 → 148.
    expect(quoteTotals(quoteOf([line("l1", 1234, 1)], { vatRate: 1200 }))).toMatchObject({
      vat: 148,
      total: 1382,
    });
    // VAT of the subtotal, not line by line: 21 % of 3 × 50 = 31,5 → 32, not 3 × 11 = 33.
    const three = quoteTotals(quoteOf([line("l1", 50, 1), line("l2", 50, 1), line("l3", 50, 1)]));
    expect(three).toMatchObject({ subtotal: 150, vat: 32, total: 182 });
  });

  test("with reverse charge the customer accounts for the VAT", () => {
    const totals = quoteTotals(quoteOf([line("l1", 1_000_000, 2)], { reverseCharge: true }));
    expect(totals).toMatchObject({ subtotal: 2_000_000, vat: 0, total: 2_000_000 });
  });

  test("the reserve for changes is for planning only; the discount is what lines take off", () => {
    const totals = quoteTotals(
      quoteOf([line("l1", 1_290_000, 20, { discount: 500 }), line("l2", 85_000, 2)], {
        changeReserve: 1_500_000,
      }),
    );
    // 25 800 000 less 5 % = 24 510 000; plus 170 000.
    expect(totals.subtotal).toBe(24_680_000);
    expect(totals.discount).toBe(1_290_000);
    expect(totals.total).toBe(24_680_000 + 5_182_800);
    expect(totals.planning).toBe(24_680_000 + 1_500_000);
  });

  test("an empty quote is zero everywhere; a section without a line is left out", () => {
    expect(quoteTotals(quoteOf([]))).toEqual({
      lines: {},
      sections: [],
      subtotal: 0,
      vat: 0,
      total: 0,
      planning: 0,
      discount: 0,
    });
  });

  test("the sample's revised quote, counted by hand", () => {
    const quote = sampleData().quotes.find((entry) => entry.id === "Q-2026-0001-r2");
    if (!quote) throw new Error("Q-2026-0001-r2 missing");
    // Desks and chairs 20 × (12 900 + 6 900) Kč less 5 % = 376 200 Kč; work
    // 16 h × 850 Kč + 120 km × 35 Kč = 17 800 Kč; 21 % VAT; a reserve of 15 000 Kč.
    expect(quoteTotals(quote)).toMatchObject({
      subtotal: 39_400_000,
      vat: 8_274_000,
      total: 47_674_000,
      planning: 40_900_000,
      discount: 1_980_000,
    });
    expect(
      quoteTotals(quote).sections.map((section) => [section.sectionId, section.amount]),
    ).toEqual([
      ["items", 37_620_000],
      ["work", 1_780_000],
    ]);
  });
});

describe("the quote a deal follows", () => {
  const sample = sampleData();
  const deal = (id: string, primaryQuoteId?: string) => ({
    id,
    ...(primaryQuoteId ? { primaryQuoteId } : {}),
  });

  test("the named one, else the approved one, else the newest live revision", () => {
    // D-2026-0002: r1 superseded, r2 active.
    expect(primaryQuote(deal("D-2026-0002"), sample.quotes)?.id).toBe("Q-2026-0001-r2");
    expect(primaryQuote(deal("D-2026-0002", "Q-2026-0001-r1"), sample.quotes)?.id).toBe(
      "Q-2026-0001-r1",
    );
    // A named quote of another deal is not this deal's: the rule reports it.
    expect(primaryQuote(deal("D-2026-0002", "Q-2026-0002-r1"), sample.quotes)?.id).toBe(
      "Q-2026-0001-r2",
    );
    // An older approved quote wins over a newer draft.
    const approved = sample.quotes.map((entry) =>
      entry.id === "Q-2026-0001-r1" ? { ...entry, status: "approved" as const } : entry,
    );
    expect(primaryQuote(deal("D-2026-0002"), approved)?.id).toBe("Q-2026-0001-r1");
    // Nothing live: the newest of any status.
    const cancelled = sample.quotes.map((entry) =>
      entry.dealId === "D-2026-0002" ? { ...entry, status: "cancelled" as const } : entry,
    );
    expect(primaryQuote(deal("D-2026-0002"), cancelled)?.id).toBe("Q-2026-0001-r2");
    expect(primaryQuote(deal("D-2026-0001"), sample.quotes)).toBeUndefined();
  });

  test("the deal's value is the primary quote's subtotal once it has a line", () => {
    expect(valueFromQuotes(deal("D-2026-0002"), sample.quotes)).toBe(39_400_000);
    expect(valueFromQuotes(deal("D-2026-0002", "Q-2026-0001-r1"), sample.quotes)).toBe(40_960_000);
    expect(valueFromQuotes(deal("D-2026-0001"), sample.quotes)).toBeUndefined();
    // A quote without a line leaves the deal its own value.
    const empty = { ...newQuote("Q-2026-0009-r1"), lines: [] };
    expect(valueFromQuotes(deal("D-2026-0001"), [empty])).toBeUndefined();
    // Every deal of the sample with a quote has its value.
    for (const entry of sample.deals) {
      const value = valueFromQuotes(entry, sample.quotes);
      if (value !== undefined)
        expect({ id: entry.id, value }).toEqual({ id: entry.id, value: entry.value });
    }
  });

  test("the latest revision of every quote number, newest first", () => {
    expect(latestRevisions(sample.quotes).map((entry) => entry.id)).toEqual([
      "Q-2026-0003-r1",
      "Q-2026-0002-r1",
      "Q-2026-0001-r2",
      "Q-2026-0006-r1",
      "Q-2026-0005-r1",
      "Q-2026-0004-r1",
    ]);
  });
});

describe("numbers, revisions and terms", () => {
  test("the next quote number of a year, a revision's id and a free line id", () => {
    const numbers = sampleData().quotes.map((entry) => entry.number);
    expect(nextQuoteNumber(2026, numbers)).toBe("Q-2026-0007");
    expect(nextQuoteNumber("2027", numbers)).toBe("Q-2027-0001");
    expect(quoteRevisionId("Q-2026-0001", 3)).toBe("Q-2026-0001-r3");
    expect(nextLineId([{ id: "l1" }, { id: "l3" }])).toBe("l4");
    expect(nextLineId([{ id: "l2" }])).toBe("l3");
    expect(nextLineId([])).toBe("l1");
  });

  test("terms are plain text with headings, bullets and paragraphs", () => {
    expect(
      termsBlocks(
        "## Platby\n- Záloha 50 %\n- Doplatek 50 %\n\nSplatnost je\n14 dní.\n• Jinak\nKonec",
      ),
    ).toEqual([
      { kind: "heading", text: "Platby" },
      { kind: "list", items: ["Záloha 50 %", "Doplatek 50 %"] },
      { kind: "paragraph", text: "Splatnost je 14 dní." },
      { kind: "list", items: ["Jinak"] },
      { kind: "paragraph", text: "Konec" },
    ]);
    expect(termsBlocks(undefined)).toEqual([]);
    expect(termsBlocks("")).toEqual([]);
  });
});
