import { type DealsStore, type Revision, type Stored, StoreError } from "../data/store.ts";
import { type Activity, nextActivityId } from "../domain/activity.ts";
import { addDays, localToday } from "../domain/common.ts";
import { type Company, nextCompanyId } from "../domain/company.ts";
import { type Contact, nextContactId } from "../domain/contact.ts";
import { type Deal, nextDealId } from "../domain/deal.ts";
import { type Forecast, forecast } from "../domain/forecast.ts";
import { stageById } from "../domain/settings.ts";
import { type Stats, type StatsPeriod, stats } from "../domain/stats.ts";

/**
 * The operations of Deals over the storage port, shared by the HTTP API, the
 * tools for agents and the command line. Each one reads what it needs, gives
 * a new record its id and saves a draft; none of them publishes.
 *
 * New records get the next free id, a deal moves through the stages with
 * what closing it needs, and the forecast and the statistics are computed
 * from one consistent read.
 */
export interface ServiceOptions {
  /** Today's date for new records and the forecast; injectable for tests. */
  today?: () => string;
}

export type NewCompany = Omit<Company, "id" | "revision" | "updatedAt" | "updatedBy">;
export type NewContact = Omit<Contact, "id" | "revision" | "updatedAt" | "updatedBy">;
export type NewDeal = Omit<Deal, "id" | "createdAt" | "revision" | "updatedAt" | "updatedBy"> & {
  createdAt?: string | undefined;
};
export type NewActivity = Omit<Activity, "id" | "revision" | "updatedAt" | "updatedBy">;

/**
 * A move of a deal to another stage. Won asks for the value and the day it
 * was won, lost for the reason, the day and an optional note; a move to an
 * open stage reopens a closed deal and forgets what closing it said.
 */
export interface StageMove {
  stageId: string;
  baseRevision: Revision;
  value?: number | undefined;
  closedAt?: string | undefined;
  lossReasonId?: string | undefined;
  lossNote?: string | undefined;
}

/** The default period of the statistics: the last 90 days up to today, both included. */
export function lastDays(today: string, days = 90): StatsPeriod {
  return { from: addDays(today, -(days - 1)), to: today };
}

const ids = (entries: readonly Stored<{ id: string }>[]) => entries.map((entry) => entry.value.id);

export function createService(store: DealsStore, options: ServiceOptions = {}) {
  const today = options.today ?? (() => localToday());

  return {
    async createCompany(input: NewCompany): Promise<Stored<Company>> {
      const id = nextCompanyId(ids(await store.listCompanies()));
      return store.saveCompany({ id, ...input }, null);
    },

    async createContact(input: NewContact): Promise<Stored<Contact>> {
      const id = nextContactId(ids(await store.listContacts()));
      return store.saveContact({ id, ...input }, null);
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

    /** Moves a deal to another stage; the rules refuse a won deal without a value. */
    async moveDeal(id: string, move: StageMove): Promise<Stored<Deal>> {
      const [settings, current] = await Promise.all([store.settings(), store.getDeal(id)]);
      if (!current) {
        throw new StoreError("not_found", {
          cs: `Obchodní případ ${id} neexistuje.`,
          en: `The deal ${id} does not exist.`,
        });
      }
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
        ...open
      } = current.value;
      const next: Deal = { ...open, stageId: stage.id };
      if (stage.kind === "won") {
        next.value = move.value ?? current.value.value;
        next.closedAt = move.closedAt ?? today();
      }
      if (stage.kind === "lost") {
        next.closedAt = move.closedAt ?? today();
        if (move.lossReasonId !== undefined) next.lossReasonId = move.lossReasonId;
        if (move.lossNote?.trim()) next.lossNote = move.lossNote.trim();
      }
      return store.saveDeal(next, move.baseRevision);
    },

    async forecast(): Promise<Forecast> {
      return forecast(await store.readData(), { today: today() });
    },

    /** The statistics of a period, the last 90 days by default. */
    async stats(period: StatsPeriod = lastDays(today())): Promise<Stats> {
      return stats(await store.readData(), period);
    },
  };
}

export type DealsService = ReturnType<typeof createService>;
