import type { DataSet } from "./collections.ts";
import { addDays, daysBetween, monthOf } from "./common.ts";
import type { Deal } from "./deal.ts";
import { averageAmount, roundDiv, safe, sumAmounts } from "./money.ts";
import { addMonths } from "./payment-plan.ts";
import { type Quote, quoteTotals } from "./quote.ts";
import type { Settings, Stage, StageKind } from "./settings.ts";

/**
 * The statistics of a period, a pure function of the data.
 *
 * A deal is closed in the period when its stage is won or lost and its
 * closing date lies between `from` and `to`, both included; it is new in the
 * period when it was created in it. The conversion is won / (won + lost) of
 * the deals closed in the period, in basis points rounded half up (6000 =
 * 60 %). Averages are rounded half up to a whole haléř and a whole day.
 *
 * Every figure is compared with the previous period of the same length, the
 * days right before `from`. Every count carries the ids of the deals or
 * quotes behind it, so the App opens them from any number. A filter by
 * salesperson or deal type narrows every figure but the stages' settings.
 */
export interface StatsPeriod {
  /** `YYYY-MM-DD`, included. */
  from: string;
  /** `YYYY-MM-DD`, included. */
  to: string;
}

export interface StatsFilter {
  ownerId?: string | undefined;
  dealTypeId?: string | undefined;
}

export interface CountAndValue {
  count: number;
  value: number;
}

/** A count and a value with the records behind them. */
export interface Figure extends CountAndValue {
  ids: string[];
}

export interface StageStats extends Figure {
  stageId: string;
  label: string;
  kind: StageKind;
}

export interface LossReasonStats extends Figure {
  reasonId: string;
  label: string;
}

/** The headline figures of one period. */
export interface PeriodFigures {
  won: Figure;
  lost: Figure;
  created: Figure;
  quotes: Figure;
  conversionBasisPoints: number | null;
  averageWonValue: number | null;
  averageCycleDays: number | null;
}

export interface LeaderboardRow {
  ownerId: string;
  won: Figure;
  previous: Figure;
  open: Figure;
}

export interface MonthFigure extends Figure {
  month: string;
}

/** A bucket of a chart: a week (from its Monday) or a month. */
export interface Bucket {
  /** The first day of the bucket in the period. */
  from: string;
  to: string;
}

export interface CreatedBucket extends Bucket {
  open: Figure;
  won: Figure;
  lost: Figure;
}

export interface QuoteBucket extends Bucket, Figure {}

/** The won value summed day by day: the period against the previous one. */
export interface CumulativePoint {
  day: number;
  date: string;
  value: number;
  previous: number;
}

export interface Stats {
  period: StatsPeriod;
  previousPeriod: StatsPeriod;
  currency: string;
  current: PeriodFigures;
  previous: PeriodFigures;
  /** Open deals now: the pipeline has no history, so no comparison. */
  pipeline: Figure;
  leaderboard: LeaderboardRow[];
  /** Won deals by the month they closed: the 12 months up to the period's end. */
  wonByMonth: MonthFigure[];
  /** Weeks for a period of up to 120 days, months for a longer one. */
  bucket: "week" | "month";
  createdByBucket: CreatedBucket[];
  quotesByBucket: QuoteBucket[];
  cumulative: CumulativePoint[];
  byStage: StageStats[];
  lostByReason: LossReasonStats[];
  /* The figures of the period, as before 0.2.0. */
  won: CountAndValue;
  lost: CountAndValue;
  conversionBasisPoints: number | null;
  averageWonValue: number | null;
  averageCycleDays: number | null;
}

const figure = (entries: readonly { id: string; value: number }[]): Figure => ({
  count: entries.length,
  value: sumAmounts(entries.map((entry) => entry.value)),
  ids: entries.map((entry) => entry.id),
});

const within = (date: string | undefined, period: StatsPeriod) =>
  date !== undefined && date >= period.from && date <= period.to;

