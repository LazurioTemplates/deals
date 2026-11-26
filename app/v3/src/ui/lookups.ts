import { useMemo } from "react";
import type { Deal } from "../domain/deal.ts";
import { primaryQuote, type Quote, quoteTotals } from "../domain/quote.ts";
import type { Salesperson } from "../domain/salesperson.ts";
import type { BillingEntity, DealType, Stage } from "../domain/settings.ts";
import type { AppData } from "./App.tsx";

/**
 * The names behind the ids a page shows: a salesperson, a company, a stage,
 * a deal type, a billing entity, a deal; and each deal's primary quote. One
 * place, so every page names a record the same way.
 */
export interface Lookups {
  salesperson: (id: string | undefined) => Salesperson | undefined;
  salespersonName: (id: string | undefined) => string;
  companyName: (id: string | undefined) => string;
  contactName: (id: string | undefined) => string;
  stage: (id: string) => Stage | undefined;
  dealType: (id: string | undefined) => DealType | undefined;
  billingEntity: (id: string | undefined) => BillingEntity | undefined;
  deal: (id: string | undefined) => Deal | undefined;
  /** The quotes of a deal, every revision, newest first. */
  quotesOf: (dealId: string) => Quote[];
  /** The quote a deal's value follows, if any. */
  primaryQuoteOf: (dealId: string) => Quote | undefined;
  /** The subtotal of a quote without VAT, cached. */
  quoteSubtotal: (quote: Quote) => number;
}

export function lookupsOf(data: AppData): Lookups {
  const salespeople = new Map(data.salespeople.map((entry) => [entry.value.id, entry.value]));
  const companies = new Map(data.companies.map((entry) => [entry.value.id, entry.value.name]));
  const contacts = new Map(data.contacts.map((entry) => [entry.value.id, entry.value.name]));
  const deals = new Map(data.deals.map((entry) => [entry.value.id, entry.value]));
  const settings = data.settings.value;
  const stages = new Map(settings.stages.map((stage) => [stage.id, stage]));
  const types = new Map((settings.dealTypes ?? []).map((entry) => [entry.id, entry]));
  const entities = new Map((settings.billingEntities ?? []).map((entry) => [entry.id, entry]));
  const quotes = data.quotes.map((entry) => entry.value);
  const byDeal = new Map<string, Quote[]>();
  for (const quote of quotes)
    byDeal.set(quote.dealId, [...(byDeal.get(quote.dealId) ?? []), quote]);
  for (const list of byDeal.values()) {
    list.sort(
      (left, right) =>
        right.issuedOn.localeCompare(left.issuedOn) ||
        right.number.localeCompare(left.number) ||
        right.version - left.version,
    );
  }
  const subtotals = new WeakMap<Quote, number>();
  return {
    salesperson: (id) => (id ? salespeople.get(id) : undefined),
    salespersonName: (id) => (id ? (salespeople.get(id)?.name ?? id) : ""),
    companyName: (id) => (id ? (companies.get(id) ?? id) : ""),
    contactName: (id) => (id ? (contacts.get(id) ?? id) : ""),
    stage: (id) => stages.get(id),
    dealType: (id) => (id ? types.get(id) : undefined),
    billingEntity: (id) => (id ? entities.get(id) : undefined),
    deal: (id) => (id ? deals.get(id) : undefined),
    quotesOf: (dealId) => byDeal.get(dealId) ?? [],
    primaryQuoteOf: (dealId) => {
      const deal = deals.get(dealId);
      return deal ? primaryQuote(deal, byDeal.get(dealId) ?? []) : undefined;
    },
    quoteSubtotal: (quote) => {
      const cached = subtotals.get(quote);
      if (cached !== undefined) return cached;
      const value = quoteTotals(quote).subtotal;
      subtotals.set(quote, value);
      return value;
    },
  };
}

/** The lookups of the App's data, rebuilt when the data changes. */
export function useLookups(data: AppData): Lookups {
  return useMemo(() => lookupsOf(data), [data]);
}

/** Per-viewer conveniences in the browser's storage; never data, never required. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window or blocked storage: the view simply is not remembered.
  }
}
