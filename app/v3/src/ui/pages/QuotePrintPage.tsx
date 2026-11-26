import { Alert, Button } from "design-system/react";
import type { Address } from "../../domain/company.ts";
import { lineAmount } from "../../domain/money.ts";
import { quoteTotals } from "../../domain/quote.ts";
import { billingEntityById } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { PageHeader } from "../components/common.tsx";
import { formatQuantity } from "../components/quotes/quoteForm.ts";
import { TermsPreview } from "../components/quotes/TermsPreview.tsx";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import { href } from "../routes.ts";

function addressLines(address: Address | undefined): string[] {
  if (!address) return [];
  const city = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.street, city, address.country].filter((line): line is string => Boolean(line));
}

/**
 * A quote as it prints on A4: the supplier and the customer, the recap by
 * section, the itemised lines, the totals and the terms. Printing or saving a
 * PDF is the person's own step; nothing is sent from here.
 */
export function QuotePrintPage({ data, id }: { data: AppData; id: string }) {
  const t = useT();
  const locale = useLocale();
  const settings = data.settings.value;
  const entry = data.quotes.find((stored) => stored.value.id === id);
  const f = useFormat(entry?.value.currency ?? settings.currency);
  if (!entry) {
    return (
      <section>
        <PageHeader
          eyebrow={<a href={href({ page: "quotes" })}>{t("Cenové nabídky", "Quotes")}</a>}
          title={t("Nabídka neexistuje", "This quote does not exist")}
        />
      </section>
    );
  }
  const quote = entry.value;
  const totals = quoteTotals(quote);
  const supplier =
    billingEntityById(settings, quote.billingEntityId) ?? settings.billingEntities?.[0];
  const contact = data.contacts.find((stored) => stored.value.id === quote.contactId)?.value;
  const withDiscount = quote.lines.some((line) => (line.discount ?? 0) > 0);
  const terms = [quote.terms?.vatNote, quote.terms?.payments, quote.terms?.scope].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  const commercial = quote.commercialTerms;

  return (
    <section className="quote-print-page">
      <div className="quote-print-toolbar">
        <Button variant="quiet" icon="arrow-left" href={href({ page: "quote", id: quote.id })}>
          {t("Zpět do editoru", "Back to the editor")}
        </Button>
        <Button variant="primary" icon="download" onClick={() => window.print()}>
          {t("Tisk / Uložit PDF", "Print / Save PDF")}
        </Button>
      </div>
      {quote.status === "draft" ? (
        <div className="quote-print-notice">
          <Alert tone="warning" locale={locale}>
            <p>
              {t(
                "Tato nabídka je koncept. Než ji pošlete zákazníkovi, zkontrolujte ji a v editoru ji označte jako odeslanou. Toto upozornění se netiskne.",
                "This quote is a draft. Check it before you send it to the customer, and mark it as sent in the editor. This notice is not printed.",
              )}
            </p>
          </Alert>
        </div>
      ) : null}
      <article className="quote-sheet" data-theme="light" lang={locale}>
        <header className="quote-sheet-head">
          <div className="quote-sheet-party">
            <p className="quote-sheet-label">{t("Dodavatel", "Supplier")}</p>
            {supplier ? (
              <>
                <p className="quote-sheet-name">{supplier.name}</p>
                {addressLines(supplier.address).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {supplier.ico ? (
                  <p>
                    {t("IČO", "Company ID")} {supplier.ico}
                  </p>
                ) : null}
                {supplier.dic ? (
                  <p>
                    {t("DIČ", "VAT ID")} {supplier.dic}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="muted">
                {t("Dodavatel není v nastavení.", "No supplier in the settings.")}
              </p>
            )}
          </div>
          <div className="quote-sheet-party">
            <p className="quote-sheet-label">{t("Odběratel", "Customer")}</p>
            <p className="quote-sheet-name">{quote.customer.name}</p>
            {addressLines(quote.customer.address).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {quote.customer.ico ? (
              <p>
                {t("IČO", "Company ID")} {quote.customer.ico}
              </p>
            ) : null}
            {quote.customer.dic ? (
              <p>
                {t("DIČ", "VAT ID")} {quote.customer.dic}
              </p>
            ) : null}
            {contact ? (
              <p>
                {t("Kontakt", "Contact")}:{" "}
                {[contact.name, contact.email].filter(Boolean).join(", ")}
              </p>
            ) : null}
          </div>
        </header>

        <div className="quote-sheet-title">
          <h1>{t("Cenová nabídka", "Quote")}</h1>
          <p className="quote-sheet-project">{quote.title}</p>
          <dl className="quote-sheet-meta">
            <div>
              <dt>{t("Číslo", "Number")}</dt>
              <dd>
                {quote.number}, {t("revize", "revision")} {quote.version}
              </dd>
            </div>
            <div>
              <dt>{t("Vystaveno", "Issued")}</dt>
              <dd>{f.date(quote.issuedOn)}</dd>
            </div>
            {quote.validUntil ? (
              <div>
                <dt>{t("Platnost do", "Valid until")}</dt>
                <dd>{f.date(quote.validUntil)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {totals.sections.length > 1 ? (
          <section className="quote-sheet-block">
            <h2>{t("Rekapitulace", "Recap")}</h2>
            <table className="quote-sheet-table">
              <tbody>
                {totals.sections.map((section) => (
                  <tr key={section.sectionId}>
                    <th scope="row">{section.label}</th>
                    <td className="num">{f.money(section.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="quote-sheet-block">
          <h2>{t("Položky", "Items")}</h2>
          <table className="quote-sheet-table quote-sheet-lines">
            <thead>
              <tr>
                <th scope="col">{t("Popis", "Description")}</th>
                <th scope="col" className="num">
                  {t("Počet", "Qty")}
                </th>
                <th scope="col">{t("MJ", "Unit")}</th>
                <th scope="col" className="num">
                  {t("Cena MJ", "Unit price")}
                </th>
                {withDiscount ? (
                  <th scope="col" className="num">
                    {t("Sleva", "Discount")}
                  </th>
                ) : null}
                <th scope="col" className="num">
                  {t("Celkem", "Total")}
                </th>
              </tr>
            </thead>
            {quote.sections.map((section) => {
              const lines = quote.lines.filter((line) => line.sectionId === section.id);
              if (lines.length === 0) return null;
              return (
                <tbody key={section.id}>
                  <tr className="quote-sheet-section">
                    <th scope="colgroup" colSpan={withDiscount ? 6 : 5}>
                      {section.label}
                    </th>
                  </tr>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="quote-sheet-line-name">{line.name}</span>
                        {line.description ? (
                          <span className="quote-sheet-line-description">{line.description}</span>
                        ) : null}
                      </td>
                      <td className="num">{formatQuantity(line.quantity, locale)}</td>
                      <td>{line.unit}</td>
                      <td className="num">{f.money(line.unitPrice)}</td>
                      {withDiscount ? (
                        <td className="num">{line.discount ? f.rate(line.discount) : ""}</td>
                      ) : null}
                      <td className="num">
                        {f.money(lineAmount(line.unitPrice, line.quantity, line.discount ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
          {quote.lines.length === 0 ? (
            <p className="muted">
              {t("Nabídka zatím nemá položky.", "The quote has no items yet.")}
            </p>
          ) : null}
        </section>

        <section className="quote-sheet-block quote-sheet-totals">
          <dl>
            {totals.discount > 0 ? (
              <div>
                <dt>{t("Sleva celkem", "Total discount")}</dt>
                <dd className="num">−{f.money(totals.discount)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Celkem bez DPH", "Total excl. VAT")}</dt>
              <dd className="num">{f.money(totals.subtotal)}</dd>
            </div>
            {quote.reverseCharge ? (
              <div>
                <dt>{t("DPH", "VAT")}</dt>
                <dd className="num">{f.money(0)}</dd>
              </div>
            ) : (
              <div>
                <dt>
                  {t("DPH", "VAT")} {f.rate(quote.vatRate)}
                </dt>
                <dd className="num">{f.money(totals.vat)}</dd>
              </div>
            )}
            <div className="quote-sheet-grand">
              <dt>{t("Celkem s DPH", "Total incl. VAT")}</dt>
              <dd className="num">{f.money(totals.total)}</dd>
            </div>
          </dl>
          {quote.reverseCharge ? (
            <p className="quote-sheet-note">
              {t(
                "Daň odvede zákazník (přenesená daňová povinnost).",
                "VAT to be accounted for by the customer (reverse charge).",
              )}
            </p>
          ) : null}
          {quote.changeReserve ? (
            <p className="quote-sheet-note">
              {t(
                `Rezerva na změny mimo cenu nabídky: ${f.money(quote.changeReserve)} bez DPH.`,
                `Reserve for changes outside the quoted price: ${f.money(quote.changeReserve)} excl. VAT.`,
              )}
            </p>
          ) : null}
        </section>

        {terms.length > 0 || commercial?.termsVersion || commercial?.termsUrl ? (
          <section className="quote-sheet-block quote-sheet-terms">
            <h2>{t("Podmínky", "Terms")}</h2>
            {terms.map((text) => (
              <TermsPreview key={text} source={text} className="quote-sheet-terms-text" />
            ))}
            {commercial?.termsVersion || commercial?.termsUrl ? (
              <p>
                {t("Obchodní podmínky", "Commercial terms")}
                {commercial.termsVersion ? ` ${commercial.termsVersion}` : ""}
                {commercial.termsUrl ? `: ${commercial.termsUrl}` : ""}
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="quote-sheet-footer">
          {supplier ? (
            <p>
              {[
                supplier.name,
                supplier.ico ? `${t("IČO", "Company ID")} ${supplier.ico}` : undefined,
                supplier.dic ? `${t("DIČ", "VAT ID")} ${supplier.dic}` : undefined,
                supplier.bankAccount
                  ? `${t("Účet", "Account")} ${supplier.bankAccount}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {supplier ? (
            <p>{[supplier.email, supplier.phone, supplier.website].filter(Boolean).join(" · ")}</p>
          ) : null}
          <p>
            {quote.number}, {t("revize", "revision")} {quote.version}
          </p>
        </footer>
      </article>
    </section>
  );
}
