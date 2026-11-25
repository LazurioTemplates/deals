import { Button, Dialog, Icon } from "design-system/react";
import { useId, useState } from "react";
import { localToday } from "../../domain/common.ts";
import type { Deal } from "../../domain/deal.ts";
import type { Settings, Stage } from "../../domain/settings.ts";
import { api, type Stored } from "../api.ts";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import { useCanWrite } from "../write.tsx";
import { ErrorNotice, Field, fieldErrors } from "./common.tsx";

/**
 * Closing a deal asks what closing needs: won asks for the value and the day
 * it was won, lost for the reason from the settings, a note and the day.
 * The dialog saves the move as a draft; the rules on the server have the
 * last word (a won deal needs a value above zero).
 */
export function CloseDealDialog({
  deal,
  stage,
  settings,
  open,
  onClose,
  onDone,
  today = localToday(),
}: {
  deal: Stored<Deal>;
  stage: Stage;
  settings: Settings;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  today?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(settings.currency);
  const formId = useId();
  const won = stage.kind === "won";
  const [valueText, setValueText] = useState(() => f.amount(deal.value.value));
  const [closedAt, setClosedAt] = useState(deal.value.closedAt ?? today);
  const [reason, setReason] = useState(settings.lossReasons[0]?.id ?? "");
  const [note, setNote] = useState(deal.value.lossNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const value = f.parseMoney(valueText);
  const valueProblem =
    won && (value === null || value <= 0)
      ? t(
          "Vyhraný případ potřebuje hodnotu větší než nula.",
          "A won deal needs a value above zero.",
        )
      : undefined;
  const errors = fieldErrors(error);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (valueProblem) return;
    setBusy(true);
    setError(null);
    try {
      await api.moveDeal(deal.value.id, {
        stageId: stage.id,
        baseRevision: deal.revision,
        closedAt,
        ...(won ? { value: value ?? 0 } : { lossReasonId: reason, lossNote: note }),
      });
      await onDone();
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      id={`close-${formId.replace(/:/g, "")}`}
      title={won ? t("Vyhráno", "Won") : t("Ztraceno", "Lost")}
      description={deal.value.title}
      open={open}
      onClose={onClose}
      locale={locale}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button
            variant={won ? "primary" : "danger"}
            type="submit"
            form={formId}
            busy={busy}
            disabled={Boolean(valueProblem) || (!won && !reason)}
          >
            {won
              ? t("Označit jako vyhrané", "Mark as won")
              : t("Označit jako ztracené", "Mark as lost")}
          </Button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={submit}>
        <ErrorNotice error={error} />
        {won ? (
          <Field
            label={t(`Hodnota (${settings.currency})`, `Value (${settings.currency})`)}
            error={valueProblem ?? errors.value}
          >
            <input
              value={valueText}
              inputMode="decimal"
              autoComplete="off"
              onChange={(event) => setValueText(event.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label={t("Důvod ztráty", "Loss reason")} error={errors.lossReasonId}>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                {settings.lossReasons.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Poznámka", "Note")}>
              <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </>
        )}
        <Field label={t("Datum uzavření", "Closing date")} error={errors.closedAt}>
          <input
            type="date"
            value={closedAt}
            required
            onChange={(event) => setClosedAt(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Moves a deal to another stage: an open stage at once, won or lost through
 * the dialog that asks what closing needs.
 */
export function MoveDeal({
  deal,
  settings,
  onChanged,
  label,
}: {
  deal: Stored<Deal>;
  settings: Settings;
  onChanged: () => Promise<void>;
  label?: string;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const [closing, setClosing] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!canWrite) return null;
  const others = settings.stages.filter((stage) => stage.id !== deal.value.stageId);

  async function move(id: string) {
    const stage = settings.stages.find((entry) => entry.id === id);
    if (!stage) return;
    if (stage.kind !== "open") {
      setClosing(stage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.moveDeal(deal.value.id, { stageId: stage.id, baseRevision: deal.revision });
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="move-deal">
      <div className="ds-select-wrap">
        <select
          className="ds-select move-select"
          value=""
          disabled={busy}
          aria-label={label ?? t(`Přesunout ${deal.value.title}`, `Move ${deal.value.title}`)}
          onChange={(event) => void move(event.target.value)}
        >
          <option value="" disabled>
            {t("Do fáze…", "Move to…")}
          </option>
          {others.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
        <Icon name="nav-arrow-down" className="ds-select__chevron" />
      </div>
      <ErrorNotice error={error} title={t("Nepřesunuto.", "Not moved.")} />
      {closing ? (
        <CloseDealDialog
          deal={deal}
          stage={closing}
          settings={settings}
          open
          onClose={() => setClosing(null)}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}
