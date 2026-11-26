import { type Change, type DealsStore, StoreError } from "../data/store.ts";
import type { DataSet } from "../domain/collections.ts";
import { isCalendarDate } from "../domain/common.ts";
import {
  type Company,
  company as companySchema,
  isValidIco,
  nextCompanyId,
} from "../domain/company.ts";
import { type Contact, contact as contactSchema, nextContactId } from "../domain/contact.ts";
import { type Deal, deal as dealSchema, nextDealId } from "../domain/deal.ts";
import { parseMoney } from "../domain/money.ts";
import { checkRulesLocalized } from "../domain/rules.ts";
import {
  nextSalespersonId,
  type Salesperson,
  salesperson as salespersonSchema,
} from "../domain/salesperson.ts";
import { lostStage, openStages, type Settings, type Stage, wonStage } from "../domain/settings.ts";
import type { Locale, Localized } from "../i18n/locale.ts";

/**
 * The import of companies, contacts or deals from a CSV export (a
 * spreadsheet, a CRM such as HubSpot). The browser parses the file
 * (`domain/csv.ts`) and maps its columns to the fields below; `planImport`
 * turns the mapped rows into new records and says, row by row, what each one
 * creates and what stops it. The browser shows that plan as the preview; the
 * server plans again over the data stored now and writes every new record in
 * one `saveAll` as a draft. An import never changes an existing record and
 * never publishes.
 */
