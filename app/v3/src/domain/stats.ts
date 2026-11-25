import type { DataSet } from "./collections.ts";
import { daysBetween } from "./common.ts";
import { dealsWithStage } from "./forecast.ts";
import { averageAmount, roundDiv, safe, sumAmounts } from "./money.ts";
import type { StageKind } from "./settings.ts";

/**
 * The statistics of a period, a pure function of the data.
 *
 * A deal is closed in the period when its stage is won or lost and its
 * closing date lies between `from` and `to`, both included. The conversion
 * is won / (won + lost) of those deals, in basis points rounded half up
 * (6000 = 60 %). The average value and the average sales cycle (days from
 * `createdAt` to `closedAt`) are of the won deals, rounded half up to a whole
 * haléř and a whole day. By stage, an open stage counts the deals in it now
 * (the pipeline has no history of its stages), a won or lost stage the deals
 * closed in the period. Lost deals are counted by their reason, in the order
 * of the settings, a reason no deal names with zero.
 */
export interface StatsPeriod {
  /** `YYYY-MM-DD`, included. */
  from: string;
  /** `YYYY-MM-DD`, included. */
  to: string;
}

export interface CountAndValue {
  count: number;
  value: number;
}

export interface StageStats extends CountAndValue {
  stageId: string;
  label: string;
  kind: StageKind;
}

export interface LossReasonStats extends CountAndValue {
  reasonId: string;
  label: string;
}

export interface Stats {
  period: StatsPeriod;
  currency: string;
  won: CountAndValue;
  lost: CountAndValue;
  /** Won / (won + lost) in basis points, half up; null with nothing closed. */
  conversionBasisPoints: number | null;
  /** The average value of a won deal in haléře, half up; null with none won. */
  averageWonValue: number | null;
  /** The average days from creation to winning, half up; null with none won. */
  averageCycleDays: number | null;
  byStage: StageStats[];
  lostByReason: LossReasonStats[];
}

const countAndValue = (values: readonly number[]): CountAndValue => ({
  count: values.length,
  value: sumAmounts(values),
});

export function stats(data: DataSet, period: StatsPeriod): Stats {
  if (period.to < period.from) throw new RangeError("the period ends before it starts");
  const settings = data.settings;
  const currency = settings?.currency ?? "CZK";
  const none = { count: 0, value: 0 };
  if (!settings) {
    return {
      period,
      currency,
      won: none,
      lost: none,
      conversionBasisPoints: null,
      averageWonValue: null,
      averageCycleDays: null,
      byStage: [],
      lostByReason: [],
    };
  }
  const deals = dealsWithStage(data, settings);
  const inPeriod = (closedAt: string | undefined) =>
    closedAt !== undefined && closedAt >= period.from && closedAt <= period.to;
  const closed = deals.filter(
    ({ deal, stage }) => stage.kind !== "open" && inPeriod(deal.closedAt),
  );
  const won = closed.filter(({ stage }) => stage.kind === "won").map(({ deal }) => deal);
  const lost = closed.filter(({ stage }) => stage.kind === "lost").map(({ deal }) => deal);
  const decided = won.length + lost.length;
  const cycles = won.map((deal) => daysBetween(deal.createdAt, deal.closedAt as string));
  const counted = (kind: StageKind) => (kind === "open" ? deals : closed);
  return {
    period,
    currency,
    won: countAndValue(won.map((deal) => deal.value)),
    lost: countAndValue(lost.map((deal) => deal.value)),
    conversionBasisPoints:
      decided === 0 ? null : safe(roundDiv(BigInt(won.length) * 10_000n, BigInt(decided))),
    averageWonValue: averageAmount(won.map((deal) => deal.value)),
    averageCycleDays:
      cycles.length === 0
        ? null
        : safe(
            roundDiv(BigInt(cycles.reduce((sum, days) => sum + days, 0)), BigInt(cycles.length)),
          ),
    byStage: settings.stages.map((stage) => ({
      stageId: stage.id,
      label: stage.label,
      kind: stage.kind,
      ...countAndValue(
        counted(stage.kind)
          .filter((entry) => entry.stage.id === stage.id)
          .map(({ deal }) => deal.value),
      ),
    })),
    lostByReason: settings.lossReasons.map((reason) => ({
      reasonId: reason.id,
      label: reason.label,
      ...countAndValue(
        lost.filter((deal) => deal.lossReasonId === reason.id).map((deal) => deal.value),
      ),
    })),
  };
}
