import type { DealsStore, Stored } from "../data/store.ts";
import { type Activity, nextActivityId } from "../domain/activity.ts";
import { localToday } from "../domain/common.ts";
import { type Company, nextCompanyId } from "../domain/company.ts";
import { type Contact, nextContactId } from "../domain/contact.ts";
import { type Deal, nextDealId } from "../domain/deal.ts";
import { type Forecast, forecast } from "../domain/forecast.ts";
import { type Stats, type StatsPeriod, stats } from "../domain/stats.ts";

/**
 * The operations of Deals over the storage port, shared by the HTTP API, the
 * tools for agents and the command line. Each one reads what it needs, gives
 * a new record its id and saves a draft; none of them publishes.
 *
 * This first part holds what the data needs: new records get the next free
 * id, and the forecast and the statistics are computed from one consistent
 * read. The HTTP API and the tools build on it.
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

    async forecast(): Promise<Forecast> {
      return forecast(await store.readData(), { today: today() });
    },

    async stats(period: StatsPeriod): Promise<Stats> {
      return stats(await store.readData(), period);
    },
  };
}

export type DealsService = ReturnType<typeof createService>;
