import {
  type Change,
  type DealsStore,
  type Revision,
  type Stored,
  StoreError,
} from "../data/store.ts";
import { type Activity, nextActivityId } from "../domain/activity.ts";
import { addDays, localToday } from "../domain/common.ts";
import { type Company, nextCompanyId } from "../domain/company.ts";
import { type Contact, nextContactId } from "../domain/contact.ts";
import { type Deal, nextDealId } from "../domain/deal.ts";
import { type Forecast, type ForecastFilter, forecast } from "../domain/forecast.ts";
import {
  type ForecastEntry,
  type ForecastNote,
  nextForecastEntryId,
} from "../domain/forecast-entry.ts";
import { type Payment, type PaymentPlan, withInvoice, withPaid } from "../domain/payment-plan.ts";
import { nextPricebookItemId, type PricebookItem } from "../domain/pricebook.ts";
import {
  nextQuoteNumber,
  type Quote,
  type QuoteStatus,
  quoteRevisionId,
  valueFromQuotes,
} from "../domain/quote.ts";
import { nextSalespersonId, type Salesperson } from "../domain/salesperson.ts";
import { type Settings, stageById } from "../domain/settings.ts";
import { type Stats, type StatsFilter, type StatsPeriod, stats } from "../domain/stats.ts";

/**
 * The operations of Deals over the storage port, shared by the HTTP API, the
 * tools for agents and the command line. Each one reads what it needs, gives
 * a new record its id and saves a draft; none of them publishes.
 *
 * New records get the next free id, a deal moves through the stages with
 * what closing it needs, a deal's value follows its primary quote, and the
 * forecast and the statistics are computed from one consistent read.
 */
export interface ServiceOptions {
  /** Today's date for new records and the forecast; injectable for tests. */
  today?: () => string;
}

type Audit = "revision" | "updatedAt" | "updatedBy";
export type NewCompany = Omit<Company, "id" | Audit>;
export type NewContact = Omit<Contact, "id" | Audit>;
export type NewSalesperson = Omit<Salesperson, "id" | Audit>;
export type NewPricebookItem = Omit<PricebookItem, "id" | Audit>;
export type NewForecastEntry = Omit<ForecastEntry, "id" | Audit>;
export type NewDeal = Omit<Deal, "id" | "createdAt" | Audit> & {
  createdAt?: string | undefined;
};
export type NewActivity = Omit<Activity, "id" | Audit>;

/**
 * A move of a deal to another stage. Won asks for the value, the day it was
 * won and how it is invoiced (a payment plan, else it waits unassigned in the
 * forecast); lost for the reason, the day and an optional note; a move to an
 * open stage reopens a closed deal and forgets what closing it said.
 */
export interface StageMove {
  stageId: string;
  baseRevision: Revision;
  value?: number | undefined;
  closedAt?: string | undefined;
  lossReasonId?: string | undefined;
  lossNote?: string | undefined;
  paymentPlan?: PaymentPlan | undefined;
}

/** A change of one payment's invoice or payment: a day, or `null` to take it back. */
export interface PaymentChange {
  baseRevision: Revision;
  invoicedOn?: string | null | undefined;
  paidOn?: string | null | undefined;
}

/** What a new quote may set beyond what it takes from its deal. */
export interface NewQuote {
  dealId: string;
  title?: string | undefined;
  /** Copy the lines of the price list items (`I-0001`) into the first sections. */
  pricebookItemIds?: string[] | undefined;
}

/** The default period of the statistics: the last 90 days up to today, both included. */
export function lastDays(today: string, days = 90): StatsPeriod {
  return { from: addDays(today, -(days - 1)), to: today };
}

const ids = (entries: readonly Stored<{ id: string }>[]) => entries.map((entry) => entry.value.id);

const notFound = (cs: string, en: string) => new StoreError("not_found", { cs, en });

