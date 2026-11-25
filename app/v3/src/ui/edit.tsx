import { Alert, Button } from "design-system/react";
import { useState } from "react";
import { canonicalJson } from "../domain/canonical.ts";
import { ApiError, type Stored } from "./api.ts";
import { ErrorNotice } from "./components/common.tsx";
import { useLocale, useT } from "./i18n.tsx";
import { useCanWrite } from "./write.tsx";

/**
 * A form over one stored record: the values the person is typing and the
 * stored record they came from. The save sends that record's revision as its
 * `baseRevision`, never the revision of a later reload, so a save over a
 * colleague's newer change is refused with `record_changed` instead of
 * overwriting it.
 */
export interface RecordForm<T, F> {
  /** The record the form came from; `undefined` for a new record. */
  base: Stored<T> | undefined;
  form: F;
  /** The change under the form the person chose to keep editing past. */
  dismissed: string | null;
}

/** How the record stored now differs from the one the form came from. */
export type Drift = "none" | "changed" | "gone";

export function driftOf<T>(base: Stored<T> | undefined, current: Stored<T> | undefined): Drift {
  if (!base) return "none";
  if (!current) return "gone";
  return current.revision === base.revision ? "none" : "changed";
}

/** A form opened afresh on the record as it is stored now. */
export function openForm<T, F>(
  current: Stored<T> | undefined,
  formOf: (value: T | undefined) => F,
): RecordForm<T, F> {
  return { base: current, form: formOf(current?.value), dismissed: null };
}

/** Whether the person changed a value since the form came from its record. */
export function isTouched<T, F>(
  state: RecordForm<T, F>,
  formOf: (value: T | undefined) => F,
): boolean {
  return canonicalJson(state.form) !== canonicalJson(formOf(state.base?.value));
}

/**
 * What a reload of the data does to an open form. A form the person has not
 * touched follows the record, so it shows what is stored now; a touched one
 * keeps its values and the revision it came from, and the page shows that
 * the record changed under it.
 */
export function followRecord<T, F>(
  state: RecordForm<T, F>,
  current: Stored<T> | undefined,
  formOf: (value: T | undefined) => F,
): RecordForm<T, F> {
  if (driftOf(state.base, current) === "none") return state;
  return isTouched(state, formOf) ? state : openForm(current, formOf);
}

/**
 * The form after a save answered. The fields stay editable while a save
 * waits, so the person may have typed on: when the values are still the ones
 * sent, the form continues from what was stored; when they changed meanwhile,
 * they stay as typed on top of the stored record, whose revision the next
 * save sends, and the form shows them as not yet saved.
 */
export function afterSave<T, F>(
  state: RecordForm<T, F>,
  stored: Stored<T>,
  submitted: F,
  formOf: (value: T | undefined) => F,
): RecordForm<T, F> {
  if (canonicalJson(state.form) === canonicalJson(submitted)) return openForm(stored, formOf);
  return { base: stored, form: state.form, dismissed: null };
}

/** The key of a change under the form, so keeping on editing past it hides only that one. */
function changeKey<T>(drift: Drift, current: Stored<T> | undefined): string | null {
  if (drift === "changed") return current?.revision ?? null;
  return drift === "gone" ? "gone" : null;
}

/** Whether an error is a save refused because the record changed meanwhile. */
export function isRecordChanged(error: unknown): boolean {
  return error instanceof ApiError && error.code === "record_changed";
}

/**
 * The state of a record's form across reloads of the data (see
 * `followRecord`): the base the save sends, the values, and whether the
 * record changed under touched values.
 */