export const IMPORT_KINDS = ["companies", "contacts", "deals"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_FIELDS = {
  companies: ["name", "ico", "dic", "street", "city", "postalCode", "country", "website", "note"],
  contacts: ["name", "firstName", "lastName", "email", "phone", "role", "company", "note"],
  deals: [
    "title",
    "company",
    "value",
    "stage",
    "closeDate",
    "createdAt",
    "owner",
    "dealType",
    "lossReason",
    "description",
  ],
} as const;

export type ImportField = (typeof IMPORT_FIELDS)[ImportKind][number];

/** Every field of every kind once, for the schema of the API. */
export const ALL_IMPORT_FIELDS = [
  ...new Set(Object.values(IMPORT_FIELDS).flat()),
] as unknown as readonly [ImportField, ...ImportField[]];

const L = (cs: string, en: string): Localized => ({ cs, en });

export const IMPORT_FIELD_LABELS: Record<ImportField, Localized> = {
  name: L("Název / jméno", "Name"),
  ico: L("IČO", "Company ID"),
  dic: L("DIČ", "VAT ID"),
  street: L("Ulice a číslo", "Street and number"),
  city: L("Obec", "City"),
  postalCode: L("PSČ", "Postal code"),
  country: L("Stát", "Country"),
  website: L("Web", "Website"),
  note: L("Poznámka", "Note"),
  firstName: L("Jméno", "First name"),
  lastName: L("Příjmení", "Last name"),
  email: L("E-mail", "E-mail"),
  phone: L("Telefon", "Phone"),
  role: L("Pozice", "Job title"),
  company: L("Firma (název)", "Company (name)"),
  title: L("Název případu", "Deal name"),
  value: L("Hodnota", "Amount"),
  stage: L("Fáze", "Stage"),
  closeDate: L("Datum uzavření", "Close date"),
  createdAt: L("Datum vzniku", "Create date"),
  owner: L("Obchodník", "Salesperson"),
  dealType: L("Typ zakázky", "Deal type"),
  lossReason: L("Důvod ztráty", "Loss reason"),
  description: L("Popis", "Description"),
};

/**
 * Column names the import recognises, per kind and field, as `headerKey`
 * makes them: Czech, English and the headers of a HubSpot export.
 */
const ALIASES: Record<ImportKind, Partial<Record<ImportField, readonly string[]>>> = {
  companies: {
    name: ["companyname", "company", "name", "nazev", "nazevfirmy", "firma", "spolecnost"],
    ico: ["ico", "ic", "icofirmy", "registrationnumber", "companyregistrationnumber"],
    dic: ["dic", "vatid", "vatnumber", "taxid", "vat"],
    street: ["street", "streetaddress", "address", "ulice", "adresa", "uliceacislo"],
    city: ["city", "town", "mesto", "obec"],
    postalCode: ["postalcode", "zip", "zipcode", "postcode", "psc"],
    country: ["country", "countryregion", "stat", "zeme"],
    website: ["website", "websiteurl", "web", "www", "url", "companydomainname", "domain"],
    note: ["note", "notes", "description", "poznamka", "popis"],
  },
  contacts: {
    name: ["name", "fullname", "contactname", "jmeno", "celejmeno", "jmenoaprijmeni", "kontakt"],
    firstName: ["firstname", "givenname", "krestnijmeno"],
    lastName: ["lastname", "surname", "familyname", "prijmeni"],
    email: ["email", "emailaddress", "mail", "emailovaadresa"],
    phone: ["phone", "phonenumber", "mobilephonenumber", "mobile", "telefon", "tel", "mobil"],
    role: ["jobtitle", "title", "role", "position", "pozice", "funkce"],
    company: [
      "company",
      "companyname",
      "associatedcompany",
      "organization",
      "firma",
      "nazevfirmy",
      "spolecnost",
    ],
    note: ["note", "notes", "poznamka"],
  },
  deals: {
    title: ["dealname", "name", "title", "deal", "nazev", "nazevpripadu", "pripad", "predmet"],
    company: [
      "company",
      "companyname",
      "associatedcompany",
      "customer",
      "account",
      "firma",
      "zakaznik",
      "spolecnost",
    ],
    value: ["amount", "amountincompanycurrency", "value", "dealvalue", "hodnota", "castka", "cena"],
    stage: ["dealstage", "stage", "pipelinestage", "faze", "stav", "status"],
    closeDate: [
      "closedate",
      "closingdate",
      "expectedclose",
      "expectedclosedate",
      "datumuzavreni",
      "uzavreni",
      "ocekavaneuzavreni",
    ],
    createdAt: [
      "createdate",
      "createdat",
      "created",
      "datumvytvoreni",
      "vytvoreno",
      "datumvzniku",
      "datumzalozeni",
    ],
    owner: ["dealowner", "owner", "salesperson", "assignedto", "obchodnik", "vlastnik"],
    dealType: ["dealtype", "type", "typ", "typzakazky"],
    lossReason: ["closedlostreason", "lostreason", "lossreason", "duvodztraty"],
    description: ["description", "note", "notes", "popis", "poznamka"],
  },
};

/** A column name as the guesses compare it: no accents, no brackets, letters and digits only. */
export function headerKey(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** The field each column most likely holds, or null; a field is guessed for one column only. */
export function guessMapping(kind: ImportKind, headers: readonly string[]): (ImportField | null)[] {
  const aliases = ALIASES[kind];
  const taken = new Set<ImportField>();
  const keys = headers.map(headerKey);
  const mapping = keys.map((key) => {
    for (const field of IMPORT_FIELDS[kind] as readonly ImportField[]) {
      if (taken.has(field)) continue;
      if (aliases[field]?.includes(key)) {
        taken.add(field);
        return field;
      }
    }
    return null;
  });
  // Czech „Jméno“ beside „Příjmení“ is the first name, not the full one.
  if (kind === "contacts" && taken.has("lastName") && !taken.has("firstName")) {
    const at = keys.findIndex((key, index) => key === "jmeno" && mapping[index] === "name");
    if (at >= 0) mapping[at] = "firstName";
  }
  return mapping;
}

/**
 * A date as exports write it, as `YYYY-MM-DD`: `2026-11-05`, `5. 11. 2026`,
 * `5.11.2026` and the American `11/5/2026`; a time after the date is
 * ignored. Null for anything else and for a day the calendar does not have.
 */
export function parseImportDate(text: string): string | null {
  const value = text.trim();
  let year: string | undefined;
  let month: string | undefined;
  let day: string | undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value);
  const czech = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s.*)?$/.exec(value);
  const american = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(value);
  if (iso) [, year, month, day] = iso;
  else if (czech) [, day, month, year] = czech;
  else if (american) [, month, day, year] = american;
  if (!year || !month || !day) return null;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isCalendarDate(date) ? date : null;
}

/** One row of the file as the person mapped it. */
export interface ImportRow {
  /** The row's number as the spreadsheet shows it. */
  row: number;
  values: Partial<Record<ImportField, string>>;
}

export interface ImportInput {
  kind: ImportKind;
  rows: ImportRow[];
  /** Create a company a contact or a deal names by a name no company has. */
  createCompanies: boolean;
  /** How the amounts are written: `1 234,50` (cs) or `1,234.50` (en). */
  numberLocale: Locale;
  /** The salesperson of a deal whose row names none. */
  defaultOwnerId?: string | undefined;
}

export type CreatedCollection = "companies" | "contacts" | "deals" | "salespeople";

