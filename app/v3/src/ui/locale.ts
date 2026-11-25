import { resolveLocale as chooseLocale, readLazurioLocale } from "design-system";
import { DEFAULT_LOCALE, type Locale, parseLocale } from "../i18n/locale.ts";

/**
 * The language the App speaks, by the design system's rule (Lazurio's,
 * decision 0142): an explicit choice first, then the language Lazurio gives,
 * then Czech.
 *
 * 1. The explicit choice is `?lang=cs|en` in the address (development,
 *    screenshots, a link someone shares).
 * 2. Lazurio gives the language of the person's profile in
 *    `/.lazurio/shell.json`, read by the design system's `readLazurioLocale`.
 * 3. Czech.
 */
export type Load = (path: string, init?: RequestInit) => Promise<Response>;

export async function resolveLocale(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  load: Load = (path, init) => fetch(path, init),
): Promise<Locale> {
  const explicit = parseLocale(new URLSearchParams(search).get("lang"));
  const lazurio = explicit
    ? null
    : await readLazurioLocale(load as typeof fetch, AbortSignal.timeout(1500));
  return chooseLocale({ explicit, lazurio }) ?? DEFAULT_LOCALE;
}