export function useRecordForm<T, F>(
  current: Stored<T> | undefined,
  formOf: (value: T | undefined) => F,
) {
  const [held, setHeld] = useState<RecordForm<T, F>>(() => openForm(current, formOf));
  const state = followRecord(held, current, formOf);
  // An untouched form follows the record during this render.
  if (state !== held) setHeld(state);
  const drift = driftOf(state.base, current);
  const change = changeKey(drift, current);
  return {
    base: state.base,
    form: state.form,
    drift,
    /** The record changed under touched values and the person has not chosen to go on. */
    changed: change !== null && change !== state.dismissed,
    update: (patch: Partial<F>) =>
      setHeld((before) => ({ ...before, form: { ...before.form, ...patch } })),
    setForm: (form: F) => setHeld((before) => ({ ...before, form })),
    /** Keep the values and their revision; a save is refused until the current version is loaded. */
    keepEditing: () => setHeld((before) => ({ ...before, dismissed: change })),
    /** Drop the values and open the form on the record stored now. */
    loadCurrent: () => setHeld(openForm(current, formOf)),
    /**
     * After a save of `submitted`: the form continues from what was stored,
     * keeping what the person typed while the save waited (`afterSave`).
     */
    saved: (stored: Stored<T>, submitted: F) =>
      setHeld((before) => afterSave(before, stored, submitted, formOf)),
  };
}

/**
 * The notice of a record that changed under the form, or of a save refused
 * for it: the person's values stay, and they choose to load the current
 * version (which drops them) or keep editing.
 */
export function ChangedNotice({
  drift,
  refused,
  settings = false,
  onLoadCurrent,
  onKeepEditing,
}: {
  drift: Drift;
  refused: boolean;
  /** The form edits the settings, which the notice names as such. */
  settings?: boolean;
  onLoadCurrent: () => void;
  onKeepEditing: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const gone = drift === "gone";
  const what = gone
    ? t("Záznam mezitím zmizel.", "The record is gone meanwhile.")
    : settings
      ? t("Nastavení mezitím změnil někdo jiný.", "Someone else changed the settings meanwhile.")
      : t("Záznam mezitím změnil někdo jiný.", "Someone else changed the record meanwhile.");
  const title = refused ? `${t("Neuloženo.", "Not saved.")} ${what}` : what;
  return (
    <Alert
      tone={refused ? "danger" : "warning"}
      title={title}
      live={refused ? "assertive" : "polite"}
      locale={locale}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={onLoadCurrent}>
            {gone
              ? t("Zavřít formulář", "Close the form")
              : t("Načíst aktuální verzi", "Load the current version")}
          </Button>
          <Button variant="quiet" size="sm" onClick={onKeepEditing}>
            {t("Pokračovat v úpravách", "Keep editing")}
          </Button>
        </>
      }
    >
      <p>
        {t(
          "Vaše rozpracované úpravy zůstávají ve formuláři. Uložit je půjde až po načtení aktuální verze, které je zahodí; co chcete zachovat, si nejdřív zkopírujte.",
          "Your unsaved edits stay in the form. They can be saved only after loading the current version, which drops them; copy first what you want to keep.",
        )}
      </p>
    </Alert>
  );
}

/**
 * The notices at the top of a record's form: a refusal in words, and when
 * the record changed under the form or a save was refused for it, the
 * choice between the current version and the person's values.
 */
export function EditNotices({
  edit,
  error,
  onClear,
  settings = false,
}: {
  edit: Pick<
    ReturnType<typeof useRecordForm>,
    "base" | "drift" | "changed" | "loadCurrent" | "keepEditing"
  >;
  error: unknown;
  onClear: () => void;
  settings?: boolean;
}) {
  const canWrite = useCanWrite();
  // A new record has nothing to load: its refusal is said as it is.
  const refused = isRecordChanged(error) && edit.base !== undefined;
  return (
    <>
      {refused ? null : <ErrorNotice error={error} />}
      {canWrite && (edit.changed || refused) ? (
        <ChangedNotice
          drift={edit.drift}
          refused={refused}
          settings={settings}
          onLoadCurrent={() => {
            edit.loadCurrent();
            onClear();
          }}
          onKeepEditing={() => {
            edit.keepEditing();
            onClear();
          }}
        />
      ) : null}
    </>
  );
}
