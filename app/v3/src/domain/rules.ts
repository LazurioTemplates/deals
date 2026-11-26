import type { Locale, Localized } from "../i18n/locale.ts";
import type { DataSet } from "./collections.ts";
import { isValidIco } from "./company.ts";
import { type PaymentPlan, plannedTotal } from "./payment-plan.ts";
import { primaryQuote, quoteRevisionId, quoteTotals } from "./quote.ts";
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
    const uniqueIds = (
      values: readonly { id: string }[] | undefined,
      code: string,
      cs: string,
      en: string,
    ) => {
      const list = (values ?? []).map((entry) => entry.id);
      if (new Set(list).size !== list.length) error(settingsRecord, code, cs, en);
      return new Set(list);
    };
    const typeIds = uniqueIds(
      settings.dealTypes,
      "deal_type_duplicate_id",
      "typ zakázky má stejné id dvakrát",
      "two deal types have the same id",
    );
    const entityIds = uniqueIds(
      settings.billingEntities,
      "billing_entity_duplicate_id",
      "fakturační firma má stejné id dvakrát",
      "two billing entities have the same id",
    );
    uniqueIds(
      settings.quotes.sections,
      "quote_section_duplicate_id",
      "sekce nabídky má stejné id dvakrát",
      "two quote sections have the same id",
    );
    // A deal type or an entity something names cannot be taken out of the settings.
    const named = (
      pick: (entry: { dealTypeId?: string; billingEntityId?: string }) => string | undefined,
    ) =>
      new Set(
        [...data.deals, ...data.forecastEntries, ...data.quotes]
          .map((entry) => pick(entry as { dealTypeId?: string; billingEntityId?: string }))
          .filter((id): id is string => id !== undefined),
      );
    for (const id of [...named((entry) => entry.dealTypeId)]
      .filter((id) => !typeIds.has(id))
      .sort()) {
      error(
        settingsRecord,
        "deal_type_in_use",
        `typ zakázky ${id} se používá, nejde ho odebrat`,
        `the deal type ${id} is in use; it cannot be removed`,
      );
    }
    for (const id of [...named((entry) => entry.billingEntityId)]
      .filter((id) => !entityIds.has(id))
      .sort()) {
      error(
        settingsRecord,
        "billing_entity_in_use",
        `fakturační firma ${id} se používá, nejde ji odebrat`,
        `the billing entity ${id} is in use; it cannot be removed`,
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

  const salespeople = new Map(data.salespeople.map((entry) => [entry.id, entry]));
  const quotesById = new Map(data.quotes.map((entry) => [entry.id, entry]));
  const typeKnown = (id: string | undefined) =>
    id === undefined || !settings || (settings.dealTypes ?? []).some((entry) => entry.id === id);
  const entityKnown = (id: string | undefined) =>
    id === undefined ||
    !settings ||
    (settings.billingEntities ?? []).some((entry) => entry.id === id);
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
    const owner = salespeople.get(deal.ownerId);
    if (!owner) {
      error(
        record,
        "unknown_salesperson",
        `obchodník ${deal.ownerId} neexistuje`,
        `the salesperson ${deal.ownerId} does not exist`,
      );
    }
    if (!typeKnown(deal.dealTypeId)) {
      error(
        record,
        "unknown_deal_type",
        `typ zakázky ${deal.dealTypeId} neexistuje`,
        `the deal type ${deal.dealTypeId} does not exist`,
      );
    }
    if (!entityKnown(deal.billingEntityId)) {
      error(
        record,
        "unknown_billing_entity",
        `fakturační firma ${deal.billingEntityId} neexistuje`,
        `the billing entity ${deal.billingEntityId} does not exist`,
      );
    }
    if (deal.primaryQuoteId !== undefined) {
      const named = quotesById.get(deal.primaryQuoteId);
      if (!named || named.dealId !== deal.id) {
        error(
          record,
          "unknown_primary_quote",
          `nabídka ${deal.primaryQuoteId} nepatří k tomuto případu`,
          `the quote ${deal.primaryQuoteId} does not belong to this deal`,
        );
      }
    }
    const primary = primaryQuote(deal, data.quotes);
    if (primary && primary.lines.length > 0 && quoteTotals(primary).subtotal !== deal.value) {
      warning(
        record,
        "value_differs_from_quote",
        `hodnota případu se liší od nabídky ${primary.id}`,
        `the value of the deal differs from the quote ${primary.id}`,
      );
    }
    if (deal.paymentPlan) checkPlan(record, deal.paymentPlan, deal.value, error);
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
          "otevřený případ nemá očekávané datum uzavření",
          "an open deal has no expected closing date",
        );
      } else if (options.today !== undefined && deal.expectedClose < options.today) {
        warning(
          record,
          "expected_close_past",
          `očekávané datum uzavření ${deal.expectedClose} už minulo`,
          `the expected closing date ${deal.expectedClose} has passed`,
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
    if (stage.kind !== "won" && deal.paymentPlan !== undefined) {
      error(
        record,
        "plan_outside_won",
        "plán plateb má jen vyhraný případ",
        "only a won deal has a payment plan",
      );
    }
    if (stage.kind === "open" && owner && !owner.active) {
      warning(
        record,
        "salesperson_inactive",
        `obchodník ${owner.name} už není aktivní`,
        `the salesperson ${owner.name} is no longer active`,
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
  const approvedByDeal = new Map<string, string[]>();
  for (const entry of data.quotes) {
    const record = `quotes/${entry.id}`;
    if (entry.id !== quoteRevisionId(entry.number, entry.version)) {
      error(
        record,
        "quote_id_mismatch",
        `id nabídky musí být ${quoteRevisionId(entry.number, entry.version)}`,
        `the id of the quote must be ${quoteRevisionId(entry.number, entry.version)}`,
      );
    }
    if (!deals.has(entry.dealId)) {
      error(
        record,
        "unknown_deal",
        `obchodní případ ${entry.dealId} neexistuje`,
        `the deal ${entry.dealId} does not exist`,
      );
    }
    if (entry.contactId !== undefined && !contacts.has(entry.contactId)) {
      error(
        record,
        "unknown_contact",
        `kontakt ${entry.contactId} neexistuje`,
        `the contact ${entry.contactId} does not exist`,
      );
    }
    if (entry.customer.companyId !== undefined && !companies.has(entry.customer.companyId)) {
      error(
        record,
        "unknown_company",
        `firma ${entry.customer.companyId} neexistuje`,
        `the company ${entry.customer.companyId} does not exist`,
      );
    }
    if (!entityKnown(entry.billingEntityId)) {
      error(
        record,
        "unknown_billing_entity",
        `fakturační firma ${entry.billingEntityId} neexistuje`,
        `the billing entity ${entry.billingEntityId} does not exist`,
      );
    }
    if (entry.validUntil !== undefined && entry.validUntil < entry.issuedOn) {
      error(
        record,
        "valid_before_issued",
        "nabídka platí jen do dne před vystavením",
        "the quote is valid only until before it was issued",
      );
    }
    const sectionIds = entry.sections.map((section) => section.id);
    if (new Set(sectionIds).size !== sectionIds.length) {
      error(
        record,
        "quote_section_duplicate_id",
        "sekce nabídky má stejné id dvakrát",
        "two sections of the quote have the same id",
      );
    }
    const lineIds = entry.lines.map((line) => line.id);
    if (new Set(lineIds).size !== lineIds.length) {
      error(
        record,
        "quote_line_duplicate_id",
        "položka nabídky má stejné id dvakrát",
        "two lines of the quote have the same id",
      );
    }
    for (const line of entry.lines) {
      if (!sectionIds.includes(line.sectionId)) {
        error(
          record,
          "unknown_quote_section",
          `položka ${line.name} je v sekci ${line.sectionId}, kterou nabídka nemá`,
          `the line ${line.name} is in the section ${line.sectionId}, which the quote does not have`,
        );
      }
    }
    if (entry.status === "approved") {
      approvedByDeal.set(entry.dealId, [...(approvedByDeal.get(entry.dealId) ?? []), entry.id]);
      if (entry.commercialTerms && !entry.commercialTerms.evidence) {
        warning(
          record,
          "terms_without_evidence",
          "schválená nabídka nemá doklad o přijetí obchodních podmínek",
          "an approved quote has no evidence that its commercial terms were accepted",
        );
      }
    }
  }
  for (const [dealId, ids] of approvedByDeal) {
    if (ids.length < 2) continue;
    warning(
      `deals/${dealId}`,
      "several_approved_quotes",
      `případ má víc schválených nabídek: ${ids.join(", ")}`,
      `the deal has several approved quotes: ${ids.join(", ")}`,
    );
  }

  const sections = new Set((settings?.quotes.sections ?? []).map((section) => section.id));
  for (const item of data.pricebook) {
    if (settings && item.sectionId !== undefined && !sections.has(item.sectionId)) {
      warning(
        `pricebook/${item.id}`,
        "unknown_quote_section",
        `sekce ${item.sectionId} v nastavení nabídek není`,
        `the quote settings have no section ${item.sectionId}`,
      );
    }
  }

  for (const entry of data.forecastEntries) {
    const record = `forecastEntries/${entry.id}`;
    const unknown = (code: string, cs: string, en: string) => error(record, code, cs, en);
    if (entry.companyId !== undefined && !companies.has(entry.companyId)) {
      unknown(
        "unknown_company",
        `firma ${entry.companyId} neexistuje`,
        `the company ${entry.companyId} does not exist`,
      );
    }
    if (entry.ownerId !== undefined && !salespeople.has(entry.ownerId)) {
      unknown(
        "unknown_salesperson",
        `obchodník ${entry.ownerId} neexistuje`,
        `the salesperson ${entry.ownerId} does not exist`,
      );
    }
    if (entry.dealId !== undefined && !deals.has(entry.dealId)) {
      unknown(
        "unknown_deal",
        `obchodní případ ${entry.dealId} neexistuje`,
        `the deal ${entry.dealId} does not exist`,
      );
    }
    if (!typeKnown(entry.dealTypeId)) {
      unknown(
        "unknown_deal_type",
        `typ zakázky ${entry.dealTypeId} neexistuje`,
        `the deal type ${entry.dealTypeId} does not exist`,
      );
    }
    if (!entityKnown(entry.billingEntityId)) {
      unknown(
        "unknown_billing_entity",
        `fakturační firma ${entry.billingEntityId} neexistuje`,
        `the billing entity ${entry.billingEntityId} does not exist`,
      );
    }
    checkPaymentDates(record, entry, error);
  }
  return issues;
}

type Report = (record: string, code: string, cs: string, en: string) => void;

/** A due date needs an invoice; a payment is paid no earlier than invoiced. */
function checkPaymentDates(
  record: string,
  value: {
    invoicedOn?: string | undefined;
    dueOn?: string | undefined;
    paidOn?: string | undefined;
  },
  error: Report,
  label = "",
): void {
  if (value.dueOn !== undefined && value.invoicedOn === undefined) {
    error(
      record,
      "due_without_invoice",
      `${label}splatnost má jen vystavená faktura`,
      `${label}only an issued invoice has a due date`,
    );
  }
  if (
    value.dueOn !== undefined &&
    value.invoicedOn !== undefined &&
    value.dueOn < value.invoicedOn
  ) {
    error(
      record,
      "due_before_invoice",
      `${label}splatnost je dřív než vystavení faktury`,
      `${label}the due date is before the invoice`,
    );
  }
  if (
    value.paidOn !== undefined &&
    value.invoicedOn !== undefined &&
    value.paidOn < value.invoicedOn
  ) {
    error(
      record,
      "paid_before_invoice",
      `${label}platba je dřív než vystavení faktury`,
      `${label}the payment is before the invoice`,
    );
  }
}

/** A planned payment plan sums exactly to the deal's value; an unassigned one plans nothing. */
function checkPlan(record: string, plan: PaymentPlan, value: number, error: Report): void {
  const ids = plan.payments.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    error(
      record,
      "payment_duplicate_id",
      "platba má stejné id dvakrát",
      "two payments have the same id",
    );
  }
  if (plan.status === "unassigned" && plan.payments.length > 0) {
    error(
      record,
      "unassigned_with_payments",
      "nezařazený plán nemá platby",
      "an unassigned plan has no payments",
    );
  }
  if (plan.status === "planned") {
    if (plan.payments.length === 0) {
      error(
        record,
        "plan_without_payments",
        "plán plateb nemá žádnou platbu",
        "the payment plan has no payment",
      );
    } else if (plannedTotal(plan) !== value) {
      error(
        record,
        "plan_sum",
        "platby plánu se nesčítají na hodnotu případu",
        "the payments of the plan do not add up to the value of the deal",
      );
    }
  }
  for (const entry of plan.payments) checkPaymentDates(record, entry, error, `${entry.id}: `);
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
