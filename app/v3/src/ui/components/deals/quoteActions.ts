import { api } from "../../api.ts";
import { navigate } from "../../routes.ts";

/** Creates a quote for a deal (a draft) and opens it. */
export async function createQuoteFor(
  dealId: string,
  onChanged?: () => Promise<void>,
): Promise<void> {
  const created = await api.createQuote({ dealId });
  await onChanged?.();
  navigate({ page: "quote", id: created.value.id });
}

/** Writes the next revision of a quote (a draft copy of its latest) and opens it. */
export async function reviseQuoteOf(
  quoteId: string,
  onChanged?: () => Promise<void>,
): Promise<void> {
  const created = await api.reviseQuote(quoteId);
  await onChanged?.();
  navigate({ page: "quote", id: created.value.id });
}