/** The deals of a data set with their stage; a deal whose stage is unknown is left out. */
export function dealsWithStage(
  data: Pick<DataSet, "deals">,
  settings: Pick<Settings, "stages">,
): { deal: Deal; stage: Stage }[] {
  const stages = new Map(settings.stages.map((stage) => [stage.id, stage]));
  return data.deals.flatMap((deal) => {
    const stage = stages.get(deal.stageId);
    return stage ? [{ deal, stage }] : [];
  });
}

/** The previous period of the same length: the days right before `from`. */
export function previousPeriod(period: StatsPeriod): StatsPeriod {
  const days = daysBetween(period.from, period.to) + 1;
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

/** The Monday of a date's week. */
export function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** The weeks or months of a period, each clipped to it. */
export function bucketsOf(period: StatsPeriod, kind: "week" | "month"): Bucket[] {
  const buckets: Bucket[] = [];
  let start = period.from;
  while (start <= period.to) {
    const next =
      kind === "week" ? addDays(mondayOf(start), 7) : `${addMonths(monthOf(start), 1)}-01`;
    const end = addDays(next, -1) < period.to ? addDays(next, -1) : period.to;
    buckets.push({ from: start, to: end });
    start = next;
  }
  return buckets;
}

export function stats(data: DataSet, period: StatsPeriod, filter: StatsFilter = {}): Stats {
  if (period.to < period.from) throw new RangeError("the period ends before it starts");
  const settings = data.settings;
  const currency = settings?.currency ?? "CZK";
  const before = previousPeriod(period);
  const days = daysBetween(period.from, period.to) + 1;
  const bucket: "week" | "month" = days <= 120 ? "week" : "month";
  const kept = (deal: Deal) =>
    (filter.ownerId === undefined || deal.ownerId === filter.ownerId) &&
    (filter.dealTypeId === undefined || deal.dealTypeId === filter.dealTypeId);
  const deals = settings ? dealsWithStage(data, settings).filter(({ deal }) => kept(deal)) : [];
  const dealIds = new Set(deals.map(({ deal }) => deal.id));
  const quotes = data.quotes.filter((entry) => dealIds.has(entry.dealId));
  const quoteValue = (entry: Quote) => ({ id: entry.id, value: quoteTotals(entry).subtotal });
  const won = deals.filter(({ stage }) => stage.kind === "won").map(({ deal }) => deal);
  const lost = deals.filter(({ stage }) => stage.kind === "lost").map(({ deal }) => deal);
  const open = deals.filter(({ stage }) => stage.kind === "open").map(({ deal }) => deal);

  function figuresOf(range: StatsPeriod): PeriodFigures {
    const wonIn = won.filter((deal) => within(deal.closedAt, range));
    const lostIn = lost.filter((deal) => within(deal.closedAt, range));
    const decided = wonIn.length + lostIn.length;
    const cycles = wonIn.map((deal) => daysBetween(deal.createdAt, deal.closedAt as string));
    return {
      won: figure(wonIn),
      lost: figure(lostIn),
      created: figure(
        deals.map(({ deal }) => deal).filter((deal) => within(deal.createdAt, range)),
      ),
      quotes: figure(quotes.filter((entry) => within(entry.issuedOn, range)).map(quoteValue)),
      conversionBasisPoints:
        decided === 0 ? null : safe(roundDiv(BigInt(wonIn.length) * 10_000n, BigInt(decided))),
      averageWonValue: averageAmount(wonIn.map((deal) => deal.value)),
      averageCycleDays:
        cycles.length === 0
          ? null
          : safe(
              roundDiv(
                BigInt(cycles.reduce((sum, value) => sum + value, 0)),
                BigInt(cycles.length),
              ),
            ),
    };
  }

  const current = figuresOf(period);
  const previous = figuresOf(before);

  const owners = [
    ...data.salespeople.map((entry) => entry.id),
    ...new Set(deals.map(({ deal }) => deal.ownerId)),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const leaderboard: LeaderboardRow[] = owners
    .map((ownerId) => ({
      ownerId,
      won: figure(won.filter((deal) => deal.ownerId === ownerId && within(deal.closedAt, period))),
      previous: figure(
        won.filter((deal) => deal.ownerId === ownerId && within(deal.closedAt, before)),
      ),
      open: figure(open.filter((deal) => deal.ownerId === ownerId)),
    }))
    .filter((row) => row.won.count + row.previous.count + row.open.count > 0)
    .sort((left, right) => right.won.value - left.won.value || right.open.value - left.open.value);

  const lastMonth = monthOf(period.to);
  const wonByMonth: MonthFigure[] = Array.from({ length: 12 }, (_, index) => {
    const month = addMonths(lastMonth, index - 11);
    return { month, ...figure(won.filter((deal) => deal.closedAt?.startsWith(month))) };
  });

  const buckets = bucketsOf(period, bucket);
  const createdByBucket: CreatedBucket[] = buckets.map((range) => {
    const fresh = deals.filter(({ deal }) => within(deal.createdAt, range));
    const of = (kind: StageKind) =>
      figure(fresh.filter(({ stage }) => stage.kind === kind).map(({ deal }) => deal));
    return { ...range, open: of("open"), won: of("won"), lost: of("lost") };
  });
  const quotesByBucket: QuoteBucket[] = buckets.map((range) => ({
    ...range,
    ...figure(quotes.filter((entry) => within(entry.issuedOn, range)).map(quoteValue)),
  }));

  const daily = (range: StatsPeriod) => {
    const byDay = new Map<string, bigint>();
    for (const deal of won) {
      if (!within(deal.closedAt, range)) continue;
      const day = deal.closedAt as string;
      byDay.set(day, (byDay.get(day) ?? 0n) + BigInt(deal.value));
    }
    return byDay;
  };
  const nowByDay = daily(period);
  const thenByDay = daily(before);
  let runningNow = 0n;
  let runningThen = 0n;
  const cumulative: CumulativePoint[] = Array.from({ length: days }, (_, day) => {
    const date = addDays(period.from, day);
    runningNow += nowByDay.get(date) ?? 0n;
    runningThen += thenByDay.get(addDays(before.from, day)) ?? 0n;
    return { day, date, value: safe(runningNow), previous: safe(runningThen) };
  });

  const closedIn = deals.filter(
    ({ deal, stage }) => stage.kind !== "open" && within(deal.closedAt, period),
  );
  const byStage: StageStats[] = (settings?.stages ?? []).map((stage) => ({
    stageId: stage.id,
    label: stage.label,
    kind: stage.kind,
    ...figure(
      (stage.kind === "open" ? deals : closedIn)
        .filter((entry) => entry.stage.id === stage.id)
        .map(({ deal }) => deal),
    ),
  }));
  const lostIn = lost.filter((deal) => within(deal.closedAt, period));
  const lostByReason: LossReasonStats[] = (settings?.lossReasons ?? []).map((reason) => ({
    reasonId: reason.id,
    label: reason.label,
    ...figure(lostIn.filter((deal) => deal.lossReasonId === reason.id)),
  }));

  const plain = ({ count, value }: CountAndValue): CountAndValue => ({ count, value });
  return {
    period,
    previousPeriod: before,
    currency,
    current,
    previous,
    pipeline: figure(open),
    leaderboard,
    wonByMonth,
    bucket,
    createdByBucket,
    quotesByBucket,
    cumulative,
    byStage,
    lostByReason,
    won: plain(current.won),
    lost: plain(current.lost),
    conversionBasisPoints: current.conversionBasisPoints,
    averageWonValue: current.averageWonValue,
    averageCycleDays: current.averageCycleDays,
  };
}

/** The change of a figure against the previous period in basis points; null from zero. */
export function changeBasisPoints(now: number, before: number): number | null {
  if (before === 0) return null;
  return safe(roundDiv(BigInt(now - before) * 10_000n, BigInt(before)));
}
