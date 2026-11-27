import { Button } from "design-system/react";
import { useMemo } from "react";
import { localToday, monthOf } from "../../domain/common.ts";
import { probabilityOf } from "../../domain/deal.ts";
import { amountsOf, forecast, forecastRows } from "../../domain/forecast.ts";
import { sumAmounts } from "../../domain/money.ts";
import { periodOf } from "../../domain/periods.ts";
import { openStages } from "../../domain/settings.ts";
import { changeBasisPoints, stats } from "../../domain/stats.ts";
import { type AppData, dataSetOf } from "../App.tsx";
import { StatTile } from "../components/Board.tsx";
import { changeText, monthName } from "../components/charts/format.ts";
import { PageHeader } from "../components/common.tsx";
import { DAYS, DEALS, useFormat, useLocale, useT } from "../i18n.tsx";
import { useLookups } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

const SOONEST = 8;

/**
 * The overview: the open pipeline by stage with the deals in each, this
 * month's forecast from the payment plans, what is on the way and overdue,
 * the results of the last 90 days and the open deals closing soonest. The
 * numbers come from the same pure functions as the forecast and the
 * statistics pages.
 */
export function OverviewPage({
  data,
  today = localToday(),
}: {
  data: AppData;
  /** Kept for the App's page contract; the overview itself changes nothing. */
  onChanged?: () => Promise<void>;
  today?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const lookups = useLookups(data);
  const set = useMemo(() => dataSetOf(data), [data]);
  const thisMonth = monthOf(today);
  const pipeline = openStages(settings).map((stage) => {
    const deals = data.deals.filter((entry) => entry.value.stageId === stage.id);
    return { stage, deals, sum: sumAmounts(deals.map((entry) => entry.value.value)) };
  });
  const openDeals = pipeline.flatMap((column) => column.deals);
  const outlook = useMemo(() => forecast(set, { today }), [set, today]);
  const month = outlook.months.find((entry) => entry.month === thisMonth);
  const rows = useMemo(() => forecastRows(set, today), [set, today]);
  const all = amountsOf(rows);
  const overdue = rows
    .filter((row) => row.state === "overdue")
    .sort((left, right) => (left.dueOn ?? "").localeCompare(right.dueOn ?? ""));
  const period = useMemo(() => stats(set, periodOf("last90", today)), [set, today]);
  const soonest = openDeals
    .filter((entry) => entry.value.expectedClose !== undefined)
    .sort((left, right) =>
      (left.value.expectedClose ?? "").localeCompare(right.value.expectedClose ?? ""),
    )
    .slice(0, SOONEST);
  const wonChange = changeBasisPoints(period.current.won.value, period.previous.won.value);

  return (
    <section className="overview-page">
      <PageHeader
        title={t("Přehled obchodu", "Sales overview")}
        actions={
          canWrite ? (
            <Button
              variant="primary"
              icon="plus"
              href={href({ page: "new-deal", company: null, stage: null })}
            >
              {t("Nový případ", "New deal")}
            </Button>
          ) : null
        }
      />

      <div className="stat-tiles">
        <StatTile
          label={t(
            `Forecast: ${monthName(thisMonth, locale)}`,
            `Forecast: ${monthName(thisMonth, locale)}`,
          )}
          value={f.money(month?.forecast ?? 0)}
          note={t(
            `vyfakturováno ${f.money(month?.invoiced ?? 0)} · zaplaceno ${f.money(month?.paid ?? 0)}`,
            `invoiced ${f.money(month?.invoiced ?? 0)} · paid ${f.money(month?.paid ?? 0)}`,
          )}
          onOpen={() => navigate({ page: "forecast" })}
        />
        <StatTile
          label={t("Na cestě", "On the way")}
          value={f.money(all.onTheWay)}
          note={t("vyfakturováno, nezaplaceno", "invoiced, not paid yet")}
          onOpen={() => navigate({ page: "forecast" })}
        />
        <StatTile
          label={t("Po splatnosti", "Overdue")}
          value={
            <span className={all.overdue > 0 ? "danger" : undefined}>{f.money(all.overdue)}</span>
          }
          note={t.count(overdue.length, PAYMENTS)}
        />
        <StatTile
          label={t("Otevřená pipeline", "Open pipeline")}
          value={f.money(sumAmounts(openDeals.map((entry) => entry.value.value)))}
          note={t.count(openDeals.length, DEALS)}
          onOpen={() => navigate({ page: "deals", tab: "open" })}
        />
      </div>

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
                        {lookups.companyName(deal.companyId)}
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
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </section>

      <div className="overview-grid">
        <article className="ds-card">
          <header className="overview-card-head">
            <h2>{t("Posledních 90 dní", "The last 90 days")}</h2>
            <a href={href({ page: "stats" })} className="small">
              {t("Statistiky", "Statistics")}
            </a>
          </header>
          <dl className="figures">
            <div>
              <dt>{t("Vyhráno", "Won")}</dt>
              <dd>
                {period.current.won.count} · {f.money(period.current.won.value)}
                {period.previous.won.value > 0 ? (
                  <span className="muted small"> {changeText(wonChange, f.rate, locale)}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{t("Konverze", "Conversion")}</dt>
              <dd>{f.rate(period.conversionBasisPoints)}</dd>
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
                {period.averageCycleDays === null ? "–" : t.count(period.averageCycleDays, DAYS)}
              </dd>
            </div>
          </dl>
        </article>

        <article className="ds-card">
          <h2>{t("Nejbližší uzavření", "Closing soonest")}</h2>
          {soonest.length === 0 ? (
            <p className="muted small">
              {t("Žádný otevřený případ s datem.", "No open deal with a date.")}
            </p>
          ) : (
            <ul className="overview-list">
              {soonest.map((entry) => {
                const deal = entry.value;
                const late = (deal.expectedClose ?? "") < today;
                return (
                  <li key={deal.id}>
                    <span className="overview-list-main">
                      <a href={href({ page: "deal", id: deal.id })}>{deal.title}</a>
                      <span className="small muted">
                        {lookups.companyName(deal.companyId)} ·{" "}
                        {lookups.stage(deal.stageId)?.label ?? deal.stageId}
                      </span>
                    </span>
                    <span className="overview-list-side">
                      <span className="num">{f.money(deal.value)}</span>
                      <span className={late ? "small warning" : "small muted"}>
                        {late ? `${t("po termínu", "overdue")} ` : ""}
                        {f.date(deal.expectedClose)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="ds-card">
          <h2>{t("Platby po splatnosti", "Overdue payments")}</h2>
          {overdue.length === 0 ? (
            <p className="muted small">{t("Nic není po splatnosti.", "Nothing is overdue.")}</p>
          ) : (
            <ul className="overview-list">
              {overdue.map((row) => (
                <li key={row.key}>
                  <span className="overview-list-main">
                    {row.dealId ? (
                      <a href={href({ page: "deal", id: row.dealId })}>{row.title}</a>
                    ) : (
                      <a href={href({ page: "forecast" })}>{row.title}</a>
                    )}
                    <span className="small muted">
                      {lookups.companyName(row.companyId)}
                      {row.label ? ` · ${row.label}` : ""}
                    </span>
                  </span>
                  <span className="overview-list-side">
                    <span className="num">{f.money(row.amount)}</span>
                    <span className="small danger">
                      {t("splatné", "due")} {f.date(row.dueOn)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

const PAYMENTS = {
  cs: { one: "platba", few: "platby", many: "plateb" },
  en: { one: "payment", other: "payments" },
};
