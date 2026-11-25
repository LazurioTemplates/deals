import { Button, Table } from "design-system/react";
import { useState } from "react";
import { addDays, localToday } from "../../domain/common.ts";
import { probabilityOf } from "../../domain/deal.ts";
import { forecast } from "../../domain/forecast.ts";
import { sumAmounts } from "../../domain/money.ts";
import { openStages } from "../../domain/settings.ts";
import { stats } from "../../domain/stats.ts";
import { type AppData, dataSetOf } from "../App.tsx";
import { MoveDeal } from "../components/CloseDeal.tsx";
import { PageHeader } from "../components/common.tsx";
import { DAYS, DEALS, useFormat, useT } from "../i18n.tsx";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

/**
 * The overview: the open pipeline by stage with the deals in each, the
 * weighted forecast by month, and the statistics of a period (the last 90
 * days unless the person picks another). The numbers come from the same
 * pure functions as the API's `/api/forecast` and `/api/stats`.
 */
export function OverviewPage({
  data,
  onChanged,
  today = localToday(),
}: {
  data: AppData;
  onChanged: () => Promise<void>;
  today?: string;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const [from, setFrom] = useState(addDays(today, -89));
  const [to, setTo] = useState(today);
  const set = dataSetOf(data);
  const companies = new Map(data.companies.map((entry) => [entry.value.id, entry.value]));
  const pipeline = openStages(settings).map((stage) => {
    const deals = data.deals.filter((entry) => entry.value.stageId === stage.id);
    return { stage, deals, sum: sumAmounts(deals.map((entry) => entry.value.value)) };
  });
  const outlook = forecast(set, { today });
  const periodValid = from !== "" && to !== "" && from <= to;
  const period = periodValid ? stats(set, { from, to }) : null;

  return (
    <section>
      <PageHeader
        title={t("Přehled obchodu", "Sales overview")}
        subtitle={t(
          "Otevřené případy podle fáze, vážený forecast a výsledky za zvolené období.",
          "Open deals by stage, the weighted forecast and the results of a period.",
        )}
        actions={
          canWrite ? (
            <Button variant="primary" href={href({ page: "new-deal", company: null })}>
              {t("Nový případ", "New deal")}
            </Button>
          ) : null
        }
      />

      <h2 id="pipeline-heading">{t("Pipeline", "Pipeline")}</h2>
      <section className="pipeline" aria-labelledby="pipeline-heading">
        {pipeline.map(({ stage, deals, sum }) => (
          <section key={stage.id} className="pipeline-column" aria-label={stage.label}>
            <header className="pipeline-head">
              <h3>{stage.label}</h3>
              <span className="muted small">
                {t.count(deals.length, DEALS)} · {f.rate(stage.probability * 100)}
              </span>
              <span className="num pipeline-sum">{f.money(sum)}</span>
            </header>
            {deals.length === 0 ? (
              <p className="muted small">{t("Žádný případ.", "No deal.")}</p>
            ) : (
              <ul className="deal-cards">
                {deals.map((entry) => {
                  const deal = entry.value;
                  const own = deal.probability !== undefined;
                  return (
                    <li key={deal.id} className="deal-card">
                      <a className="deal-card-title" href={href({ page: "deal", id: deal.id })}>
                        {deal.title}
                      </a>
                      <span className="muted small deal-card-company">
                        {companies.get(deal.companyId)?.name ?? deal.companyId}
                      </span>
                      <span className="deal-card-meta">
                        <span className="num">{f.money(deal.value)}</span>
                        <span className="muted small">
                          {own ? `${f.rate(probabilityOf(deal, stage) * 100)} · ` : ""}
                          {deal.expectedClose === undefined ? (
                            t("bez data", "no date")
                          ) : deal.expectedClose < today ? (
                            <span className="warning">
                              {t("po termínu", "overdue")} {f.date(deal.expectedClose)}
                            </span>
                          ) : (
                            f.date(deal.expectedClose)
                          )}
                        </span>
                      </span>
                      <MoveDeal deal={entry} settings={settings} onChanged={onChanged} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </section>

      <div className="overview-panels">
        <article className="ds-card">
          <h2>{t("Vážený forecast", "Weighted forecast")}</h2>
          <p className="muted small">
            {t(
              "Hodnota × pravděpodobnost podle očekávaného měsíce uzavření. Případy bez data nebo s datem v minulosti jsou zvlášť.",
              "Value × probability by the expected month of closing. Deals without a date or with one in the past are apart.",
            )}
          </p>
          <Table
            id="forecast"
            caption={t("Vážený forecast po měsících", "Weighted forecast by month")}
            hideCaption
          >
            <thead>
              <tr>
                <th>{t("Měsíc", "Month")}</th>
                <th className="ds-table__num">{t("Případy", "Deals")}</th>
                <th className="ds-table__num">{t("Hodnota", "Value")}</th>
                <th className="ds-table__num">{t("Vážená", "Weighted")}</th>
              </tr>
            </thead>
            <tbody>
              {outlook.months.map((month) => (
                <tr key={month.month}>
                  <td>{f.month(month.month)}</td>
                  <td className="ds-table__num">{month.count}</td>
                  <td className="ds-table__num">{f.money(month.value)}</td>
                  <td className="ds-table__num">{f.money(month.weighted)}</td>
                </tr>
              ))}
              <tr>
                <td>{t("Bez data", "No date")}</td>
                <td className="ds-table__num">{outlook.noDate.count}</td>
                <td className="ds-table__num">{f.money(outlook.noDate.value)}</td>
                <td className="ds-table__num">{f.money(outlook.noDate.weighted)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("Celkem", "Total")}</th>
                <td className="ds-table__num">{outlook.total.count}</td>
                <td className="ds-table__num">{f.money(outlook.total.value)}</td>
                <td className="ds-table__num">
                  <strong>{f.money(outlook.total.weighted)}</strong>
                </td>
              </tr>
            </tfoot>
          </Table>
        </article>

        <article className="ds-card">
          <h2>{t("Výsledky za období", "Results of a period")}</h2>
          <div className="period">
            <label className="ds-field">
              <span className="ds-field__label">{t("Od", "From")}</span>
              <input
                className="ds-input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="ds-field">
              <span className="ds-field__label">{t("Do", "To")}</span>
              <input
                className="ds-input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
          {!period ? (
            <p className="warning">
              {t(
                "Období musí začínat nejpozději v den konce.",
                "The period must start no later than it ends.",
              )}
            </p>
          ) : (
            <>
              <dl className="figures">
                <div>
                  <dt>{t("Konverze", "Conversion")}</dt>
                  <dd>{f.rate(period.conversionBasisPoints)}</dd>
                </div>
                <div>
                  <dt>{t("Vyhrané", "Won")}</dt>
                  <dd>
                    {period.won.count} · {f.money(period.won.value)}
                  </dd>
                </div>
                <div>
                  <dt>{t("Ztracené", "Lost")}</dt>
                  <dd>
                    {period.lost.count} · {f.money(period.lost.value)}
                  </dd>
                </div>
                <div>
                  <dt>{t("Průměrná výhra", "Average win")}</dt>
                  <dd>{period.averageWonValue === null ? "–" : f.money(period.averageWonValue)}</dd>
                </div>
                <div>
                  <dt>{t("Průměrný cyklus", "Average cycle")}</dt>
                  <dd>
                    {period.averageCycleDays === null
                      ? "–"
                      : t.count(period.averageCycleDays, DAYS)}
                  </dd>
                </div>
              </dl>
              <h3>{t("Ztracené podle důvodu", "Lost by reason")}</h3>
              <ul className="plain-list">
                {period.lostByReason.map((reason) => (
                  <li key={reason.reasonId}>
                    <span>{reason.label}</span>
                    <span className="num">
                      {reason.count} · {f.money(reason.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
