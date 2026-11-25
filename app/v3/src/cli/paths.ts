import { resolve } from "node:path";
import type { Locale } from "../i18n/locale.ts";

/** The App package: `app/v3/src/cli` → two levels up. */
export const APP_ROOT = resolve(import.meta.dir, "..", "..");
/** The Module root: four levels up. */
export const MODULE_ROOT = resolve(APP_ROOT, "..", "..");
/** The data repository skeleton an adopting Organization starts from. */
export const DATA_REPO_TEMPLATE = resolve(MODULE_ROOT, "templates", "data-repo");
/** The Module's data checkout. */
export const DATA_MOUNT = resolve(MODULE_ROOT, "db");

export type Start = "empty" | "sample";

/**
 * The records of a start in a language, laid out like `db/data/`: `empty`
 * holds the settings with a pipeline and loss reasons ready to use, `sample`
 * fictional companies, contacts, deals across the pipeline and activities.
 */
export function seedDirectory(locale: Locale, start: Start): string {
  return resolve(APP_ROOT, "seed", locale, start);
}
