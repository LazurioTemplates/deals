import { cx } from "design-system";
import { Alert, Button, Switch } from "design-system/react";
import { useEffect, useRef, useState } from "react";
import { equalShares, MAX_PAYMENTS, type PaymentPlan } from "../../domain/payment-plan.ts";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import {
  addPayment,
  amountForShare,
  balanceLast,
  difference,
  equalSplit,
  initialPlan,
  parseShare,
  planComplete,
  QUICK_SPLITS,
  removePayment,
  resplit,
  shareForAmount,
  shareText,
} from "./forecast/plan-math.ts";

/**
 * The editor of a won deal's payment plan: one payment or several, each
 * with its month, its share and its amount; reverse charge. Controlled: it
 * shows `value` and reports every change with whether the plan is complete
 * (a planned plan's amounts sum exactly to `total`).
 */
export interface PaymentPlanEditorProps {
  /** The plan as edited now. */
  value: PaymentPlan;
  /** The deal's value without VAT, in haléře: what the payments must add up to. */
  total: number;
  currency: string;
  /** Today, `YYYY-MM-DD`: the month a new plan starts in. */
  today: string;
  onChange: (plan: PaymentPlan, complete: boolean) => void;
  /** An id prefix for the fields, unique on the page. */
  idPrefix: string;
  disabled?: boolean;
}

/** What the person is typing into a share or an amount, until the field loses focus. */
type Typing = { key: string; text: string } | null;

