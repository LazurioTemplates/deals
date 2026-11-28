import { cx } from "design-system";
import { Badge, Button, Icon } from "design-system/react";
import { useState } from "react";
import type { ForecastMonth, ForecastRow } from "../../../domain/forecast.ts";
import type { ForecastNote } from "../../../domain/forecast-entry.ts";
import type { Stored } from "../../api.ts";
import { type Format, useLocale, useT } from "../../i18n.tsx";
import { PaymentStateBadge } from "../../labels.tsx";
import type { Lookups } from "../../lookups.ts";
import { href } from "../../routes.ts";
import { monthName } from "../charts/format.ts";
import { type Column, DataTable } from "../DataTable.tsx";

/** What a month's rows let the person do; the page saves each as a draft. */
export interface RowActions {
  invoice: (row: ForecastRow, issued: boolean) => void;
  pay: (row: ForecastRow, paid: boolean) => void;
  editPlan: (row: ForecastRow) => void;
  move: (row: ForecastRow) => void;
  editEntry: (row: ForecastRow) => void;
  removeEntry: (row: ForecastRow) => void;
  addRow: (month: string) => void;
  saveNote: (month: string, text: string, revision: string | null) => Promise<void>;
}

export const NOTE_LIMIT = 4000;

/**
 * One month of the forecast: a summary row with its figures that opens to the
 * note and a table of its rows with their invoice and payment, which the
 * person ticks off in place. Closed, the body stays in the page, hidden.
 */