export function createService(store: DealsStore, options: ServiceOptions = {}) {
  const today = options.today ?? (() => localToday());

  async function requireDeal(id: string): Promise<Stored<Deal>> {
    const found = await store.getDeal(id);
    if (!found)
      throw notFound(`Obchodní případ ${id} neexistuje.`, `The deal ${id} does not exist.`);
    return found;
  }

  async function requireQuote(id: string): Promise<Stored<Quote>> {
    const found = await store.get("quotes", id);
    if (!found) throw notFound(`Nabídka ${id} neexistuje.`, `The quote ${id} does not exist.`);
    return found;
  }

  /**
   * Saves quotes and, in the same write, the deal whose value follows them:
   * the deal's value becomes its primary quote's subtotal once that quote
   * has a line.
   */
  async function saveQuotes(
    changes: { value: Quote; baseRevision: Revision | null }[],
    dealPatch?: (deal: Deal) => Deal,
  ): Promise<Stored<Quote>[]> {
    const dealId = changes[0]?.value.dealId;
    if (!dealId) return [];
    const [deal, quotes] = await Promise.all([requireDeal(dealId), store.list("quotes")]);
    const merged = new Map(quotes.map((entry) => [entry.value.id, entry.value]));
    for (const change of changes) merged.set(change.value.id, change.value);
    let next = dealPatch ? dealPatch(deal.value) : deal.value;
    const value = valueFromQuotes(next, [...merged.values()]);
    if (value !== undefined && value !== next.value) next = { ...next, value };
    const writes: Change[] = changes.map((change) => ({
      collection: "quotes" as const,
      value: change.value,
      baseRevision: change.baseRevision,
    }));
    if (next !== deal.value) {
      writes.push({ collection: "deals", value: next, baseRevision: deal.revision });
    }
    const saved = await store.saveAll(writes);
    return saved.slice(0, changes.length) as Stored<Quote>[];
  }

  function dueDaysOf(settings: Settings, company: Company | undefined): number {
    return company?.paymentDueDays ?? settings.paymentDueDays;
  }

  function applyChange(value: Payment, change: PaymentChange, dueDays: number): Payment {
    let next = value;
    if (change.invoicedOn !== undefined) next = withInvoice(next, change.invoicedOn, dueDays);
    if (change.paidOn !== undefined) next = withPaid(next, change.paidOn, dueDays);
    return next;
  }

  return {
    async createCompany(input: NewCompany): Promise<Stored<Company>> {
      const id = nextCompanyId(ids(await store.listCompanies()));
      return store.saveCompany({ id, ...input }, null);
    },

    async createContact(input: NewContact): Promise<Stored<Contact>> {
      const id = nextContactId(ids(await store.listContacts()));
      return store.saveContact({ id, ...input }, null);
    },

    async createSalesperson(input: NewSalesperson): Promise<Stored<Salesperson>> {
      const id = nextSalespersonId(ids(await store.list("salespeople")));
      return store.save("salespeople", { id, ...input }, null);
    },

    async createPricebookItem(input: NewPricebookItem): Promise<Stored<PricebookItem>> {
      const id = nextPricebookItemId(ids(await store.list("pricebook")));
      return store.save("pricebook", { id, ...input }, null);
    },

    /** A new deal, numbered in the year it is created: `D-2026-0015`. */
    async createDeal(input: NewDeal): Promise<Stored<Deal>> {
      const createdAt = input.createdAt ?? today();
      const id = nextDealId(createdAt.slice(0, 4), ids(await store.listDeals()));
      return store.saveDeal({ ...input, id, createdAt }, null);
    },

    /** A new activity, numbered in the year it happens: `A-2026-00021`. */
    async logActivity(input: NewActivity): Promise<Stored<Activity>> {
      const id = nextActivityId(input.at.slice(0, 4), ids(await store.listActivities()));
      return store.saveActivity({ id, ...input }, null);
    },

    /** Saves a deal; while it has a quote with a line, its value follows the primary quote. */
    async saveDeal(value: Deal, baseRevision: Revision): Promise<Stored<Deal>> {
      const quotes = (await store.list("quotes")).map((entry) => entry.value);
      const followed = valueFromQuotes(value, quotes);
      return store.saveDeal(
        followed === undefined ? value : { ...value, value: followed },
        baseRevision,
      );
    },

    /** Moves a deal to another stage; the rules refuse a won deal without a value. */
    async moveDeal(id: string, move: StageMove): Promise<Stored<Deal>> {
      const [settings, current] = await Promise.all([store.settings(), requireDeal(id)]);
      const stage = stageById(settings.value, move.stageId);
      if (!stage) {
        throw new StoreError("invalid_record", {
          cs: `Fáze ${move.stageId} neexistuje.`,
          en: `The stage ${move.stageId} does not exist.`,
        });
      }
      const {
        closedAt: _closedAt,
        lossReasonId: _reason,
        lossNote: _note,
        paymentPlan: _plan,
        ...open
      } = current.value;
      const next: Deal = { ...open, stageId: stage.id };
      if (stage.kind === "won") {
        next.value = move.value ?? current.value.value;
        next.closedAt = move.closedAt ?? current.value.closedAt ?? today();
        next.paymentPlan = move.paymentPlan ??
          current.value.paymentPlan ?? { status: "unassigned", payments: [] };
      }
      if (stage.kind === "lost") {
        next.closedAt = move.closedAt ?? today();
        if (move.lossReasonId !== undefined) next.lossReasonId = move.lossReasonId;
        if (move.lossNote?.trim()) next.lossNote = move.lossNote.trim();
      }
      return store.saveDeal(next, move.baseRevision);
    },

    /** Plans how a won deal is invoiced, or puts it back among the unassigned. */
    async planPayments(id: string, plan: PaymentPlan, baseRevision: Revision) {
      const current = await requireDeal(id);
      return store.saveDeal({ ...current.value, paymentPlan: plan }, baseRevision);
    },

    /**
     * Marks a payment of a won deal invoiced or paid on a day, or takes it
     * back; the due date follows from the company's days, else the settings'.
     */
    async changePayment(dealId: string, paymentId: string, change: PaymentChange) {
      const [settings, current] = await Promise.all([store.settings(), requireDeal(dealId)]);
      const plan = current.value.paymentPlan;
      const found = plan?.payments.find((entry) => entry.id === paymentId);
      if (!plan || !found) {
        throw notFound(
          `Platba ${paymentId} v případu ${dealId} neexistuje.`,
          `The payment ${paymentId} of the deal ${dealId} does not exist.`,
        );
      }
      const company = (await store.getCompany(current.value.companyId))?.value;
      const days = dueDaysOf(settings.value, company);
      const payments = plan.payments.map((entry) =>
        entry.id === paymentId ? applyChange(entry, change, days) : entry,
      );
      return store.saveDeal(
        { ...current.value, paymentPlan: { ...plan, payments } },
        change.baseRevision,
      );
    },

    /** A manual row of the forecast, numbered in the year of its month: `F-2026-0003`. */
    async createForecastEntry(input: NewForecastEntry): Promise<Stored<ForecastEntry>> {
      const id = nextForecastEntryId(
        input.month.slice(0, 4),
        ids(await store.list("forecastEntries")),
      );
      return store.save("forecastEntries", { id, ...input }, null);
    },

    /** Marks a manual forecast row invoiced or paid, like a payment. */
    async changeForecastEntry(id: string, change: PaymentChange) {
      const [settings, current] = await Promise.all([
        store.settings(),
        store.get("forecastEntries", id),
      ]);
      if (!current) {
        throw notFound(
          `Řádek forecastu ${id} neexistuje.`,
          `The forecast row ${id} does not exist.`,
        );
      }
      const company = current.value.companyId
        ? (await store.getCompany(current.value.companyId))?.value
        : undefined;
      const days = dueDaysOf(settings.value, company);
      const { invoicedOn, dueOn, paidOn } = applyChange(
        {
          id: "p1",
          month: current.value.month,
          amount: current.value.amount,
          ...pickDates(current.value),
        },
        change,
        days,
      );
      const { invoicedOn: _i, dueOn: _d, paidOn: _p, ...rest } = current.value;
      return store.save(
        "forecastEntries",
        {
          ...rest,
          ...(invoicedOn ? { invoicedOn } : {}),
          ...(dueOn ? { dueOn } : {}),
          ...(paidOn ? { paidOn } : {}),
        },
        change.baseRevision,
      );
    },

    /** Writes the note of a month of the forecast; an empty text removes it. */
    async saveForecastNote(
      month: string,
      text: string,
      baseRevision: Revision | null,
    ): Promise<Stored<ForecastNote> | null> {
      if (text.trim() === "") {
        if (baseRevision !== null) await store.remove("forecastNotes", month, baseRevision);
        return null;
      }
      return store.save("forecastNotes", { id: month, text: text.trim() }, baseRevision);
    },

    /**
     * A new quote of a deal, numbered in the year it is written: revision 1
     * of `Q-2026-0004`, as a draft, with the customer copied from the deal's
     * company and the defaults of the settings.
     */
    async createQuote(input: NewQuote): Promise<Stored<Quote>> {
      const [settings, deal, quotes, items] = await Promise.all([
        store.settings(),
        requireDeal(input.dealId),
        store.list("quotes"),
        store.list("pricebook"),
      ]);
      const defaults = settings.value.quotes;
      const company = (await store.getCompany(deal.value.companyId))?.value;
      const issuedOn = today();
      const number = nextQuoteNumber(
        issuedOn.slice(0, 4),
        quotes.map((entry) => entry.value.number),
      );
      const firstSection = defaults.sections[0]?.id ?? "items";
      const lines = (input.pricebookItemIds ?? []).flatMap((itemId, index) => {
        const item = items.find((entry) => entry.value.id === itemId)?.value;
        if (!item) return [];
        const sectionId = defaults.sections.some((section) => section.id === item.sectionId)
          ? (item.sectionId as string)
          : firstSection;
        return [
          {
            id: `l${index + 1}`,
            sectionId,
            pricebookItemId: item.id,
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
            quantity: 1,
            unit: item.unit,
            unitPrice: item.unitPrice,
          },
        ];
      });
      const entity = deal.value.billingEntityId ?? settings.value.billingEntities?.[0]?.id;
      const value: Quote = {
        id: quoteRevisionId(number, 1),
        number,
        version: 1,
        dealId: deal.value.id,
        status: "draft",
        title: input.title?.trim() || deal.value.title,
        issuedOn,
        validUntil: addDays(issuedOn, defaults.validityDays),
        currency: settings.value.currency,
        ...(entity ? { billingEntityId: entity } : {}),
        customer: {
          ...(company ? { companyId: company.id } : {}),
          name: company?.name ?? deal.value.title,
          ...(company?.ico ? { ico: company.ico } : {}),
          ...(company?.dic ? { dic: company.dic } : {}),
          ...(company?.address ? { address: company.address } : {}),
        },
        ...(deal.value.contactIds?.[0] ? { contactId: deal.value.contactIds[0] } : {}),
        vatRate: defaults.vatRate,
        sections: structuredClone(defaults.sections),
        lines,
        ...(defaults.terms ? { terms: structuredClone(defaults.terms) } : {}),
        ...(defaults.termsVersion || defaults.termsUrl
          ? {
              commercialTerms: {
                customerScope: "unresolved" as const,
                ...(defaults.termsVersion ? { termsVersion: defaults.termsVersion } : {}),
                ...(defaults.termsUrl ? { termsUrl: defaults.termsUrl } : {}),
              },
            }
          : {}),
      };
      const [saved] = await saveQuotes([{ value, baseRevision: null }]);
      return saved as Stored<Quote>;
    },

    /** Saves a quote; its deal's value follows when it is the primary quote. */
    async saveQuote(value: Quote, baseRevision: Revision): Promise<Stored<Quote>> {
      const [saved] = await saveQuotes([{ value, baseRevision }]);
      return saved as Stored<Quote>;
    },

    /**
     * The next revision of a quote, as a draft copied from its latest
     * revision; an active latest revision becomes superseded.
     */
    async reviseQuote(id: string): Promise<Stored<Quote>> {
      const [settings, source, quotes] = await Promise.all([
        store.settings(),
        requireQuote(id),
        store.list("quotes"),
      ]);
      const family = quotes.filter((entry) => entry.value.number === source.value.number);
      const latest = family.reduce((best, entry) =>
        entry.value.version > best.value.version ? entry : best,
      );
      const issuedOn = today();
      const { sentOn: _sent, approvedOn: _approved, ...copy } = structuredClone(latest.value);
      const version = latest.value.version + 1;
      const next: Quote = {
        ...copy,
        id: quoteRevisionId(latest.value.number, version),
        version,
        status: "draft",
        issuedOn,
        validUntil: addDays(issuedOn, settings.value.quotes.validityDays),
      };
      const changes: { value: Quote; baseRevision: Revision | null }[] = [
        { value: next, baseRevision: null },
      ];
      if (latest.value.status === "active") {
        changes.push({
          value: { ...latest.value, status: "superseded" },
          baseRevision: latest.revision,
        });
      }
      const [saved] = await saveQuotes(changes, (deal) =>
        deal.primaryQuoteId === latest.value.id ? { ...deal, primaryQuoteId: next.id } : deal,
      );
      return saved as Stored<Quote>;
    },

    /**
     * Changes the status of a quote: active records the day it was sent,
     * approved the day it was approved and makes it the deal's primary quote.
     */
    async setQuoteStatus(
      id: string,
      status: QuoteStatus,
      baseRevision: Revision,
    ): Promise<Stored<Quote>> {
      const current = await requireQuote(id);
      const next: Quote = { ...current.value, status };
      if (status === "active" && !next.sentOn) next.sentOn = today();
      if (status === "approved" && !next.approvedOn) next.approvedOn = today();
      const [saved] = await saveQuotes([{ value: next, baseRevision }], (deal) => {
        if (status === "approved") return { ...deal, primaryQuoteId: id };
        if (deal.primaryQuoteId === id && (status === "superseded" || status === "cancelled")) {
          const { primaryQuoteId: _primary, ...rest } = deal;
          return rest;
        }
        return deal;
      });
      return saved as Stored<Quote>;
    },

    async forecast(year?: number, filter?: ForecastFilter): Promise<Forecast> {
      return forecast(await store.readData(), { today: today(), year, filter });
    },

    /** The statistics of a period, the last 90 days by default. */
    async stats(period: StatsPeriod = lastDays(today()), filter?: StatsFilter): Promise<Stats> {
      return stats(await store.readData(), period, filter);
    },
  };
}

function pickDates(value: { invoicedOn?: string; dueOn?: string; paidOn?: string }) {
  return {
    ...(value.invoicedOn ? { invoicedOn: value.invoicedOn } : {}),
    ...(value.dueOn ? { dueOn: value.dueOn } : {}),
    ...(value.paidOn ? { paidOn: value.paidOn } : {}),
  };
}

export type DealsService = ReturnType<typeof createService>;
