import type { PaymentPlan } from "../../domain/payment-plan.ts";
import { useT } from "../i18n.tsx";

/**
 * The editor of a won deal's payment plan: one payment or several, each
 * with its month, its share and its amount; reverse charge. Controlled: it
 * shows `value` and reports every change with whether the plan is complete
 * (a planned plan's amounts sum exactly to `total`).
 *
 * Placeholder until it is built in this pull request; the interface stays.
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

export function PaymentPlanEditor(_props: PaymentPlanEditorProps) {
  const t = useT();
  return (
    <p className="muted">
      {t("Editor plánu plateb se připravuje.", "The payment plan editor is coming.")}
    </p>
  );
}
