import { Button, EmptyState, Switch } from "design-system/react";
import { useMemo, useState } from "react";
import { localToday } from "../../domain/common.ts";
import { sumAmounts } from "../../domain/money.ts";
import { PERIOD_LABELS, type PeriodPreset, periodOf } from "../../domain/periods.ts";
import { isLive, QUOTE_STATUSES, type Quote, type QuoteStatus } from "../../domain/quote.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { Board, ChipChoice, StatTile, useViewMode, ViewToggle } from "../components/Board.tsx";
import { ErrorNotice, PageHeader } from "../components/common.tsx";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { NewQuoteDialog } from "../components/quotes/NewQuoteDialog.tsx";
import { matches } from "../components/quotes/search.ts";
import { useFormat, useT } from "../i18n.tsx";
import { QUOTE_STATUS_LABELS, QuoteStatusBadge } from "../labels.tsx";
import { readLocal, useLookups, writeLocal } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

/** The periods the list offers, in this order. */
const PERIODS: PeriodPreset[] = [
  "all",
  "today",
  "yesterday",
  "last7",
  "lastWeek",
  "last30",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
];

const PERIOD_KEY = "quotes.period.v1";
const REVISIONS_KEY = "quotes.revisions.v1";

function rememberedPeriod(): PeriodPreset {
  const kept = readLocal<string>(PERIOD_KEY, "all");
  return PERIODS.includes(kept as PeriodPreset) ? (kept as PeriodPreset) : "all";
}

/** The latest revision of every quote number, as stored. */
function latestOf(quotes: readonly Stored<Quote>[]): Stored<Quote>[] {
  const byNumber = new Map<string, Stored<Quote>>();
  for (const entry of quotes) {
    const found = byNumber.get(entry.value.number);
    if (!found || entry.value.version > found.value.version)
      byNumber.set(entry.value.number, entry);
  }
  return [...byNumber.values()];
}