export function MonthPanel({
  month,
  figures,
  rows,
  note,
  lookups,
  f,
  canWrite,
  busy,
  current,
  open,
  onToggle,
  actions,
}: {
  month: string;
  figures: ForecastMonth;
  rows: ForecastRow[];
  note: Stored<ForecastNote> | undefined;
  lookups: Lookups;
  f: Format;
  canWrite: boolean;
  /** The key of the row being saved now. */
  busy: string | null;
  current: boolean;
  /** Whether the month shows its note and rows under its summary row. */
  open: boolean;
  onToggle: () => void;
  actions: RowActions;
}) {
  const t = useT();
  const locale = useLocale();
  const columns: Column<ForecastRow>[] = [
    {
      id: "title",
      label: t("Případ / řádek", "Deal / row"),
      width: 220,
      sortValue: (row) => row.title,
      render: (row) => (
        <span className="forecast-row-title">
          {row.dealId ? (
            <a className="data-table-link" href={href({ page: "deal", id: row.dealId })}>
              {row.title}
            </a>
          ) : (
            <span className="data-table-link">{row.title}</span>
          )}
          <span className="small muted">
            {row.kind === "entry" ? t("Ruční řádek", "Manual row") : (row.label ?? "")}
            {row.note ? ` · ${row.note}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "amount",
      label: t("Částka", "Amount"),
      width: 150,
      align: "end",
      sortValue: (row) => row.amount,
      render: (row) => f.money(row.amount),
    },
    {
      id: "share",
      label: t("Podíl", "Share"),
      width: 120,
      align: "end",
      sortValue: (row) => row.share,
      render: (row) =>
        row.share !== undefined && row.of ? (
          <>
            {f.rate(row.share)} <span className="muted">· {`${row.of.index}/${row.of.count}`}</span>
          </>
        ) : (
          ""
        ),
    },
    {
      id: "state",
      label: t("Stav", "State"),
      width: 130,
      sortValue: (row) => row.state,
      render: (row) => <PaymentStateBadge state={row.state} />,
    },
    {
      id: "invoice",
      label: t("Faktura", "Invoice"),
      width: 90,
      interactive: true,
      render: (row) => (
        <input
          type="checkbox"
          className="ds-check__input"
          checked={row.invoicedOn !== undefined}
          disabled={!canWrite || busy === row.key}
          aria-label={t(`Faktura vystavena: ${row.title}`, `Invoice issued: ${row.title}`)}
          onChange={(event) => actions.invoice(row, event.target.checked)}
        />
      ),
    },
    {
      id: "invoicedOn",
      label: t("Vystaveno", "Issued"),
      width: 110,
      sortValue: (row) => row.invoicedOn,
      render: (row) => f.date(row.invoicedOn),
    },
    {
      id: "dueOn",
      label: t("Splatnost", "Due"),
      width: 110,
      sortValue: (row) => row.dueOn,
      render: (row) => (
        <span className={row.state === "overdue" ? "danger" : undefined}>{f.date(row.dueOn)}</span>
      ),
    },
    {
      id: "paid",
      label: t("Zaplaceno", "Paid"),
      width: 100,
      interactive: true,
      render: (row) => (
        <input
          type="checkbox"
          className="ds-check__input"
          checked={row.paidOn !== undefined}
          disabled={!canWrite || busy === row.key}
          aria-label={t(`Zaplaceno: ${row.title}`, `Paid: ${row.title}`)}
          onChange={(event) => actions.pay(row, event.target.checked)}
        />
      ),
    },
    {
      id: "paidOn",
      label: t("Zaplaceno dne", "Paid on"),
      width: 120,
      sortValue: (row) => row.paidOn,
      render: (row) => f.date(row.paidOn),
    },
    {
      id: "company",
      label: t("Firma", "Company"),
      width: 180,
      sortValue: (row) => lookups.companyName(row.companyId),
      render: (row) => lookups.companyName(row.companyId),
    },
    {
      id: "owner",
      label: t("Obchodník", "Salesperson"),
      width: 150,
      sortValue: (row) => lookups.salespersonName(row.ownerId),
      render: (row) => lookups.salespersonName(row.ownerId),
    },
    {
      id: "type",
      label: t("Typ", "Type"),
      width: 120,
      sortValue: (row) => lookups.dealType(row.dealTypeId)?.label,
      render: (row) => lookups.dealType(row.dealTypeId)?.label ?? "",
    },
    {
      id: "reverseCharge",
      label: t("PDP", "RC"),
      width: 70,
      sortValue: (row) => (row.reverseCharge ? 1 : 0),
      render: (row) =>
        row.reverseCharge ? (
          <Badge tone="neutral" icon={false}>
            {t("PDP", "RC")}
          </Badge>
        ) : (
          ""
        ),
    },
  ];
  if (canWrite) {
    columns.push({
      id: "actions",
      label: t("Akce", "Actions"),
      width: 140,
      interactive: true,
      render: (row) => (
        <span className="forecast-row-actions">
          {row.kind === "payment" ? (
            <Button
              variant="quiet"
              size="sm"
              icon="edit-pencil"
              iconOnly
              label={t("Upravit plán plateb", "Edit the payment plan")}
              onClick={() => actions.editPlan(row)}
            />
          ) : (
            <Button
              variant="quiet"
              size="sm"
              icon="edit-pencil"
              iconOnly
              label={t("Upravit řádek", "Edit the row")}
              onClick={() => actions.editEntry(row)}
            />
          )}
          <Button
            variant="quiet"
            size="sm"
            icon="calendar"
            iconOnly
            label={t("Přesunout do jiného měsíce", "Move to another month")}
            onClick={() => actions.move(row)}
          />
          {row.kind === "entry" ? (
            <Button
              variant="quiet"
              size="sm"
              icon="trash"
              iconOnly
              label={t("Odebrat řádek", "Remove the row")}
              onClick={() => actions.removeEntry(row)}
            />
          ) : null}
        </span>
      ),
    });
  }

  const name = `${monthName(month, locale)} ${month.slice(0, 4)}`;
  const body = `forecast-month-${month}-body`;
  return (
    <section
      id={`forecast-month-${month}`}
      className={cx("forecast-month", current && "is-current", open && "is-open")}
      aria-labelledby={`forecast-month-${month}-title`}
    >
      <h2 className="forecast-month-head">
        <button
          type="button"
          className="forecast-month-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
        >
          <span className="forecast-month-name">
            <span id={`forecast-month-${month}-title`} className="forecast-month-label">
              {name}
            </span>
            {current ? (
              <Badge tone="accent" icon={false}>
                {t("Tento měsíc", "This month")}
              </Badge>
            ) : null}
          </span>
          <span className="forecast-month-figures">
            <span className="forecast-month-figure">
              <span className="forecast-month-figure-label">{t("Řádků", "Rows")}</span>
              <span className="num">{figures.count}</span>
            </span>
            <span className="forecast-month-figure">
              <span className="forecast-month-figure-label">{t("Celkem", "Total")}</span>
              <span className="num">{f.money(figures.forecast)}</span>
            </span>
            <span className="forecast-month-figure">
              <span className="forecast-month-figure-label">{t("Vyfakturováno", "Invoiced")}</span>
              <span className="num">{f.money(figures.invoiced)}</span>
            </span>
            {figures.overdue > 0 ? (
              <span className="forecast-month-figure">
                <span className="forecast-month-figure-label">{t("Po splatnosti", "Overdue")}</span>
                <span className="num danger">{f.money(figures.overdue)}</span>
              </span>
            ) : null}
          </span>
          <Icon name="nav-arrow-down" className="forecast-month-chevron" />
        </button>
      </h2>
      <div id={body} className="forecast-month-body" hidden={!open}>
        <div className="forecast-month-tools">
          <MonthNote month={month} note={note} canWrite={canWrite} onSave={actions.saveNote} />
          {canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              className="forecast-month-add"
              onClick={() => actions.addRow(month)}
            >
              {t("Přidat řádek", "Add a row")}
            </Button>
          ) : null}
        </div>
        <DataTable
          id={`forecast-${month}`}
          caption={t(`Řádky forecastu: ${name}`, `Forecast rows: ${name}`)}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          storageKey="deals.forecast.rows"
          rowClassName={(row) => (row.state === "overdue" ? "forecast-row--overdue" : undefined)}
          empty={t("V tomto měsíci zatím nic není.", "Nothing in this month yet.")}
        />
      </div>
    </section>
  );
}

/** The note of a month: shown, edited in place, removed when emptied. */
function MonthNote({
  month,
  note,
  canWrite,
  onSave,
}: {
  month: string;
  note: Stored<ForecastNote> | undefined;
  canWrite: boolean;
  onSave: (month: string, text: string, revision: string | null) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note?.value.text ?? "");
  const [busy, setBusy] = useState(false);
  if (!editing) {
    if (!note && !canWrite) return null;
    return (
      <div className="forecast-note">
        {note ? (
          <p className="forecast-note-text pre">
            <Icon name="page" size="sm" />
            <span>{note.value.text}</span>
          </p>
        ) : null}
        {canWrite ? (
          <Button
            variant="quiet"
            size="sm"
            icon={note ? "edit-pencil" : "plus"}
            onClick={() => {
              setText(note?.value.text ?? "");
              setEditing(true);
            }}
          >
            {note
              ? t("Upravit poznámku", "Edit the note")
              : t("Poznámka k měsíci", "A note on the month")}
          </Button>
        ) : null}
      </div>
    );
  }
  const id = `forecast-note-${month}`;
  return (
    <div className="forecast-note forecast-note--editing">
      <label className="ds-field__label" htmlFor={id}>
        {t("Poznámka k měsíci", "A note on the month")}
      </label>
      <textarea
        id={id}
        className="ds-textarea"
        rows={3}
        maxLength={NOTE_LIMIT}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="forecast-note-actions">
        <span className="small muted">
          {text.length} / {NOTE_LIMIT}
          {text.trim() === "" && note
            ? ` · ${t("Prázdná poznámka se odebere.", "An empty note is removed.")}`
            : ""}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
          {t("Zrušit", "Cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          busy={busy}
          disabled={busy || (text.trim() === "" && !note)}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(month, text.trim(), note?.revision ?? null);
              setEditing(false);
            } catch {
              // The page shows the refusal; the text stays here to try again.
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Uložit poznámku", "Save the note")}
        </Button>
      </div>
    </div>
  );
}
