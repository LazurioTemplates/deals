import type { DataSet } from "./collections.ts";
import { monthOf } from "./common.ts";
import { type Deal, probabilityOf } from "./deal.ts";
import { sumAmounts, weightedHundredths, weightedTotal } from "./money.ts";
import type { Settings, Stage } from "./settings.ts";

/**
 * The forecast of the pipeline, a pure function of the data and today.
 *
 * Every open deal counts with `value × probability / 100`, the deal's own
 * probability or else its stage's. Deals are grouped by the month of their
 * expected closing date; a deal without one, or with one that has already
 * passed, counts in the bucket without a date instead (and the rules warn
 * about it). The weighted amounts are kept exact in hundredths of a haléř
 * and rounded half up to whole haléře only in the sum of a bucket, so the
 * haléře of one deal never round on their own. Won deals are grouped by the
 * month they were closed and never count as open.
 */
export interface ForecastBucket {
  /** Open deals in the bucket. */
  count: number;
  /** Their values summed, unweighted, in haléře. */
  value: number;
  /** Their weighted values summed, rounded half up once, in haléře. */
  weighted: number;
}

export interface ForecastMonth extends ForecastBucket {
  /** `YYYY-MM`. */
  month: string;
}

export interface WonMonth {
  month: string;
  count: number;
  value: number;
}

export interface Forecast {
  currency: string;
  /** Months with an open deal, oldest first. */
  months: ForecastMonth[];
  /** Open deals without an expected closing date or with one already past. */
  noDate: ForecastBucket;
  /** Every open deal; `weighted` is the sum of the buckets' rounded sums. */
  total: ForecastBucket;
  /** Won deals by the month they were closed, oldest first. */
  won: WonMonth[];
}

export interface ForecastOptions {
  /** Today, `YYYY-MM-DD`: an expected closing date before it counts without a date. */
  today: string;
}

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

interface Exact {
  count: number;
  values: number[];
  hundredths: bigint;
}

const emptyExact = (): Exact => ({ count: 0, values: [], hundredths: 0n });

function bucketOf(exact: Exact): ForecastBucket {
  return {
    count: exact.count,
    value: sumAmounts(exact.values),
    weighted: weightedTotal(exact.hundredths),
  };
}

export function forecast(data: DataSet, options: ForecastOptions): Forecast {
  const settings = data.settings;
  const currency = settings?.currency ?? "CZK";
  if (!settings) {
    const none = { count: 0, value: 0, weighted: 0 };
    return { currency, months: [], noDate: none, total: none, won: [] };
  }
  const months = new Map<string, Exact>();
  const noDate = emptyExact();
  const won = new Map<string, number[]>();
  for (const { deal, stage } of dealsWithStage(data, settings)) {
    if (stage.kind === "won") {
      if (deal.closedAt === undefined) continue;
      const month = monthOf(deal.closedAt);
      won.set(month, [...(won.get(month) ?? []), deal.value]);
      continue;
    }
    if (stage.kind !== "open") continue;
    const dated = deal.expectedClose !== undefined && deal.expectedClose >= options.today;
    const month = dated ? monthOf(deal.expectedClose as string) : null;
    const bucket = month ? (months.get(month) ?? emptyExact()) : noDate;
    bucket.count += 1;
    bucket.values.push(deal.value);
    bucket.hundredths += weightedHundredths(deal.value, probabilityOf(deal, stage));
    if (month) months.set(month, bucket);
  }
  const byMonth = [...months.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([month, exact]) => ({ month, ...bucketOf(exact) }));
  const buckets = [...byMonth, bucketOf(noDate)];
  return {
    currency,
    months: byMonth,
    noDate: bucketOf(noDate),
    total: {
      count: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      value: sumAmounts(buckets.map((bucket) => bucket.value)),
      weighted: sumAmounts(buckets.map((bucket) => bucket.weighted)),
    },
    won: [...won.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([month, values]) => ({ month, count: values.length, value: sumAmounts(values) })),
  };
}
