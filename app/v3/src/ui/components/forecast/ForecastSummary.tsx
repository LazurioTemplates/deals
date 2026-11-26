import { Table, Tabs } from "design-system/react";
import type { ForecastGroup } from "../../../domain/forecast.ts";
import { basisPointsOf } from "../../../domain/money.ts";
import { changeBasisPoints } from "../../../domain/stats.ts";
import { type Format, useLocale, useT } from "../../i18n.tsx";
import { changeText } from "../charts/format.ts";

export interface SummaryGrouping {
  id: string;
  label: string;
  groups: ForecastGroup[];
  previous: ForecastGroup[];
  name: (id: string | null) => string;
}

/**
 * „Souhrn podle“: the year's forecast by salesperson, deal type and billing
 * entity, each with its share of the year, invoiced, paid and the change
 * against the previous year.
 */
export function ForecastSummary({
  year,
  total,
  groupings,
  f,
}: {
  year: number;
  total: number;
  groupings: SummaryGrouping[];
  f: Format;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="ds-card forecast-summary" aria-labelledby="forecast-summary-title">
      <h2 id="forecast-summary-title">{t("Souhrn podle", "Summary by")}</h2>
      <Tabs
        label={t("Souhrn podle", "Summary by")}
        items={groupings.map((grouping) => ({
          id: `forecast-summary-${grouping.id}`,
          label: grouping.label,
        }))}
        panels={Object.fromEntries(
          groupings.map((grouping) => [
            `forecast-summary-${grouping.id}`,
            <Table
              key={grouping.id}
              id={`forecast-summary-${grouping.id}-table`}
              caption={t(
                `Forecast ${year} podle: ${grouping.label}`,
                `Forecast ${year} by ${grouping.label.toLowerCase()}`,
              )}
              hideCaption
              density="compact"
            >
              <thead>
                <tr>
                  <th scope="col">{grouping.label}</th>
                  <th scope="col" className="ds-table__num">
                    {t("Částka", "Amount")}
                  </th>
                  <th scope="col" className="ds-table__num">
                    {t("Podíl na roce", "Share of the year")}
                  </th>
                  <th scope="col" className="ds-table__num">
                    {t("Vyfakturováno", "Invoiced")}
                  </th>
                  <th scope="col" className="ds-table__num">
                    {t("Zaplaceno", "Paid")}
                  </th>
                  <th scope="col" className="ds-table__num">
                    {t(`Změna proti ${year - 1}`, `Change against ${year - 1}`)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouping.groups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {t("V tomto roce nic není.", "Nothing in this year.")}
                    </td>
                  </tr>
                ) : null}
                {grouping.groups.map((group) => {
                  const before = grouping.previous.find((entry) => entry.id === group.id);
                  const change = changeBasisPoints(group.forecast, before?.forecast ?? 0);
                  return (
                    <tr key={group.id ?? "none"}>
                      <th scope="row">{grouping.name(group.id)}</th>
                      <td className="ds-table__num">{f.money(group.forecast)}</td>
                      <td className="ds-table__num">
                        <span className="forecast-share">
                          <span className="forecast-share-bar" aria-hidden="true">
                            <span
                              style={{
                                width: `${basisPointsOf(group.forecast, total) / 100}%`,
                              }}
                            />
                          </span>
                          {f.rate(basisPointsOf(group.forecast, total))}
                        </span>
                      </td>
                      <td className="ds-table__num">{f.money(group.invoiced)}</td>
                      <td className="ds-table__num">{f.money(group.paid)}</td>
                      <td
                        className={
                          change === null
                            ? "ds-table__num muted"
                            : change > 0
                              ? "ds-table__num ok"
                              : change < 0
                                ? "ds-table__num danger"
                                : "ds-table__num"
                        }
                      >
                        {changeText(change, f.rate, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>,
          ]),
        )}
      />
    </section>
  );
}
