import type { PricebookItem } from "../../../domain/pricebook.ts";

/** Text folded for a search: lowercase, without diacritics, so `zidle` finds `Židle`. */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Whether every word of a query is found in one of the texts. */
export function matches(query: string, texts: readonly (string | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(texts.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

/** The active price list items a query finds by name, code or description, by name. */
export function findItems(
  items: readonly PricebookItem[],
  query: string,
  limit = 12,
): PricebookItem[] {
  return items
    .filter((item) => item.active && matches(query, [item.name, item.code, item.description]))
    .sort((left, right) => left.name.localeCompare(right.name, "cs"))
    .slice(0, limit);
}
