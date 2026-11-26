import { Button, Dialog, Table } from "design-system/react";
import { type ReactNode, useMemo, useState } from "react";
import { localToday } from "../../domain/common.ts";
import { PERIOD_LABELS, type PeriodPreset, periodOf } from "../../domain/periods.ts";
import { quoteTotals } from "../../domain/quote.ts";
import {
  type Bucket,
  changeBasisPoints,
  type Figure,
  type StatsFilter,
  stats,
} from "../../domain/stats.ts";
import { type AppData, dataSetOf } from "../App.tsx";
import { ChipChoice, StatTile } from "../components/Board.tsx";
import { BarListChart, ChartFrame, ColumnChart, LineChart } from "../components/charts/Charts.tsx";
import { changeText, dayShort, monthShort } from "../components/charts/format.ts";
import { compactMoney } from "../components/charts/geometry.ts";
import { PageHeader, StageChip } from "../components/common.tsx";
import { FilterSelect } from "../components/forecast/FilterSelect.tsx";
import { DAYS, useFormat, useLocale, useT } from "../i18n.tsx";
import { readLocal, useLookups, writeLocal } from "../lookups.ts";
import { href } from "../routes.ts";

/** The periods the statistics offer, shortest first. */
export const STATS_PRESETS = [
  "thisWeek",
  "lastWeek",
  "last30",
  "last90",
  "thisQuarter",
  "last365",
  "all",
] as const satisfies readonly PeriodPreset[];
export type StatsPreset = (typeof STATS_PRESETS)[number];

const PERIOD_KEY = "deals.stats.period";
const FILTER_KEY = "deals.stats.filter";

/** What a dialog lists: the deals or the quotes behind a number. */
interface Behind {
  title: string;
  kind: "deals" | "quotes";
  ids: string[];
}

/**
 * The statistics of a period (the last 90 days unless the person picks
 * another, remembered per viewer), each figure against the period of the
 * same length before it. Every number opens the deals or quotes behind it.
 * Computed here from the loaded data by the same pure function as the API's
 * `/api/stats`.
 */
