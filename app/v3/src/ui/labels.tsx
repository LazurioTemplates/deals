import type { Tone } from "design-system";
import { Badge } from "design-system/react";
import type { PaymentState } from "../domain/payment-plan.ts";
import type { QuoteStatus, TermsArea, TermsChoice } from "../domain/quote.ts";
import type { Localized } from "../i18n/locale.ts";
import { useT } from "./i18n.tsx";

/** The words and colours of states every page shows the same way. */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, Localized> = {
  draft: { cs: "Koncept", en: "Draft" },
  active: { cs: "Odeslaná", en: "Sent" },
  approved: { cs: "Schválená", en: "Approved" },
  superseded: { cs: "Nahrazená", en: "Superseded" },
  cancelled: { cs: "Zrušená", en: "Cancelled" },
};

export const QUOTE_STATUS_TONES: Record<QuoteStatus, Tone> = {
  draft: "neutral",
  active: "info",
  approved: "success",
  superseded: "neutral",
  cancelled: "danger",
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const t = useT();
  return (
    <Badge tone={QUOTE_STATUS_TONES[status]} icon={false}>
      {t.of(QUOTE_STATUS_LABELS[status])}
    </Badge>
  );
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, Localized> = {
  planned: { cs: "Plánováno", en: "Planned" },
  invoiced: { cs: "Vyfakturováno", en: "Invoiced" },
  overdue: { cs: "Po splatnosti", en: "Overdue" },
  paid: { cs: "Zaplaceno", en: "Paid" },
};

export const PAYMENT_STATE_TONES: Record<PaymentState, Tone> = {
  planned: "neutral",
  invoiced: "info",
  overdue: "danger",
  paid: "success",
};

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  const t = useT();
  return (
    <Badge tone={PAYMENT_STATE_TONES[state]} icon={false}>
      {t.of(PAYMENT_STATE_LABELS[state])}
    </Badge>
  );
}

export const TERMS_AREA_LABELS: Record<TermsArea, Localized> = {
  payments: { cs: "Platební podmínky", en: "Payment terms" },
  deposit: { cs: "Zálohy", en: "Deposits" },
  ownership: { cs: "Výhrada vlastnictví", en: "Retention of title" },
  warranty: { cs: "Záruka", en: "Warranty" },
  liability: { cs: "Odpovědnost", en: "Liability" },
  service: { cs: "Rozsah servisu", en: "Service scope" },
  support: { cs: "Placená podpora", en: "Paid support" },
  sla: { cs: "SLA", en: "SLA" },
  changes: { cs: "Změny rozsahu", en: "Changes of scope" },
};

export const TERMS_CHOICE_LABELS: Record<TermsChoice, Localized> = {
  standard: { cs: "Standardní podmínky", en: "Standard terms" },
  custom: { cs: "Upravené podmínky", en: "Custom terms" },
  customer: { cs: "Podmínky zákazníka", en: "The customer's terms" },
  "not-applicable": { cs: "Netýká se", en: "Not applicable" },
  excluded: { cs: "Výslovně vyloučeno", en: "Explicitly excluded" },
  pending: { cs: "Čeká na rozhodnutí", en: "Pending" },
};

export const CUSTOMER_SCOPE_LABELS: Record<"b2b" | "b2c" | "mixed" | "unresolved", Localized> = {
  b2b: { cs: "Firma (B2B)", en: "Business (B2B)" },
  b2c: { cs: "Spotřebitel (B2C)", en: "Consumer (B2C)" },
  mixed: { cs: "Smíšené", en: "Mixed" },
  unresolved: { cs: "Nevyřešeno", en: "Unresolved" },
};
