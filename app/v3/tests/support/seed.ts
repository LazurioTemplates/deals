import { DATA_REPO_TEMPLATE, seedDirectory } from "../../src/cli/paths.ts";
import { readDataDirectory } from "../../src/data/directory.ts";
import type { Activity } from "../../src/domain/activity.ts";
import type { DataSet } from "../../src/domain/collections.ts";
import type { Company } from "../../src/domain/company.ts";
import type { Contact } from "../../src/domain/contact.ts";
import type { Deal } from "../../src/domain/deal.ts";
import type { PricebookItem } from "../../src/domain/pricebook.ts";
import type { Quote } from "../../src/domain/quote.ts";
import type { Salesperson } from "../../src/domain/salesperson.ts";
import type { Settings } from "../../src/domain/settings.ts";
import type { Locale } from "../../src/i18n/locale.ts";

export { DATA_REPO_TEMPLATE, seedDirectory };

/** The day the tests take for today: the sample's numbers are counted from it. */
export const TODAY = "2026-11-25";

/** The fictional example records of a language, parsed; the tests' data. */
export function sampleData(locale: Locale = "cs"): DataSet & { settings: Settings } {
  const read = readDataDirectory(seedDirectory(locale, "sample"), TODAY);
  if (read.issues.length > 0 || !read.data.settings) {
    throw new Error(`invalid sample data: ${JSON.stringify(read.issues)}`);
  }
  return { ...read.data, settings: read.data.settings };
}

/** A new company that passes every rule of the sample. */
export function newCompany(id = "C-0007", name = "Nová Ukázka s.r.o."): Company {
  return { id, name, address: { city: "Brno", country: "Česká republika" } };
}

/** A new contact of the sample's company C-0001. */
export function newContact(id = "P-0011", name = "Nová Osoba"): Contact {
  return { id, name, email: "nova.osoba@ukazka-nabytek.example", companyId: "C-0001" };
}

/** A new open deal of the sample's company C-0001, owned by Jana Ukázková (`S-0001`). */
export function newDeal(id = "D-2026-0015"): Deal {
  return {
    id,
    title: "Vybavení recepce",
    companyId: "C-0001",
    contactIds: ["P-0001"],
    ownerId: "S-0001",
    stageId: "qualified",
    value: 6_400_000,
    createdAt: "2026-11-24",
    expectedClose: "2027-03-31",
  };
}

/** A new call on the sample's deal D-2026-0001. */
export function newActivity(id = "A-2026-00021"): Activity {
  return {
    id,
    dealId: "D-2026-0001",
    type: "call",
    at: "2026-11-24T10:00:00+01:00",
    summary: "Domluva termínu schůzky",
    contactIds: ["P-0002"],
  };
}

/** A new salesperson after the sample's three. */
export function newSalesperson(id = "S-0004", name = "Nová Obchodnice"): Salesperson {
  return { id, name, email: "nova.obchodnice@example.com", active: true };
}

/** A new item of the price list after the sample's eight. */
export function newPricebookItem(id = "I-0009"): PricebookItem {
  return {
    id,
    name: "Školení obsluhy",
    unit: "h",
    unitPrice: 250_000,
    sectionId: "work",
    active: true,
  };
}

/** A quote of the sample's deal D-2026-0001 with two lines, as a test builds on it. */
export function newQuote(id = "Q-2026-0007-r1"): Quote {
  const [number = "Q-2026-0007", version = "1"] = id.split("-r");
  return {
    id,
    number,
    version: Number(version),
    dealId: "D-2026-0001",
    status: "draft",
    title: "Vybavení zasedací místnosti",
    issuedOn: "2026-11-25",
    validUntil: "2026-12-25",
    currency: "CZK",
    customer: { companyId: "C-0001", name: "Ukázka Nábytek s.r.o." },
    vatRate: 2100,
    sections: [
      { id: "items", label: "Dodávka" },
      { id: "work", label: "Práce" },
    ],
    lines: [
      { id: "l1", sectionId: "items", name: "Stůl", quantity: 2, unit: "ks", unitPrice: 1_290_000 },
      { id: "l2", sectionId: "work", name: "Montáž", quantity: 1.5, unit: "h", unitPrice: 85_000 },
    ],
  };
}
