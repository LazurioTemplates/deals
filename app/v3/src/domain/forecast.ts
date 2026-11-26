import type { DataSet } from "./collections.ts";
import { sumAmounts } from "./money.ts";
import { type PaymentState, paymentState, shareOfValue } from "./payment-plan.ts";
import type { Settings } from "./settings.ts";

/**
 * The forecast: what the Organization invoices month by month, a pure
 * function of the data and today.
 *
 * It is the payments of won deals' payment plans and the manual rows of the
 * forecast (`forecastEntries`), never a weighted guess over open deals. Each
 * row has a state: planned, invoiced, overdue (invoiced, unpaid, past due) or
 * paid. A won deal without a planned payment plan is „unassigned“: it waits
 * for somebody to plan it, in any year.
 *
 * Rows group by salesperson, deal type and billing entity; the same three
 * filter the whole forecast.
 */
export interface ForecastRow {
  /** `deals/<id>#<payment>` or `forecastEntries/<id>`: stable across reloads. */
  key: string;
  kind: "payment" | "entry";
  month: string;
  amount: number;
  state: PaymentState;
  title: string;
  dealId?: string | undefined;
  paymentId?: string | undefined;
  entryId?: string | undefined;
  companyId?: string | undefined;
  ownerId?: string | undefined;
  dealTypeId?: string | undefined;
  billingEntityId?: string | undefined;
  /** A payment's share of its deal's value, in basis points. */
  share?: number | undefined;
  /** How many payments the plan has and which one this is (1-based). */
  of?: { index: number; count: number } | undefined;
  label?: string | undefined;
  invoicedOn?: string | undefined;
  dueOn?: string | undefined;
  paidOn?: string | undefined;
  reverseCharge?: boolean | undefined;
  note?: string | undefined;
}

export interface ForecastAmounts {
  /** Every row's amount. */
  forecast: number;
  /** Rows with an invoice issued (invoiced, overdue or paid). */
  invoiced: number;
  paid: number;
  overdue: number;
  /** Invoiced and not paid yet („Na cestě“). */
  onTheWay: number;
  count: number;
}

export interface ForecastMonth extends ForecastAmounts {
  month: string;
}

export interface ForecastQuarter extends ForecastAmounts {
  quarter: 1 | 2 | 3 | 4;
}

export interface ForecastGroup extends ForecastAmounts {
  /** The id of the salesperson, the deal type or the entity; null for rows without one. */
  id: string | null;
}

export interface UnassignedDeal {
  dealId: string;
  title: string;
  value: number;
  closedAt?: string | undefined;
  companyId: string;
  ownerId: string;
  dealTypeId?: string | undefined;
  billingEntityId?: string | undefined;
}

export interface Forecast {
  currency: string;
  year: number;
  /** The years with a row, and this year, ascending. */
  years: number[];
  /** January to December of the year. */
  months: ForecastMonth[];
  quarters: ForecastQuarter[];
  total: ForecastAmounts;
  /** The rows of the year, by month and then title. */
  rows: ForecastRow[];
  unassigned: UnassignedDeal[];
  groups: { owner: ForecastGroup[]; dealType: ForecastGroup[]; billingEntity: ForecastGroup[] };
}

export interface ForecastFilter {
  ownerId?: string | undefined;
  dealTypeId?: string | undefined;
  billingEntityId?: string | undefined;
}

export interface ForecastOptions {
  /** Today, `YYYY-MM-DD`: an invoice due before it is overdue. */
  today: string;
  /** The year shown; this year by default. */
  year?: number | undefined;
  filter?: ForecastFilter | undefined;
}

/** Every row of the forecast across years, without a filter. */
export function forecastRows(data: DataSet, today: string): ForecastRow[] {
  const settings = data.settings;
  const defaultEntity = settings?.billingEntities?.[0]?.id;
  const rows: ForecastRow[] = [];
  const wonStages = new Set(
    (settings?.stages ?? []).filter((stage) => stage.kind === "won").map((stage) => stage.id),
  );
  for (const deal of data.deals) {
    if (!wonStages.has(deal.stageId)) continue;
    const plan = deal.paymentPlan;
    if (!plan || plan.status !== "planned") continue;
    const count = plan.payments.length;
    plan.payments.forEach((entry, index) => {
      rows.push({
        key: `deals/${deal.id}#${entry.id}`,
        kind: "payment",
        month: entry.month,
        amount: entry.amount,
        state: paymentState(entry, today),
        title: deal.title,
        dealId: deal.id,
        paymentId: entry.id,
        companyId: deal.companyId,
        ownerId: deal.ownerId,
        dealTypeId: deal.dealTypeId,
        billingEntityId: deal.billingEntityId ?? defaultEntity,
        share: shareOfValue(entry.amount, deal.value),
        of: { index: index + 1, count },
        label: entry.label,
        invoicedOn: entry.invoicedOn,
        dueOn: entry.dueOn,
        paidOn: entry.paidOn,
        reverseCharge: plan.reverseCharge,
        note: entry.note,
      });
    });
  }
  for (const entry of data.forecastEntries) {
    rows.push({
      key: `forecastEntries/${entry.id}`,
      kind: "entry",
      month: entry.month,
      amount: entry.amount,
      state: paymentState(entry, today),
      title: entry.title,
      entryId: entry.id,
      dealId: entry.dealId,
      companyId: entry.companyId,
      ownerId: entry.ownerId,
      dealTypeId: entry.dealTypeId,
      billingEntityId: entry.billingEntityId ?? defaultEntity,
      invoicedOn: entry.invoicedOn,
      dueOn: entry.dueOn,
      paidOn: entry.paidOn,
      reverseCharge: entry.reverseCharge,
      note: entry.note,
    });
  }
  return rows.sort(
    (left, right) =>
      left.month.localeCompare(right.month) ||
      left.title.localeCompare(right.title, "cs") ||
      left.key.localeCompare(right.key),
  );
}