/** The quotes: tiles, filters by period and supplier, a search, and the list or the board. */
export function QuoteListPage({
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
  const lookups = useLookups(data);
  const entities = settings.billingEntities ?? [];
  const severalEntities = entities.length > 1;
  const defaultEntity = entities[0]?.id ?? "";
  const [period, setPeriod] = useState<PeriodPreset>(rememberedPeriod);
  const [entity, setEntity] = useState("all");
  const [query, setQuery] = useState("");
  const [revisions, setRevisions] = useState(() => readLocal<boolean>(REVISIONS_KEY, false));
  const [mode, setMode] = useViewMode("quotes.view.v1");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const entityOf = (quote: Quote) => quote.billingEntityId ?? defaultEntity;
  const range = period === "all" ? null : periodOf(period, today);
  const inPeriod = (quote: Quote) =>
    !range || (quote.issuedOn >= range.from && quote.issuedOn <= range.to);
  const found = (quote: Quote) => {
    const deal = lookups.deal(quote.dealId);
    return matches(query, [
      quote.number,
      quote.id,
      quote.title,
      quote.customer.name,
      deal?.title,
      deal ? lookups.companyName(deal.companyId) : undefined,
      deal ? lookups.salespersonName(deal.ownerId) : undefined,
      t.of(QUOTE_STATUS_LABELS[quote.status]),
    ]);
  };

  const latest = useMemo(() => latestOf(data.quotes), [data.quotes]);
  const pool = revisions ? data.quotes : latest;
  const beforeEntity = pool.filter((entry) => inPeriod(entry.value) && found(entry.value));
  const rows = beforeEntity.filter((entry) => entity === "all" || entityOf(entry.value) === entity);
  // The tiles count each quote once, by its latest revision, under the same filters.
  const counted = latest.filter(
    (entry) =>
      inPeriod(entry.value) &&
      found(entry.value) &&
      (entity === "all" || entityOf(entry.value) === entity),
  );
  const countOf = (status: QuoteStatus) =>
    counted.filter((entry) => entry.value.status === status).length;
  const totalValue = sumAmounts(
    counted
      .filter((entry) => isLive(entry.value.status))
      .map((entry) => lookups.quoteSubtotal(entry.value)),
  );

  async function setStatus(entry: Stored<Quote>, status: QuoteStatus) {
    if (status === entry.value.status) return;
    setMoving(entry.value.id);
    setError(null);
    try {
      await api.setQuoteStatus(entry.value.id, status, entry.revision);
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setMoving(null);
    }
  }

  const companyOf = (quote: Quote) => {
    const deal = lookups.deal(quote.dealId);
    return deal ? lookups.companyName(deal.companyId) : quote.customer.name;
  };
  const ownerOf = (quote: Quote) => lookups.salespersonName(lookups.deal(quote.dealId)?.ownerId);
  const entityName = (quote: Quote) => lookups.billingEntity(entityOf(quote))?.name ?? "";

  const columns: Column<Stored<Quote>>[] = [
    {
      id: "number",
      label: t("Číslo", "Number"),
      width: 130,
      render: (entry) => <span className="mono">{entry.value.number}</span>,
      sortValue: (entry) => `${entry.value.number}-${String(entry.value.version).padStart(3, "0")}`,
    },
    {
      id: "title",
      label: t("Název", "Title"),
      width: 240,
      render: (entry) => entry.value.title,
      sortValue: (entry) => entry.value.title,
    },
    {
      id: "company",
      label: t("Firma", "Company"),
      width: 180,
      render: (entry) => companyOf(entry.value),
      sortValue: (entry) => companyOf(entry.value),
    },
    {
      id: "owner",
      label: t("Obchodník", "Salesperson"),
      width: 150,
      render: (entry) => ownerOf(entry.value),
      sortValue: (entry) => ownerOf(entry.value),
    },
    ...(severalEntities
      ? [
          {
            id: "entity",
            label: t("Dodavatel", "Supplier"),
            width: 160,
            render: (entry: Stored<Quote>) => entityName(entry.value),
            sortValue: (entry: Stored<Quote>) => entityName(entry.value),
          },
        ]
      : []),
    {
      id: "version",
      label: t("Revize", "Revision"),
      width: 90,
      align: "end",
      render: (entry) => entry.value.version,
      sortValue: (entry) => entry.value.version,
    },
    {
      id: "status",
      label: t("Stav", "Status"),
      width: 150,
      interactive: true,
      render: (entry) =>
        canWrite ? (
          <div className="ds-select-wrap quote-status-select">
            <select
              className="ds-select"
              value={entry.value.status}
              disabled={moving !== null}
              aria-label={t(
                `Stav nabídky ${entry.value.id}`,
                `Status of the quote ${entry.value.id}`,
              )}
              onChange={(event) => void setStatus(entry, event.target.value as QuoteStatus)}
            >
              {QUOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.of(QUOTE_STATUS_LABELS[status])}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <QuoteStatusBadge status={entry.value.status} />
        ),
      sortValue: (entry) => QUOTE_STATUSES.indexOf(entry.value.status),
    },
    {
      id: "total",
      label: t("Celkem bez DPH", "Total excl. VAT"),
      width: 150,
      align: "end",
      render: (entry) => f.money(lookups.quoteSubtotal(entry.value)),
      sortValue: (entry) => lookups.quoteSubtotal(entry.value),
    },
    {
      id: "issuedOn",
      label: t("Vystaveno", "Issued"),
      width: 120,
      render: (entry) => f.date(entry.value.issuedOn),
      sortValue: (entry) => entry.value.issuedOn,
    },
    {
      id: "validUntil",
      label: t("Platnost do", "Valid until"),
      width: 120,
      render: (entry) => f.date(entry.value.validUntil),
      sortValue: (entry) => entry.value.validUntil,
    },
  ];

  const entityOptions = [
    { value: "all", label: t("Všichni dodavatelé", "All suppliers"), count: beforeEntity.length },
    ...entities.map((entry) => ({
      value: entry.id,
      label: entry.name,
      count: beforeEntity.filter((quote) => entityOf(quote.value) === entry.id).length,
    })),
  ];

  return (
    <section className="quotes-page">
      <PageHeader
        title={t("Cenové nabídky", "Quotes")}
        actions={
          <>
            <ViewToggle mode={mode} onChange={setMode} />
            {canWrite ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                {t("Nová nabídka", "New quote")}
              </Button>
            ) : null}
          </>
        }
      />
      {canWrite ? (
        <NewQuoteDialog
          data={data}
          open={creating}
          onClose={() => setCreating(false)}
          onChanged={onChanged}
        />
      ) : null}
      <div className="quotes-filters">
        <ChipChoice
          label={t("Období podle data vystavení", "Period by the issue date")}
          value={period}
          options={PERIODS.map((value) => ({ value, label: t.of(PERIOD_LABELS[value]) }))}
          onChange={(value) => {
            setPeriod(value);
            writeLocal(PERIOD_KEY, value);
          }}
        />
        {severalEntities ? (
          <ChipChoice
            label={t("Dodavatel", "Supplier")}
            value={entity}
            options={entityOptions}
            onChange={setEntity}
          />
        ) : null}
      </div>
      <div className="stat-tiles">
        <StatTile label={t("Celkem nabídek", "Quotes in total")} value={counted.length} />
        <StatTile label={t("Odeslané", "Sent")} value={countOf("active")} />
        <StatTile label={t("Schválené", "Approved")} value={countOf("approved")} />
        <StatTile label={t("Koncepty", "Drafts")} value={countOf("draft")} />
        <StatTile
          label={t("Celková hodnota bez DPH", "Total value excl. VAT")}
          value={f.money(totalValue)}
          note={t("bez zrušených a nahrazených", "without cancelled and superseded")}
        />
      </div>
      <div className="filter-bar">
        <input
          className="ds-input filter-bar-search"
          type="search"
          value={query}
          aria-label={t("Hledat nabídky", "Search the quotes")}
          placeholder={t(
            "Případ, firma, obchodník, číslo, název, stav",
            "Deal, company, salesperson, number, title, status",
          )}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Switch
          id="quotes-revisions"
          label={t("Zobrazit předchozí revize", "Show earlier revisions")}
          checked={revisions}
          onChange={(event) => {
            setRevisions(event.target.checked);
            writeLocal(REVISIONS_KEY, event.target.checked);
          }}
        />
      </div>
      <ErrorNotice error={error} title={t("Stav se nezměnil.", "The status did not change.")} />
      {data.quotes.length === 0 ? (
        <EmptyState
          icon="page"
          title={t("Zatím žádná nabídka.", "No quote yet.")}
          actions={
            canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t("Nová nabídka", "New quote")}
              </Button>
            ) : null
          }
        >
          <p>
            {t(
              "Nabídka vzniká k obchodnímu případu a začíná jako koncept.",
              "A quote belongs to a deal and starts as a draft.",
            )}
          </p>
        </EmptyState>
      ) : mode === "list" ? (
        <DataTable
          id="quotes"
          caption={t("Cenové nabídky", "Quotes")}
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.value.id}
          rowHref={(entry) => href({ page: "quote", id: entry.value.id })}
          onOpen={(entry) => navigate({ page: "quote", id: entry.value.id })}
          rowClassName={(entry) => (isLive(entry.value.status) ? undefined : "quote-row-faded")}
          storageKey="quotes.columns.v1"
          defaultSort="issuedOn"
          defaultDirection="desc"
          empty={t("Filtrům neodpovídá žádná nabídka.", "No quote matches the filters.")}
        />
      ) : (
        <div className="quote-board">
          <Board
            label={t("Nabídky podle stavu", "Quotes by status")}
            canMove={canWrite && moving === null}
            columns={QUOTE_STATUSES.map((status) => {
              const cards = rows
                .filter((entry) => entry.value.status === status)
                .sort((left, right) => right.value.issuedOn.localeCompare(left.value.issuedOn));
              return {
                id: status,
                label: t.of(QUOTE_STATUS_LABELS[status]),
                cards,
                total: f.money(
                  sumAmounts(cards.map((entry) => lookups.quoteSubtotal(entry.value))),
                ),
                tone: isLive(status) ? (status === "approved" ? "won" : "open") : "muted",
              };
            })}
            cardKey={(entry) => entry.value.id}
            cardHref={(entry) => href({ page: "quote", id: entry.value.id })}
            onMove={(entry, status) => void setStatus(entry, status as QuoteStatus)}
            renderCard={(entry) => (
              <>
                <span className="quote-card-head">
                  <span className="mono small">{entry.value.number}</span>
                  <span className="muted small">
                    {t("rev.", "rev.")} {entry.value.version}
                  </span>
                </span>
                <span className="quote-card-title">{entry.value.title}</span>
                <span className="muted small">{companyOf(entry.value)}</span>
                <span className="quote-card-meta">
                  <span className="muted small">{f.date(entry.value.issuedOn)}</span>
                  <span className="num small">{f.money(lookups.quoteSubtotal(entry.value))}</span>
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  );
}
