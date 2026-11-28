import { resolveLocale as chooseLocale, readLazurioLocale } from "design-system";
import { DEFAULT_LOCALE, type Locale, parseLocale } from "../i18n/locale.ts";

/**
 * The language the App speaks, by the design system's rule (Lazurio's,
 * decision 0142): an explicit choice first, then the language Lazurio gives,
 * then Czech.
 *
 * 1. The explicit choice is `?lang=cs|en` in the address (development,
 *    screenshots, a link someone shares), else the language the person chose
 *    in the App's settings for this browser (`readLocaleChoice`).
 * 2. Lazurio gives the language of the person's profile in
 *    `/.lazurio/shell.json`, read by the design system's `readLazurioLocale`.
 * 3. Czech.
 */
export type Load = (path: string, init?: RequestInit) => Promise<Response>;

/** The person's own choice of language in this browser; `auto` follows Lazurio. */
export type LocaleChoice = Locale | "auto";

const CHOICE_KEY = "deals.locale";

/** The language chosen in the settings, or `auto` where nothing (or no storage) is there. */
export function readLocaleChoice(): LocaleChoice {
  try {
    return parseLocale(globalThis.localStorage?.getItem(CHOICE_KEY)) ?? "auto";
  } catch {
    return "auto";
  }
}

/** Keeps the person's choice for this browser; `auto` forgets it. */
export function writeLocaleChoice(choice: LocaleChoice): void {
  try {
    if (choice === "auto") globalThis.localStorage?.removeItem(CHOICE_KEY);
    else globalThis.localStorage?.setItem(CHOICE_KEY, choice);
  } catch {
    // No storage (a private window): the choice lasts until the page reloads.
  }
}

export async function resolveLocale(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  load: Load = (path, init) => fetch(path, init),
  chosen: LocaleChoice = readLocaleChoice(),
): Promise<Locale> {
  const explicit =
    parseLocale(new URLSearchParams(search).get("lang")) ?? (chosen === "auto" ? null : chosen);
  const lazurio = explicit
    ? null
    : await readLazurioLocale(load as typeof fetch, AbortSignal.timeout(1500));
  return chooseLocale({ explicit, lazurio }) ?? DEFAULT_LOCALE;
}
