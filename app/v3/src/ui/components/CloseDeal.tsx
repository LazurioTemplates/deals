import { Button, Dialog, Icon } from "design-system/react";
import { useId, useState } from "react";
import { localToday, monthOf } from "../../domain/common.ts";
import type { Deal } from "../../domain/deal.ts";
import { type PaymentPlan, plannedTotal, singlePayment } from "../../domain/payment-plan.ts";
import type { Settings, Stage } from "../../domain/settings.ts";
import { api, type Stored } from "../api.ts";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import { useCanWrite } from "../write.tsx";
import { ErrorNotice, Field, fieldErrors } from "./common.tsx";
import { PaymentPlanEditor } from "./PaymentPlanEditor.tsx";

/** Whether a plan can go to the forecast: planned, with payments that add up to the value. */
export function isCompletePlan(plan: PaymentPlan, value: number): boolean {
  return plan.status === "planned" && plan.payments.length > 0 && plannedTotal(plan) === value;
}

/**
 * Closing a deal asks what closing needs: won asks for the value, the day it
 * was won and how it is invoiced (the payment plan), lost for the reason from
 * the settings, a note and the day. The dialog saves the move as a draft; the
 * rules on the server have the last word (a won deal needs a value above zero).
 */
export function CloseDealDialog({
  deal,
  stage,
  settings,
  open,
  onClose,
  onDone,
  today = localToday(),
  switchTo,
}: {
  deal: Stored<Deal>;
  stage: Stage;
  settings: Settings;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  today?: string;
  /** On a closed deal: the button that turns it to the other closing. */
  switchTo?: CloseSwitch | undefined;
}) {
  const won = stage.kind === "won";
  return won ? (
    <WonDialog
      deal={deal}
      stage={stage}
      settings={settings}
      open={open}
      onClose={onClose}
      onDone={onDone}
      today={today}
      switchTo={switchTo}
    />
  ) : (
    <LostDialog
      deal={deal}
      stage={stage}
      settings={settings}
      open={open}
      onClose={onClose}
      onDone={onDone}
      today={today}
      switchTo={switchTo}
    />
  );
}

/** A way out of the dialog to the other closing: a won deal that was lost after all. */
export interface CloseSwitch {
  label: string;
  run: () => void;
}

interface DialogProps {
  deal: Stored<Deal>;
  stage: Stage;
  settings: Settings;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  today: string;
  switchTo?: CloseSwitch | undefined;
}

/** The quiet button that switches to the other closing, at the start of the footer. */
function SwitchButton({ switchTo }: { switchTo: CloseSwitch | undefined }) {
  if (!switchTo) return null;
  return (
    <Button variant="quiet" className="close-deal-switch" onClick={switchTo.run}>
      {switchTo.label}
    </Button>
  );
}

/**
 * Won: the final value, the day and the payment plan. „Zařadit do forecastu“
 * saves a complete plan; „Zařadit později“ leaves the plan unassigned, so the
 * forecast lists the deal among those still to plan.
 */
