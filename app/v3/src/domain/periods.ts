import { addDays, monthOf } from "./common.ts";
import { addMonths } from "./payment-plan.ts";
import type { StatsPeriod } from "./stats.ts";

/**
 * The periods a person picks for the quotes and the statistics, relative to
 * today. A week starts on Monday; a quarter is January–March and so on.
 */
export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last7",
  "lastWeek",
  "thisWeek",
  "last30",
  "lastMonth",
  "last90",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "last365",
  "lastYear",
  "all",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, { cs: string; en: string }> = {
  today: { cs: "Dnes", en: "Today" },
  yesterday: { cs: "Včera", en: "Yesterday" },
  last7: { cs: "Posledních 7 dní", en: "Last 7 days" },
  lastWeek: { cs: "Minulý týden", en: "Last week" },
  thisWeek: { cs: "Tento týden", en: "This week" },
  last30: { cs: "30 dní", en: "30 days" },
  lastMonth: { cs: "Minulý měsíc", en: "Last month" },
  last90: { cs: "90 dní", en: "90 days" },
  thisQuarter: { cs: "Tento kvartál", en: "This quarter" },
  lastQuarter: { cs: "Minulý kvartál", en: "Last quarter" },
  thisYear: { cs: "Tento rok", en: "This year" },
  last365: { cs: "365 dní", en: "365 days" },
  lastYear: { cs: "Minulý rok", en: "Last year" },
  all: { cs: "Vše", en: "All" },
};

function mondayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
}

/**
 * The days of a preset, both included. `all` starts at `earliest` (the
 * oldest date of the data), else at the start of last year.
 */
export function periodOf(preset: PeriodPreset, today: string, earliest?: string): StatsPeriod {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "thisWeek":
      return { from: mondayOf(today), to: today };
    case "lastWeek": {
      const monday = addDays(mondayOf(today), -7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "lastMonth": {
      const month = addMonths(monthOf(today), -1);
      return { from: `${month}-01`, to: addDays(`${monthOf(today)}-01`, -1) };
    }
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisQuarter":
      return { from: quarterStart(today), to: today };
    case "lastQuarter": {
      const start = quarterStart(today);
      const previous = `${addMonths(start.slice(0, 7), -3)}-01`;
      return { from: previous, to: addDays(start, -1) };
    }
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last365":
      return { from: addDays(today, -364), to: today };
    case "lastYear": {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "all": {
      const fallback = `${Number(today.slice(0, 4)) - 1}-01-01`;
      const from = earliest && earliest < today ? earliest : fallback;
      return { from, to: today };
    }
  }
}
