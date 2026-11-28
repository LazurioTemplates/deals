import { Badge, Button, Checkbox } from "design-system/react";
import { useState } from "react";
import { ACTIVITY_TYPES, type Activity, type ActivityType } from "../../domain/activity.ts";
import { localToday } from "../../domain/common.ts";
import type { Deal } from "../../domain/deal.ts";
import type { Salesperson } from "../../domain/salesperson.ts";
import { openStages, type Settings, stageById } from "../../domain/settings.ts";
import type { Localized } from "../../i18n/locale.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { CloseDealDialog, MoveDeal } from "../components/CloseDeal.tsx";
import { ErrorNotice, Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { DealQuotesCard } from "../components/deals/DealQuotesCard.tsx";
import { PaymentPlanCard } from "../components/deals/PaymentPlanCard.tsx";
import { EditNotices, formLocked, isRecordChanged, useRecordForm } from "../edit.tsx";
import { type Format, useFormat, useT } from "../i18n.tsx";
import { useLookups } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { localDateTime, withOffset } from "../time.ts";
import { useCanWrite } from "../write.tsx";

export const ACTIVITY_LABELS: Record<ActivityType, Localized> = {
  call: { cs: "Hovor", en: "Call" },
  meeting: { cs: "Schůzka", en: "Meeting" },
  email: { cs: "E-mail", en: "E-mail" },
  note: { cs: "Poznámka", en: "Note" },
  task: { cs: "Úkol", en: "Task" },
};

interface DealForm {
  title: string;
  companyId: string;
  contactIds: string[];
  ownerId: string;
  stageId: string;
  dealTypeId: string;
  billingEntityId: string;
  value: string;
  probability: string;
  expectedClose: string;
  description: string;
}

/** What a new deal starts with beyond its company: its stage and its salesperson. */
export interface NewDealDefaults {
  stage?: string | null | undefined;
  ownerId?: string | undefined;
}

/**
 * The form of a deal as stored, or of a new one (of `company` and in the
 * open stage `stage` when the route names them).
 */
export function dealFormOf(
  deal: Deal | undefined,
  settings: Settings,
  f: Format,
  company: string | null,
  defaults: NewDealDefaults = {},
): DealForm {
  const open = openStages(settings);
  const stage = open.find((entry) => entry.id === defaults.stage)?.id ?? open[0]?.id ?? "";
  return {
    title: deal?.title ?? "",
    companyId: deal?.companyId ?? company ?? "",
    contactIds: deal?.contactIds ?? [],
    ownerId: deal?.ownerId ?? defaults.ownerId ?? "",
    stageId: deal?.stageId ?? stage,
    dealTypeId: deal?.dealTypeId ?? "",
    billingEntityId: deal?.billingEntityId ?? "",
    value: deal ? f.amount(deal.value) : "",
    probability: deal?.probability === undefined ? "" : String(deal.probability),
    expectedClose: deal?.expectedClose ?? "",
    description: deal?.description ?? "",
  };
}

/**
 * Sends a deal's form: a change of the deal the form came from, with that
 * deal's revision as the base, or a new deal. A closed deal keeps its stage;
 * it moves only through closing or reopening. While the deal follows a
 * quote, the server sets the value from that quote.
 */
export function submitDeal(
  base: Stored<Deal> | undefined,
  form: DealForm,
  settings: Settings,
  f: Format,
): Promise<Stored<Deal>> {
  const deal = base?.value;
  const open = !deal || stageById(settings, deal.stageId)?.kind === "open";
  const value = form.value.trim() === "" ? 0 : f.parseMoney(form.value);
  const probability = form.probability.trim() === "" ? undefined : Number(form.probability);
  const {
    probability: _p,
    expectedClose: _e,
    description: _d,
    contactIds: _c,
    dealTypeId: _t,
    billingEntityId: _b,
    ...kept
  } = deal ?? ({} as Partial<Deal>);
  const record = {
    ...kept,
    title: form.title.trim(),
    companyId: form.companyId,
    ownerId: form.ownerId,
    stageId: open ? form.stageId : (deal?.stageId ?? form.stageId),
    value: value ?? 0,
    ...(form.contactIds.length > 0 ? { contactIds: form.contactIds } : {}),
    ...(form.dealTypeId ? { dealTypeId: form.dealTypeId } : {}),
    ...(form.billingEntityId ? { billingEntityId: form.billingEntityId } : {}),
    ...(probability !== undefined ? { probability } : {}),
    ...(form.expectedClose ? { expectedClose: form.expectedClose } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
  return base && deal
    ? api.saveDeal({ ...record, id: deal.id, createdAt: deal.createdAt }, base.revision)
    : api.createDeal(record);
}

/** The salespeople a deal may name: the active ones, and its own even when they left. */
function salespeopleFor(all: readonly Stored<Salesperson>[], current: string): Salesperson[] {
  return all
    .map((entry) => entry.value)
    .filter((person) => person.active || person.id === current)
    .sort((left, right) => left.name.localeCompare(right.name, "cs"));
}

/** A deal's detail and its edit in one page, with its quotes, payments and activities. */
export function DealPage({
  data,
  id,
  company,
  stage: stageParam = null,
  onChanged,
  today = localToday(),
}: {
  data: AppData;
  id: string | null;
  company: string | null;
  stage?: string | null;
  onChanged: () => Promise<void>;
  today?: string;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const lookups = useLookups(data);
  const current = id ? data.deals.find((entry) => entry.value.id === id) : undefined;
  const open = openStages(settings);
  const firstActive = salespeopleFor(data.salespeople, "")[0]?.id;
  // The form keeps the deal it came from: a reload of the data never
  // replaces what the person is typing, and the save sends that revision.
  const edit = useRecordForm<Deal, DealForm>(current, (deal) =>
    dealFormOf(deal, settings, f, company, { stage: stageParam, ownerId: firstActive }),
  );
  const form = edit.form;
  // The page shows the deal as stored now; the form edits the one it came from.
  const stored = current ?? edit.base;
  const [closing, setClosing] = useState<"won" | "lost" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  if (id && !stored) {
    return (
      <section>
        <PageHeader title={t("Obchodní případ neexistuje", "This deal does not exist")} />
      </section>
    );
  }
  const stage = stored ? stageById(settings, stored.value.stageId) : undefined;
  const isOpen = !stored || stage?.kind === "open";
  const baseStage = edit.base ? stageById(settings, edit.base.value.stageId) : undefined;
  const formIsOpen = !edit.base || baseStage?.kind === "open";
  const primary = stored ? lookups.primaryQuoteOf(stored.value.id) : undefined;
  const followsQuote = primary !== undefined && primary.lines.length > 0;
  const value = form.value.trim() === "" ? 0 : f.parseMoney(form.value);
  const probability = form.probability.trim() === "" ? undefined : Number(form.probability);
  const probabilityProblem =
    probability !== undefined &&
    (!Number.isInteger(probability) || probability < 0 || probability > 100)
      ? t("Celé číslo od 0 do 100, nebo nic.", "A whole number from 0 to 100, or nothing.")
      : undefined;
  const valueProblem =
    !followsQuote && (value === null || value < 0)
      ? t("Částka, třeba 120 000 nebo 47 500,50.", "An amount, e.g. 120,000 or 47,500.50.")
      : undefined;
  const companyContacts = data.contacts.filter(
    (entry) => entry.value.companyId === form.companyId || form.contactIds.includes(entry.value.id),
  );
  const salespeople = salespeopleFor(data.salespeople, form.ownerId);
  const dealTypes = settings.dealTypes ?? [];
  const entities = settings.billingEntities ?? [];
  const reasons = new Map(settings.lossReasons.map((reason) => [reason.id, reason.label]));
  const won = settings.stages.find((entry) => entry.kind === "won");
  const lost = settings.stages.find((entry) => entry.kind === "lost");
  const update = edit.update;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (valueProblem || probabilityProblem) return;
    setBusy(true);
    setError(null);
    const opened = edit.base;
    try {
      const saved = await submitDeal(opened, form, settings, f);
      if (opened) edit.saved(saved, form);
      await onChanged();
      navigate({ page: "deal", id: saved.value.id });
    } catch (caught) {
      // The deal stored now, so the person can load it; their values stay.
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="deal-page">
      <PageHeader
        eyebrow={
          stored
            ? `${t("Obchodní případ", "Deal")} ${stored.value.id}`
            : t("Obchodní případy", "Deals")
        }
        title={stored ? stored.value.title : t("Nový obchodní případ", "New deal")}
        subtitle={
          stored ? (
            <span className="meta-row">
              <StageChip stage={stage} />
              <span className="num">{f.money(stored.value.value)}</span>
              {stored.value.closedAt ? (
                <span>
                  {t("uzavřeno", "closed")} {f.date(stored.value.closedAt)}
                </span>
              ) : null}
              {stored.value.lossReasonId ? (
                <span>
                  {t("důvod", "reason")}:{" "}
                  {reasons.get(stored.value.lossReasonId) ?? stored.value.lossReasonId}
                </span>
              ) : null}
            </span>
          ) : undefined
        }
        actions={
          stored && canWrite ? (
            <>
              {/* An open deal closes here; a closed one changes its closing in the dialog. */}
              {isOpen && won ? (
                <Button variant="primary" icon="check" onClick={() => setClosing("won")}>
                  {t("Označit jako vyhraný", "Mark as won")}
                </Button>
              ) : null}
              {isOpen && lost ? (
                <Button variant="secondary" onClick={() => setClosing("lost")}>
                  {t("Označit jako ztracený", "Mark as lost")}
                </Button>
              ) : null}
              {!isOpen && stage ? (
                <Button
                  variant="secondary"
                  onClick={() => setClosing(stage.kind as "won" | "lost")}
                >
                  {t("Upravit uzavření", "Edit the closing")}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {stored && closing && (closing === "won" ? won : lost) ? (
        <CloseDealDialog
          deal={stored}
          stage={(closing === "won" ? won : lost) as NonNullable<typeof won>}
          settings={settings}
          open
          onClose={() => setClosing(null)}
          onDone={onChanged}
          today={today}
          switchTo={
            isOpen
              ? undefined
              : closing === "won" && lost
                ? {
                    label: t("Byl nakonec ztracený", "It was lost after all"),
                    run: () => setClosing("lost"),
                  }
                : closing === "lost" && won
                  ? {
                      label: t("Byl nakonec vyhraný", "It was won after all"),
                      run: () => setClosing("won"),
                    }
                  : undefined
          }
        />
      ) : null}
      {stored?.value.lossNote ? <p className="loss-note">{stored.value.lossNote}</p> : null}
      <div className="detail-grid">
        <form className="form" onSubmit={save}>
          <fieldset
            className="form-fieldset"
            disabled={formLocked(canWrite, busy, edit.base === undefined)}
          >
            <EditNotices edit={edit} error={error} onClear={() => setError(null)} />
            <article className="ds-card">
              <div className="form-grid">
                <Field label={t("Název", "Title")} error={errors.title} wide>
                  <input
                    value={form.title}
                    required
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </Field>
                <Field
                  label={t("Firma", "Company")}
                  error={errors.companyId}
                  hint={
                    data.companies.length === 0
                      ? t("Nejdřív založte firmu.", "Create a company first.")
                      : undefined
                  }
                >
                  <select
                    value={form.companyId}
                    required
                    onChange={(event) => update({ companyId: event.target.value })}
                  >
                    <option value="" disabled>
                      {t("Vyberte firmu", "Choose a company")}
                    </option>
                    {data.companies.map((entry) => (
                      <option key={entry.value.id} value={entry.value.id}>
                        {entry.value.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="deal-owner-field">
                  <Field label={t("Obchodník", "Salesperson")} error={errors.ownerId}>
                    <select
                      value={form.ownerId}
                      required
                      onChange={(event) => update({ ownerId: event.target.value })}
                    >
                      <option value="" disabled>
                        {t("Vyberte obchodníka", "Choose a salesperson")}
                      </option>
                      {salespeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.active
                            ? person.name
                            : t(`${person.name} (neaktivní)`, `${person.name} (inactive)`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {canWrite && salespeople.length === 0 ? (
                    <a className="small" href={href({ page: "new-salesperson" })}>
                      {t("Založit obchodníka", "Add a salesperson")}
                    </a>
                  ) : null}
                </div>
                {formIsOpen ? (
                  <Field label={t("Fáze", "Stage")} error={errors.stageId}>
                    <select
                      value={form.stageId}
                      onChange={(event) => update({ stageId: event.target.value })}
                    >
                      {open.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label} ({f.rate(entry.probability * 100)})
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {dealTypes.length > 0 ? (
                  <Field label={t("Typ zakázky", "Deal type")} error={errors.dealTypeId}>
                    <select
                      value={form.dealTypeId}
                      onChange={(event) => update({ dealTypeId: event.target.value })}
                    >
                      <option value="">{t("Bez typu", "No type")}</option>
                      {dealTypes.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {entities.length > 1 ? (
                  <Field
                    label={t("Fakturační firma", "Billing entity")}
                    error={errors.billingEntityId}
                  >
                    <select
                      value={form.billingEntityId}
                      onChange={(event) => update({ billingEntityId: event.target.value })}
                    >
                      <option value="">
                        {t(
                          `Výchozí (${entities[0]?.name ?? ""})`,
                          `Default (${entities[0]?.name ?? ""})`,
                        )}
                      </option>
                      {entities.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {followsQuote && primary ? (
                  <div className="ds-field deal-value-quote">
                    <span className="ds-field__label">
                      {t(
                        `Hodnota bez DPH (${settings.currency})`,
                        `Value without VAT (${settings.currency})`,
                      )}
                    </span>
                    <span className="deal-value-amount num">
                      {f.money(lookups.quoteSubtotal(primary))}
                    </span>
                    <p className="ds-field__hint">
                      {t("Hodnota se řídí nabídkou", "The value follows the quote")}{" "}
                      <a href={href({ page: "quote", id: primary.id })}>
                        {primary.number} ·{" "}
                        {t(`revize ${primary.version}`, `rev. ${primary.version}`)}
                      </a>
                    </p>
                  </div>
                ) : (
                  <Field
                    label={t(
                      `Hodnota bez DPH (${settings.currency})`,
                      `Value without VAT (${settings.currency})`,
                    )}
                    error={valueProblem ?? errors.value}
                  >
                    <input
                      value={form.value}
                      inputMode="decimal"
                      autoComplete="off"
                      onChange={(event) => update({ value: event.target.value })}
                    />
                  </Field>
                )}
                <Field
                  label={t("Pravděpodobnost (%)", "Probability (%)")}
                  hint={t("Prázdné = podle fáze.", "Empty = the stage's.")}
                  error={probabilityProblem ?? errors.probability}
                >
                  <input
                    value={form.probability}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) => update({ probability: event.target.value })}
                  />
                </Field>
                <Field
                  label={t("Očekávané uzavření", "Expected close")}
                  error={errors.expectedClose}
                >
                  <input
                    type="date"
                    value={form.expectedClose}
                    onChange={(event) => update({ expectedClose: event.target.value })}
                  />
                </Field>
                <Field label={t("Popis", "Description")} wide>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(event) => update({ description: event.target.value })}
                  />
                </Field>
                <div className="ds-field field-wide">
                  <span className="ds-field__label">{t("Kontakty", "Contacts")}</span>
                  {companyContacts.length === 0 ? (
                    <p className="muted small">
                      {t("Firma zatím nemá kontakty.", "The company has no contacts yet.")}
                    </p>
                  ) : (
                    <ul className="check-list">
                      {companyContacts.map((entry) => (
                        <li key={entry.value.id}>
                          <Checkbox
                            id={`deal-contact-${entry.value.id}`}
                            label={
                              entry.value.role
                                ? `${entry.value.name} · ${entry.value.role}`
                                : entry.value.name
                            }
                            checked={form.contactIds.includes(entry.value.id)}
                            onChange={(event) =>
                              update({
                                contactIds: event.target.checked
                                  ? [...form.contactIds, entry.value.id]
                                  : form.contactIds.filter((other) => other !== entry.value.id),
                              })
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
            {canWrite ? (
              <div className={edit.touched ? "form-actions form-actions--pending" : "form-actions"}>
                {edit.touched ? (
                  <span className="form-actions-note">
                    {t("Neuložené změny", "Unsaved changes")}
                  </span>
                ) : null}
                <Button
                  variant="primary"
                  type="submit"
                  busy={busy}
                  disabled={
                    !form.title.trim() ||
                    !form.companyId ||
                    !form.ownerId ||
                    Boolean(valueProblem || probabilityProblem)
                  }
                >
                  {stored
                    ? t("Uložit do konceptu", "Save to the draft")
                    : t("Založit případ", "Create the deal")}
                </Button>
                {!stored ? (
                  <Button variant="quiet" href={href({ page: "new-company" })}>
                    {t("Nová firma", "New company")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        </form>
        {stored ? (
          <aside className="aside">
            {!isOpen ? (
              <article className="ds-card">
                <h2>{t("Znovu otevřít", "Reopen")}</h2>
                <MoveDeal
                  deal={stored}
                  settings={{ ...settings, stages: open }}
                  onChanged={onChanged}
                  label={t("Vrátit do otevřené fáze", "Back to an open stage")}
                />
              </article>
            ) : null}
            {stage?.kind === "won" ? (
              <PaymentPlanCard
                deal={stored}
                settings={settings}
                today={today}
                onChanged={onChanged}
              />
            ) : null}
            <DealQuotesCard data={data} deal={stored.value} onChanged={onChanged} />
            <Activities data={data} deal={stored} onChanged={onChanged} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}

const STRIP_TYPES = ["call", "meeting", "note"] as const satisfies readonly ActivityType[];

const STRIP_LABELS: Record<(typeof STRIP_TYPES)[number], Localized> = {
  call: { cs: "Poslední hovor", en: "Last call" },
  meeting: { cs: "Poslední schůzka", en: "Last meeting" },
  note: { cs: "Poslední poznámka", en: "Last note" },
};

/** The days of the latest call, meeting and note, at a glance. */
function LatestActivities({ activities, f }: { activities: readonly Activity[]; f: Format }) {
  const t = useT();
  return (
    <dl className="activity-strip">
      {STRIP_TYPES.map((type) => {
        // The activities come newest first.
        const latest = activities.find((activity) => activity.type === type);
        return (
          <div key={type} className={latest ? undefined : "is-empty"}>
            <dt>{t.of(STRIP_LABELS[type])}</dt>
            <dd>
              {latest ? <time dateTime={latest.at}>{f.date(latest.at.slice(0, 10))}</time> : "–"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The activities of a deal, newest first, with a form for a new one. */
function Activities({
  data,
  deal,
  onChanged,
}: {
  data: AppData;
  deal: Stored<Deal>;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const f = useFormat(data.settings.value.currency);
  const activities = data.activities
    .filter((entry) => entry.value.dealId === deal.value.id)
    .sort((left, right) => Date.parse(right.value.at) - Date.parse(left.value.at));
  const contacts = new Map(data.contacts.map((entry) => [entry.value.id, entry.value.name]));
  const [type, setType] = useState<ActivityType>("call");
  const [at, setAt] = useState(() => localDateTime());
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const when = withOffset(at);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!when) return;
    setBusy(true);
    setError(null);
    try {
      await api.createActivity({
        dealId: deal.value.id,
        type,
        at: when,
        summary: summary.trim(),
        ...(deal.value.contactIds?.length ? { contactIds: deal.value.contactIds } : {}),
        ...(type === "task" ? { done: false } : {}),
      });
      setSummary("");
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(entry: Stored<Activity>) {
    setError(null);
    try {
      await api.saveActivity({ ...entry.value, done: !entry.value.done }, entry.revision);
      await onChanged();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <article className="ds-card">
      <h2>{t("Aktivity", "Activities")}</h2>
      <LatestActivities activities={activities.map((entry) => entry.value)} f={f} />
      <ErrorNotice error={error} />
      {canWrite ? (
        <form className="activity-form" onSubmit={add}>
          <div className="activity-form-row">
            <select
              className="ds-select"
              value={type}
              aria-label={t("Typ aktivity", "Type of activity")}
              onChange={(event) => setType(event.target.value as ActivityType)}
            >
              {ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t.of(ACTIVITY_LABELS[value])}
                </option>
              ))}
            </select>
            <input
              className="ds-input"
              type="datetime-local"
              value={at}
              aria-label={t("Kdy", "When")}
              onChange={(event) => setAt(event.target.value)}
            />
          </div>
          <input
            className="ds-input"
            value={summary}
            placeholder={t("Co se stalo nebo co je potřeba udělat", "What happened or what to do")}
            aria-label={t("Shrnutí", "Summary")}
            enterKeyHint="done"
            onChange={(event) => setSummary(event.target.value)}
          />
          <Button variant="secondary" type="submit" busy={busy} disabled={!summary.trim() || !when}>
            {t("Přidat aktivitu", "Add the activity")}
          </Button>
        </form>
      ) : null}
      {activities.length === 0 ? (
        <p className="muted">{t("Zatím žádná aktivita.", "No activity yet.")}</p>
      ) : (
        <ul className="timeline">
          {activities.map((entry) => {
            const activity = entry.value;
            return (
              <li key={activity.id} className={activity.done ? "timeline-done" : undefined}>
                <div className="timeline-head">
                  <Badge tone={activity.type === "task" ? "warning" : "neutral"} icon={false}>
                    {t.of(ACTIVITY_LABELS[activity.type])}
                  </Badge>
                  <time className="muted small" dateTime={activity.at}>
                    {f.dateTime(activity.at)}
                  </time>
                </div>
                {activity.type === "task" ? (
                  <Checkbox
                    id={`task-${activity.id}`}
                    label={activity.summary}
                    checked={activity.done === true}
                    disabled={!canWrite}
                    onChange={() => void toggle(entry)}
                  />
                ) : (
                  <p className="timeline-summary">{activity.summary}</p>
                )}
                {activity.contactIds?.length ? (
                  <p className="muted small">
                    {activity.contactIds
                      .map((contact) => contacts.get(contact) ?? contact)
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
