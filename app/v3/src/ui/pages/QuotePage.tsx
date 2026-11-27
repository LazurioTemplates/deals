import { Alert, Button, Dialog } from "design-system/react";
import { useState } from "react";
import { canonicalJson } from "../../domain/canonical.ts";
import { isLive, type Quote, type QuoteStatus, quoteTotals } from "../../domain/quote.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { Field, PageHeader } from "../components/common.tsx";
import {
  CommercialTermsCard,
  QuoteSummary,
  QuoteTermsCard,
} from "../components/quotes/QuoteCards.tsx";
import { QuoteLines } from "../components/quotes/QuoteLines.tsx";
import {
  buildQuote,
  customerFromCompany,
  previewOf,
  problemsOf,
  type QuoteForm,
  quoteFormOf,
} from "../components/quotes/quoteForm.ts";
import { EditNotices, isRecordChanged, useRecordForm } from "../edit.tsx";
import { useLocale, useT } from "../i18n.tsx";
import { QuoteStatusBadge } from "../labels.tsx";
import { useLookups } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

/** The editor of one revision of a quote. Superseded and cancelled revisions are read-only. */
export function QuotePage({
  data,
  id,
  onChanged,
}: {
  data: AppData;
  id: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const lookups = useLookups(data);
  const current = data.quotes.find((entry) => entry.value.id === id);
  const formOf = (quote: Quote | undefined) => quoteFormOf(quote, locale);
  const edit = useRecordForm<Quote, QuoteForm>(current, formOf);
  const form = edit.form;
  const stored = current ?? edit.base;
  const [discounts, setDiscounts] = useState(() =>
    (current?.value.lines ?? []).some((line) => (line.discount ?? 0) > 0),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [tried, setTried] = useState(false);

  if (!stored) {
    return (
      <section>
        <PageHeader
          eyebrow={<a href={href({ page: "quotes" })}>{t("Cenové nabídky", "Quotes")}</a>}
          title={t("Nabídka neexistuje", "This quote does not exist")}
        />
      </section>
    );
  }
  const quote = stored.value;
  const deal = lookups.deal(quote.dealId);
  const family = data.quotes
    .filter((entry) => entry.value.number === quote.number)
    .sort((left, right) => right.value.version - left.value.version);
  const latest = family[0]?.value;
  const isLatest = latest?.id === quote.id;
  const frozen = quote.status === "superseded" || quote.status === "cancelled";
  const locked = !canWrite || frozen;
  const problems = problemsOf(form, locale);
  const totals = quoteTotals(previewOf(form, locale));
  const touched = edit.base
    ? canonicalJson(form) !== canonicalJson(formOf(edit.base.value))
    : false;
  const update = edit.update;
  const companyId = form.customer.companyId || deal?.companyId;
  const company = data.companies.find((entry) => entry.value.id === companyId)?.value;
  const contacts = data.contacts.filter(
    (entry) => entry.value.companyId === companyId || entry.value.id === form.contactId,
  );
  const entities = settings.billingEntities ?? [];

  /** Saves the form when it changed; returns the revision stored now, or null when it was refused. */
  async function saveIfTouched(): Promise<Stored<Quote> | null> {
    const base = edit.base;
    if (!base) return null;
    if (!touched) return current ?? base;
    setTried(true);
    const record = buildQuote(base.value, form, locale);
    if (!record) return null;
    const saved = await api.saveQuote(record, base.revision);
    edit.saved(saved, form);
    return saved;
  }

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (caught) {
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      await saveIfTouched();
      await onChanged();
    });

  const changeStatus = (status: QuoteStatus) =>
    run(status, async () => {
      const saved = await saveIfTouched();
      if (!saved) return;
      await api.setQuoteStatus(quote.id, status, saved.revision);
      await onChanged();
    });

  const revise = () =>
    run("revise", async () => {
      const saved = await saveIfTouched();
      if (!saved) return;
      const next = await api.reviseQuote(quote.id);
      await onChanged();
      navigate({ page: "quote", id: next.value.id });
    });

  const statusActions =
    canWrite && !frozen ? (
      <>
        {quote.status === "draft" ? (
          <Button
            variant="secondary"
            busy={busy === "active"}
            disabled={busy !== null}
            onClick={() => void changeStatus("active")}
          >
            {t("Označit jako odeslanou", "Mark as sent")}
          </Button>
        ) : null}
        {quote.status !== "approved" ? (
          <Button
            variant="secondary"
            busy={busy === "approved"}
            disabled={busy !== null}
            onClick={() => void changeStatus("approved")}
          >
            {t("Schválit", "Approve")}
          </Button>
        ) : null}
        {isLatest ? (
          <Button
            variant="secondary"
            busy={busy === "revise"}
            disabled={busy !== null}
            onClick={() => void revise()}
          >
            {t("Nová revize", "New revision")}
          </Button>
        ) : null}
        <Button variant="quiet" disabled={busy !== null} onClick={() => setCancelling(true)}>
          {t("Zrušit", "Cancel")}
        </Button>
      </>
    ) : null;

  return (
    <section className="quote-page">
      <PageHeader
        eyebrow={
          deal ? (
            <a href={href({ page: "deal", id: deal.id })}>{deal.title}</a>
          ) : (
            <a href={href({ page: "quotes" })}>{t("Cenové nabídky", "Quotes")}</a>
          )
        }
        title={form.title || quote.title}
        subtitle={
          <span className="meta-row">
            <span className="mono">{quote.number}</span>
            <span>
              {t("Revize", "Revision")} {quote.version}
            </span>
            <QuoteStatusBadge status={quote.status} />
            <span>{quote.customer.name}</span>
          </span>
        }
        actions={
          <>
            {touched && canWrite && !frozen ? (
              <Button
                variant="primary"
                busy={busy === "save"}
                disabled={busy !== null}
                onClick={() => void save()}
              >
                {t("Uložit do konceptu", "Save to the draft")}
              </Button>
            ) : null}
            <Button
              variant={touched ? "secondary" : "primary"}
              icon="page"
              href={href({ page: "quote-print", id: quote.id })}
            >
              {t("Náhled a tisk", "Preview and print")}
            </Button>
            {statusActions}
          </>
        }
      />
      {!isLatest && latest ? (
        <Alert tone="info" locale={locale}>
          <p>
            {t(
              `Toto je revize ${quote.version}. Nejnovější je revize ${latest.version}.`,
              `This is revision ${quote.version}. The latest is revision ${latest.version}.`,
            )}{" "}
            <a href={href({ page: "quote", id: latest.id })}>
              {t("Otevřít nejnovější revizi", "Open the latest revision")}
            </a>
          </p>
        </Alert>
      ) : null}
      {frozen ? (
        <Alert tone="warning" locale={locale}>
          <p>
            {quote.status === "superseded"
              ? t(
                  "Nahrazená revize zůstává, jak byla odeslána; upravit ji nejde.",
                  "A superseded revision stays as it was sent; it cannot be edited.",
                )
              : t(
                  "Zrušená nabídka je jen ke čtení. Stav jde změnit v seznamu nabídek.",
                  "A cancelled quote is read-only. Its status can be changed in the list of quotes.",
                )}
          </p>
        </Alert>
      ) : null}
      <EditNotices edit={edit} error={error} onClear={() => setError(null)} />
      {tried && problems.any && !locked ? (
        <Alert tone="danger" live="assertive" locale={locale}>
          <p>
            {t(
              "Neuloženo. Opravte zvýrazněná pole: počet je kladné číslo s nejvýš 3 desetinnými místy, ceny jsou částky.",
              "Not saved. Correct the marked fields: a quantity is a positive number with at most 3 decimals, prices are amounts.",
            )}
          </p>
        </Alert>
      ) : null}
      <fieldset className="form-fieldset" disabled={locked}>
        <div className="quote-layout">
          <div className="quote-main">
            <article className="ds-card quote-card">
              <h2>{t("Projekt", "Project")}</h2>
              <div className="form-grid">
                <Field
                  label={t("Název", "Title")}
                  error={problems.title ? t("Vyplňte název.", "Fill in the title.") : undefined}
                  wide
                >
                  <input
                    value={form.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </Field>
                {entities.length > 1 ? (
                  <Field label={t("Dodavatel", "Supplier")}>
                    <select
                      value={form.billingEntityId}
                      onChange={(event) => update({ billingEntityId: event.target.value })}
                    >
                      {!form.billingEntityId ? <option value="">–</option> : null}
                      {entities.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field
                  label={t("Vystaveno", "Issued")}
                  error={problems.issuedOn ? t("Zadejte datum.", "Enter a date.") : undefined}
                >
                  <input
                    type="date"
                    value={form.issuedOn}
                    onChange={(event) => update({ issuedOn: event.target.value })}
                  />
                </Field>
                <Field
                  label={t("Platnost do", "Valid until")}
                  error={
                    problems.validUntil
                      ? t("Nejdříve v den vystavení.", "On the issue date or later.")
                      : undefined
                  }
                >
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(event) => update({ validUntil: event.target.value })}
                  />
                </Field>
                <Field label={t("Kontakt", "Contact")}>
                  <select
                    value={form.contactId}
                    onChange={(event) => update({ contactId: event.target.value })}
                  >
                    <option value="">{t("Bez kontaktu", "No contact")}</option>
                    {contacts.map((entry) => (
                      <option key={entry.value.id} value={entry.value.id}>
                        {entry.value.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </article>

            <article className="ds-card quote-card">
              <div className="quote-card-heading">
                <h2>{t("Odběratel", "Customer")}</h2>
                {!locked && company ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => update({ customer: customerFromCompany(company) })}
                  >
                    {t("Načíst z firmy", "Load from the company")}
                  </Button>
                ) : null}
              </div>
              <p className="muted small">
                {t(
                  "Kopie údajů firmy v době nabídky; vytištěná nabídka zůstává, jaká byla.",
                  "A copy of the company as the quote was written; a printed quote stays as it was.",
                )}
              </p>
              <div className="form-grid">
                <Field
                  label={t("Název", "Name")}
                  error={
                    problems.customerName ? t("Vyplňte název.", "Fill in the name.") : undefined
                  }
                  wide
                >
                  <input
                    value={form.customer.name}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, name: event.target.value } })
                    }
                  />
                </Field>
                <Field
                  label={t("IČO", "Company ID")}
                  error={problems.ico ? t("Osm číslic.", "Eight digits.") : undefined}
                >
                  <input
                    value={form.customer.ico}
                    inputMode="numeric"
                    onChange={(event) =>
                      update({ customer: { ...form.customer, ico: event.target.value } })
                    }
                  />
                </Field>
                <Field label={t("DIČ", "VAT ID")}>
                  <input
                    value={form.customer.dic}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, dic: event.target.value } })
                    }
                  />
                </Field>
                <Field label={t("Ulice", "Street")} wide>
                  <input
                    value={form.customer.street}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, street: event.target.value } })
                    }
                  />
                </Field>
                <Field label={t("Město", "City")}>
                  <input
                    value={form.customer.city}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, city: event.target.value } })
                    }
                  />
                </Field>
                <Field label={t("PSČ", "Postal code")}>
                  <input
                    value={form.customer.postalCode}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, postalCode: event.target.value } })
                    }
                  />
                </Field>
                <Field label={t("Země", "Country")}>
                  <input
                    value={form.customer.country}
                    onChange={(event) =>
                      update({ customer: { ...form.customer, country: event.target.value } })
                    }
                  />
                </Field>
              </div>
            </article>

            <QuoteLines
              form={form}
              setForm={update}
              settings={settings}
              pricebook={data.pricebook.map((entry) => entry.value)}
              problems={tried ? problems.lines : {}}
              locked={locked}
              discounts={discounts}
              onDiscounts={(on) => {
                setDiscounts(on);
                if (!on && form.lines.some((line) => line.discount))
                  update({ lines: form.lines.map((line) => ({ ...line, discount: "" })) });
              }}
            />

            <QuoteTermsCard form={form} update={update} />
            <CommercialTermsCard form={form} update={update} />

            <article className="ds-card quote-card">
              <h2>{t("Poznámka", "Note")}</h2>
              <Field
                label={t("Interní poznámka", "Internal note")}
                hint={t("Netiskne se.", "Not printed.")}
              >
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={(event) => update({ note: event.target.value })}
                />
              </Field>
            </article>
          </div>
          <aside className="quote-aside">
            <QuoteSummary
              form={form}
              update={update}
              totals={totals}
              problems={problems}
              currency={settings.currency}
            >
              {canWrite && !frozen ? (
                <div className="quote-save">
                  <Button
                    variant="primary"
                    block
                    busy={busy === "save"}
                    disabled={busy !== null || !touched}
                    onClick={() => void save()}
                  >
                    {t("Uložit do konceptu", "Save to the draft")}
                  </Button>
                  <p className="muted small">
                    {touched
                      ? t("Máte neuložené změny.", "You have unsaved changes.")
                      : t("Vše je uloženo v konceptu.", "Everything is saved in the draft.")}
                  </p>
                </div>
              ) : null}
            </QuoteSummary>
            {family.length > 1 ? (
              <article className="ds-card">
                <h2>{t("Revize", "Revisions")}</h2>
                <ul className="quote-revisions">
                  {family.map((entry) => (
                    <li key={entry.value.id}>
                      {entry.value.id === quote.id ? (
                        <strong>
                          {t("Revize", "Revision")} {entry.value.version}
                        </strong>
                      ) : (
                        <a href={href({ page: "quote", id: entry.value.id })}>
                          {t("Revize", "Revision")} {entry.value.version}
                        </a>
                      )}
                      <QuoteStatusBadge status={entry.value.status} />
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </aside>
        </div>
      </fieldset>
      <Dialog
        id="quote-cancel"
        size="sm"
        title={t("Zrušit nabídku?", "Cancel the quote?")}
        open={cancelling}
        onClose={() => setCancelling(false)}
        locale={locale}
        footer={
          <>
            <Button variant="quiet" onClick={() => setCancelling(false)}>
              {t("Ponechat", "Keep it")}
            </Button>
            <Button
              variant="danger"
              busy={busy === "cancelled"}
              onClick={() => {
                setCancelling(false);
                void changeStatus("cancelled");
              }}
            >
              {t("Zrušit nabídku", "Cancel the quote")}
            </Button>
          </>
        }
      >
        <p>
          {isLive(quote.status)
            ? t(
                "Zrušená nabídka se stane jen ke čtení a přestane určovat hodnotu případu. Uloží se do konceptu.",
                "A cancelled quote becomes read-only and no longer sets the deal's value. It is saved to the draft.",
              )
            : null}
        </p>
      </Dialog>
    </section>
  );
}
