import { cx } from "design-system";
import { Icon } from "design-system/react";
import type { ForecastMonth, ForecastQuarter } from "../../../domain/forecast.ts";
import { useLocale, useT } from "../../i18n.tsx";
import { monthName, monthShort, withoutZeroCents } from "../charts/format.ts";
import { axisOf, compactMoney } from "../charts/geometry.ts";

/** The parts of a month's column, from the bottom: what is settled first. */
const PARTS = ["paid", "invoiced", "overdue", "planned"] as const;
type Part = (typeof PARTS)[number];

function partsOf(month: ForecastMonth): Record<Part, number> {
  return {
    paid: month.paid,
    invoiced: Math.max(0, month.onTheWay - month.overdue),
    overdue: month.overdue,
    planned: Math.max(0, month.forecast - month.invoiced),
  };
}

/**
 * The forecast of a year as columns, one per month: paid, invoiced, overdue
 * and still planned stacked in one column, the quarters' sums under each
 * three. A column is a button: it opens the month's panel, and a won deal
 * without a plan dragged onto it is planned in that month.
 */
export function MonthChart({
  months,
  quarters,
  thisMonth,
  notes,
  over,
  dropping,
  money,
  onOpen,
  onOver,
  onDrop,
}: {
  months: ForecastMonth[];
  quarters: ForecastQuarter[];
  thisMonth: string;
  /** The months with a note, and its text. */
  notes: Map<string, string>;
  /** The month a dragged deal is over now. */
  over: string | null;
  /** Whether a deal is being dragged, so a column takes it. */
  dropping: boolean;
  money: (amount: number) => string;
  onOpen: (month: string) => void;
  onOver: (month: string | null) => void;
  onDrop: (month: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const axis = axisOf(Math.max(0, ...months.map((month) => month.forecast)), 3);
  const legend: { part: Part; label: string }[] = [
    { part: "paid", label: t("Zaplaceno", "Paid") },
    { part: "invoiced", label: t("Vyfakturováno", "Invoiced") },
    { part: "overdue", label: t("Po splatnosti", "Overdue") },
    { part: "planned", label: t("Plánováno", "Planned") },
  ];
  return (
    <section className="ds-card forecast-chart" aria-labelledby="forecast-chart-title">
      <header className="forecast-chart-head">
        <h2 id="forecast-chart-title" className="forecast-chart-title">
          {t("Po měsících", "By month")}
        </h2>
        <ul className="forecast-chart-legend">
          {legend.map((entry) => (
            <li key={entry.part}>
              <span className={`forecast-swatch is-${entry.part}`} aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ul>
      </header>

      <div className="forecast-chart-plot">
        <ol className="forecast-chart-ticks" aria-hidden="true">
          {[...axis.ticks].reverse().map((tick) => (
            <li key={tick} style={{ bottom: `${(tick / axis.max) * 100}%` }}>
              <span>{compactMoney(tick, locale)}</span>
            </li>
          ))}
        </ol>
        <ol className="forecast-chart-columns">
          {months.map((month) => {
            const parts = partsOf(month);
            const note = notes.get(month.month);
            const current = month.month === thisMonth;
            const name = monthName(month.month, locale);
            const summary = [
              `${name}: ${month.count === 0 ? t("nic", "nothing") : money(month.forecast)}`,
              month.paid > 0 ? `${t("zaplaceno", "paid")} ${money(month.paid)}` : "",
              month.overdue > 0 ? `${t("po splatnosti", "overdue")} ${money(month.overdue)}` : "",
              note ? `${t("poznámka", "note")}: ${note}` : "",
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={month.month}>
                <button
                  type="button"
                  className={cx(
                    "forecast-column",
                    current && "is-current",
                    month.count === 0 && "is-empty",
                    over === month.month && "is-over",
                  )}
                  aria-label={summary}
                  title={summary}
                  onClick={() => onOpen(month.month)}
                  onDragOver={(event) => {
                    if (!dropping) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    onOver(month.month);
                  }}
                  onDragLeave={() => {
                    if (over === month.month) onOver(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onOver(null);
                    onDrop(month.month);
                  }}
                >
                  <span className="forecast-column-track">
                    <span
                      className="forecast-column-stack"
                      style={{ height: `${(month.forecast / axis.max) * 100}%` }}
                    >
                      {month.count > 0 ? (
                        <span className="forecast-column-value">
                          {compactMoney(month.forecast, locale)}
                        </span>
                      ) : null}
                      {[...PARTS]
                        .reverse()
                        .map((part) =>
                          parts[part] > 0 ? (
                            <span
                              key={part}
                              className={`forecast-column-part is-${part}`}
                              style={{ flexGrow: parts[part] }}
                            />
                          ) : null,
                        )}
                    </span>
                  </span>
                  <span className="forecast-column-month" aria-hidden="true">
                    <span className="forecast-column-month-wide">
                      {monthShort(month.month, locale, false)}
                    </span>
                    <span className="forecast-column-month-narrow">
                      {Number(month.month.slice(5, 7))}
                    </span>
                    {note ? <Icon name="page" size="sm" className="forecast-column-note" /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="forecast-chart-quarters">
        {quarters.map((quarter) => (
          <li key={quarter.quarter}>
            <span className="forecast-quarter-name">Q{quarter.quarter}</span>
            <span className="forecast-quarter-amount num">
              {withoutZeroCents(money(quarter.forecast))}
            </span>
            <span className="small muted num">
              {t("zaplaceno", "paid")} {withoutZeroCents(money(quarter.paid))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