export interface CreatedRecord {
  collection: CreatedCollection;
  id: string;
  name: string;
}

export interface ImportRowPlan {
  row: number;
  /** The row's main name: a company, a person, a deal. */
  label: string;
  /** Whether the row creates its record; a skipped one creates nothing. */
  skipped: boolean;
  /** Why the row is skipped. */
  errors: Localized[];
  /** What the row changed on the way, imported anyway. */
  warnings: Localized[];
  /** What the row creates, its own record and a company or salesperson it needs. */
  creates: CreatedRecord[];
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  /** Every new record, for one `saveAll`. */
  changes: Change[];
  created: Record<CreatedCollection, number>;
}

const nameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("cs");

/** A reason the record does not pass its schema, in words: the field and what it expects. */
function schemaProblem(issues: readonly { path: PropertyKey[]; message: string }[]): Localized {
  const fields = [...new Set(issues.map((issue) => issue.path.map(String).join(".")))].join(", ");
  return L(`Neplatná hodnota pole ${fields}.`, `An invalid value of ${fields}.`);
}

/**
 * What an import would create from mapped rows over the data as it is: every
 * row's new records, problems and warnings, and the changes of one write.
 */
export function planImport(
  data: DataSet,
  settings: Settings,
  input: ImportInput,
  today: string,
): ImportPlan {
  const companies: Company[] = [...data.companies];
  const contacts: Contact[] = [...data.contacts];
  const deals: Deal[] = [...data.deals];
  const salespeople: Salesperson[] = [...data.salespeople];
  const createdBy = new Map<string, number>();
  const changes: Change[] = [];
  const plans: ImportRowPlan[] = [];
  const recordRow = new Map<string, number>();

  const companyByName = (name: string) =>
    companies.find((entry) => nameKey(entry.name) === nameKey(name));
  const where = (id: string) => {
    const row = createdBy.get(id);
    return row === undefined
      ? L(`už existuje (${id})`, `already exists (${id})`)
      : L(`je už v importu na řádku ${row}`, `is already in the import on row ${row}`);
  };

  const addCompany = (value: Company, plan: ImportRowPlan) => {
    companies.push(value);
    createdBy.set(value.id, plan.row);
    changes.push({ collection: "companies", value, baseRevision: null });
    recordRow.set(`companies/${value.id}`, plans.length);
    plan.creates.push({ collection: "companies", id: value.id, name: value.name });
  };

  /** The company a row names: an existing one, a new one when allowed, else undefined. */
  const companyFor = (name: string, plan: ImportRowPlan): Company | undefined => {
    const found = companyByName(name);
    if (found || !input.createCompanies) return found;
    const value: Company = { id: nextCompanyId(companies.map((entry) => entry.id)), name };
    addCompany(value, plan);
    return value;
  };

  const settingsLabel = <E extends { id: string; label: string }>(
    entries: readonly E[],
    text: string,
  ): E | undefined =>
    entries.find(
      (entry) => entry.id === text.trim().toLowerCase() || nameKey(entry.label) === nameKey(text),
    );

  const stageFor = (text: string): Stage | undefined => {
    const found = settingsLabel(settings.stages, text);
    if (found) return found;
    const key = headerKey(text);
    if (["closedwon", "won", "vyhrano", "vyhra", "vyhrany"].includes(key))
      return wonStage(settings);
    if (["closedlost", "lost", "ztraceno", "prohrano", "ztraceny"].includes(key)) {
      return lostStage(settings);
    }
    return undefined;
  };

  const ownerFor = (text: string, plan: ImportRowPlan): Salesperson | undefined => {
    const value = text.trim();
    const found = salespeople.find(
      (entry) =>
        entry.id === value ||
        nameKey(entry.name) === nameKey(value) ||
        (value.includes("@") && entry.email?.toLowerCase() === value.toLowerCase()),
    );
    if (found) return found;
    const created: Salesperson = {
      id: nextSalespersonId(salespeople.map((entry) => entry.id)),
      name: value,
      ...(value.includes("@") ? { email: value } : {}),
      active: true,
    };
    if (!salespersonSchema.safeParse(created).success) return undefined;
    salespeople.push(created);
    createdBy.set(created.id, plan.row);
    changes.push({ collection: "salespeople", value: created, baseRevision: null });
    recordRow.set(`salespeople/${created.id}`, plans.length);
    plan.creates.push({ collection: "salespeople", id: created.id, name: created.name });
    return created;
  };

  for (const { row, values } of input.rows) {
    const get = (field: ImportField) => (values[field] ?? "").trim();
    const plan: ImportRowPlan = {
      row,
      label: "",
      skipped: false,
      errors: [],
      warnings: [],
      creates: [],
    };
    const refuse = (cs: string, en: string) => plan.errors.push(L(cs, en));
    const warn = (cs: string, en: string) => plan.warnings.push(L(cs, en));

    if (input.kind === "companies") {
      const name = get("name");
      plan.label = name;
      let ico = get("ico").replace(/\s/g, "");
      // A spreadsheet drops the leading zeros of a number.
      if (/^[0-9]{6,7}$/.test(ico)) ico = ico.padStart(8, "0");
      if (!name) refuse("Chybí název firmy.", "The company name is missing.");
      if (ico && !isValidIco(ico)) {
        refuse(`IČO ${get("ico")} není platné.`, `The company ID ${get("ico")} is not valid.`);
      }
      const same =
        (ico ? companies.find((entry) => entry.ico === ico) : undefined) ??
        (name ? companyByName(name) : undefined);
      if (same) {
        const at = where(same.id);
        refuse(`Firma ${same.name} ${at.cs}.`, `The company ${same.name} ${at.en}.`);
      }
      if (plan.errors.length === 0) {
        const address = Object.fromEntries(
          (["street", "city", "postalCode", "country"] as const).flatMap((field) =>
            get(field) ? [[field, get(field)]] : [],
          ),
        );
        const value: Company = {
          id: nextCompanyId(companies.map((entry) => entry.id)),
          name,
          ...(ico ? { ico } : {}),
          ...(get("dic") ? { dic: get("dic") } : {}),
          ...(Object.keys(address).length > 0 ? { address } : {}),
          ...(get("website") ? { website: get("website") } : {}),
          ...(get("note") ? { note: get("note") } : {}),
        };
        const parsed = companySchema.safeParse(value);
        if (parsed.success) addCompany(value, plan);
        else plan.errors.push(schemaProblem(parsed.error.issues));
      }
    }

    if (input.kind === "contacts") {
      const name = get("name") || [get("firstName"), get("lastName")].filter(Boolean).join(" ");
      const email = get("email");
      plan.label = name || email;
      if (!name) refuse("Chybí jméno kontaktu.", "The contact's name is missing.");
      if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
        refuse(`E-mail ${email} nemá tvar adresy.`, `The e-mail ${email} is not an address.`);
      }
      const same = email
        ? contacts.find((entry) => entry.email?.toLowerCase() === email.toLowerCase())
        : undefined;
      if (same) {
        const at = where(same.id);
        refuse(
          `Kontakt s e-mailem ${email} ${at.cs}.`,
          `The contact with the e-mail ${email} ${at.en}.`,
        );
      }
      if (plan.errors.length === 0) {
        const companyName = get("company");
        const owner = companyName ? companyFor(companyName, plan) : undefined;
        if (companyName && !owner) {
          warn(
            `Firma ${companyName} neexistuje; kontakt se založí bez firmy.`,
            `The company ${companyName} does not exist; the contact is created without one.`,
          );
        }
        const value: Contact = {
          id: nextContactId(contacts.map((entry) => entry.id)),
          name,
          ...(email ? { email } : {}),
          ...(get("phone") ? { phone: get("phone") } : {}),
          ...(get("role") ? { role: get("role") } : {}),
          ...(owner ? { companyId: owner.id } : {}),
          ...(get("note") ? { note: get("note") } : {}),
        };
        const parsed = contactSchema.safeParse(value);
        if (parsed.success) {
          contacts.push(value);
          createdBy.set(value.id, row);
          changes.push({ collection: "contacts", value, baseRevision: null });
          recordRow.set(`contacts/${value.id}`, plans.length);
          plan.creates.push({ collection: "contacts", id: value.id, name: value.name });
        } else {
          plan.errors.push(schemaProblem(parsed.error.issues));
        }
      }
    }

    if (input.kind === "deals") {
      const title = get("title");
      const companyName = get("company");
      plan.label = title;
      if (!title) refuse("Chybí název případu.", "The deal name is missing.");
      if (!companyName) refuse("Chybí firma.", "The company is missing.");
      const existingCompany = companyName ? companyByName(companyName) : undefined;
      if (companyName && !existingCompany && !input.createCompanies) {
        refuse(
          `Firma ${companyName} neexistuje. Založte ji, nebo zapněte zakládání chybějících firem.`,
          `The company ${companyName} does not exist. Create it, or turn on creating missing companies.`,
        );
      }

      const stageText = get("stage");
      let stage = stageText ? stageFor(stageText) : undefined;
      if (!stage) {
        stage = openStages(settings)[0];
        if (stageText && stage) {
          warn(
            `Fáze ${stageText} v nastavení není; případ půjde do fáze ${stage.label}.`,
            `The stage ${stageText} is not in the settings; the deal goes to ${stage.label}.`,
          );
        }
      }

      const valueText = get("value");
      const value = valueText ? parseMoney(valueText, input.numberLocale) : 0;
      if (value === null || value < 0) {
        refuse(
          `Částka ${valueText} není kladné číslo.`,
          `The amount ${valueText} is no positive number.`,
        );
      }

      const dateOf = (field: "closeDate" | "createdAt") => {
        const text = get(field);
        if (!text) return undefined;
        const parsed = parseImportDate(text);
        if (!parsed) {
          const label = IMPORT_FIELD_LABELS[field];
          refuse(
            `${label.cs} ${text} nemá tvar data (2026-11-05, 5. 11. 2026, 11/5/2026).`,
            `${label.en} ${text} is not a date (2026-11-05, 5. 11. 2026, 11/5/2026).`,
          );
        }
        return parsed ?? undefined;
      };
      const closeDate = dateOf("closeDate");
      const createdText = dateOf("createdAt");
      const closed = stage?.kind === "won" || stage?.kind === "lost";
      let createdAt = createdText ?? today;
      if (closed && !closeDate && !get("closeDate")) {
        refuse(
          `Případ ve fázi ${stage?.label} potřebuje datum uzavření.`,
          `A deal in the stage ${stage?.label} needs its close date.`,
        );
      }
      if (closed && closeDate) {
        if (!createdText && closeDate < createdAt) createdAt = closeDate;
        if (closeDate < createdAt) {
          refuse("Případ je uzavřený dřív, než vznikl.", "The deal closes before it was created.");
        }
      }
      if (stage?.kind === "won" && value === 0) {
        refuse("Vyhraný případ potřebuje hodnotu.", "A won deal needs its amount.");
      }
      let lossReasonId: string | undefined;
      const reasonText = get("lossReason");
      if (stage?.kind === "lost") {
        lossReasonId = reasonText ? settingsLabel(settings.lossReasons, reasonText)?.id : undefined;
        if (!lossReasonId) {
          const known = settings.lossReasons.map((reason) => reason.label).join(", ");
          refuse(
            `Ztracený případ potřebuje důvod ztráty z nastavení (${known}).`,
            `A lost deal needs a loss reason from the settings (${known}).`,
          );
        }
      }
      let dealTypeId: string | undefined;
      const typeText = get("dealType");
      if (typeText) {
        dealTypeId = settingsLabel(settings.dealTypes ?? [], typeText)?.id;
        if (!dealTypeId) {
          warn(
            `Typ zakázky ${typeText} v nastavení není; případ ho mít nebude.`,
            `The deal type ${typeText} is not in the settings; the deal has none.`,
          );
        }
      }
      const ownerText = get("owner");
      const defaultOwner = input.defaultOwnerId
        ? salespeople.find((entry) => entry.id === input.defaultOwnerId)
        : undefined;
      if (!ownerText && !defaultOwner) {
        refuse("Chybí obchodník.", "The salesperson is missing.");
      }

      if (plan.errors.length === 0 && stage && value !== null) {
        const owner = ownerText ? ownerFor(ownerText, plan) : defaultOwner;
        const company = companyFor(companyName, plan);
        if (!owner)
          refuse(
            `Obchodník ${ownerText} nejde založit.`,
            `The salesperson ${ownerText} cannot be created.`,
          );
        if (owner && company) {
          const record: Deal = {
            id: nextDealId(
              createdAt.slice(0, 4),
              deals.map((entry) => entry.id),
            ),
            title,
            companyId: company.id,
            ownerId: owner.id,
            stageId: stage.id,
            ...(dealTypeId ? { dealTypeId } : {}),
            value,
            createdAt,
            ...(stage.kind === "open" && closeDate ? { expectedClose: closeDate } : {}),
            ...(closed && closeDate ? { closedAt: closeDate } : {}),
            ...(lossReasonId ? { lossReasonId } : {}),
            ...(stage.kind === "won"
              ? { paymentPlan: { status: "unassigned" as const, payments: [] } }
              : {}),
            ...(get("description") ? { description: get("description") } : {}),
          };
          const parsed = dealSchema.safeParse(record);
          if (parsed.success) {
            deals.push(record);
            createdBy.set(record.id, row);
            changes.push({ collection: "deals", value: record, baseRevision: null });
            recordRow.set(`deals/${record.id}`, plans.length);
            plan.creates.push({ collection: "deals", id: record.id, name: record.title });
          } else {
            plan.errors.push(schemaProblem(parsed.error.issues));
          }
        }
      }
    }

    plan.skipped = plan.errors.length > 0;
    plans.push(plan);
  }

  // A last guard: a rule across records the checks above missed stops the
  // row whose record breaks it, never the whole import.
  const before = new Set(
    checkRulesLocalized({ ...data, settings }, { today })
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.record}:${issue.code}`),
  );
  let kept = changes;
  for (let pass = 0; pass < 3; pass += 1) {
    const merged = mergedData(data, settings, kept);
    const broken = checkRulesLocalized(merged, { today }).filter(
      (issue) => issue.severity === "error" && !before.has(`${issue.record}:${issue.code}`),
    );
    if (broken.length === 0) break;
    const dropped = new Set<string>();
    for (const issue of broken) {
      const index = recordRow.get(issue.record);
      const plan = index === undefined ? undefined : plans[index];
      if (!plan) continue;
      plan.errors.push(issue.message);
      plan.skipped = true;
      dropped.add(issue.record);
    }
    if (dropped.size === 0) break;
    kept = kept.filter((change) => !dropped.has(`${change.collection}/${idOf(change)}`));
    for (const plan of plans) {
      plan.creates = plan.creates.filter(
        (entry) => !dropped.has(`${entry.collection}/${entry.id}`),
      );
    }
  }

  const created: Record<CreatedCollection, number> = {
    companies: 0,
    contacts: 0,
    deals: 0,
    salespeople: 0,
  };
  for (const change of kept) {
    if (change.collection in created) created[change.collection as CreatedCollection] += 1;
  }
  return { rows: plans, changes: kept, created };
}

function idOf(change: Change): string {
  return "remove" in change ? change.remove : (change.value as { id: string }).id;
}

function mergedData(data: DataSet, settings: Settings, changes: readonly Change[]): DataSet {
  const added = (collection: CreatedCollection) =>
    changes.flatMap((change) =>
      change.collection === collection && "value" in change ? [change.value] : [],
    );
  return {
    ...data,
    settings,
    companies: [...data.companies, ...(added("companies") as Company[])],
    contacts: [...data.contacts, ...(added("contacts") as Contact[])],
    deals: [...data.deals, ...(added("deals") as Deal[])],
    salespeople: [...data.salespeople, ...(added("salespeople") as Salesperson[])],
  };
}

/** What an import created and which rows it skipped and why, in one language. */
export interface ImportReport {
  created: Record<CreatedCollection, number>;
  records: CreatedRecord[];
  skipped: { row: number; label: string; reasons: string[] }[];
  warnings: { row: number; label: string; messages: string[] }[];
}

export function reportOf(plan: ImportPlan, locale: Locale): ImportReport {
  return {
    created: plan.created,
    records: plan.rows.flatMap((row) => row.creates),
    skipped: plan.rows
      .filter((row) => row.skipped)
      .map((row) => ({
        row: row.row,
        label: row.label,
        reasons: row.errors.map((error) => error[locale]),
      })),
    warnings: plan.rows
      .filter((row) => !row.skipped && row.warnings.length > 0)
      .map((row) => ({
        row: row.row,
        label: row.label,
        messages: row.warnings.map((warning) => warning[locale]),
      })),
  };
}

/**
 * Imports mapped rows over the data stored now: every new record in one
 * write as a draft, never a change of an existing record, never a publish.
 */
export async function importRecords(
  store: DealsStore,
  input: ImportInput,
  options: { today: string; locale: Locale },
): Promise<ImportReport> {
  const settings = await store.settings();
  const data = await store.readData();
  const plan = planImport(data, settings.value, input, options.today);
  if (plan.changes.length > 0) await store.saveAll(plan.changes);
  return reportOf(plan, options.locale);
}

/** The refusal of an import that has no rows. */
export function emptyImport(): StoreError {
  return new StoreError("bad_request", {
    cs: "Import nemá žádný řádek.",
    en: "The import has no row.",
  });
}
