import { Button, Dialog, Switch } from "design-system/react";
import { useCallback, useState } from "react";
import type { Deal } from "../../../domain/deal.ts";
import type { ForecastEntry } from "../../../domain/forecast-entry.ts";
import { MONTH, type PaymentPlan } from "../../../domain/payment-plan.ts";
import type { AppData } from "../../App.tsx";
import { api, type Stored } from "../../api.ts";
import { useFormat, useLocale, useT } from "../../i18n.tsx";
import { ErrorNotice, Field } from "../common.tsx";
import { PaymentPlanEditor } from "../PaymentPlanEditor.tsx";
import { planComplete } from "./plan-math.ts";

/**
 * The dialogs of the forecast: the payment plan of a won deal, a manual
 * row, moving a row to another month and removing a manual row. Each saves
 * a draft and then reloads the page (`onSaved`).
 */

export function PlanDialog({
  deal,
  currency,
  today,
  onClose,
  onSaved,
}: {
  deal: Stored<Deal>;
  currency: string;
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(currency);
  const total = deal.value.value;
  const [plan, setPlan] = useState<PaymentPlan>(
    deal.value.paymentPlan ?? { status: "unassigned", payments: [] },
  );
  const [complete, setComplete] = useState(planComplete(plan, total));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const change = useCallback((next: PaymentPlan, done: boolean) => {
    setPlan(next);
    setComplete(done);
  }, []);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.planPayments(deal.value.id, plan, deal.revision);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }
  return (
    <Dialog
      id="forecast-plan"
      size="lg"
      open
      locale={locale}
      onClose={onClose}
      title={t("Plán plateb", "Payment plan")}
      description={`${deal.value.title} · ${f.money(total)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button variant="primary" busy={busy} disabled={!complete || busy} onClick={save}>
            {t("Uložit plán", "Save the plan")}
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <PaymentPlanEditor
        value={plan}
        total={total}
        currency={currency}
        today={today}
        onChange={change}
        idPrefix={`plan-${deal.value.id}`}
        disabled={busy}
      />
    </Dialog>
  );
}

interface EntryForm {
  title: string;
  companyId: string;
  ownerId: string;
  dealTypeId: string;
  billingEntityId: string;
  amount: string;
  month: string;
  reverseCharge: boolean;
  note: string;
}

export function EntryDialog({
  data,
  entry,
  month,
  onClose,
  onSaved,
}: {
  data: AppData;
  /** The row edited, or null for a new one. */
  entry: Stored<ForecastEntry> | null;
  /** The month a new row starts in. */
  month: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const value = entry?.value;
  const [form, setForm] = useState<EntryForm>({
    title: value?.title ?? "",
    companyId: value?.companyId ?? "",
    ownerId: value?.ownerId ?? "",
    dealTypeId: value?.dealTypeId ?? "",
    billingEntityId: value?.billingEntityId ?? "",
    amount: value ? f.amount(value.amount) : "",
    month: value?.month ?? month,
    reverseCharge: value?.reverseCharge === true,
    note: value?.note ?? "",
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (change: Partial<EntryForm>) => setForm({ ...form, ...change });
  const amount = f.parseMoney(form.amount);
  const errors = {
    title: form.title.trim() ? undefined : t("Vyplňte název.", "Fill in a title."),
    amount:
      amount !== null && amount >= 0
        ? undefined
        : t("Zadejte částku, třeba 12 500.", "Enter an amount, e.g. 12,500."),
    month: MONTH.test(form.month) ? undefined : t("Vyberte měsíc.", "Pick a month."),
  };
  const valid = !errors.title && !errors.amount && !errors.month;
  const shown = (message: string | undefined) => (tried ? message : undefined);
  const entities = settings.billingEntities ?? [];
  const types = settings.dealTypes ?? [];

  async function save() {
    setTried(true);
    if (!valid || amount === null) return;
    setBusy(true);
    setError(null);
    const optional = (text: string) => (text.trim() ? text.trim() : undefined);
    const fields = {
      month: form.month,
      title: form.title.trim(),
      amount,
      companyId: optional(form.companyId),
      ownerId: optional(form.ownerId),
      dealTypeId: optional(form.dealTypeId),
      billingEntityId: optional(form.billingEntityId),
      reverseCharge: form.reverseCharge ? true : undefined,
      note: optional(form.note),
    };
    try {
      if (entry) {
        const { invoicedOn, dueOn, paidOn, dealId, id, revision, updatedAt, updatedBy } =
          entry.value;
        await api.saveForecastEntry(
          { id, dealId, invoicedOn, dueOn, paidOn, revision, updatedAt, updatedBy, ...fields },
          entry.revision,
        );
      } else {
        await api.createForecastEntry(fields);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  return (
    <Dialog
      id="forecast-entry"
      size="lg"
      open
      locale={locale}
      onClose={onClose}
      title={entry ? t("Upravit řádek", "Edit the row") : t("Přidat řádek", "Add a row")}
      description={t(
        "Příjem, který neplánuje žádný vyhraný případ: paušál, smlouva mimo pipeline.",
        "Income no won deal plans: a recurring fee, a contract outside the pipeline.",
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button variant="primary" busy={busy} disabled={busy} onClick={save}>
            {entry ? t("Uložit", "Save") : t("Přidat", "Add")}
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <div className="form-grid">
        <Field label={t("Název", "Title")} error={shown(errors.title)} wide>
          <input value={form.title} onChange={(event) => set({ title: event.target.value })} />
        </Field>
        <Field label={t("Částka bez DPH", "Amount without VAT")} error={shown(errors.amount)}>
          <input
            inputMode="decimal"
            className="num"
            value={form.amount}
            onChange={(event) => set({ amount: event.target.value })}
          />
        </Field>
        <Field label={t("Měsíc", "Month")} error={shown(errors.month)}>
          <input
            type="month"
            value={form.month}
            onChange={(event) => set({ month: event.target.value })}
          />
        </Field>
        <Field label={t("Firma", "Company")}>
          <select
            value={form.companyId}
            onChange={(event) => set({ companyId: event.target.value })}
          >
            <option value="">{t("Bez firmy", "No company")}</option>
            {data.companies.map((company) => (
              <option key={company.value.id} value={company.value.id}>
                {company.value.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Obchodník", "Salesperson")}>
          <select value={form.ownerId} onChange={(event) => set({ ownerId: event.target.value })}>
            <option value="">{t("Bez obchodníka", "No salesperson")}</option>
            {data.salespeople.map((person) => (
              <option key={person.value.id} value={person.value.id}>
                {person.value.name}
              </option>
            ))}
          </select>
        </Field>
        {types.length > 0 ? (
          <Field label={t("Typ zakázky", "Deal type")}>
            <select
              value={form.dealTypeId}
              onChange={(event) => set({ dealTypeId: event.target.value })}
            >
              <option value="">{t("Bez typu", "No type")}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {entities.length > 1 ? (
          <Field label={t("Fakturační firma", "Billing entity")}>
            <select
              value={form.billingEntityId}
              onChange={(event) => set({ billingEntityId: event.target.value })}
            >
              <option value="">{t("Výchozí", "Default")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={t("Poznámka", "Note")} wide>
          <textarea
            rows={2}
            value={form.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </Field>
      </div>
      <Switch
        id="forecast-entry-reverse-charge"
        label={t("Přenesená daňová povinnost (PDP)", "Reverse charge")}
        checked={form.reverseCharge}
        onChange={(event) => set({ reverseCharge: event.target.checked })}
      />
    </Dialog>
  );
}

/** Moves a payment of a plan or a manual row to another month. */
export function MoveDialog({
  title,
  month,
  onClose,
  onMove,
}: {
  title: string;
  month: string;
  onClose: () => void;
  onMove: (month: string) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const [target, setTarget] = useState(month);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = MONTH.test(target) && target !== month;
  async function move() {
    setBusy(true);
    setError(null);
    try {
      await onMove(target);
      onClose();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }
  return (
    <Dialog
      id="forecast-move"
      size="sm"
      open
      locale={locale}
      onClose={onClose}
      title={t("Přesunout do jiného měsíce", "Move to another month")}
      description={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button variant="primary" busy={busy} disabled={!valid || busy} onClick={move}>
            {t("Přesunout", "Move")}
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <Field label={t("Fakturační měsíc", "Invoicing month")}>
        <input type="month" value={target} onChange={(event) => setTarget(event.target.value)} />
      </Field>
    </Dialog>
  );
}

/** Asks before a manual row is removed. */
export function RemoveDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: Stored<ForecastEntry>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.removeForecastEntry(entry.value.id, entry.revision);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }
  return (
    <Dialog
      id="forecast-remove"
      size="sm"
      open
      locale={locale}
      onClose={onClose}
      title={t("Odebrat řádek?", "Remove the row?")}
      description={entry.value.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Ponechat", "Keep")}
          </Button>
          <Button variant="danger" busy={busy} disabled={busy} onClick={remove}>
            {t("Odebrat", "Remove")}
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <p>
        {t(
          "Řádek zmizí z forecastu, až koncept publikujete.",
          "The row leaves the forecast once the draft is published.",
        )}
      </p>
    </Dialog>
  );
}
