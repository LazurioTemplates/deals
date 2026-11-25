import { DATA_REPO_TEMPLATE, seedDirectory } from "../../src/cli/paths.ts";
import { readDataDirectory } from "../../src/data/directory.ts";
import type { Activity } from "../../src/domain/activity.ts";
import type { DataSet } from "../../src/domain/collections.ts";
import type { Company } from "../../src/domain/company.ts";
import type { Contact } from "../../src/domain/contact.ts";
import type { Deal } from "../../src/domain/deal.ts";
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

/** A new open deal of the sample's company C-0001. */
export function newDeal(id = "D-2026-0015"): Deal {
  return {
    id,
    title: "Vybavení recepce",
    companyId: "C-0001",
    contactIds: ["P-0001"],
    owner: "Jana Ukázková",
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