function WonDialog({ deal, stage, settings, open, onClose, onDone, today, switchTo }: DialogProps) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(settings.currency);
  const formId = useId();
  const kept = deal.value.paymentPlan;
  const [valueText, setValueText] = useState(() => f.amount(deal.value.value));
  const [closedAt, setClosedAt] = useState(deal.value.closedAt ?? today);
  // Until the person touches the plan, it is one payment of the whole value
  // in the closing month, and follows the value and the day as they change.
  const [edited, setEdited] = useState<{ plan: PaymentPlan; complete: boolean } | null>(() =>
    kept && kept.status === "planned" && kept.payments.length > 0
      ? { plan: kept, complete: true }
      : null,
  );
  const [busy, setBusy] = useState<"plan" | "later" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const value = f.parseMoney(valueText);
  const amount = value ?? 0;
  const valueProblem =
    value === null || value <= 0
      ? t(
          "Vyhraný případ potřebuje hodnotu větší než nula.",
          "A won deal needs a value above zero.",
        )
      : undefined;
  const reverseCharge = kept?.reverseCharge;
  const plan: PaymentPlan = edited?.plan ?? {
    ...singlePayment(amount, monthOf(closedAt || today)),
    ...(reverseCharge ? { reverseCharge } : {}),
  };
  const complete =
    !valueProblem && (edited ? edited.complete : true) && isCompletePlan(plan, amount);
  const errors = fieldErrors(error);

  async function close(paymentPlan: PaymentPlan, which: "plan" | "later") {
    if (valueProblem) return;
    setBusy(which);
    setError(null);
    try {
      await api.moveDeal(deal.value.id, {
        stageId: stage.id,
        baseRevision: deal.revision,
        closedAt,
        value: amount,
        paymentPlan,
      });
      await onDone();
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  const later: PaymentPlan = {
    status: "unassigned",
    payments: [],
    ...(plan.reverseCharge ? { reverseCharge: plan.reverseCharge } : {}),
  };

  return (
    <Dialog
      id={`won-${formId.replace(/:/g, "")}`}
      title={t("Vyhráno", "Won")}
      description={deal.value.title}
      size="lg"
      open={open}
      onClose={onClose}
      locale={locale}
      footer={
        <>
          <SwitchButton switchTo={switchTo} />
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button
            variant="secondary"
            busy={busy === "later"}
            disabled={Boolean(valueProblem) || busy !== null}
            onClick={() => void close(later, "later")}
          >
            {t("Zařadit později", "Plan it later")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            busy={busy === "plan"}
            disabled={!complete || busy !== null}
          >
            {t("Zařadit do forecastu", "Add to the forecast")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="form close-deal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) void close(plan, "plan");
        }}
      >
        <ErrorNotice error={error} />
        <div className="close-deal-fields">
          <Field
            label={t(
              `Hodnota bez DPH (${settings.currency})`,
              `Value without VAT (${settings.currency})`,
            )}
            error={valueProblem ?? errors.value}
          >
            <input
              value={valueText}
              inputMode="decimal"
              autoComplete="off"
              onChange={(event) => setValueText(event.target.value)}
            />
          </Field>
          <Field label={t("Vyhráno dne", "Won on")} error={errors.closedAt}>
            <input
              type="date"
              value={closedAt}
              required
              onChange={(event) => setClosedAt(event.target.value)}
            />
          </Field>
        </div>
        <fieldset className="close-deal-plan">
          <legend className="ds-field__label">{t("Plán plateb", "Payment plan")}</legend>
          <PaymentPlanEditor
            value={plan}
            total={amount}
            currency={settings.currency}
            today={closedAt || today}
            idPrefix={`won-plan-${deal.value.id}`}
            disabled={busy !== null}
            onChange={(next, nextComplete) => setEdited({ plan: next, complete: nextComplete })}
          />
          {errors.paymentPlan ? <p className="ds-field__error">{errors.paymentPlan}</p> : null}
        </fieldset>
        <p className="muted small">
          {t(
            "Do forecastu jde jen plán, jehož platby dávají dohromady hodnotu případu. Jinak ho zařaďte později.",
            "Only a plan whose payments add up to the deal's value goes to the forecast. Otherwise plan it later.",
          )}
        </p>
      </form>
    </Dialog>
  );
}

/** Lost: the reason from the settings, a note and the day. */
function LostDialog({
  deal,
  stage,
  settings,
  open,
  onClose,
  onDone,
  today,
  switchTo,
}: DialogProps) {
  const t = useT();
  const locale = useLocale();
  const formId = useId();
  const [closedAt, setClosedAt] = useState(deal.value.closedAt ?? today);
  const [reason, setReason] = useState(
    deal.value.lossReasonId ?? settings.lossReasons[0]?.id ?? "",
  );
  const [note, setNote] = useState(deal.value.lossNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.moveDeal(deal.value.id, {
        stageId: stage.id,
        baseRevision: deal.revision,
        closedAt,
        lossReasonId: reason,
        lossNote: note,
      });
      await onDone();
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      id={`lost-${formId.replace(/:/g, "")}`}
      title={t("Ztraceno", "Lost")}
      description={deal.value.title}
      open={open}
      onClose={onClose}
      locale={locale}
      footer={
        <>
          <SwitchButton switchTo={switchTo} />
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button variant="danger" type="submit" form={formId} busy={busy} disabled={!reason}>
            {t("Označit jako ztracené", "Mark as lost")}
          </Button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={submit}>
        <ErrorNotice error={error} />
        <Field label={t("Důvod ztráty", "Loss reason")} error={errors.lossReasonId}>
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {settings.lossReasons.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Poznámka", "Note")}>
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Field label={t("Datum uzavření", "Closing date")} error={errors.closedAt}>
          <input
            type="date"
            value={closedAt}
            required
            onChange={(event) => setClosedAt(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Moves a deal to another stage: an open stage at once, won or lost through
 * the dialog that asks what closing needs.
 */
export function MoveDeal({
  deal,
  settings,
  onChanged,
  label,
}: {
  deal: Stored<Deal>;
  settings: Settings;
  onChanged: () => Promise<void>;
  label?: string;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const [closing, setClosing] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!canWrite) return null;
  const others = settings.stages.filter((stage) => stage.id !== deal.value.stageId);

  async function move(id: string) {
    const stage = settings.stages.find((entry) => entry.id === id);
    if (!stage) return;
    if (stage.kind !== "open") {
      setClosing(stage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.moveDeal(deal.value.id, { stageId: stage.id, baseRevision: deal.revision });
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="move-deal">
      <div className="ds-select-wrap">
        <select
          className="ds-select move-select"
          value=""
          disabled={busy}
          aria-label={label ?? t(`Přesunout ${deal.value.title}`, `Move ${deal.value.title}`)}
          onChange={(event) => void move(event.target.value)}
        >
          <option value="" disabled>
            {t("Do fáze…", "Move to…")}
          </option>
          {others.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
        <Icon name="nav-arrow-down" className="ds-select__chevron" />
      </div>
      <ErrorNotice error={error} title={t("Nepřesunuto.", "Not moved.")} />
      {closing ? (
        <CloseDealDialog
          deal={deal}
          stage={closing}
          settings={settings}
          open
          onClose={() => setClosing(null)}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}
