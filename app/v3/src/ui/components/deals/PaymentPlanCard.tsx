import { Button, Checkbox, Dialog } from "design-system/react";
import { useId, useState } from "react";
import { monthOf } from "../../../domain/common.ts";
import type { Deal } from "../../../domain/deal.ts";
import {
  type Payment,
  type PaymentPlan,
  paymentState,
  shareOfValue,
  singlePayment,
} from "../../../domain/payment-plan.ts";
import type { Settings } from "../../../domain/settings.ts";
import { api, type Stored } from "../../api.ts";
import { useFormat, useLocale, useT } from "../../i18n.tsx";
import { PaymentStateBadge } from "../../labels.tsx";
import { useCanWrite } from "../../write.tsx";
import { isCompletePlan } from "../CloseDeal.tsx";
import { ErrorNotice } from "../common.tsx";
import { PaymentPlanEditor } from "../PaymentPlanEditor.tsx";

/**
 * How a won deal is invoiced: each payment with its month, amount, share and
 * state, ticked off as invoiced and paid; the plan is edited in a dialog. A
 * deal won without a plan offers to plan it.
 */
export function PaymentPlanCard({
  deal,
  settings,
  today,
  onChanged,
}: {
  deal: Stored<Deal>;
  settings: Settings;
  today: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const f = useFormat(settings.currency);
  const plan = deal.value.paymentPlan;
  const planned = plan?.status === "planned" && plan.payments.length > 0;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function change(payment: Payment, field: "invoicedOn" | "paidOn", on: boolean) {
    setBusy(`${payment.id}:${field}`);
    setError(null);
    try {
      await api.changePayment(deal.value.id, payment.id, {
        baseRevision: deal.revision,
        [field]: on ? today : null,
      });
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="ds-card deal-side-card">
      <div className="panel-head">
        <h2>{t("Plán plateb", "Payment plan")}</h2>
        {canWrite && planned ? (
          <Button variant="secondary" size="sm" icon="edit-pencil" onClick={() => setEditing(true)}>
            {t("Upravit plán", "Edit the plan")}
          </Button>
        ) : null}
      </div>
      <ErrorNotice error={error} />
      {planned && plan ? (
        <>
          {plan.reverseCharge ? (
            <p className="muted small">{t("Přenesená daňová povinnost", "Reverse charge")}</p>
          ) : null}
          <ul className="deal-payments">
            {plan.payments.map((payment) => {
              const state = paymentState(payment, today);
              return (
                <li key={payment.id} className="deal-payment">
                  <div className="deal-payment-head">
                    <span className="deal-payment-month">{f.month(payment.month)}</span>
                    {payment.label ? <span className="muted small">{payment.label}</span> : null}
                    <PaymentStateBadge state={state} />
                  </div>
                  <div className="deal-payment-amount">
                    <span className="num">{f.money(payment.amount)}</span>
                    <span className="muted small num">
                      {f.rate(shareOfValue(payment.amount, deal.value.value))}
                    </span>
                  </div>
                  {payment.dueOn && !payment.paidOn ? (
                    <p className="muted small deal-payment-due">
                      {t("splatnost", "due")} {f.date(payment.dueOn)}
                    </p>
                  ) : null}
                  <div className="deal-payment-toggles">
                    <Checkbox
                      id={`pay-${deal.value.id}-${payment.id}-invoiced`}
                      label={t("Faktura vystavena", "Invoice issued")}
                      checked={payment.invoicedOn !== undefined}
                      disabled={!canWrite || busy !== null}
                      onChange={(event) => void change(payment, "invoicedOn", event.target.checked)}
                    />
                    <Checkbox
                      id={`pay-${deal.value.id}-${payment.id}-paid`}
                      label={t("Zaplaceno", "Paid")}
                      checked={payment.paidOn !== undefined}
                      disabled={!canWrite || busy !== null}
                      onChange={(event) => void change(payment, "paidOn", event.target.checked)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <p className="muted">
            {t(
              "Platby zatím nejsou naplánované; forecast vede případ mezi nezařazenými.",
              "The payments are not planned yet; the forecast lists the deal as unassigned.",
            )}
          </p>
          {canWrite ? (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
              {t("Naplánovat platby", "Plan the payments")}
            </Button>
          ) : null}
        </>
      )}
      {editing ? (
        <PlanDialog
          deal={deal}
          settings={settings}
          today={today}
          onClose={() => setEditing(false)}
          onChanged={onChanged}
        />
      ) : null}
    </article>
  );
}

/** The plan in the editor; saved as a draft. */
function PlanDialog({
  deal,
  settings,
  today,
  onClose,
  onChanged,
}: {
  deal: Stored<Deal>;
  settings: Settings;
  today: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const id = useId().replace(/:/g, "");
  const value = deal.value.value;
  const kept = deal.value.paymentPlan;
  const [plan, setPlan] = useState<PaymentPlan>(() =>
    kept && kept.status === "planned" && kept.payments.length > 0
      ? kept
      : {
          ...singlePayment(value, monthOf(deal.value.closedAt ?? today)),
          ...(kept?.reverseCharge ? { reverseCharge: kept.reverseCharge } : {}),
        },
  );
  const [complete, setComplete] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const savable = plan.status === "unassigned" || (complete && isCompletePlan(plan, value));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.planPayments(deal.value.id, plan, deal.revision);
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
      id={`plan-${id}`}
      title={t("Plán plateb", "Payment plan")}
      description={deal.value.title}
      size="lg"
      open
      onClose={onClose}
      locale={locale}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button variant="primary" busy={busy} disabled={!savable} onClick={() => void save()}>
            {t("Uložit do konceptu", "Save to the draft")}
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <PaymentPlanEditor
        value={plan}
        total={value}
        currency={settings.currency}
        today={today}
        idPrefix={`plan-${deal.value.id}`}
        disabled={busy}
        onChange={(next, nextComplete) => {
          setPlan(next);
          setComplete(nextComplete);
        }}
      />
    </Dialog>
  );
}
