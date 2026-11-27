import { cx } from "design-system";
import { Button, EmptyState, Icon } from "design-system/react";
import { useMemo, useState } from "react";
import { localToday, monthOf } from "../../domain/common.ts";
import {
  type ForecastFilter,
  type ForecastRow,
  forecast,
  type UnassignedDeal,
} from "../../domain/forecast.ts";
import { basisPointsOf } from "../../domain/money.ts";
import { splitValue } from "../../domain/payment-plan.ts";
import { type AppData, dataSetOf } from "../App.tsx";
import { api } from "../api.ts";
import { StatTile } from "../components/Board.tsx";
import { ErrorNotice, PageHeader } from "../components/common.tsx";
import { FilterSelect } from "../components/forecast/FilterSelect.tsx";
import {
  EntryDialog,
  MoveDialog,
  PlanDialog,
  RemoveDialog,
} from "../components/forecast/ForecastDialogs.tsx";
import { ForecastSummary } from "../components/forecast/ForecastSummary.tsx";
import { MonthChart } from "../components/forecast/MonthChart.tsx";
import { MonthPanel, type RowActions } from "../components/forecast/MonthPanel.tsx";
import { DEALS, useFormat, useT } from "../i18n.tsx";
import { readLocal, useLookups, writeLocal } from "../lookups.ts";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

type OpenDialog =
  | { kind: "plan"; dealId: string }
  | { kind: "entry"; entryId: string | null; month: string }
  | { kind: "move"; row: ForecastRow }
  | { kind: "remove"; entryId: string };

const FILTER_KEY = "deals.forecast.filter";

/**
 * The forecast of a year: what the Organization invoices month by month,
 * from the payment plans of won deals and the manual rows. The figures come
 * from the same pure function as the API's `/api/forecast`, computed here
 * from the loaded data.
 */
