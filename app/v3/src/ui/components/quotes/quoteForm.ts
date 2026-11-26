import { slugify } from "../../../domain/common.ts";
import type { Company } from "../../../domain/company.ts";
import { lineAmount, parseMoney, parseScaled } from "../../../domain/money.ts";
import type { PricebookItem } from "../../../domain/pricebook.ts";
import {
  type CommercialTerms,
  CUSTOMER_SCOPES,
  nextLineId,
  type Quote,
  type QuoteLine,
  TERMS_AREAS,
  TERMS_CHOICES,
  type TermsArea,
  type TermsChoice,
} from "../../../domain/quote.ts";
import type { QuoteSection } from "../../../domain/settings.ts";
import type { Locale } from "../../../i18n/locale.ts";

/**
 * The editor's form of one quote revision: what the person types, as text
 * where it is a number, so a half-typed `1,` never turns into something
 * else. `buildQuote` turns it back into a quote and says what is wrong.
 */
export interface LineForm {
  id: string;
  sectionId: string;
  pricebookItemId: string;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
}

export interface CustomerForm {
  companyId: string;
  name: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CommercialForm {
  customerScope: CommercialTerms["customerScope"];
  termsVersion: string;
  termsUrl: string;
  acceptedOn: string;
  evidence: string;
  choices: Partial<Record<TermsArea, TermsChoice>>;
  note: string;
}

export interface QuoteForm {
  title: string;
  billingEntityId: string;
  issuedOn: string;
  validUntil: string;
  contactId: string;
  customer: CustomerForm;
  vatRate: string;
  reverseCharge: boolean;
  sections: QuoteSection[];
  lines: LineForm[];
  changeReserve: string;
  terms: { vatNote: string; payments: string; scope: string };
  commercial: CommercialForm;
  note: string;
}

/** A scaled integer as people read it: `1500` with 3 decimals → `1,5` in Czech, `1.5` in English. */
export function formatScaled(scaled: number, decimals: number, locale: Locale): string {
  const negative = scaled < 0;
  const absolute = Math.abs(Math.round(scaled));
  const unit = 10 ** decimals;
  const whole = Math.floor(absolute / unit);
  const fraction = String(absolute % unit)
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const mark = locale === "en" ? "." : ",";
  return `${negative ? "-" : ""}${whole}${fraction ? `${mark}${fraction}` : ""}`;
}

/** A quantity (≤ 3 decimals) as text: `1.5` → `1,5`. */
export function formatQuantity(value: number, locale: Locale): string {
  return formatScaled(Math.round(value * 1000), 3, locale);
}

/** Basis points as a percent number without the sign: `2100` → `21`, `1250` → `12,5`. */
export function formatPercent(basisPoints: number, locale: Locale): string {
  return formatScaled(basisPoints, 2, locale);
}

/** An amount in haléře as editable text without grouping: `123450` → `1234,50`. */
export function formatEditAmount(amount: number, locale: Locale): string {
  const whole = Math.floor(amount / 100);
  const rest = String(amount % 100).padStart(2, "0");
  return `${whole}${locale === "en" ? "." : ","}${rest}`;
}

/** A typed quantity: positive, at most three decimals; null otherwise. */
export function parseQuantity(text: string, locale: Locale): number | null {
  const milli = parseScaled(text, 3, locale);
  if (milli === null || milli <= 0 || milli > 1_000_000_000_000) return null;
  return milli / 1000;
}

/** A typed percent as basis points, 0–100 % with at most two decimals; null otherwise. */
export function parsePercent(text: string, locale: Locale): number | null {
  const value = parseScaled(text, 2, locale);
  if (value === null || value < 0 || value > 10_000) return null;
  return value;
}

/** A typed amount in haléře, zero or more; null otherwise. */
export function parseAmount(text: string, locale: Locale): number | null {
  const value = parseMoney(text, locale);
  if (value === null || value < 0) return null;
  return value;
}

function lineFormOf(line: QuoteLine, locale: Locale): LineForm {
  return {
    id: line.id,
    sectionId: line.sectionId,
    pricebookItemId: line.pricebookItemId ?? "",
    name: line.name,
    description: line.description ?? "",
    quantity: formatQuantity(line.quantity, locale),
    unit: line.unit,
    unitPrice: formatEditAmount(line.unitPrice, locale),
    discount: line.discount ? formatPercent(line.discount, locale) : "",
  };
}

export function customerFormOf(customer: Quote["customer"] | undefined): CustomerForm {
  return {
    companyId: customer?.companyId ?? "",
    name: customer?.name ?? "",
    ico: customer?.ico ?? "",
    dic: customer?.dic ?? "",
    street: customer?.address?.street ?? "",
    city: customer?.address?.city ?? "",
    postalCode: customer?.address?.postalCode ?? "",
    country: customer?.address?.country ?? "",
  };
}

/** The customer copy taken afresh from a company. */
export function customerFromCompany(company: Company): CustomerForm {
  return customerFormOf({
    companyId: company.id,
    name: company.name,
    ico: company.ico,
    dic: company.dic,
    address: company.address,
  });
}

/** The form of a stored quote. */
export function quoteFormOf(quote: Quote | undefined, locale: Locale): QuoteForm {
  const commercial = quote?.commercialTerms;
  return {
    title: quote?.title ?? "",
    billingEntityId: quote?.billingEntityId ?? "",
    issuedOn: quote?.issuedOn ?? "",
    validUntil: quote?.validUntil ?? "",
    contactId: quote?.contactId ?? "",
    customer: customerFormOf(quote?.customer),
    vatRate: formatPercent(quote?.vatRate ?? 0, locale),
    reverseCharge: quote?.reverseCharge === true,
    sections: (quote?.sections ?? []).map((section) => ({ ...section })),
    lines: (quote?.lines ?? []).map((line) => lineFormOf(line, locale)),
    changeReserve: quote?.changeReserve ? formatEditAmount(quote.changeReserve, locale) : "",
    terms: {
      vatNote: quote?.terms?.vatNote ?? "",
      payments: quote?.terms?.payments ?? "",
      scope: quote?.terms?.scope ?? "",
    },
    commercial: {
      customerScope: commercial?.customerScope ?? "unresolved",
      termsVersion: commercial?.termsVersion ?? "",
      termsUrl: commercial?.termsUrl ?? "",
      acceptedOn: commercial?.acceptedOn ?? "",
      evidence: commercial?.evidence ?? "",
      choices: { ...(commercial?.choices ?? {}) },
      note: commercial?.note ?? "",
    },
    note: quote?.note ?? "",
  };
}

/** A line of the form as the price list item gives it. */
export function lineFromItem(
  item: PricebookItem,
  sectionId: string,
  lines: readonly Pick<LineForm, "id">[],
  locale: Locale,
): LineForm {
  return {
    id: nextLineId(lines),
    sectionId,
    pricebookItemId: item.id,
    name: item.name,
    description: item.description ?? "",
    quantity: "1",
    unit: item.unit,
    unitPrice: formatEditAmount(item.unitPrice, locale),
    discount: "",
  };
}

/** An empty line of the person's own. */
export function customLine(
  sectionId: string,
  lines: readonly Pick<LineForm, "id">[],
  unit: string,
): LineForm {
  return {
    id: nextLineId(lines),
    sectionId,
    pricebookItemId: "",
    name: "",
    description: "",
    quantity: "1",
    unit,
    unitPrice: "",
    discount: "",
  };
}

/** A free section id from a label: `Doprava` → `doprava`, `doprava-2` when taken. */
export function sectionIdFor(label: string, sections: readonly QuoteSection[]): string {
  const base = slugify(label) || "section";
  const used = new Set(sections.map((section) => section.id));
  if (!used.has(base)) return base;
  let number = 2;
  while (used.has(`${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

/** What is wrong with one line, by field. */
export interface LineProblems {
  name?: true;
  quantity?: true;
  unit?: true;
  unitPrice?: true;
  discount?: true;
}

export interface QuoteProblems {
  title?: true;
  issuedOn?: true;
  validUntil?: true;
  customerName?: true;
  ico?: true;
  vatRate?: true;
  changeReserve?: true;
  lines: Record<string, LineProblems>;
  /** Whether anything at all is wrong. */
  any: boolean;
}

/** The parsed line, or null while one of its numbers is not valid. */
export function parsedLine(line: LineForm, locale: Locale): QuoteLine | null {
  const quantity = parseQuantity(line.quantity, locale);
  const unitPrice = parseAmount(line.unitPrice, locale);
  const discount = line.discount.trim() === "" ? 0 : parsePercent(line.discount, locale);
  if (quantity === null || unitPrice === null || discount === null) return null;
  return {
    id: line.id,
    sectionId: line.sectionId,
    ...(line.pricebookItemId ? { pricebookItemId: line.pricebookItemId } : {}),
    name: line.name.trim(),
    ...(line.description.trim() ? { description: line.description.trim() } : {}),
    quantity,
    unit: line.unit.trim(),
    unitPrice,
    ...(discount > 0 ? { discount } : {}),
  };
}

/** The amount of a line as typed, or null while it is not valid. */
export function lineFormAmount(line: LineForm, locale: Locale): number | null {
  const parsed = parsedLine(line, locale);
  return parsed ? lineAmount(parsed.unitPrice, parsed.quantity, parsed.discount ?? 0) : null;
}

export function problemsOf(form: QuoteForm, locale: Locale): QuoteProblems {
  const problems: QuoteProblems = { lines: {}, any: false };
  const flag = (key: Exclude<keyof QuoteProblems, "lines" | "any">) => {
    problems[key] = true;
    problems.any = true;
  };
  if (!form.title.trim()) flag("title");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.issuedOn)) flag("issuedOn");
  if (form.validUntil && form.validUntil < form.issuedOn) flag("validUntil");
  if (!form.customer.name.trim()) flag("customerName");
  if (form.customer.ico.trim() && !/^[0-9]{8}$/.test(form.customer.ico.trim())) flag("ico");
  if (parsePercent(form.vatRate, locale) === null) flag("vatRate");
  if (form.changeReserve.trim() && parseAmount(form.changeReserve, locale) === null)
    flag("changeReserve");
  for (const line of form.lines) {
    const found: LineProblems = {};
    if (!line.name.trim()) found.name = true;
    if (parseQuantity(line.quantity, locale) === null) found.quantity = true;
    if (!line.unit.trim()) found.unit = true;
    if (parseAmount(line.unitPrice, locale) === null) found.unitPrice = true;
    if (line.discount.trim() && parsePercent(line.discount, locale) === null) found.discount = true;
    if (Object.keys(found).length > 0) {
      problems.lines[line.id] = found;
      problems.any = true;
    }
  }
  return problems;
}

/** The lines and numbers of the form that parse, for the live totals. */
export function previewOf(form: QuoteForm, locale: Locale) {
  return {
    sections: form.sections,
    lines: form.lines.flatMap((line) => {
      const parsed = parsedLine(line, locale);
      return parsed ? [parsed] : [];
    }),
    vatRate: parsePercent(form.vatRate, locale) ?? 0,
    reverseCharge: form.reverseCharge,
    changeReserve: parseAmount(form.changeReserve, locale) ?? 0,
  };
}

const optional = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * The quote the form describes, on top of the stored revision it came from;
 * null while `problemsOf` finds something wrong.
 */
export function buildQuote(base: Quote, form: QuoteForm, locale: Locale): Quote | null {
  if (problemsOf(form, locale).any) return null;
  const lines = form.lines.map((line) => parsedLine(line, locale) as QuoteLine);
  const address = withoutUndefined({
    street: optional(form.customer.street),
    city: optional(form.customer.city),
    postalCode: optional(form.customer.postalCode),
    country: optional(form.customer.country),
  });
  const customer = withoutUndefined({
    companyId: optional(form.customer.companyId),
    name: form.customer.name.trim(),
    ico: optional(form.customer.ico),
    dic: optional(form.customer.dic),
    address: Object.keys(address).length > 0 ? address : undefined,
  });
  const terms = withoutUndefined({
    vatNote: optional(form.terms.vatNote),
    payments: optional(form.terms.payments),
    scope: optional(form.terms.scope),
  });
  const choices = Object.fromEntries(
    TERMS_AREAS.flatMap((area) => {
      const choice = form.commercial.choices[area];
      return choice && TERMS_CHOICES.includes(choice) ? [[area, choice]] : [];
    }),
  );
  const commercial = withoutUndefined({
    customerScope: CUSTOMER_SCOPES.includes(form.commercial.customerScope)
      ? form.commercial.customerScope
      : "unresolved",
    termsVersion: optional(form.commercial.termsVersion),
    termsUrl: optional(form.commercial.termsUrl),
    acceptedOn: optional(form.commercial.acceptedOn),
    evidence: optional(form.commercial.evidence),
    choices: Object.keys(choices).length > 0 ? choices : undefined,
    note: optional(form.commercial.note),
  }) as CommercialTerms;
  const commercialSet =
    base.commercialTerms !== undefined ||
    commercial.customerScope !== "unresolved" ||
    Object.keys(commercial).length > 1;
  const reserve = form.changeReserve.trim() ? parseAmount(form.changeReserve, locale) : 0;
  const {
    validUntil: _validUntil,
    billingEntityId: _entity,
    contactId: _contact,
    reverseCharge: _reverse,
    changeReserve: _reserve,
    terms: _terms,
    commercialTerms: _commercial,
    note: _note,
    ...kept
  } = base;
  return {
    ...kept,
    title: form.title.trim(),
    issuedOn: form.issuedOn,
    ...(form.validUntil ? { validUntil: form.validUntil } : {}),
    ...(form.billingEntityId ? { billingEntityId: form.billingEntityId } : {}),
    customer,
    ...(form.contactId ? { contactId: form.contactId } : {}),
    vatRate: parsePercent(form.vatRate, locale) as number,
    ...(form.reverseCharge ? { reverseCharge: true } : {}),
    sections: form.sections.map((section) => ({ id: section.id, label: section.label.trim() })),
    lines,
    ...(reserve ? { changeReserve: reserve } : {}),
    ...(Object.keys(terms).length > 0 ? { terms } : {}),
    ...(commercialSet ? { commercialTerms: commercial } : {}),
    ...(optional(form.note) ? { note: form.note.trim() } : {}),
  };
}
