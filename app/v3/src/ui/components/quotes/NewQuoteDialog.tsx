import { Dialog, EmptyState } from "design-system/react";
import { useState } from "react";
import type { AppData } from "../../App.tsx";
import { api } from "../../api.ts";
import { useFormat, useLocale, useT } from "../../i18n.tsx";
import { useLookups } from "../../lookups.ts";
import { navigate } from "../../routes.ts";
import { ErrorNotice } from "../common.tsx";
import { matches } from "./search.ts";

/**
 * „Nová nabídka“: the person finds the deal the quote is for; the quote is
 * created as a draft of that deal and opens in the editor.
 */
export function NewQuoteDialog({
  data,
  open,
  onClose,
  onChanged,
}: {
  data: AppData;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(data.settings.value.currency);
  const lookups = useLookups(data);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const kindOrder = { open: 0, won: 1, lost: 2 } as const;
  const deals = data.deals
    .map((entry) => entry.value)
    .filter((deal) =>
      matches(query, [
        deal.title,
        deal.id,
        lookups.companyName(deal.companyId),
        lookups.salespersonName(deal.ownerId),
      ]),
    )
    .sort(
      (left, right) =>
        kindOrder[lookups.stage(left.stageId)?.kind ?? "open"] -
          kindOrder[lookups.stage(right.stageId)?.kind ?? "open"] ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .slice(0, 40);

  async function create(dealId: string) {
    setBusy(dealId);
    setError(null);
    try {
      const created = await api.createQuote({ dealId });
      await onChanged();
      setQuery("");
      onClose();
      navigate({ page: "quote", id: created.value.id });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      id="new-quote"
      title={t("Nová nabídka", "New quote")}
      description={t(
        "Vyberte obchodní případ. Nabídka vznikne jako koncept s odběratelem z jeho firmy.",
        "Choose the deal. The quote starts as a draft with the customer taken from its company.",
      )}
      size="lg"
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      dismissable
      locale={locale}
    >
      <div className="picker">
        <ErrorNotice error={error} title={t("Nabídka nevznikla.", "The quote was not created.")} />
        <input
          className="ds-input"
          type="search"
          value={query}
          aria-label={t("Hledat obchodní případ", "Search the deals")}
          placeholder={t("Název, firma nebo obchodník", "Title, company or salesperson")}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {deals.length === 0 ? (
          <EmptyState
            icon="search"
            headingLevel={3}
            title={t("Žádný obchodní případ.", "No deal found.")}
          />
        ) : (
          <ul className="picker-list">
            {deals.map((deal) => {
              const stage = lookups.stage(deal.stageId);
              return (
                <li key={deal.id}>
                  <button
                    type="button"
                    className="picker-option"
                    disabled={busy !== null}
                    aria-busy={busy === deal.id ? "true" : undefined}
                    onClick={() => void create(deal.id)}
                  >
                    <span className="picker-option-main">
                      <span className="picker-option-name">{deal.title}</span>
                      <span className="muted small">
                        {[lookups.companyName(deal.companyId), stage?.label, deal.id]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="num small">
                      {busy === deal.id ? t("Zakládám…", "Creating…") : f.money(deal.value)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
