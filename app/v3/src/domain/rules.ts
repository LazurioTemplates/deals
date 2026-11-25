import type { Locale, Localized } from "../i18n/locale.ts";
import type { DataSet } from "./collections.ts";
import { isValidIco } from "./company.ts";
import { SETTINGS_ID } from "./settings.ts";

/**
 * Rules across records, which the schema of one record cannot express: a
 * deal names a company, contacts, a stage and a loss reason that exist, a won
 * or lost deal has what closing it needs, an IČO is valid and used once. The
 * App checks them before it saves a record and before it publishes, and in
 * `bun run validate:db`; the data repository's own validator checks the shape
 * of each record only.
 *
 * An error blocks the save of the record it is about and every publication;
 * a warning is shown and blocks nothing.
 */
export type Severity = "error" | "warning";

export interface LocalizedRuleIssue {
  /** The record the issue is about: `<collection>/<id>`. */
  record: string;
  severity: Severity;
  /** A stable name of the rule, for tests and the interface: `unknown_stage`. */
  code: string;
  message: Localized;
}

export interface RuleIssue {
  record: string;
  severity: Severity;
  code: string;
  message: string;
}

export interface RuleOptions {
  /**
   * Today, `YYYY-MM-DD`: an open deal expected to close before it is a
   * warning. Without it only a missing date is.
   */
  today?: string | undefined;
}