export function PaymentPlanEditor({
  value,
  total,
  currency,
  today,
  onChange,
  idPrefix,
  disabled = false,
}: PaymentPlanEditorProps) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(currency);
  const [typing, setTyping] = useState<Typing>(null);
  const empty = value.status !== "planned" || value.payments.length === 0;
  const plan: PaymentPlan = empty ? initialPlan(total, today, value.reverseCharge) : value;
  const payments = plan.payments;

  // A plan nobody planned yet starts as one payment this month; the parent
  // hears it once, so it can save it as it is shown.
  const announced = useRef(false);
  useEffect(() => {
    if (!empty || announced.current) return;
    announced.current = true;
    onChange(plan, planComplete(plan, total));
  }, [empty, plan, total, onChange]);

  const emit = (next: PaymentPlan) => onChange(next, planComplete(next, total));
  const setPayments = (next: PaymentPlan["payments"]) => emit({ ...plan, payments: next });
  const several = payments.length > 1;
  const missing = difference(payments, total);

  const typed = (key: string, shown: string) => (typing?.key === key ? typing.text : shown);
  const blur = () => setTyping(null);

  return (
    <div className={cx("plan-editor", disabled && "is-disabled")}>
      <div className="plan-editor-mode">
        <fieldset className="chip-choice">
          <legend className="ds-visually-hidden">{t("Počet plateb", "Number of payments")}</legend>
          <button
            type="button"
            className={cx("chip", !several && "is-active")}
            aria-pressed={!several}
            disabled={disabled}
            onClick={() => setPayments(resplit(payments.slice(0, 1), total, [10_000], ""))}
          >
            {t("Jedna platba", "One payment")}
          </button>
          <button
            type="button"
            className={cx("chip", several && "is-active")}
            aria-pressed={several}
            disabled={disabled}
            onClick={() => {
              if (!several) setPayments(equalSplit(payments, total, 2, payments[0]?.month ?? ""));
            }}
          >
            {t("Více plateb", "Several payments")}
          </button>
        </fieldset>
        {several ? (
          <label className="plan-editor-count">
            <span className="small muted">{t("Počet", "Count")}</span>
            <select
              className="ds-select"
              value={payments.length}
              disabled={disabled}
              onChange={(event) =>
                setPayments(
                  equalSplit(payments, total, Number(event.target.value), payments[0]?.month ?? ""),
                )
              }
            >
              {Array.from({ length: MAX_PAYMENTS - 1 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {several ? (
        <div className="plan-editor-quick">
          <span className="small muted">{t("Rychlé rozdělení", "Quick split")}</span>
          {QUICK_SPLITS.map((split) => (
            <Button
              key={split.id}
              variant="soft"
              size="sm"
              disabled={disabled}
              onClick={() =>
                setPayments(resplit(payments, total, split.shares, payments[0]?.month ?? ""))
              }
            >
              {split.label}
            </Button>
          ))}
          <Button
            variant="soft"
            size="sm"
            disabled={disabled}
            onClick={() =>
              setPayments(
                resplit(payments, total, equalShares(payments.length), payments[0]?.month ?? ""),
              )
            }
          >
            {t("Rovným dílem", "Equal")}
          </Button>
        </div>
      ) : null}

      <ol className="plan-editor-rows">
        {payments.map((payment, index) => {
          const shareKey = `${payment.id}:share`;
          const amountKey = `${payment.id}:amount`;
          const share = shareForAmount(payment.amount, total);
          const number = index + 1;
          const update = (change: Partial<typeof payment>) =>
            setPayments(
              payments.map((entry, at) => (at === index ? { ...entry, ...change } : entry)),
            );
          const settled = payment.invoicedOn !== undefined || payment.paidOn !== undefined;
          return (
            <li key={payment.id} className="plan-editor-row">
              <span className="plan-editor-number small muted" aria-hidden="true">
                {number}.
              </span>
              <label className="plan-editor-field plan-editor-month">
                <span className="small muted">{t("Měsíc", "Month")}</span>
                <input
                  className="ds-input"
                  type="month"
                  id={`${idPrefix}-month-${payment.id}`}
                  value={payment.month}
                  disabled={disabled}
                  aria-label={t(`Měsíc platby ${number}`, `Month of payment ${number}`)}
                  onChange={(event) => {
                    if (event.target.value) update({ month: event.target.value });
                  }}
                />
              </label>
              <label className="plan-editor-field plan-editor-label">
                <span className="small muted">{t("Popis", "Label")}</span>
                <input
                  className="ds-input"
                  id={`${idPrefix}-label-${payment.id}`}
                  value={payment.label ?? ""}
                  placeholder={
                    index === 0
                      ? t("Záloha", "Deposit")
                      : index === payments.length - 1
                        ? t("Doplatek", "Balance")
                        : ""
                  }
                  disabled={disabled}
                  aria-label={t(`Popis platby ${number}`, `Label of payment ${number}`)}
                  onChange={(event) => {
                    const text = event.target.value;
                    const { label: _label, ...rest } = payment;
                    setPayments(
                      payments.map((entry, at) =>
                        at === index ? (text.trim() ? { ...rest, label: text } : rest) : entry,
                      ),
                    );
                  }}
                />
              </label>
              <label className="plan-editor-field plan-editor-share">
                <span className="small muted">{t("Podíl %", "Share %")}</span>
                <input
                  className="ds-input num"
                  id={`${idPrefix}-share-${payment.id}`}
                  inputMode="decimal"
                  value={typed(shareKey, shareText(share, locale))}
                  disabled={disabled}
                  aria-label={t(`Podíl platby ${number} v %`, `Share of payment ${number} in %`)}
                  onChange={(event) => {
                    const text = event.target.value;
                    setTyping({ key: shareKey, text });
                    const parsed = parseShare(text, locale);
                    if (parsed !== null) update({ amount: amountForShare(total, parsed) });
                  }}
                  onBlur={blur}
                />
              </label>
              <label className="plan-editor-field plan-editor-amount">
                <span className="small muted">
                  {t("Částka bez DPH", "Amount without VAT")} ({currency})
                </span>
                <input
                  className="ds-input num"
                  id={`${idPrefix}-amount-${payment.id}`}
                  inputMode="decimal"
                  value={typed(amountKey, f.amount(payment.amount))}
                  disabled={disabled}
                  aria-label={t(
                    `Částka platby ${number} bez DPH`,
                    `Amount of payment ${number} without VAT`,
                  )}
                  onChange={(event) => {
                    const text = event.target.value;
                    setTyping({ key: amountKey, text });
                    const parsed = f.parseMoney(text);
                    if (parsed !== null && parsed >= 0) update({ amount: parsed });
                  }}
                  onBlur={blur}
                />
              </label>
              <span className="plan-editor-remove">
                {several ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    icon="trash"
                    iconOnly
                    disabled={disabled || settled}
                    label={t(`Odebrat platbu ${number}`, `Remove payment ${number}`)}
                    onClick={() => setPayments(removePayment(payments, index))}
                  />
                ) : null}
              </span>
              {settled ? (
                <span className="plan-editor-settled small muted">
                  {payment.paidOn
                    ? t(`Zaplaceno ${f.date(payment.paidOn)}`, `Paid ${f.date(payment.paidOn)}`)
                    : t(
                        `Vyfakturováno ${f.date(payment.invoicedOn)}`,
                        `Invoiced ${f.date(payment.invoicedOn)}`,
                      )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {several && payments.length < MAX_PAYMENTS ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={disabled}
            onClick={() => setPayments(addPayment(payments, total, today))}
          >
            {t("Přidat platbu", "Add a payment")}
          </Button>
        </div>
      ) : null}

      <Switch
        id={`${idPrefix}-reverse-charge`}
        label={t("Přenesená daňová povinnost (PDP)", "Reverse charge")}
        checked={plan.reverseCharge === true}
        disabled={disabled}
        onChange={(event) => {
          const { reverseCharge: _reverse, ...rest } = plan;
          emit(event.target.checked ? { ...rest, reverseCharge: true } : rest);
        }}
      />

      <dl className="plan-editor-summary">
        <div>
          <dt>{t("Celková hodnota", "Total value")}</dt>
          <dd className="num">{f.money(total)}</dd>
        </div>
        <div>
          <dt>{t("Rozpočítáno", "Allocated")}</dt>
          <dd className="num">{f.money(total - missing)}</dd>
        </div>
        <div>
          <dt>{t("Rozdíl", "Difference")}</dt>
          <dd className={cx("num", missing !== 0 && "danger")}>{f.money(missing)}</dd>
        </div>
      </dl>
      {missing !== 0 ? (
        <Alert
          tone="warning"
          locale={locale}
          actions={
            missing + (payments.at(-1)?.amount ?? 0) >= 0 ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => setPayments(balanceLast(payments, total))}
              >
                {t("Dorovnat poslední", "Balance the last one")}
              </Button>
            ) : null
          }
        >
          {missing > 0
            ? t(
                `Platby dávají o ${f.money(missing)} méně než hodnota případu.`,
                `The payments are ${f.money(missing)} short of the deal's value.`,
              )
            : t(
                `Platby dávají o ${f.money(-missing)} víc než hodnota případu.`,
                `The payments exceed the deal's value by ${f.money(-missing)}.`,
              )}
        </Alert>
      ) : null}
    </div>
  );
}
