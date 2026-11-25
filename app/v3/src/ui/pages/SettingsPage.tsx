import { Alert, Button, Switch } from "design-system/react";
import { useState } from "react";
import { slugify } from "../../domain/common.ts";
import type { LossReason, Settings, Stage } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { api } from "../api.ts";
import { ErrorNotice, Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { useLocale, useT } from "../i18n.tsx";
import { useCanWrite } from "../write.tsx";

interface StageRow extends Omit<Stage, "probability"> {
  probability: string;
}

/** A new id from a label that no other entry has: `jednani`, `jednani-2`. */
export function freshId(label: string, taken: readonly string[], fallback: string): string {
  const base = slugify(label) || fallback;
  let id = base;
  for (let index = 2; taken.includes(id); index += 1) id = `${base}-${index}`;
  return id;
}

/**
 * The settings of the pipeline: the stages in their order with their names
 * and probabilities, the loss reasons, the currency, the salespeople and the
 * ARES lookup. The won and the lost stage stay; a stage or a reason a deal
 * uses cannot be removed (the rules say so on saving too).
 */
export function SettingsPage({
  data,
  onChanged,
}: {
  data: AppData;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const canWrite = useCanWrite();
  const stored = data.settings;
  const [stages, setStages] = useState<StageRow[]>(() =>
    stored.value.stages.map((stage) => ({ ...stage, probability: String(stage.probability) })),
  );
  const [reasons, setReasons] = useState<LossReason[]>(() =>
    stored.value.lossReasons.map((reason) => ({ ...reason })),
  );
  const [currency, setCurrency] = useState(stored.value.currency);
  const [owners, setOwners] = useState((stored.value.owners ?? []).join("\n"));
  const [ares, setAres] = useState(stored.value.aresLookup);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  const usedStages = new Set(data.deals.map((entry) => entry.value.stageId));
  const usedReasons = new Set(data.deals.flatMap((entry) => entry.value.lossReasonId ?? []));

  const probabilityOf = (row: StageRow) => {
    const value = Number(row.probability);
    return row.probability.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 100
      ? value
      : null;
  };
  const invalid =
    stages.some((row) => !row.label.trim() || probabilityOf(row) === null) ||
    reasons.length === 0 ||
    reasons.some((reason) => !reason.label.trim()) ||
    !/^[A-Z]{3}$/.test(currency);

  const move = (index: number, by: -1 | 1) => {
    const next = [...stages];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + by, 0, row);
    setStages(next);
  };
  const editStage = (index: number, patch: Partial<StageRow>) =>
    setStages(stages.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const addStage = () => {
    const label = t("Nová fáze", "New stage");
    const id = freshId(
      label,
      stages.map((row) => row.id),
      "stage",
    );
    const before = stages.findIndex((row) => row.kind !== "open");
    const next = [...stages];
    next.splice(before < 0 ? next.length : before, 0, {
      id,
      label,
      kind: "open",
      probability: "50",
    });
    setStages(next);
  };
  const addReason = () => {
    const label = t("Jiný důvod", "Another reason");
    setReasons([
      ...reasons,
      {
        id: freshId(
          label,
          reasons.map((reason) => reason.id),
          "reason",
        ),
        label,
      },
    ]);
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const list = owners
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const { owners: _owners, ...rest } = stored.value;
    const record: Settings = {
      ...rest,
      currency,
      stages: stages.map((row) => ({
        id: row.id,
        label: row.label.trim(),
        kind: row.kind,
        probability: probabilityOf(row) ?? 0,
      })),
      lossReasons: reasons.map((reason) => ({ id: reason.id, label: reason.label.trim() })),
      ...(list.length > 0 ? { owners: [...new Set(list)] } : {}),
      aresLookup: ares,
    };
    try {
      await api.saveSettings(record, stored.revision);
      await onChanged();
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        title={t("Nastavení", "Settings")}
        subtitle={t(
          "Fáze pipeline, důvody ztráty, měna a obchodníci. Změna se uloží jako koncept.",
          "The stages of the pipeline, the loss reasons, the currency and the salespeople. A change is saved as a draft.",
        )}
      />
      <form className="form form-wide" onSubmit={save}>
        <fieldset className="form-fieldset" disabled={!canWrite}>
          <ErrorNotice error={error} />
          {saved ? (
            <Alert tone="success" locale={locale}>
              {t("Uloženo do konceptu.", "Saved to the draft.")}
            </Alert>
          ) : null}

          <article className="ds-card">
            <h2>{t("Fáze pipeline", "Pipeline stages")}</h2>
            <p className="muted small">
              {t(
                "V pořadí, v jakém jimi případ prochází. Vyhraná a ztracená fáze zůstávají vždy; pravděpodobnost otevřené fáze je výchozí šance případu.",
                "In the order a deal goes through them. The won and the lost stage always stay; the probability of an open stage is a deal's default chance.",
              )}
            </p>
            <ol className="stage-rows">
              {stages.map((row, index) => {
                const closed = row.kind !== "open";
                const used = usedStages.has(row.id);
                return (
                  <li key={row.id} className="stage-row">
                    <span className="stage-kind">
                      <StageChip stage={{ ...row, probability: probabilityOf(row) ?? 0 }} />
                    </span>
                    <input
                      className="ds-input stage-label"
                      value={row.label}
                      aria-label={t(`Název fáze ${index + 1}`, `Name of stage ${index + 1}`)}
                      onChange={(event) => editStage(index, { label: event.target.value })}
                    />
                    <span className="stage-probability">
                      <input
                        className="ds-input"
                        value={row.probability}
                        inputMode="numeric"
                        disabled={closed}
                        aria-label={t(
                          `Pravděpodobnost fáze ${index + 1} v %`,
                          `Probability of stage ${index + 1} in %`,
                        )}
                        onChange={(event) => editStage(index, { probability: event.target.value })}
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                    <span className="stage-actions">
                      <Button
                        variant="quiet"
                        size="sm"
                        iconOnly
                        icon="nav-arrow-up"
                        label={t("Posunout výš", "Move up")}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      />
                      <Button
                        variant="quiet"
                        size="sm"
                        iconOnly
                        icon="nav-arrow-down"
                        label={t("Posunout níž", "Move down")}
                        disabled={index === stages.length - 1}
                        onClick={() => move(index, 1)}
                      />
                      {closed ? null : (
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={
                            used || stages.filter((other) => other.kind === "open").length < 2
                          }
                          title={
                            used
                              ? t("Fázi používá obchodní případ.", "A deal is in this stage.")
                              : undefined
                          }
                          onClick={() => setStages(stages.filter((_, at) => at !== index))}
                        >
                          {t("Odebrat", "Remove")}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" onClick={addStage}>
              {t("Přidat otevřenou fázi", "Add an open stage")}
            </Button>
          </article>

          <article className="ds-card">
            <h2>{t("Důvody ztráty", "Loss reasons")}</h2>
            <ul className="reason-rows">
              {reasons.map((reason, index) => (
                <li key={reason.id} className="reason-row">
                  <input
                    className="ds-input"
                    value={reason.label}
                    aria-label={t(`Důvod ${index + 1}`, `Reason ${index + 1}`)}
                    onChange={(event) =>
                      setReasons(
                        reasons.map((other, at) =>
                          at === index ? { ...other, label: event.target.value } : other,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={usedReasons.has(reason.id) || reasons.length < 2}
                    title={
                      usedReasons.has(reason.id)
                        ? t("Důvod používá obchodní případ.", "A deal names this reason.")
                        : undefined
                    }
                    onClick={() => setReasons(reasons.filter((_, at) => at !== index))}
                  >
                    {t("Odebrat", "Remove")}
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" onClick={addReason}>
              {t("Přidat důvod", "Add a reason")}
            </Button>
          </article>

          <article className="ds-card">
            <h2>{t("Obecné", "General")}</h2>
            <div className="form-grid">
              <Field
                label={t("Měna", "Currency")}
                hint={t(
                  "Kód ISO 4217, třeba CZK nebo EUR.",
                  "An ISO 4217 code, such as CZK or EUR.",
                )}
                error={errors.currency}
              >
                <input
                  value={currency}
                  maxLength={3}
                  autoComplete="off"
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                />
              </Field>
              <Field
                label={t("Obchodníci", "Salespeople")}
                hint={t(
                  "Jedno jméno na řádek. Případ může mít i jiné jméno, kontrola jen upozorní.",
                  "One name a line. A deal may name someone else; the check only warns.",
                )}
                error={errors.owners}
              >
                <textarea
                  rows={4}
                  value={owners}
                  onChange={(event) => setOwners(event.target.value)}
                />
              </Field>
              <div className="field-wide">
                <Switch
                  id="ares-lookup"
                  label={t(
                    "Dohledávat firmy v ARES podle IČO (dotaz jde přes server aplikace)",
                    "Look companies up in ARES by their company ID (the App's server asks)",
                  )}
                  checked={ares}
                  onChange={(event) => setAres(event.target.checked)}
                />
              </div>
            </div>
          </article>

          {canWrite ? (
            <div className="form-actions">
              <Button variant="primary" type="submit" busy={busy} disabled={invalid}>
                {t("Uložit do konceptu", "Save to the draft")}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </section>
  );
}
