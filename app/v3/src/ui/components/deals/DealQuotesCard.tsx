import { Badge, Button } from "design-system/react";
import { useState } from "react";
import type { Deal } from "../../../domain/deal.ts";
import { latestRevisions, primaryQuote, quoteTotals } from "../../../domain/quote.ts";
import type { AppData } from "../../App.tsx";
import { useFormat, useT } from "../../i18n.tsx";
import { QuoteStatusBadge } from "../../labels.tsx";
import { useLookups } from "../../lookups.ts";
import { href } from "../../routes.ts";
import { useCanWrite } from "../../write.tsx";
import { ErrorNotice } from "../common.tsx";
import { createQuoteFor, reviseQuoteOf } from "./quoteActions.ts";

/**
 * Every quote of a deal, every revision, newest first: its number and
 * revision, status, the day it was issued and its totals; the quote the
 * deal's value follows is marked. A new quote and a new revision of the
 * latest are drafts that open at once.
 */
export function DealQuotesCard({
  data,
  deal,
  onChanged,
}: {
  data: AppData;
  deal: Deal;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const f = useFormat(data.settings.value.currency);
  const lookups = useLookups(data);
  const quotes = lookups.quotesOf(deal.id);
  const primary = primaryQuote(deal, quotes);
  const latest = new Set(latestRevisions(quotes).map((quote) => quote.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="ds-card deal-side-card">
      <div className="panel-head">
        <h2>{t("Cenové nabídky", "Quotes")}</h2>
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            busy={busy === "new"}
            disabled={busy !== null}
            onClick={() => void run("new", () => createQuoteFor(deal.id, onChanged))}
          >
            {t("Nová nabídka", "New quote")}
          </Button>
        ) : null}
      </div>
      <ErrorNotice error={error} />
      {quotes.length === 0 ? (
        <p className="muted">{t("Případ zatím nemá nabídku.", "The deal has no quote yet.")}</p>
      ) : (
        <ul className="deal-quotes">
          {quotes.map((quote) => {
            const totals = quoteTotals(quote);
            return (
              <li key={quote.id} className="deal-quote">
                <div className="deal-quote-head">
                  <a href={href({ page: "quote", id: quote.id })} className="deal-quote-number">
                    {quote.number}
                  </a>
                  <span className="muted small">
                    {t(`Revize ${quote.version}`, `Revision ${quote.version}`)}
                  </span>
                  <QuoteStatusBadge status={quote.status} />
                  {primary?.id === quote.id ? (
                    <Badge tone="accent" icon={false}>
                      {t("Hlavní", "Primary")}
                    </Badge>
                  ) : null}
                </div>
                <dl className="deal-quote-figures">
                  <div>
                    <dt>{t("Vystaveno", "Issued")}</dt>
                    <dd>{f.date(quote.issuedOn)}</dd>
                  </div>
                  <div>
                    <dt>{t("Bez DPH", "Without VAT")}</dt>
                    <dd className="num">{f.money(totals.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>{t("S DPH", "With VAT")}</dt>
                    <dd className="num">{f.money(totals.total)}</dd>
                  </div>
                </dl>
                {canWrite && latest.has(quote.id) ? (
                  <div className="deal-quote-actions">
                    <Button
                      variant="quiet"
                      size="sm"
                      busy={busy === quote.id}
                      disabled={busy !== null}
                      onClick={() => void run(quote.id, () => reviseQuoteOf(quote.id, onChanged))}
                    >
                      {t("Nová revize", "New revision")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