export function StatsPage({ data, today = localToday() }: { data: AppData; today?: string }) {
  const t = useT();
  const locale = useLocale();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const lookups = useLookups(data);
  const [preset, setPresetState] = useState<StatsPreset>(() => {
    const kept = readLocal<string>(PERIOD_KEY, "last90");
    return (STATS_PRESETS as readonly string[]).includes(kept) ? (kept as StatsPreset) : "last90";
  });
  const [filter, setFilterState] = useState<StatsFilter>(() =>
    readLocal<StatsFilter>(FILTER_KEY, {}),
  );
  const [measure, setMeasure] = useState<"count" | "value">("value");
  const [behind, setBehind] = useState<Behind | null>(null);
  const setPreset = (next: StatsPreset) => {
    setPresetState(next);
    writeLocal(PERIOD_KEY, next);
  };
  const setFilter = (next: StatsFilter) => {
    setFilterState(next);
    writeLocal(FILTER_KEY, next);
  };

  const set = useMemo(() => dataSetOf(data), [data]);
  const earliest = useMemo(() => {
    const dates = [
      ...set.deals.flatMap((deal) => [deal.createdAt, deal.closedAt ?? deal.createdAt]),
      ...set.quotes.map((quote) => quote.issuedOn),
    ];
    return [...dates].sort()[0];
  }, [set]);
  const period = useMemo(() => periodOf(preset, today, earliest), [preset, today, earliest]);
  const s = useMemo(() => stats(set, period, filter), [set, period, filter]);
  const { current, previous } = s;
  const types = settings.dealTypes ?? [];
  const open = (title: string, kind: Behind["kind"], ids: string[]) =>
    setBehind({ title, kind, ids });
  const openDeals = (title: string, figure: Figure) => open(title, "deals", figure.ids);

  const change = (now: number, before: number, lowerIsBetter = false) => {
    const basisPoints = changeBasisPoints(now, before);
    if (basisPoints === null && now === 0) return undefined;
    return {
      basisPoints: basisPoints === null ? null : lowerIsBetter ? -basisPoints : basisPoints,
      text: changeText(basisPoints, f.rate, locale),
    };
  };
  const was = (text: string) => t(`předtím ${text}`, `before ${text}`);
  const bucketLabel = (bucket: Bucket) =>
    s.bucket === "week"
      ? dayShort(bucket.from, locale)
      : monthShort(bucket.from.slice(0, 7), locale);
  const bucketName = (bucket: Bucket) =>
    bucket.from === bucket.to
      ? f.date(bucket.from)
      : `${f.date(bucket.from)} – ${f.date(bucket.to)}`;
  const tick = (value: number) => compactMoney(value, locale);
  const countTick = (value: number) => String(value);
  const legendPeriods = [
    { name: t("Toto období", "This period"), tone: "accent" as const },
    { name: t("Předchozí období", "Previous period"), tone: "previous" as const },
  ];
  const conversionDelta =
    current.conversionBasisPoints !== null && previous.conversionBasisPoints !== null
      ? current.conversionBasisPoints - previous.conversionBasisPoints
      : null;
  const decided: Figure = {
    count: current.won.count + current.lost.count,
    value: 0,
    ids: [...current.won.ids, ...current.lost.ids],
  };
  const cumulativeEnd = s.cumulative.at(-1);
  const weekly = s.cumulative.filter(
    (_point, index) => index % 7 === 6 || index === s.cumulative.length - 1,
  );

  return (
    <section className="stats-page">
      <PageHeader
        title={t("Statistiky", "Statistics")}
        subtitle={t(
          `${f.date(period.from)} – ${f.date(period.to)}, porovnání s ${f.date(s.previousPeriod.from)} – ${f.date(s.previousPeriod.to)}`,
          `${f.date(period.from)} – ${f.date(period.to)}, compared with ${f.date(s.previousPeriod.from)} – ${f.date(s.previousPeriod.to)}`,
        )}
      />
      <div className="filter-bar stats-filters">
        <ChipChoice
          label={t("Období", "Period")}
          value={preset}
          options={STATS_PRESETS.map((value) => ({ value, label: t.of(PERIOD_LABELS[value]) }))}
          onChange={setPreset}
        />
        <div className="stats-filter-selects">
          <FilterSelect
            label={t("Obchodník", "Salesperson")}
            all={t("Všichni obchodníci", "All salespeople")}
            value={filter.ownerId}
            options={data.salespeople.map((entry) => ({
              value: entry.value.id,
              label: entry.value.name,
            }))}
            onChange={(ownerId) => setFilter({ ...filter, ownerId })}
          />
          {types.length > 0 ? (
            <FilterSelect
              label={t("Typ zakázky", "Deal type")}
              all={t("Všechny typy", "All types")}
              value={filter.dealTypeId}
              options={types.map((entry) => ({ value: entry.id, label: entry.label }))}
              onChange={(dealTypeId) => setFilter({ ...filter, dealTypeId })}
            />
          ) : null}
        </div>
      </div>

      <div className="stat-tiles stats-tiles">
        <StatTile
          label={t("Vyhráno", "Won")}
          value={current.won.count}
          change={change(current.won.count, previous.won.count)}
          note={was(String(previous.won.count))}
          onOpen={() => openDeals(t("Vyhrané případy", "Won deals"), current.won)}
        />
        <StatTile
          label={t("Hodnota vyhraných", "Value won")}
          value={f.money(current.won.value)}
          change={change(current.won.value, previous.won.value)}
          note={was(f.money(previous.won.value))}
          onOpen={() => openDeals(t("Vyhrané případy", "Won deals"), current.won)}
        />
        <StatTile
          label={t("Průměrný vyhraný případ", "Average won deal")}
          value={current.averageWonValue === null ? "–" : f.money(current.averageWonValue)}
          change={
            current.averageWonValue !== null && previous.averageWonValue !== null
              ? change(current.averageWonValue, previous.averageWonValue)
              : undefined
          }
          note={
            previous.averageWonValue === null ? undefined : was(f.money(previous.averageWonValue))
          }
          onOpen={() => openDeals(t("Vyhrané případy", "Won deals"), current.won)}
        />
        <StatTile
          label={t("Nové případy", "New deals")}
          value={current.created.count}
          change={change(current.created.count, previous.created.count)}
          note={was(String(previous.created.count))}
          onOpen={() => openDeals(t("Nové případy", "New deals"), current.created)}
        />
        <StatTile
          label={t("Vytvořené nabídky", "Quotes created")}
          value={current.quotes.count}
          change={change(current.quotes.count, previous.quotes.count)}
          note={f.money(current.quotes.value)}
          onOpen={() =>
            open(t("Vytvořené nabídky", "Quotes created"), "quotes", current.quotes.ids)
          }
        />
        <StatTile
          label={t("Konverze", "Conversion")}
          value={f.rate(current.conversionBasisPoints)}
          change={
            conversionDelta === null
              ? undefined
              : {
                  basisPoints: conversionDelta,
                  text: `${conversionDelta > 0 ? "▲" : conversionDelta < 0 ? "▼" : "="} ${pointsText(Math.abs(conversionDelta), locale)}`,
                }
          }
          note={t(
            `${current.won.count} vyhraných z ${decided.count} uzavřených`,
            `${current.won.count} won of ${decided.count} closed`,
          )}
          onOpen={() => openDeals(t("Uzavřené případy", "Closed deals"), decided)}
        />
        <StatTile
          label={t("Průměrná délka obchodu", "Average sales cycle")}
          value={current.averageCycleDays === null ? "–" : t.count(current.averageCycleDays, DAYS)}
          change={
            current.averageCycleDays !== null && previous.averageCycleDays !== null
              ? change(current.averageCycleDays, previous.averageCycleDays, true)
              : undefined
          }
          note={
            previous.averageCycleDays === null
              ? undefined
              : was(t.count(previous.averageCycleDays, DAYS))
          }
          onOpen={() => openDeals(t("Vyhrané případy", "Won deals"), current.won)}
        />
        <StatTile
          label={t("Aktivní pipeline", "Active pipeline")}
          value={f.money(s.pipeline.value)}
          note={t(`${s.pipeline.count} otevřených · dnes`, `${s.pipeline.count} open · today`)}
          onOpen={() => openDeals(t("Otevřené případy", "Open deals"), s.pipeline)}
        />
      </div>

      <div className="stats-charts">
        <ChartFrame
          title={t("Žebříček obchodníků", "Salespeople")}
          legend={legendPeriods}
          table={{
            columns: [
              t("Obchodník", "Salesperson"),
              t("Vyhráno", "Won"),
              t("Počet", "Count"),
              t("Předchozí období", "Previous period"),
              t("Otevřené", "Open"),
            ],
            rows: s.leaderboard.map((row) => ({
              key: row.ownerId,
              cells: [
                lookups.salespersonName(row.ownerId),
                f.money(row.won.value),
                row.won.count,
                f.money(row.previous.value),
                f.money(row.open.value),
              ],
              onOpen: () => openDeals(lookups.salespersonName(row.ownerId), row.won),
            })),
          }}
        >
          {s.leaderboard.length === 0 ? (
            <p className="muted small">{t("V tomto období nic.", "Nothing in this period.")}</p>
          ) : (
            <BarListChart
              label={t(
                "Vyhraná hodnota podle obchodníka, toto a předchozí období",
                "Won value by salesperson, this and the previous period",
              )}
              rows={s.leaderboard.map((row) => ({
                key: row.ownerId,
                label: lookups.salespersonName(row.ownerId),
                values: [row.won.value, row.previous.value],
                valueText: `${f.money(row.won.value)} · ${row.won.count}`,
                title: t(
                  `${lookups.salespersonName(row.ownerId)}: ${f.money(row.won.value)} (${row.won.count}), předtím ${f.money(row.previous.value)}`,
                  `${lookups.salespersonName(row.ownerId)}: ${f.money(row.won.value)} (${row.won.count}), before ${f.money(row.previous.value)}`,
                ),
              }))}
              onOpen={(index) => {
                const row = s.leaderboard[index];
                if (row) openDeals(lookups.salespersonName(row.ownerId), row.won);
              }}
            />
          )}
        </ChartFrame>

        <ChartFrame
          title={t("Vyhráno po měsících", "Won by month")}
          table={{
            columns: [t("Měsíc", "Month"), t("Počet", "Count"), t("Hodnota", "Value")],
            rows: s.wonByMonth.map((month) => ({
              key: month.month,
              cells: [f.month(month.month), month.count, f.money(month.value)],
              onOpen: () => openDeals(f.month(month.month), month),
            })),
          }}
        >
          <ColumnChart
            label={t(
              "Vyhraná hodnota po měsících za posledních 12 měsíců",
              "Won value by month over the last 12 months",
            )}
            tones={["accent"]}
            tick={tick}
            categories={s.wonByMonth.map((month) => ({
              key: month.month,
              label: monthShort(month.month, locale, false),
              values: [month.value],
              title: `${f.month(month.month)}: ${f.money(month.value)} (${month.count})`,
            }))}
            onOpen={(index) => {
              const month = s.wonByMonth[index];
              if (month) openDeals(f.month(month.month), month);
            }}
          />
        </ChartFrame>

        <ChartFrame
          title={
            s.bucket === "week"
              ? t("Nové případy podle stavu, po týdnech", "New deals by state, by week")
              : t("Nové případy podle stavu, po měsících", "New deals by state, by month")
          }
          legend={[
            { name: t("Otevřené", "Open"), tone: "open" },
            { name: t("Vyhrané", "Won"), tone: "won" },
            { name: t("Ztracené", "Lost"), tone: "lost" },
          ]}
          table={{
            columns: [
              t("Období", "Period"),
              t("Otevřené", "Open"),
              t("Vyhrané", "Won"),
              t("Ztracené", "Lost"),
            ],
            rows: s.createdByBucket.map((bucket) => ({
              key: bucket.from,
              cells: [bucketName(bucket), bucket.open.count, bucket.won.count, bucket.lost.count],
              onOpen: () =>
                open(bucketName(bucket), "deals", [
                  ...bucket.open.ids,
                  ...bucket.won.ids,
                  ...bucket.lost.ids,
                ]),
            })),
          }}
        >
          <ColumnChart
            label={t(
              "Počet nových případů podle toho, zda jsou otevřené, vyhrané nebo ztracené",
              "The number of new deals by whether they are open, won or lost",
            )}
            stacked
            integer
            tones={["open", "won", "lost"]}
            tick={countTick}
            categories={s.createdByBucket.map((bucket) => ({
              key: bucket.from,
              label: bucketLabel(bucket),
              values: [bucket.open.count, bucket.won.count, bucket.lost.count],
              title: t(
                `${bucketName(bucket)}: otevřené ${bucket.open.count}, vyhrané ${bucket.won.count}, ztracené ${bucket.lost.count}`,
                `${bucketName(bucket)}: open ${bucket.open.count}, won ${bucket.won.count}, lost ${bucket.lost.count}`,
              ),
            }))}
            onOpen={(index) => {
              const bucket = s.createdByBucket[index];
              if (bucket)
                open(bucketName(bucket), "deals", [
                  ...bucket.open.ids,
                  ...bucket.won.ids,
                  ...bucket.lost.ids,
                ]);
            }}
          />
        </ChartFrame>

        <ChartFrame
          title={
            s.bucket === "week"
              ? t("Nabídky po týdnech", "Quotes by week")
              : t("Nabídky po měsících", "Quotes by month")
          }
          tools={
            <ChipChoice
              label={t("Ukazatel", "Measure")}
              value={measure}
              options={[
                { value: "value", label: t("Hodnota", "Value") },
                { value: "count", label: t("Počet", "Count") },
              ]}
              onChange={setMeasure}
            />
          }
          table={{
            columns: [t("Období", "Period"), t("Počet", "Count"), t("Hodnota", "Value")],
            rows: s.quotesByBucket.map((bucket) => ({
              key: bucket.from,
              cells: [bucketName(bucket), bucket.count, f.money(bucket.value)],
              onOpen: () => open(bucketName(bucket), "quotes", bucket.ids),
            })),
          }}
        >
          <ColumnChart
            label={
              measure === "value"
                ? t("Hodnota vytvořených nabídek", "The value of quotes created")
                : t("Počet vytvořených nabídek", "The number of quotes created")
            }
            tones={["accent"]}
            integer={measure === "count"}
            tick={measure === "value" ? tick : countTick}
            categories={s.quotesByBucket.map((bucket) => ({
              key: bucket.from,
              label: bucketLabel(bucket),
              values: [measure === "value" ? bucket.value : bucket.count],
              title: `${bucketName(bucket)}: ${bucket.count} · ${f.money(bucket.value)}`,
            }))}
            onOpen={(index) => {
              const bucket = s.quotesByBucket[index];
              if (bucket) open(bucketName(bucket), "quotes", bucket.ids);
            }}
          />
        </ChartFrame>

        <ChartFrame
          title={t("Kumulativně vyhráno", "Won, cumulative")}
          legend={legendPeriods}
          table={{
            columns: [
              t("Den", "Day"),
              t("Toto období", "This period"),
              t("Předchozí období", "Previous period"),
            ],
            rows: weekly.map((point) => ({
              key: point.date,
              cells: [f.date(point.date), f.money(point.value), f.money(point.previous)],
            })),
          }}
        >
          <LineChart
            label={t(
              "Vyhraná hodnota sečtená den po dni, toto období proti předchozímu",
              "The won value summed day by day, this period against the previous one",
            )}
            series={[
              {
                name: t("Toto období", "This period"),
                tone: "accent",
                values: s.cumulative.map((point) => point.value),
              },
              {
                name: t("Předchozí období", "Previous period"),
                tone: "previous",
                values: s.cumulative.map((point) => point.previous),
              },
            ]}
            xLabel={(index) => dayShort(s.cumulative[index]?.date ?? period.from, locale)}
            tick={tick}
            endLabel={cumulativeEnd ? compactMoney(cumulativeEnd.value, locale) : undefined}
            tooltip={(index) => {
              const point = s.cumulative[index];
              if (!point) return null;
              return (
                <>
                  <strong>{f.date(point.date)}</strong>
                  <span>
                    {t("Toto období", "This period")}: {f.money(point.value)}
                  </span>
                  <span className="muted">
                    {t("Předchozí období", "Previous period")}: {f.money(point.previous)}
                  </span>
                </>
              );
            }}
          />
        </ChartFrame>
      </div>

      <div className="stats-tables">
        <article className="ds-card">
          <h2>{t("Podle fáze", "By stage")}</h2>
          <p className="muted small">
            {t(
              "Otevřené fáze dnes, vyhrané a ztracené uzavřené v období.",
              "Open stages today, won and lost closed in the period.",
            )}
          </p>
          <Table id="stats-stages" caption={t("Případy podle fáze", "Deals by stage")} hideCaption>
            <thead>
              <tr>
                <th scope="col">{t("Fáze", "Stage")}</th>
                <th scope="col" className="ds-table__num">
                  {t("Počet", "Count")}
                </th>
                <th scope="col" className="ds-table__num">
                  {t("Hodnota", "Value")}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.byStage.map((stage) => (
                <tr key={stage.stageId}>
                  <td>
                    <StageChip stage={lookups.stage(stage.stageId)} />
                  </td>
                  <td className="ds-table__num">
                    <CountButton count={stage.count} onOpen={() => openDeals(stage.label, stage)} />
                  </td>
                  <td className="ds-table__num">{f.money(stage.value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </article>
        <article className="ds-card">
          <h2>{t("Ztracené podle důvodu", "Lost by reason")}</h2>
          <Table
            id="stats-reasons"
            caption={t("Ztracené případy podle důvodu", "Lost deals by reason")}
            hideCaption
          >
            <thead>
              <tr>
                <th scope="col">{t("Důvod", "Reason")}</th>
                <th scope="col" className="ds-table__num">
                  {t("Počet", "Count")}
                </th>
                <th scope="col" className="ds-table__num">
                  {t("Hodnota", "Value")}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.lostByReason.map((reason) => (
                <tr key={reason.reasonId}>
                  <td>{reason.label}</td>
                  <td className="ds-table__num">
                    <CountButton
                      count={reason.count}
                      onOpen={() => openDeals(reason.label, reason)}
                    />
                  </td>
                  <td className="ds-table__num">{f.money(reason.value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </article>
      </div>

      {behind ? <BehindDialog behind={behind} data={data} onClose={() => setBehind(null)} /> : null}
    </section>
  );
}

/** `500` → `5 p. b.` / `5 pp`: a difference of two rates in percentage points. */
function pointsText(basisPoints: number, locale: "cs" | "en"): string {
  const whole = Math.trunc(basisPoints / 100);
  const rest = basisPoints % 100;
  const number =
    rest === 0
      ? String(whole)
      : `${whole}${locale === "en" ? "." : ","}${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  return locale === "en" ? `${number} pp` : `${number} p. b.`;
}

function CountButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) return <span className="muted">0</span>;
  return (
    <button type="button" className="chart-open num" onClick={onOpen}>
      {count}
    </button>
  );
}

/** The deals or quotes behind a number, each a link to its page. */
function BehindDialog({
  behind,
  data,
  onClose,
}: {
  behind: Behind;
  data: AppData;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(data.settings.value.currency);
  const lookups = useLookups(data);
  const ids = new Set(behind.ids);
  let body: ReactNode;
  if (behind.kind === "deals") {
    const deals = data.deals
      .map((entry) => entry.value)
      .filter((deal) => ids.has(deal.id))
      .sort((left, right) => right.value - left.value);
    body = (
      <Table id="stats-behind" caption={behind.title} hideCaption density="compact">
        <thead>
          <tr>
            <th scope="col">{t("Případ", "Deal")}</th>
            <th scope="col">{t("Fáze", "Stage")}</th>
            <th scope="col" className="ds-table__num">
              {t("Hodnota", "Value")}
            </th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id}>
              <td>
                <a href={href({ page: "deal", id: deal.id })}>{deal.title}</a>
                <span className="stats-behind-meta small muted">
                  {lookups.companyName(deal.companyId)} · {lookups.salespersonName(deal.ownerId)}
                  {deal.closedAt ? ` · ${f.date(deal.closedAt)}` : ""}
                </span>
              </td>
              <td>
                <StageChip stage={lookups.stage(deal.stageId)} />
              </td>
              <td className="ds-table__num">{f.money(deal.value)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  } else {
    const quotes = data.quotes
      .map((entry) => entry.value)
      .filter((quote) => ids.has(quote.id))
      .sort((left, right) => right.issuedOn.localeCompare(left.issuedOn));
    body = (
      <Table id="stats-behind" caption={behind.title} hideCaption density="compact">
        <thead>
          <tr>
            <th scope="col">{t("Nabídka", "Quote")}</th>
            <th scope="col">{t("Vystaveno", "Issued")}</th>
            <th scope="col" className="ds-table__num">
              {t("Bez DPH", "Without VAT")}
            </th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.id}>
              <td>
                <a href={href({ page: "quote", id: quote.id })}>
                  {quote.number} v{quote.version}
                </a>
                <span className="stats-behind-meta small muted">
                  {quote.title} · {lookups.companyName(lookups.deal(quote.dealId)?.companyId)}
                </span>
              </td>
              <td>{f.date(quote.issuedOn)}</td>
              <td className="ds-table__num">{f.money(quoteTotals(quote).subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }
  return (
    <Dialog
      id="stats-behind-dialog"
      size="lg"
      open
      dismissable
      locale={locale}
      onClose={onClose}
      title={behind.title}
      description={
        behind.kind === "deals"
          ? t(`Případů: ${behind.ids.length}`, `Deals: ${behind.ids.length}`)
          : t(`Nabídek: ${behind.ids.length}`, `Quotes: ${behind.ids.length}`)
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("Zavřít", "Close")}
        </Button>
      }
    >
      {behind.ids.length === 0 ? (
        <p className="muted">{t("Nic tu není.", "Nothing here.")}</p>
      ) : (
        body
      )}
    </Dialog>
  );
}
