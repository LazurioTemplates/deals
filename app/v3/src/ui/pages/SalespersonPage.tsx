import { Badge, Button, EmptyState, Switch } from "design-system/react";
import { useMemo, useState } from "react";
import type { Deal } from "../../domain/deal.ts";
import type { Salesperson } from "../../domain/salesperson.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { StatTile } from "../components/Board.tsx";
import { Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { EditNotices, formLocked, isRecordChanged, useRecordForm } from "../edit.tsx";
import { useFormat, useT } from "../i18n.tsx";
import { useLookups } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";
import { Avatar, salespersonFigures } from "./SalespeopleListPage.tsx";

export interface SalespersonForm {
  name: string;
  role: string;
  email: string;
  phone: string;
  active: boolean;
  note: string;
}

export function salespersonFormOf(person: Salesperson | undefined): SalespersonForm {
  return {
    name: person?.name ?? "",
    role: person?.role ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    active: person?.active ?? true,
    note: person?.note ?? "",
  };
}

/**
 * Sends a salesperson's form: a change of the person the form came from,
 * with that record's revision as the base, or a new salesperson.
 */
export function submitSalesperson(
  base: Stored<Salesperson> | undefined,
  form: SalespersonForm,
): Promise<Stored<Salesperson>> {
  const text = (value: string) => value.trim();
  const record = {
    name: text(form.name),
    ...(text(form.role) ? { role: text(form.role) } : {}),
    ...(text(form.email) ? { email: text(form.email) } : {}),
    ...(text(form.phone) ? { phone: text(form.phone) } : {}),
    active: form.active,
    ...(text(form.note) ? { note: text(form.note) } : {}),
  };
  return base
    ? api.saveSalesperson({ ...record, id: base.value.id }, base.revision)
    : api.createSalesperson(record);
}

/** A salesperson: their figures, their deals by value and the edit of their details. */
export function SalespersonPage({
  data,
  id,
  onChanged,
}: {
  data: AppData;
  id: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const f = useFormat(data.settings.value.currency);
  const lookups = useLookups(data);
  const current = id ? data.salespeople.find((entry) => entry.value.id === id) : undefined;
  // The form keeps the record it came from: a reload never replaces what the
  // person is typing, and the save sends that revision.
  const edit = useRecordForm<Salesperson, SalespersonForm>(current, salespersonFormOf);
  const { form, update } = edit;
  const stored = current ?? edit.base;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  const figures = useMemo(
    () => (stored ? salespersonFigures(data, lookups, stored.value.id) : null),
    [data, lookups, stored],
  );
  const columns = useMemo<Column<Deal>[]>(
    () => [
      {
        id: "title",
        label: t("Název", "Name"),
        render: (deal) => deal.title,
        sortValue: (deal) => deal.title,
        width: 240,
      },
      {
        id: "company",
        label: t("Firma", "Company"),
        render: (deal) => lookups.companyName(deal.companyId),
        sortValue: (deal) => lookups.companyName(deal.companyId),
        width: 200,
      },
      {
        id: "stage",
        label: t("Fáze", "Stage"),
        render: (deal) => <StageChip stage={lookups.stage(deal.stageId)} />,
        sortValue: (deal) => lookups.stage(deal.stageId)?.label,
        width: 150,
      },
      {
        id: "value",
        label: t("Hodnota", "Value"),
        render: (deal) => f.money(deal.value),
        sortValue: (deal) => deal.value,
        align: "end",
        width: 150,
      },
      {
        id: "quotes",
        label: t("Nabídek", "Quotes"),
        render: (deal) => lookups.quotesOf(deal.id).length,
        sortValue: (deal) => lookups.quotesOf(deal.id).length,
        align: "end",
        width: 100,
      },
    ],
    [t, lookups, f],
  );

  if (id && !stored) {
    return (
      <section>
        <PageHeader title={t("Obchodník neexistuje", "This salesperson does not exist")} />
        <p>
          <a href={href({ page: "salespeople" })}>
            {t("Zpět na obchodníky", "Back to the salespeople")}
          </a>
        </p>
      </section>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const opened = edit.base;
    const submitted = form;
    try {
      const saved = await submitSalesperson(opened, submitted);
      if (opened) edit.saved(saved, submitted);
      await onChanged();
      if (!opened) navigate({ page: "salesperson", id: saved.value.id });
    } catch (caught) {
      // The record stored now, so the person can load it; their values stay.
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const person = stored?.value;
  const openWithInactive = person && !form.active && (figures?.open.length ?? 0) > 0;

  return (
    <section>
      <PageHeader
        eyebrow={
          person ? (
            <a href={href({ page: "salespeople" })}>
              {t("Obchodníci", "Salespeople")} · {person.id}
            </a>
          ) : (
            t("Obchodníci", "Salespeople")
          )
        }
        title={
          person ? (
            <span className="person-title">
              <Avatar name={person.name} large />
              <span>{person.name}</span>
              {person.active ? null : (
                <Badge tone="neutral" icon={false}>
                  {t("Neaktivní", "Inactive")}
                </Badge>
              )}
            </span>
          ) : (
            t("Nový obchodník", "New salesperson")
          )
        }
        subtitle={
          person ? [person.role, person.email, person.phone].filter(Boolean).join(" · ") : undefined
        }
      />

      {figures ? (
        <>
          <h2 className="person-tiles-title">{t("Případy", "Deals")}</h2>
          <div className="stat-tiles person-tiles">
            <StatTile label={t("Celkem", "In total")} value={figures.deals.length} />
            <StatTile label={t("Aktivní", "Open")} value={figures.open.length} />
            <StatTile label={t("Vyhrané", "Won")} value={figures.won.length} />
            <StatTile label={t("Prohrané", "Lost")} value={figures.lost.length} />
            <StatTile
              label={t("Hodnota aktivních", "Value open")}
              value={f.money(figures.openValue)}
            />
            <StatTile
              label={t("Hodnota vyhraných", "Value won")}
              value={f.money(figures.wonValue)}
            />
          </div>
          <h2 className="person-tiles-title">{t("Nabídky", "Quotes")}</h2>
          <div className="stat-tiles person-tiles">
            <StatTile label={t("Celkem", "In total")} value={figures.quotes.length} />
            <StatTile label={t("Schválené", "Approved")} value={figures.approved.length} />
            <StatTile label={t("Odeslané", "Sent")} value={figures.sent.length} />
            <StatTile label={t("Koncepty", "Drafts")} value={figures.drafts.length} />
            <StatTile
              label={t("Hodnota schválených bez DPH", "Value approved, without VAT")}
              value={f.money(figures.approvedValue)}
            />
          </div>

          <h2>{t("Obchodní případy obchodníka", "Their deals")}</h2>
          {figures.deals.length === 0 ? (
            <EmptyState
              icon="list"
              title={t("Zatím žádný obchodní případ.", "No deal yet.")}
              headingLevel={3}
            />
          ) : (
            <DataTable
              id="salesperson-deals"
              caption={t("Obchodní případy obchodníka", "The salesperson's deals")}
              columns={columns}
              rows={figures.deals}
              rowKey={(deal) => deal.id}
              rowHref={(deal) => href({ page: "deal", id: deal.id })}
              onOpen={(deal) => navigate({ page: "deal", id: deal.id })}
              storageKey="deals.salesperson.deals"
              defaultSort="value"
              defaultDirection="desc"
            />
          )}
        </>
      ) : null}

      <form className="form person-form" onSubmit={save}>
        <fieldset
          className="form-fieldset"
          disabled={formLocked(canWrite, busy, edit.base === undefined)}
        >
          <EditNotices edit={edit} error={error} onClear={() => setError(null)} />
          <article className="ds-card">
            {person ? <h2>{t("Údaje", "Details")}</h2> : null}
            <div className="form-grid">
              <Field label={t("Jméno", "Name")} error={errors.name} wide>
                <input
                  value={form.name}
                  required
                  autoComplete="off"
                  onChange={(event) => update({ name: event.target.value })}
                />
              </Field>
              <Field label={t("Pozice", "Role")} error={errors.role}>
                <input
                  value={form.role}
                  autoComplete="off"
                  onChange={(event) => update({ role: event.target.value })}
                />
              </Field>
              <Field label={t("E-mail", "E-mail")} error={errors.email}>
                <input
                  type="email"
                  value={form.email}
                  autoComplete="off"
                  onChange={(event) => update({ email: event.target.value })}
                />
              </Field>
              <Field label={t("Telefon", "Phone")} error={errors.phone}>
                <input
                  type="tel"
                  value={form.phone}
                  autoComplete="off"
                  onChange={(event) => update({ phone: event.target.value })}
                />
              </Field>
              <div className="field-wide">
                <Switch
                  id="salesperson-active"
                  label={t(
                    "Aktivní: nový obchodní případ jde přidělit tomuto obchodníkovi",
                    "Active: a new deal may be assigned to this salesperson",
                  )}
                  checked={form.active}
                  onChange={(event) => update({ active: event.target.checked })}
                />
                {openWithInactive ? (
                  <p className="ds-field__hint">
                    {t(
                      "Otevřené případy mu zůstanou; kontrola u nich upozorní, že už není aktivní.",
                      "Their open deals stay theirs; the check warns that they are no longer active.",
                    )}
                  </p>
                ) : null}
              </div>
              <Field label={t("Poznámka", "Note")} wide>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(event) => update({ note: event.target.value })}
                />
              </Field>
            </div>
          </article>
          {canWrite ? (
            <div className={edit.touched ? "form-actions form-actions--pending" : "form-actions"}>
              {edit.touched ? (
                <span className="form-actions-note">{t("Neuložené změny", "Unsaved changes")}</span>
              ) : null}
              <Button variant="primary" type="submit" busy={busy} disabled={!form.name.trim()}>
                {person
                  ? t("Uložit do konceptu", "Save to the draft")
                  : t("Založit obchodníka", "Create the salesperson")}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </section>
  );
}