export function checkRulesLocalized(
  data: DataSet,
  options: RuleOptions = {},
): LocalizedRuleIssue[] {
  const issues: LocalizedRuleIssue[] = [];
  const add = (severity: Severity, record: string, code: string, cs: string, en: string) =>
    issues.push({ record, severity, code, message: { cs, en } });
  const error = (record: string, code: string, cs: string, en: string) =>
    add("error", record, code, cs, en);
  const warning = (record: string, code: string, cs: string, en: string) =>
    add("warning", record, code, cs, en);
  const settings = data.settings;
  const settingsRecord = `settings/${SETTINGS_ID}`;

  if (!settings) {
    error(
      settingsRecord,
      "settings_missing",
      "data nemají záznam s nastavením",
      "the data has no settings record",
    );
  } else {
    const ids = settings.stages.map((stage) => stage.id);
    if (new Set(ids).size !== ids.length) {
      error(
        settingsRecord,
        "stage_duplicate_id",
        "fáze má stejné id dvakrát",
        "two stages have the same id",
      );
    }
    const won = settings.stages.filter((stage) => stage.kind === "won");
    const lost = settings.stages.filter((stage) => stage.kind === "lost");
    if (won.length !== 1) {
      error(
        settingsRecord,
        "stage_won_count",
        `pipeline potřebuje právě jednu vyhranou fázi, má ${won.length}`,
        `the pipeline needs exactly one won stage, it has ${won.length}`,
      );
    }
    for (const stage of won.filter((entry) => entry.probability !== 100)) {
      error(
        settingsRecord,
        "stage_won_probability",
        `vyhraná fáze ${stage.id} musí mít pravděpodobnost 100 %`,
        `the won stage ${stage.id} must have a probability of 100%`,
      );
    }
    if (lost.length !== 1) {
      error(
        settingsRecord,
        "stage_lost_count",
        `pipeline potřebuje právě jednu ztracenou fázi, má ${lost.length}`,
        `the pipeline needs exactly one lost stage, it has ${lost.length}`,
      );
    }
    for (const stage of lost.filter((entry) => entry.probability !== 0)) {
      error(
        settingsRecord,
        "stage_lost_probability",
        `ztracená fáze ${stage.id} musí mít pravděpodobnost 0 %`,
        `the lost stage ${stage.id} must have a probability of 0%`,
      );
    }
    if (!settings.stages.some((stage) => stage.kind === "open")) {
      error(
        settingsRecord,
        "stage_open_missing",
        "pipeline potřebuje aspoň jednu otevřenou fázi",
        "the pipeline needs at least one open stage",
      );
    }
    const reasons = settings.lossReasons.map((reason) => reason.id);
    if (new Set(reasons).size !== reasons.length) {
      error(
        settingsRecord,
        "loss_reason_duplicate_id",
        "důvod ztráty má stejné id dvakrát",
        "two loss reasons have the same id",
      );
    }
    // A stage or a reason a deal uses cannot be taken out of the settings.
    const stageIds = new Set(ids);
    const reasonIds = new Set(reasons);
    const missingStages = [...new Set(data.deals.map((deal) => deal.stageId))]
      .filter((id) => !stageIds.has(id))
      .sort();
    for (const id of missingStages) {
      error(
        settingsRecord,
        "stage_in_use",
        `fázi ${id} používá obchodní případ, nejde ji odebrat`,
        `a deal is in the stage ${id}; it cannot be removed`,
      );
    }
    const missingReasons = [
      ...new Set(data.deals.flatMap((deal) => (deal.lossReasonId ? [deal.lossReasonId] : []))),
    ]
      .filter((id) => !reasonIds.has(id))
      .sort();
    for (const id of missingReasons) {
      error(
        settingsRecord,
        "loss_reason_in_use",
        `důvod ztráty ${id} používá obchodní případ, nejde ho odebrat`,
        `a deal names the loss reason ${id}; it cannot be removed`,
      );
    }
  }

  const byIco = new Map<string, string[]>();
  for (const company of data.companies) {
    if (company.ico === undefined) continue;
    const record = `companies/${company.id}`;
    if (!isValidIco(company.ico)) {
      error(
        record,
        "ico_checksum",
        `IČO ${company.ico} nemá správný kontrolní součet`,
        `the company id (IČO) ${company.ico} fails its checksum`,
      );
    }
    byIco.set(company.ico, [...(byIco.get(company.ico) ?? []), company.id]);
  }
  for (const [value, ids] of byIco) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const others = ids.filter((other) => other !== id).join(", ");
      error(
        `companies/${id}`,
        "ico_duplicate",
        `IČO ${value} má už firma ${others}`,
        `the company ${others} already has the company id (IČO) ${value}`,
      );
    }
  }

  const companies = new Set(data.companies.map((entry) => entry.id));
  const contacts = new Map(data.contacts.map((entry) => [entry.id, entry]));
  for (const contact of data.contacts) {
    if (contact.companyId !== undefined && !companies.has(contact.companyId)) {
      error(
        `contacts/${contact.id}`,
        "unknown_company",
        `firma ${contact.companyId} neexistuje`,
        `the company ${contact.companyId} does not exist`,
      );
    }
  }

  const owners = settings?.owners ?? [];
  for (const deal of data.deals) {
    const record = `deals/${deal.id}`;
    if (!companies.has(deal.companyId)) {
      error(
        record,
        "unknown_company",
        `firma ${deal.companyId} neexistuje`,
        `the company ${deal.companyId} does not exist`,
      );
    }
    for (const id of deal.contactIds ?? []) {
      const contact = contacts.get(id);
      if (!contact) {
        error(
          record,
          "unknown_contact",
          `kontakt ${id} neexistuje`,
          `the contact ${id} does not exist`,
        );
      } else if (contact.companyId !== deal.companyId) {
        warning(
          record,
          "contact_other_company",
          `kontakt ${id} nepatří k firmě ${deal.companyId}`,
          `the contact ${id} does not belong to the company ${deal.companyId}`,
        );
      }
    }
    if (owners.length > 0 && !owners.includes(deal.owner)) {
      warning(
        record,
        "owner_unknown",
        `obchodník ${deal.owner} není v seznamu obchodníků`,
        `the owner ${deal.owner} is not one of the salespeople`,
      );
    }
    if (deal.closedAt !== undefined && deal.closedAt < deal.createdAt) {
      error(
        record,
        "closed_before_created",
        "případ je uzavřený dřív, než vznikl",
        "the deal closes before it was created",
      );
    }
    if (!settings) continue;
    const stage = settings.stages.find((entry) => entry.id === deal.stageId);
    if (!stage) {
      error(
        record,
        "unknown_stage",
        `fáze ${deal.stageId} neexistuje`,
        `the stage ${deal.stageId} does not exist`,
      );
      continue;
    }
    if (
      deal.lossReasonId !== undefined &&
      !settings.lossReasons.some((reason) => reason.id === deal.lossReasonId)
    ) {
      error(
        record,
        "unknown_loss_reason",
        `důvod ztráty ${deal.lossReasonId} neexistuje`,
        `the loss reason ${deal.lossReasonId} does not exist`,
      );
    }
    if (stage.kind === "open") {
      if (deal.closedAt !== undefined) {
        error(
          record,
          "open_with_closed_date",
          "otevřený případ nemá datum uzavření",
          "an open deal has no closing date",
        );
      }
      if (deal.expectedClose === undefined) {
        warning(
          record,
          "expected_close_missing",
          "otevřený případ nemá očekávané datum uzavření; ve forecastu je mezi případy bez data",
          "an open deal has no expected closing date; the forecast counts it without a date",
        );
      } else if (options.today !== undefined && deal.expectedClose < options.today) {
        warning(
          record,
          "expected_close_past",
          `očekávané datum uzavření ${deal.expectedClose} už minulo; ve forecastu je mezi případy bez data`,
          `the expected closing date ${deal.expectedClose} has passed; the forecast counts it without a date`,
        );
      }
    } else if (deal.closedAt === undefined) {
      error(
        record,
        "closed_without_date",
        stage.kind === "won"
          ? "vyhraný případ nemá datum uzavření"
          : "ztracený případ nemá datum uzavření",
        stage.kind === "won" ? "a won deal has no closing date" : "a lost deal has no closing date",
      );
    }
    if (stage.kind === "won" && deal.value <= 0) {
      error(
        record,
        "won_without_value",
        "vyhraný případ musí mít hodnotu větší než nula",
        "a won deal must have a value above zero",
      );
    }
    if (stage.kind === "lost" && deal.lossReasonId === undefined) {
      error(
        record,
        "lost_without_reason",
        "ztracený případ nemá důvod ztráty",
        "a lost deal has no loss reason",
      );
    }
    if (stage.kind !== "lost" && deal.lossReasonId !== undefined) {
      error(
        record,
        "reason_outside_lost",
        "důvod ztráty má jen ztracený případ",
        "only a lost deal has a loss reason",
      );
    }
  }

  const deals = new Set(data.deals.map((entry) => entry.id));
  for (const activity of data.activities) {
    const record = `activities/${activity.id}`;
    if (!deals.has(activity.dealId)) {
      error(
        record,
        "unknown_deal",
        `obchodní případ ${activity.dealId} neexistuje`,
        `the deal ${activity.dealId} does not exist`,
      );
    }
    for (const id of activity.contactIds ?? []) {
      if (!contacts.has(id)) {
        error(
          record,
          "unknown_contact",
          `kontakt ${id} neexistuje`,
          `the contact ${id} does not exist`,
        );
      }
    }
    if (activity.type !== "task" && activity.done !== undefined) {
      error(
        record,
        "done_outside_task",
        "hotovo nebo nehotovo je jen úkol",
        "only a task is done or not done",
      );
    }
  }
  return issues;
}

/** The issues of the data in one language. */
export function checkRules(
  data: DataSet,
  options: RuleOptions & { locale?: Locale } = {},
): RuleIssue[] {
  const locale = options.locale ?? "cs";
  return checkRulesLocalized(data, options).map((issue) => ({
    ...issue,
    message: issue.message[locale],
  }));
}

/** Only the issues that block a save or a publication. */
export function errorsOf<T extends { severity: Severity }>(issues: readonly T[]): T[] {
  return issues.filter((issue) => issue.severity === "error");
}

/** Only the issues that warn. */
export function warningsOf<T extends { severity: Severity }>(issues: readonly T[]): T[] {
  return issues.filter((issue) => issue.severity === "warning");
}