export function ForecastPage({
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
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = monthOf(today);
  const [year, setYear] = useState(thisYear);
  const [filter, setFilterState] = useState<ForecastFilter>(() =>
    readLocal<ForecastFilter>(FILTER_KEY, {}),
  );
  const setFilter = (next: ForecastFilter) => {
    setFilterState(next);
    writeLocal(FILTER_KEY, next);
  };
  const [opened, setOpened] = useState<string[]>([]);
  // The months whose panel is open; the current month starts open.
  const [expanded, setExpanded] = useState<string[]>([thisMonth]);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dragged, setDragged] = useState<UnassignedDeal | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const set = useMemo(() => dataSetOf(data), [data]);
  const outlook = useMemo(() => forecast(set, { today, year, filter }), [set, today, year, filter]);
  const before = useMemo(
    () => forecast(set, { today, year: year - 1, filter }),
    [set, today, year, filter],
  );
  const entities = settings.billingEntities ?? [];
  const types = settings.dealTypes ?? [];
  const notes = new Map(data.forecastNotes.map((entry) => [entry.value.id, entry]));
  const panelMonths = outlook.months
    .map((entry) => entry.month)
    .filter(
      (month) =>
        outlook.months.find((entry) => entry.month === month)?.count ||
        month === thisMonth ||
        opened.includes(month) ||
        notes.has(month),
    );

  async function run(key: string, write: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await write();
      await onChanged();
    } catch (caught) {
      setError(caught);
      throw caught;
    } finally {
      setBusy(null);
    }
  }
  const quietly = (promise: Promise<unknown>) => {
    promise.catch(() => {});
  };

  const dealOf = (id: string | undefined) => data.deals.find((entry) => entry.value.id === id);
  const entryOf = (id: string | undefined) =>
    data.forecastEntries.find((entry) => entry.value.id === id);

  function change(row: ForecastRow, field: "invoicedOn" | "paidOn", on: boolean) {
    const day = on ? today : null;
    if (row.kind === "payment" && row.dealId && row.paymentId) {
      const deal = dealOf(row.dealId);
      if (!deal) return;
      quietly(
        run(row.key, () =>
          api.changePayment(row.dealId as string, row.paymentId as string, {
            baseRevision: deal.revision,
            [field]: day,
          }),
        ),
      );
    } else if (row.entryId) {
      const entry = entryOf(row.entryId);
      if (!entry) return;
      quietly(
        run(row.key, () =>
          api.changeForecastEntry(row.entryId as string, {
            baseRevision: entry.revision,
            [field]: day,
          }),
        ),
      );
    }
  }

  async function moveRow(row: ForecastRow, month: string) {
    if (row.kind === "payment") {
      const deal = dealOf(row.dealId);
      const plan = deal?.value.paymentPlan;
      if (!deal || !plan) return;
      const payments = plan.payments.map((entry) =>
        entry.id === row.paymentId ? { ...entry, month } : entry,
      );
      await run(row.key, () =>
        api.planPayments(deal.value.id, { ...plan, payments }, deal.revision),
      );
    } else {
      const entry = entryOf(row.entryId);
      if (!entry) return;
      await run(row.key, () => api.saveForecastEntry({ ...entry.value, month }, entry.revision));
    }
  }

  function planInMonth(deal: UnassignedDeal, month: string) {
    const stored = dealOf(deal.dealId);
    if (!stored) return;
    const reverseCharge = stored.value.paymentPlan?.reverseCharge;
    quietly(
      run(`deals/${deal.dealId}`, () =>
        api.planPayments(
          deal.dealId,
          {
            status: "planned",
            ...(reverseCharge ? { reverseCharge } : {}),
            payments: splitValue(deal.value, [10_000], month),
          },
          stored.revision,
        ),
      ),
    );
  }

  function openMonth(month: string) {
    if (!opened.includes(month)) setOpened([...opened, month]);
    if (!expanded.includes(month)) setExpanded([...expanded, month]);
    requestAnimationFrame(() =>
      document
        .getElementById(`forecast-month-${month}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  const actions: RowActions = {
    invoice: (row, issued) => change(row, "invoicedOn", issued),
    pay: (row, paid) => change(row, "paidOn", paid),
    editPlan: (row) => row.dealId && setDialog({ kind: "plan", dealId: row.dealId }),
    move: (row) => setDialog({ kind: "move", row }),
    editEntry: (row) =>
      row.entryId && setDialog({ kind: "entry", entryId: row.entryId, month: row.month }),
    removeEntry: (row) => row.entryId && setDialog({ kind: "remove", entryId: row.entryId }),
    addRow: (month) => setDialog({ kind: "entry", entryId: null, month }),
    saveNote: (month, text, revision) =>
      run(`notes/${month}`, () => api.saveForecastNote(month, text, revision)),
  };

  const filtered =
    filter.ownerId !== undefined ||
    filter.dealTypeId !== undefined ||
    filter.billingEntityId !== undefined;
  const totalPast = before.total.forecast;

  return (
    <section className="forecast-page">
      <PageHeader
        title={t(`Forecast ${year}`, `Forecast ${year}`)}
        subtitle={t(
          "Plány plateb vyhraných případů a ruční řádky, měsíc po měsíci.",
          "Payment plans of won deals and manual rows, month by month.",
        )}
        actions={
          <label className="forecast-year">
            <span className="ds-visually-hidden">{t("Rok", "Year")}</span>
            <span className="ds-select-wrap">
              <select
                className="ds-select"
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                  setOpened([]);
                  setExpanded([thisMonth]);
                }}
              >
                {[...new Set([...outlook.years, year])]
                  .sort((left, right) => left - right)
                  .map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
              </select>
              <Icon name="nav-arrow-down" className="ds-select__chevron" />
            </span>
          </label>
        }
      />

      <div className="filter-bar forecast-filters">
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
        {entities.length > 1 ? (
          <FilterSelect
            label={t("Fakturační firma", "Billing entity")}
            all={t("Všechny firmy", "All entities")}
            value={filter.billingEntityId}
            options={entities.map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={(billingEntityId) => setFilter({ ...filter, billingEntityId })}
          />
        ) : null}
        {filtered ? (
          <Button variant="quiet" size="sm" icon="xmark" onClick={() => setFilter({})}>
            {t("Zrušit filtry", "Clear filters")}
          </Button>
        ) : null}
        <p className="forecast-on-the-way">
          <span className="muted">{t("Na cestě", "On the way")}</span>{" "}
          <strong className="num">{f.money(outlook.total.onTheWay)}</strong>
        </p>
      </div>

      <ErrorNotice error={error} />

      <div className="stat-tiles forecast-totals">
        <StatTile
          label={t("Forecast celkem", "Forecast total")}
          value={f.money(outlook.total.forecast)}
          note={
            totalPast > 0
              ? t(`${year - 1}: ${f.money(totalPast)}`, `${year - 1}: ${f.money(totalPast)}`)
              : t(`${outlook.total.count} řádků`, `${outlook.total.count} rows`)
          }
        />
        <StatTile
          label={t("Vyfakturováno", "Invoiced")}
          value={f.money(outlook.total.invoiced)}
          note={share(outlook.total.invoiced, outlook.total.forecast, f.rate, t)}
        />
        <StatTile
          label={t("Zaplaceno", "Paid")}
          value={f.money(outlook.total.paid)}
          note={share(outlook.total.paid, outlook.total.forecast, f.rate, t)}
        />
        <StatTile
          label={t("Po splatnosti", "Overdue")}
          value={
            <span className={outlook.total.overdue > 0 ? "danger" : undefined}>
              {f.money(outlook.total.overdue)}
            </span>
          }
        />
      </div>

      <MonthChart
        months={outlook.months}
        quarters={outlook.quarters}
        thisMonth={thisMonth}
        notes={new Map([...notes].map(([month, entry]) => [month, entry.value.text]))}
        over={over}
        dropping={dragged !== null}
        money={f.money}
        onOpen={openMonth}
        onOver={setOver}
        onDrop={(month) => {
          if (dragged) planInMonth(dragged, month);
          setDragged(null);
        }}
      />

      {outlook.unassigned.length > 0 ? (
        <section
          className="ds-card forecast-unassigned"
          aria-labelledby="forecast-unassigned-title"
        >
          <header className="forecast-section-head">
            <h2 id="forecast-unassigned-title">
              {t("Nezařazené", "Unassigned")}{" "}
              <span className="muted small">{t.count(outlook.unassigned.length, DEALS)}</span>
            </h2>
            <p className="muted small">
              {canWrite
                ? t(
                    "Vyhrané případy bez plánu plateb. Naplánujte je, nebo je přetáhněte na měsíc: vznikne jedna platba v tom měsíci.",
                    "Won deals without a payment plan. Plan them, or drag one onto a month: it becomes one payment in that month.",
                  )
                : t("Vyhrané případy bez plánu plateb.", "Won deals without a payment plan.")}
            </p>
          </header>
          <ul className="forecast-unassigned-list">
            {outlook.unassigned.map((deal) => (
              <li
                key={deal.dealId}
                className={cx(
                  "forecast-unassigned-item",
                  dragged?.dealId === deal.dealId && "is-dragging",
                )}
                draggable={canWrite}
                onDragStart={(event) => {
                  setDragged(deal);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", deal.dealId);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
              >
                <span className="forecast-unassigned-main">
                  <a href={href({ page: "deal", id: deal.dealId })}>{deal.title}</a>
                  <span className="small muted">
                    {lookups.companyName(deal.companyId)} · {lookups.salespersonName(deal.ownerId)}
                    {deal.closedAt ? ` · ${t("vyhráno", "won")} ${f.date(deal.closedAt)}` : ""}
                  </span>
                </span>
                <span className="num forecast-unassigned-value">{f.money(deal.value)}</span>
                {canWrite ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    busy={busy === `deals/${deal.dealId}`}
                    onClick={() => setDialog({ kind: "plan", dealId: deal.dealId })}
                  >
                    {t("Naplánovat", "Plan")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outlook.total.count === 0 && outlook.unassigned.length === 0 ? (
        <EmptyState icon="calendar" title={t("V tomto roce nic není", "Nothing in this year")}>
          <p>
            {filtered
              ? t("Zkuste zrušit filtry.", "Try clearing the filters.")
              : t(
                  "Forecast plní plány plateb vyhraných případů a ruční řádky.",
                  "The payment plans of won deals and manual rows fill the forecast.",
                )}
          </p>
        </EmptyState>
      ) : null}

      <div className="forecast-panels">
        {panelMonths.map((month) => (
          <MonthPanel
            key={month}
            month={month}
            figures={
              outlook.months.find((entry) => entry.month === month) ?? {
                month,
                forecast: 0,
                invoiced: 0,
                paid: 0,
                overdue: 0,
                onTheWay: 0,
                count: 0,
              }
            }
            rows={outlook.rows.filter((row) => row.month === month)}
            note={notes.get(month)}
            lookups={lookups}
            f={f}
            canWrite={canWrite}
            busy={busy}
            current={month === thisMonth}
            open={expanded.includes(month)}
            onToggle={() =>
              setExpanded(
                expanded.includes(month)
                  ? expanded.filter((entry) => entry !== month)
                  : [...expanded, month],
              )
            }
            actions={actions}
          />
        ))}
      </div>

      <ForecastSummary
        year={year}
        total={outlook.total.forecast}
        f={f}
        groupings={[
          {
            id: "owner",
            label: t("Obchodník", "Salesperson"),
            groups: outlook.groups.owner,
            previous: before.groups.owner,
            name: (id) =>
              id ? lookups.salespersonName(id) : t("Bez obchodníka", "No salesperson"),
          },
          {
            id: "type",
            label: t("Typ zakázky", "Deal type"),
            groups: outlook.groups.dealType,
            previous: before.groups.dealType,
            name: (id) => lookups.dealType(id ?? undefined)?.label ?? t("Bez typu", "No type"),
          },
          ...(entities.length > 1
            ? [
                {
                  id: "entity",
                  label: t("Fakturační firma", "Billing entity"),
                  groups: outlook.groups.billingEntity,
                  previous: before.groups.billingEntity,
                  name: (id: string | null) =>
                    lookups.billingEntity(id ?? undefined)?.name ?? t("Bez firmy", "No entity"),
                },
              ]
            : []),
        ]}
      />

      {!canWrite ? null : (
        <p className="muted small forecast-hint">
          {t(
            "Každá změna je koncept; do dat Organizace se dostane, až ho publikujete.",
            "Every change is a draft; it reaches the Organization's data once you publish it.",
          )}
        </p>
      )}

      {dialog?.kind === "plan" && dealOf(dialog.dealId) ? (
        <PlanDialog
          key={dialog.dealId}
          deal={dealOf(dialog.dealId) as NonNullable<ReturnType<typeof dealOf>>}
          currency={settings.currency}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      ) : null}
      {dialog?.kind === "entry" ? (
        <EntryDialog
          key={dialog.entryId ?? `new-${dialog.month}`}
          data={data}
          entry={dialog.entryId ? (entryOf(dialog.entryId) ?? null) : null}
          month={dialog.month}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveDialog
          key={dialog.row.key}
          title={`${dialog.row.title} · ${f.money(dialog.row.amount)}`}
          month={dialog.row.month}
          onClose={() => setDialog(null)}
          onMove={(month) => moveRow(dialog.row, month)}
        />
      ) : null}
      {dialog?.kind === "remove" && entryOf(dialog.entryId) ? (
        <RemoveDialog
          key={dialog.entryId}
          entry={entryOf(dialog.entryId) as NonNullable<ReturnType<typeof entryOf>>}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      ) : null}
    </section>
  );
}

function share(
  part: number,
  whole: number,
  rate: (basisPoints: number | null) => string,
  t: (cs: string, en: string) => string,
): string | undefined {
  if (whole <= 0) return undefined;
  const basisPoints = basisPointsOf(part, whole);
  return t(`${rate(basisPoints)} forecastu`, `${rate(basisPoints)} of the forecast`);
}