/** The amounts of some rows. */
export function amountsOf(rows: readonly ForecastRow[]): ForecastAmounts {
  const of = (keep: (row: ForecastRow) => boolean) =>
    sumAmounts(rows.filter(keep).map((row) => row.amount));
  return {
    forecast: of(() => true),
    invoiced: of((row) => row.state !== "planned"),
    paid: of((row) => row.state === "paid"),
    overdue: of((row) => row.state === "overdue"),
    onTheWay: of((row) => row.state === "invoiced" || row.state === "overdue"),
    count: rows.length,
  };
}

function matches(
  row: Pick<ForecastRow, "ownerId" | "dealTypeId" | "billingEntityId">,
  filter: ForecastFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.ownerId !== undefined && row.ownerId !== filter.ownerId) return false;
  if (filter.dealTypeId !== undefined && row.dealTypeId !== filter.dealTypeId) return false;
  if (filter.billingEntityId !== undefined && row.billingEntityId !== filter.billingEntityId) {
    return false;
  }
  return true;
}

function groupBy(
  rows: readonly ForecastRow[],
  pick: (row: ForecastRow) => string | undefined,
  order: readonly string[],
): ForecastGroup[] {
  const byId = new Map<string | null, ForecastRow[]>();
  for (const row of rows) {
    const id = pick(row) ?? null;
    byId.set(id, [...(byId.get(id) ?? []), row]);
  }
  const rank = (id: string | null) => (id === null ? order.length + 1 : order.indexOf(id));
  return [...byId]
    .map(([id, entries]) => ({ id, ...amountsOf(entries) }))
    .sort((left, right) => right.forecast - left.forecast || rank(left.id) - rank(right.id));
}

export function forecast(data: DataSet, options: ForecastOptions): Forecast {
  const settings: Settings | null = data.settings;
  const thisYear = Number(options.today.slice(0, 4));
  const year = options.year ?? thisYear;
  const all = forecastRows(data, options.today).filter((row) => matches(row, options.filter));
  const years = [...new Set([thisYear, ...all.map((row) => Number(row.month.slice(0, 4)))])].sort(
    (left, right) => left - right,
  );
  const rows = all.filter((row) => row.month.startsWith(`${year}-`));
  const months: ForecastMonth[] = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { month, ...amountsOf(rows.filter((row) => row.month === month)) };
  });
  const quarters: ForecastQuarter[] = ([1, 2, 3, 4] as const).map((quarter) => ({
    quarter,
    ...amountsOf(rows.filter((row) => Math.ceil(Number(row.month.slice(5, 7)) / 3) === quarter)),
  }));
  const wonStages = new Set(
    (settings?.stages ?? []).filter((stage) => stage.kind === "won").map((stage) => stage.id),
  );
  const defaultEntity = settings?.billingEntities?.[0]?.id;
  const unassigned: UnassignedDeal[] = data.deals
    .filter((deal) => wonStages.has(deal.stageId) && deal.paymentPlan?.status !== "planned")
    .map((deal) => ({
      dealId: deal.id,
      title: deal.title,
      value: deal.value,
      closedAt: deal.closedAt,
      companyId: deal.companyId,
      ownerId: deal.ownerId,
      dealTypeId: deal.dealTypeId,
      billingEntityId: deal.billingEntityId ?? defaultEntity,
    }))
    .filter((deal) => matches(deal, options.filter))
    .sort((left, right) => (right.closedAt ?? "").localeCompare(left.closedAt ?? ""));
  const ownerOrder = data.salespeople.map((entry) => entry.id);
  const typeOrder = (settings?.dealTypes ?? []).map((entry) => entry.id);
  const entityOrder = (settings?.billingEntities ?? []).map((entry) => entry.id);
  return {
    currency: settings?.currency ?? "CZK",
    year,
    years,
    months,
    quarters,
    total: amountsOf(rows),
    rows,
    unassigned,
    groups: {
      owner: groupBy(rows, (row) => row.ownerId, ownerOrder),
      dealType: groupBy(rows, (row) => row.dealTypeId, typeOrder),
      billingEntity: groupBy(rows, (row) => row.billingEntityId, entityOrder),
    },
  };
}
