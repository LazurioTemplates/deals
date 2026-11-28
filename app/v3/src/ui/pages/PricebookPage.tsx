import { Badge, Button, Dialog, EmptyState, Switch } from "design-system/react";
import { useState } from "react";
import type { PricebookItem } from "../../domain/pricebook.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { ErrorNotice, Field, fieldErrors, PageHeader } from "../components/common.tsx";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { formatEditAmount, parseAmount } from "../components/quotes/quoteForm.ts";
import { matches } from "../components/quotes/search.ts";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import { readLocal, writeLocal } from "../lookups.ts";
import { useCanWrite } from "../write.tsx";

const INACTIVE_KEY = "pricebook.inactive.v1";

interface ItemForm {
  name: string;
  code: string;
  description: string;
  unit: string;
  unitPrice: string;
  sectionId: string;
  active: boolean;
}

/** The price list: the items a quote line may start from. */
export function PricebookPage({
  data,
  onChanged,
}: {
  data: AppData;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const [query, setQuery] = useState("");
  const [inactive, setInactive] = useState(() => readLocal<boolean>(INACTIVE_KEY, false));
  // `null` closed, `"new"` a new item, else the item being edited.
  const [editing, setEditing] = useState<Stored<PricebookItem> | "new" | null>(null);
  const sections = new Map(settings.quotes.sections.map((section) => [section.id, section.label]));
  const sectionLabel = (item: PricebookItem) =>
    item.sectionId ? (sections.get(item.sectionId) ?? item.sectionId) : "";
  const rows = data.pricebook.filter(
    (entry) =>
      (inactive || entry.value.active) &&
      matches(query, [
        entry.value.name,
        entry.value.code,
        entry.value.description,
        sectionLabel(entry.value),
      ]),
  );

  const columns: Column<Stored<PricebookItem>>[] = [
    {
      id: "code",
      label: t("Kód", "Code"),
      width: 110,
      render: (entry) => <span className="mono">{entry.value.code ?? entry.value.id}</span>,
      sortValue: (entry) => entry.value.code ?? entry.value.id,
    },
    {
      id: "name",
      label: t("Název", "Name"),
      width: 280,
      render: (entry) => (
        <>
          {canWrite ? (
            <button type="button" className="pricebook-open" onClick={() => setEditing(entry)}>
              {entry.value.name}
            </button>
          ) : (
            entry.value.name
          )}
          {entry.value.description ? (
            <span className="muted small cell-id">{entry.value.description}</span>
          ) : null}
        </>
      ),
      sortValue: (entry) => entry.value.name,
    },
    {
      id: "unit",
      label: t("Jednotka", "Unit"),
      width: 100,
      render: (entry) => entry.value.unit,
      sortValue: (entry) => entry.value.unit,
    },
    {
      id: "unitPrice",
      label: t("Cena", "Price"),
      width: 140,
      align: "end",
      render: (entry) => f.money(entry.value.unitPrice),
      sortValue: (entry) => entry.value.unitPrice,
    },
    {
      id: "section",
      label: t("Sekce", "Section"),
      width: 160,
      render: (entry) => sectionLabel(entry.value),
      sortValue: (entry) => sectionLabel(entry.value),
    },
    {
      id: "active",
      label: t("Aktivní", "Active"),
      width: 110,
      render: (entry) =>
        entry.value.active ? (
          <Badge tone="success" icon={false}>
            {t("Ano", "Yes")}
          </Badge>
        ) : (
          <Badge tone="neutral" icon={false}>
            {t("Ne", "No")}
          </Badge>
        ),
      sortValue: (entry) => (entry.value.active ? 0 : 1),
    },
  ];

  return (
    <section className="pricebook-page">
      <PageHeader
        title={t("Ceník", "Price list")}
        subtitle={t(
          "Změna ceníku nemění už napsané nabídky.",
          "A change of the price list never changes a quote already written.",
        )}
        actions={
          canWrite ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              {t("Nová položka", "New item")}
            </Button>
          ) : null
        }
      />
      <div className="filter-bar">
        <input
          className="ds-input filter-bar-search"
          type="search"
          value={query}
          aria-label={t("Hledat v ceníku", "Search the price list")}
          placeholder={t("Název, kód, popis, sekce", "Name, code, description, section")}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Switch
          id="pricebook-inactive"
          label={t("Zobrazit neaktivní", "Show inactive")}
          checked={inactive}
          onChange={(event) => {
            setInactive(event.target.checked);
            writeLocal(INACTIVE_KEY, event.target.checked);
          }}
        />
      </div>
      {data.pricebook.length === 0 ? (
        <EmptyState
          icon="list"
          title={t("Ceník je zatím prázdný.", "The price list is empty so far.")}
          actions={
            canWrite ? (
              <Button variant="primary" onClick={() => setEditing("new")}>
                {t("Nová položka", "New item")}
              </Button>
            ) : null
          }
        />
      ) : (
        <DataTable
          id="pricebook"
          caption={t("Ceník", "Price list")}
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.value.id}
          onOpen={canWrite ? (entry) => setEditing(entry) : undefined}
          rowClassName={(entry) => (entry.value.active ? undefined : "quote-row-faded")}
          storageKey="pricebook.columns.v1"
          defaultSort="name"
          empty={t("Hledání nic nenašlo.", "The search found nothing.")}
        />
      )}
      {editing !== null && canWrite ? (
        <ItemDialog
          key={editing === "new" ? "new" : `${editing.value.id}@${editing.revision}`}
          data={data}
          item={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}

function ItemDialog({
  data,
  item,
  onClose,
  onChanged,
}: {
  data: AppData;
  item: Stored<PricebookItem> | undefined;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const settings = data.settings.value;
  const value = item?.value;
  const [form, setForm] = useState<ItemForm>(() => ({
    name: value?.name ?? "",
    code: value?.code ?? "",
    description: value?.description ?? "",
    unit: value?.unit ?? settings.quotes.units[0] ?? "",
    unitPrice: value ? formatEditAmount(value.unitPrice, locale) : "",
    sectionId: value?.sectionId ?? "",
    active: value?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  const price = parseAmount(form.unitPrice, locale);
  const priceProblem =
    form.unitPrice.trim() !== "" && price === null
      ? t("Částka, třeba 1290 nebo 47,50.", "An amount, e.g. 1290 or 47.50.")
      : undefined;
  const units =
    settings.quotes.units.includes(form.unit) || !form.unit
      ? settings.quotes.units
      : [...settings.quotes.units, form.unit];
  const update = (patch: Partial<ItemForm>) => setForm({ ...form, ...patch });
  const ready = form.name.trim() !== "" && form.unit.trim() !== "" && price !== null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || price === null) return;
    setBusy(true);
    setError(null);
    const record = {
      name: form.name.trim(),
      ...(form.code.trim() ? { code: form.code.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      unit: form.unit.trim(),
      unitPrice: price,
      ...(form.sectionId ? { sectionId: form.sectionId } : {}),
      active: form.active,
    };
    try {
      if (item) {
        const { code: _code, description: _description, sectionId: _section, ...kept } = item.value;
        await api.savePricebookItem({ ...kept, ...record }, item.revision);
      } else {
        await api.createPricebookItem(record);
      }
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      id="pricebook-item"
      title={item ? t("Upravit položku", "Edit the item") : t("Nová položka", "New item")}
      description={item ? item.value.id : undefined}
      open
      onClose={onClose}
      locale={locale}
    >
      <form className="pricebook-form" onSubmit={save}>
        <ErrorNotice error={error} />
        <div className="form-grid">
          <Field label={t("Název", "Name")} error={errors.name} wide>
            <input
              value={form.name}
              required
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field label={t("Kód", "Code")} error={errors.code}>
            <input value={form.code} onChange={(event) => update({ code: event.target.value })} />
          </Field>
          <Field label={t("Jednotka", "Unit")} error={errors.unit}>
            <select value={form.unit} onChange={(event) => update({ unit: event.target.value })}>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t(
              `Cena za jednotku bez DPH (${settings.currency})`,
              `Unit price excl. VAT (${settings.currency})`,
            )}
            error={priceProblem ?? errors.unitPrice}
          >
            <input
              value={form.unitPrice}
              inputMode="decimal"
              autoComplete="off"
              required
              onChange={(event) => update({ unitPrice: event.target.value })}
            />
          </Field>
          <Field label={t("Sekce nabídky", "Quote section")} error={errors.sectionId}>
            <select
              value={form.sectionId}
              onChange={(event) => update({ sectionId: event.target.value })}
            >
              <option value="">{t("Bez sekce", "No section")}</option>
              {settings.quotes.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
              {form.sectionId && !settings.quotes.sections.some((s) => s.id === form.sectionId) ? (
                <option value={form.sectionId}>{form.sectionId}</option>
              ) : null}
            </select>
          </Field>
          <Field label={t("Popis", "Description")} wide>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </Field>
          <div className="field-wide">
            <Switch
              id="pricebook-item-active"
              label={t("Aktivní (nabízí se v nabídkách)", "Active (offered in quotes)")}
              checked={form.active}
              onChange={(event) => update({ active: event.target.checked })}
            />
          </div>
        </div>
        <div className="form-actions">
          <Button variant="primary" type="submit" busy={busy} disabled={!ready}>
            {t("Uložit do konceptu", "Save to the draft")}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {t("Zavřít", "Close")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
