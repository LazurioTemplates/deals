import { Button, EmptyState, Icon } from "design-system/react";
import { useState } from "react";
import type { Deal } from "../../domain/deal.ts";
import { sumAmounts } from "../../domain/money.ts";
import { type Stage, stageById } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import {
  Board,
  type BoardColumn,
  StatTile,
  useViewMode,
  ViewToggle,
} from "../components/Board.tsx";
import { CloseDealDialog } from "../components/CloseDeal.tsx";
import { ErrorNotice, PageHeader, StageChip } from "../components/common.tsx";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { createQuoteFor } from "../components/deals/quoteActions.ts";
import { DEALS, type Format, useFormat, useT } from "../i18n.tsx";
import { QuoteStatusBadge } from "../labels.tsx";
import { type Lookups, useLookups } from "../lookups.ts";
import { type DealTab, href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

const TAB_TITLES: Record<DealTab, { cs: string; en: string }> = {
  all: { cs: "Všechny případy", en: "All deals" },
  open: { cs: "Aktivní", en: "Active" },
  won: { cs: "Vyhrané", en: "Won" },
  lost: { cs: "Ztracené", en: "Lost" },
};

/** Text compared without case and diacritics: „Účetní“ matches „ucet“. */
function folded(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("cs");
}

/** Whether a deal matches the search: its title, company, salesperson or deal type. */
function matches(deal: Deal, query: string, lookups: Lookups): boolean {
  if (!query) return true;
  const text = [
    deal.title,
    deal.id,
    lookups.companyName(deal.companyId),
    lookups.salespersonName(deal.ownerId),
    lookups.dealType(deal.dealTypeId)?.label ?? "",
  ].join(" ");
  return folded(text).includes(query);
}

/**
 * The deals of a tab (every deal, the active ones, won or lost) as a table
 * or a board by stage, with figures that follow the filters.
 */
export function DealListPage({
  data,
  tab,
  onChanged,
}: {
  data: AppData;
  tab: DealTab;
  /** Reloads the data after a write; the App's event reload covers a page without it. */
  onChanged?: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const lookups = useLookups(data);
  const [mode, setMode] = useViewMode("deals.view");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");
  const [closing, setClosing] = useState<{ deal: Stored<Deal>; stage: Stage } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = onChanged ?? (async () => {});

  const kindOf = (deal: Deal) => stageById(settings, deal.stageId)?.kind;
  const query = folded(search.trim());
  const filtered = data.deals.filter(
    (entry) =>
      (!owner || entry.value.ownerId === owner) &&
      (!type || entry.value.dealTypeId === type) &&
      matches(entry.value, query, lookups),
  );
  const shown = tab === "all" ? filtered : filtered.filter((entry) => kindOf(entry.value) === tab);
  const ofKind = (kind: "open" | "won" | "lost") =>
    filtered.filter((entry) => kindOf(entry.value) === kind).map((entry) => entry.value.value);
  const openValues = ofKind("open");
  const wonValues = ofKind("won");
  const lostValues = ofKind("lost");

  // The salespeople a filter offers: everyone who owns a deal, and the active ones.
  const owners = data.salespeople
    .map((entry) => entry.value)
    .filter(
      (person) => person.active || data.deals.some((entry) => entry.value.ownerId === person.id),
    )
    .sort((left, right) => left.name.localeCompare(right.name, "cs"));
  const dealTypes = settings.dealTypes ?? [];

  async function moveTo(entry: Stored<Deal>, stageId: string) {
    const stage = stageById(settings, stageId);
    if (!stage || stage.id === entry.value.stageId) return;
    if (stage.kind !== "open") {
      setClosing({ deal: entry, stage });
      return;
    }
    setBusy(entry.value.id);
    setError(null);
    try {
      await api.moveDeal(entry.value.id, { stageId, baseRevision: entry.revision });
      await reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function newQuote(dealId: string) {
    setBusy(`quote:${dealId}`);
    setError(null);
    try {
      await createQuoteFor(dealId, onChanged);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  const columns = useDealColumns({ data, tab, lookups, canWrite, busy, moveTo, newQuote });

  const boardStages =
    tab === "all" ? settings.stages : settings.stages.filter((stage) => stage.kind === tab);
  const boardColumns: BoardColumn<Stored<Deal>>[] = boardStages.map((stage) => {
    const cards = shown.filter((entry) => entry.value.stageId === stage.id);
    return {
      id: stage.id,
      label: stage.label,
      cards,
      total: f.money(sumAmounts(cards.map((entry) => entry.value.value))),
      tone: stage.kind,
      createHref:
        stage.kind === "open"
          ? href({ page: "new-deal", company: null, stage: stage.id })
          : undefined,
    };
  });

  return (
    <section className="deal-list">
      <PageHeader
        title={t.of(TAB_TITLES[tab])}
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
        {tab === "all" || tab === "open" ? (
          <>
            <StatTile label={t("Aktivní případy", "Active deals")} value={openValues.length} />
            <StatTile
              label={t("Hodnota aktivních", "Value of active deals")}
              value={f.money(sumAmounts(openValues))}
            />
            <StatTile
              label={t("Hodnota vyhraných", "Value of won deals")}
              value={f.money(sumAmounts(wonValues))}
              note={t.count(wonValues.length, DEALS)}
            />
          </>
        ) : null}
        {tab === "won" ? (
          <>
            <StatTile label={t("Vyhrané případy", "Won deals")} value={wonValues.length} />
            <StatTile
              label={t("Hodnota vyhraných", "Value of won deals")}
              value={f.money(sumAmounts(wonValues))}
            />
          </>
        ) : null}
        {tab === "lost" ? (
          <>
            <StatTile label={t("Ztracené případy", "Lost deals")} value={lostValues.length} />
            <StatTile
              label={t("Hodnota ztracených", "Value of lost deals")}
              value={f.money(sumAmounts(lostValues))}
            />
          </>
        ) : null}
      </div>
      <div className="filter-bar">
        <div className="filter-bar-search deal-search">
          <Icon name="search" size="sm" className="deal-search-icon" />
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder={t("Hledat případ, firmu, obchodníka…", "Search deals, companies, owners…")}
            aria-label={t("Hledat", "Search")}
            enterKeyHint="search"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="ds-select-wrap">
          <select
            className="ds-select"
            value={owner}
            aria-label={t("Obchodník", "Salesperson")}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">{t("Všichni obchodníci", "All salespeople")}</option>
            {owners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <Icon name="nav-arrow-down" className="ds-select__chevron" />
        </div>
        {dealTypes.length > 0 ? (
          <div className="ds-select-wrap">
            <select
              className="ds-select"
              value={type}
              aria-label={t("Typ zakázky", "Deal type")}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">{t("Všechny typy", "All types")}</option>
              {dealTypes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <Icon name="nav-arrow-down" className="ds-select__chevron" />
          </div>
        ) : null}
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      <ErrorNotice error={error} title={t("Neuloženo.", "Not saved.")} />
      {data.deals.length === 0 ? (
        <EmptyState
          icon="search"
          title={t("Zatím žádný obchodní případ.", "No deal yet.")}
          headingLevel={2}
          actions={
            canWrite ? (
              <Button
                variant="primary"
                href={href({ page: "new-deal", company: null, stage: null })}
              >
                {t("Nový případ", "New deal")}
              </Button>
            ) : undefined
          }
        />
      ) : mode === "board" ? (
        <Board
          label={t.of(TAB_TITLES[tab])}
          columns={boardColumns}
          cardKey={(entry) => entry.value.id}
          cardHref={(entry) => href({ page: "deal", id: entry.value.id })}
          canMove={canWrite}
          onMove={(entry, stageId) => void moveTo(entry, stageId)}
          renderCard={(entry) => <DealCard deal={entry.value} lookups={lookups} f={f} />}
        />
      ) : (
        <DataTable
          id={`deals-${tab}`}
          caption={t.of(TAB_TITLES[tab])}
          columns={columns}
          rows={shown}
          rowKey={(entry) => entry.value.id}
          onOpen={(entry) => navigate({ page: "deal", id: entry.value.id })}
          key={tab}
          storageKey={`deals.columns.v1.${tab}`}
          defaultSort="stage"
          empty={t("Filtrům neodpovídá žádný případ.", "No deal matches the filters.")}
        />
      )}
      {closing ? (
        <CloseDealDialog
          deal={closing.deal}
          stage={closing.stage}
          settings={settings}
          open
          onClose={() => setClosing(null)}
          onDone={reload}
        />
      ) : null}
    </section>
  );
}

/** A deal on the board: its title, the type, the company and the owner, the value. */
function DealCard({ deal, lookups, f }: { deal: Deal; lookups: Lookups; f: Format }) {
  const t = useT();
  const stage = lookups.stage(deal.stageId);
  const hasQuote = lookups.quotesOf(deal.id).length > 0;
  const type = lookups.dealType(deal.dealTypeId)?.label;
  return (
    <>
      <span className="deal-card-title">
        {deal.title}
        {hasQuote ? <QuoteDot /> : null}
      </span>
      {type ? <span className="muted small">{type}</span> : null}
      <span className="muted small deal-card-company">
        {[lookups.companyName(deal.companyId), lookups.salespersonName(deal.ownerId)]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="deal-card-meta">
        <span className="num">{f.money(deal.value)}</span>
        {stage && stage.kind !== "open" && deal.closedAt ? (
          <span className="muted small">
            {t("uzavřeno", "closed")} {f.date(deal.closedAt)}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** The small mark of a deal that has a quote. */
function QuoteDot() {
  const t = useT();
  const label = t("Má nabídku", "Has a quote");
  return <span className="deal-quote-dot" role="img" aria-label={label} title={label} />;
}

/** The columns of the table of deals. */
function useDealColumns({
  data,
  tab,
  lookups,
  canWrite,
  busy,
  moveTo,
  newQuote,
}: {
  data: AppData;
  tab: DealTab;
  lookups: Lookups;
  canWrite: boolean;
  busy: string | null;
  moveTo: (entry: Stored<Deal>, stageId: string) => Promise<void>;
  newQuote: (dealId: string) => Promise<void>;
}): Column<Stored<Deal>>[] {
  const t = useT();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const order = new Map(settings.stages.map((stage, index) => [stage.id, index]));
  const columns: Column<Stored<Deal>>[] = [
    {
      id: "title",
      label: t("Název", "Title"),
      width: 260,
      sortValue: (entry) => entry.value.title,
      render: (entry) => (
        <span className="deal-title-cell">
          <a className="data-table-link" href={href({ page: "deal", id: entry.value.id })}>
            {entry.value.title}
          </a>
          {lookups.quotesOf(entry.value.id).length > 0 ? <QuoteDot /> : null}
        </span>
      ),
    },
    {
      id: "company",
      label: t("Firma", "Company"),
      width: 180,
      sortValue: (entry) => lookups.companyName(entry.value.companyId),
      render: (entry) => lookups.companyName(entry.value.companyId),
    },
    {
      id: "owner",
      label: t("Obchodník", "Salesperson"),
      width: 150,
      sortValue: (entry) => lookups.salespersonName(entry.value.ownerId),
      render: (entry) => lookups.salespersonName(entry.value.ownerId),
    },
    {
      id: "stage",
      label: t("Fáze", "Stage"),
      width: 180,
      interactive: true,
      sortValue: (entry) => order.get(entry.value.stageId) ?? settings.stages.length,
      render: (entry) => {
        const stage = lookups.stage(entry.value.stageId);
        if (!canWrite || stage?.kind !== "open") return <StageChip stage={stage} />;
        return (
          <div className="ds-select-wrap deal-stage-select">
            <select
              className="ds-select"
              value={entry.value.stageId}
              disabled={busy === entry.value.id}
              aria-label={t(`Fáze případu ${entry.value.title}`, `Stage of ${entry.value.title}`)}
              onChange={(event) => void moveTo(entry, event.target.value)}
            >
              {settings.stages.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <Icon name="nav-arrow-down" className="ds-select__chevron" />
          </div>
        );
      },
    },
    {
      id: "type",
      label: t("Typ zakázky", "Deal type"),
      width: 130,
      sortValue: (entry) => lookups.dealType(entry.value.dealTypeId)?.label ?? "",
      render: (entry) => lookups.dealType(entry.value.dealTypeId)?.label ?? "",
    },
    {
      id: "value",
      label: t("Hodnota", "Value"),
      width: 140,
      align: "end",
      sortValue: (entry) => entry.value.value,
      render: (entry) => f.money(entry.value.value),
    },
    {
      id: "quote",
      label: t("Nabídka", "Quote"),
      width: 130,
      interactive: true,
      sortValue: (entry) => lookups.primaryQuoteOf(entry.value.id)?.status ?? "",
      render: (entry) => {
        const primary = lookups.primaryQuoteOf(entry.value.id);
        if (primary) {
          return (
            <a
              className="deal-quote-link"
              href={href({ page: "quote", id: primary.id })}
              title={primary.id}
            >
              <QuoteStatusBadge status={primary.status} />
            </a>
          );
        }
        return canWrite ? (
          <Button
            variant="quiet"
            size="sm"
            icon="plus"
            iconOnly
            busy={busy === `quote:${entry.value.id}`}
            label={t(`Nová nabídka k ${entry.value.title}`, `New quote for ${entry.value.title}`)}
            onClick={() => void newQuote(entry.value.id)}
          />
        ) : null;
      },
    },
    {
      id: "expectedClose",
      label: t("Očekávané uzavření", "Expected close"),
      width: 150,
      sortValue: (entry) => entry.value.expectedClose,
      render: (entry) => f.date(entry.value.expectedClose),
    },
    {
      id: "closedAt",
      label: t("Uzavřeno", "Closed"),
      width: 120,
      sortValue: (entry) => entry.value.closedAt,
      render: (entry) => f.date(entry.value.closedAt),
    },
    {
      id: "createdAt",
      label: t("Založeno", "Created"),
      width: 120,
      sortValue: (entry) => entry.value.createdAt,
      render: (entry) => f.date(entry.value.createdAt),
    },
  ];
  if (tab === "lost") {
    const reasons = new Map(settings.lossReasons.map((reason) => [reason.id, reason.label]));
    const reasonOf = (entry: Stored<Deal>) =>
      entry.value.lossReasonId
        ? (reasons.get(entry.value.lossReasonId) ?? entry.value.lossReasonId)
        : "";
    columns.splice(4, 0, {
      id: "lossReason",
      label: t("Důvod ztráty", "Loss reason"),
      width: 160,
      sortValue: reasonOf,
      render: reasonOf,
    });
  }
  return columns;
}
