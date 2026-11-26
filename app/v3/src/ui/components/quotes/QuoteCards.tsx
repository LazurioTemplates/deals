import { Switch } from "design-system/react";
import {
  CUSTOMER_SCOPES,
  type QuoteTotals,
  TERMS_AREAS,
  TERMS_CHOICES,
  type TermsChoice,
} from "../../../domain/quote.ts";
import { useFormat, useT } from "../../i18n.tsx";
import { CUSTOMER_SCOPE_LABELS, TERMS_AREA_LABELS, TERMS_CHOICE_LABELS } from "../../labels.tsx";
import { Field } from "../common.tsx";
import type { QuoteForm, QuoteProblems } from "./quoteForm.ts";
import { TermsPreview } from "./TermsPreview.tsx";

type Patch = (patch: Partial<QuoteForm>) => void;

/** „Souhrn“: the totals as typed, the VAT rate, reverse charge and the reserve for changes. */
export function QuoteSummary({
  form,
  update,
  totals,
  problems,
  currency,
  children,
}: {
  form: QuoteForm;
  update: Patch;
  totals: QuoteTotals;
  problems: QuoteProblems;
  currency: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const f = useFormat(currency);
  return (
    <article className="ds-card quote-summary">
      <h2>{t("Souhrn", "Summary")}</h2>
      <dl className="quote-totals">
        {totals.sections.map((section) => (
          <div key={section.sectionId} className="quote-totals-section">
            <dt>{section.label}</dt>
            <dd className="num">{f.money(section.amount)}</dd>
          </div>
        ))}
        {totals.discount > 0 ? (
          <div>
            <dt>{t("Slevy", "Discounts")}</dt>
            <dd className="num">−{f.money(totals.discount)}</dd>
          </div>
        ) : null}
        <div className="quote-totals-strong">
          <dt>{t("Celkem bez DPH", "Total excl. VAT")}</dt>
          <dd className="num">{f.money(totals.subtotal)}</dd>
        </div>
        <div>
          <dt>
            {form.reverseCharge
              ? t("DPH (přenesená povinnost)", "VAT (reverse charge)")
              : t("DPH", "VAT")}
          </dt>
          <dd className="num">{f.money(totals.vat)}</dd>
        </div>
        <div className="quote-totals-strong">
          <dt>{t("Celkem s DPH", "Total incl. VAT")}</dt>
          <dd className="num">{f.money(totals.total)}</dd>
        </div>
      </dl>
      <div className="quote-summary-fields">
        <Field
          label={t("Sazba DPH (%)", "VAT rate (%)")}
          error={problems.vatRate ? t("0 až 100.", "0 to 100.") : undefined}
        >
          <input
            value={form.vatRate}
            inputMode="decimal"
            autoComplete="off"
            onChange={(event) => update({ vatRate: event.target.value })}
          />
        </Field>
        <Switch
          id="quote-reverse-charge"
          label={t("Přenesená daňová povinnost", "Reverse charge")}
          checked={form.reverseCharge}
          onChange={(event) => update({ reverseCharge: event.target.checked })}
        />
        {form.reverseCharge ? (
          <p className="muted small">
            {t(
              "DPH je 0. Daň přiznává a odvádí odběratel; nabídka to uvede u součtu.",
              "VAT is 0. The customer declares and pays the tax; the quote says so with the totals.",
            )}
          </p>
        ) : null}
        <Field
          label={t(`Rezerva na změny (${currency})`, `Reserve for changes (${currency})`)}
          hint={t("Mimo cenu nabídky, pro plánování.", "Outside the quoted price, for planning.")}
          error={
            problems.changeReserve
              ? t("Částka, třeba 25 000.", "An amount, e.g. 25,000.")
              : undefined
          }
        >
          <input
            value={form.changeReserve}
            inputMode="decimal"
            autoComplete="off"
            onChange={(event) => update({ changeReserve: event.target.value })}
          />
        </Field>
      </div>
      <dl className="quote-totals">
        <div className="quote-totals-strong">
          <dt>{t("Plánovací rozpočet", "Planning budget")}</dt>
          <dd className="num">{f.money(totals.planning)}</dd>
        </div>
      </dl>
      {children}
    </article>
  );
}

const TERMS_FIELDS = [
  { key: "vatNote", cs: "Poznámka k DPH", en: "Note on VAT" },
  { key: "payments", cs: "Platby a zálohy", en: "Payments and deposits" },
  { key: "scope", cs: "Rozsah a další podmínky", en: "Scope and other conditions" },
] as const;

/** „Podmínky nabídky“: the three terms texts with a preview as they print. */
export function QuoteTermsCard({ form, update }: { form: QuoteForm; update: Patch }) {
  const t = useT();
  return (
    <article className="ds-card quote-card">
      <h2>{t("Podmínky nabídky", "Terms of the quote")}</h2>
      <p className="muted small">
        {t(
          "Řádek „## Nadpis“ je nadpis, „- položka“ odrážka, prázdný řádek nový odstavec.",
          "A line starting with ## is a heading, a line starting with - is a bullet, an empty line starts a new paragraph.",
        )}
      </p>
      {TERMS_FIELDS.map((field) => (
        <div key={field.key} className="quote-terms-field">
          <Field label={t(field.cs, field.en)}>
            <textarea
              rows={5}
              value={form.terms[field.key]}
              onChange={(event) =>
                update({ terms: { ...form.terms, [field.key]: event.target.value } })
              }
            />
          </Field>
          <div className="quote-terms-preview">
            <span className="quote-terms-preview-label">{t("Náhled", "Preview")}</span>
            {form.terms[field.key].trim() ? (
              <TermsPreview source={form.terms[field.key]} />
            ) : (
              <p className="muted small">{t("Prázdné, netiskne se.", "Empty, not printed.")}</p>
            )}
          </div>
        </div>
      ))}
    </article>
  );
}

/** „Obchodní podmínky“: which terms the quote offers and how the customer accepted them. */
export function CommercialTermsCard({ form, update }: { form: QuoteForm; update: Patch }) {
  const t = useT();
  const commercial = form.commercial;
  const set = (patch: Partial<QuoteForm["commercial"]>) =>
    update({ commercial: { ...commercial, ...patch } });
  return (
    <article className="ds-card quote-card">
      <h2>{t("Obchodní podmínky", "Commercial terms")}</h2>
      <div className="form-grid">
        <Field label={t("Zákazník", "Customer")}>
          <select
            value={commercial.customerScope}
            onChange={(event) =>
              set({ customerScope: event.target.value as QuoteForm["commercial"]["customerScope"] })
            }
          >
            {CUSTOMER_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {t.of(CUSTOMER_SCOPE_LABELS[scope])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Verze podmínek", "Terms version")}>
          <input
            value={commercial.termsVersion}
            onChange={(event) => set({ termsVersion: event.target.value })}
          />
        </Field>
        <Field label={t("Odkaz na podmínky", "Link to the terms")} wide>
          <input
            type="url"
            value={commercial.termsUrl}
            inputMode="url"
            onChange={(event) => set({ termsUrl: event.target.value })}
          />
        </Field>
        <Field label={t("Přijato dne", "Accepted on")}>
          <input
            type="date"
            value={commercial.acceptedOn}
            onChange={(event) => set({ acceptedOn: event.target.value })}
          />
        </Field>
        <Field
          label={t("Doklad o přijetí", "Evidence of acceptance")}
          hint={t("Podepsaná nabídka, e-mail, dokument.", "A signed quote, an e-mail, a document.")}
        >
          <input
            value={commercial.evidence}
            onChange={(event) => set({ evidence: event.target.value })}
          />
        </Field>
      </div>
      <h3>{t("Oblasti podmínek", "Areas of the terms")}</h3>
      <div className="quote-terms-areas">
        {TERMS_AREAS.map((area) => (
          <Field key={area} label={t.of(TERMS_AREA_LABELS[area])}>
            <select
              value={commercial.choices[area] ?? ""}
              onChange={(event) => {
                const choices = { ...commercial.choices };
                if (event.target.value) choices[area] = event.target.value as TermsChoice;
                else delete choices[area];
                set({ choices });
              }}
            >
              <option value="">{t("Neurčeno", "Not set")}</option>
              {TERMS_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t.of(TERMS_CHOICE_LABELS[choice])}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <Field label={t("Poznámka k podmínkám", "Note on the terms")}>
        <textarea
          rows={3}
          value={commercial.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </Field>
    </article>
  );
}
