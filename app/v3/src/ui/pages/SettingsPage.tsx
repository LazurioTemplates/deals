import { Alert, Badge, Button, Switch, Tabs } from "design-system/react";
import { type ReactNode, useRef, useState } from "react";
import { slugify } from "../../domain/common.ts";
import { formatBasisPoints, parseScaled } from "../../domain/money.ts";
import { termsBlocks } from "../../domain/quote.ts";
import type { BillingEntity, LossReason, Settings, Stage } from "../../domain/settings.ts";
import type { Locale } from "../../i18n/locale.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { EditNotices, isRecordChanged, useRecordForm } from "../edit.tsx";
import { type CountWords, useLocale, useT } from "../i18n.tsx";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

export interface StageRow extends Omit<Stage, "probability"> {
  probability: string;
}

/** A row of a list in the settings; `id` is empty until a new row is saved. */
export interface NamedRow {
  key: string;
  id: string;
  label: string;
}

const ENTITY_TEXTS = [
  "name",
  "ico",
  "dic",
  "street",
  "postalCode",
  "city",
  "country",
  "email",
  "phone",
  "website",
  "bankAccount",
] as const;
type EntityText = (typeof ENTITY_TEXTS)[number];

export type EntityRow = { key: string; id: string } & Record<EntityText, string>;

export interface SettingsForm {
  stages: StageRow[];
  reasons: LossReason[];
  currency: string;
  ares: boolean;
  types: NamedRow[];
  entities: EntityRow[];
  vatRate: string;
  validityDays: string;
  sections: NamedRow[];
  units: string;
  vatNote: string;
  payments: string;
  scope: string;
  termsVersion: string;
  termsUrl: string;
  dueDays: string;
}

/** A VAT rate in basis points as a person writes it: `2100` → `21`, `1250` → `12,5`. */
function percentText(basisPoints: number, locale: Locale): string {
  return formatBasisPoints(basisPoints, locale).replace(/\s?%$/, "");
}

function entityRowOf(entity: BillingEntity): EntityRow {
  return {
    key: `id:${entity.id}`,
    id: entity.id,
    name: entity.name,
    ico: entity.ico ?? "",
    dic: entity.dic ?? "",
    street: entity.address?.street ?? "",
    postalCode: entity.address?.postalCode ?? "",
    city: entity.address?.city ?? "",
    country: entity.address?.country ?? "",
    email: entity.email ?? "",
    phone: entity.phone ?? "",
    website: entity.website ?? "",
    bankAccount: entity.bankAccount ?? "",
  };
}

export function settingsFormOf(
  settings: Settings | undefined,
  locale: Locale = "cs",
): SettingsForm {
  const quotes = settings?.quotes;
  return {
    stages: (settings?.stages ?? []).map((stage) => ({
      ...stage,
      probability: String(stage.probability),
    })),
    reasons: (settings?.lossReasons ?? []).map((reason) => ({ ...reason })),
    currency: settings?.currency ?? "",
    ares: settings?.aresLookup ?? false,
    types: (settings?.dealTypes ?? []).map((type) => ({
      key: `id:${type.id}`,
      id: type.id,
      label: type.label,
    })),
    entities: (settings?.billingEntities ?? []).map(entityRowOf),
    vatRate: quotes ? percentText(quotes.vatRate, locale) : "",
    validityDays: quotes ? String(quotes.validityDays) : "",
    sections: (quotes?.sections ?? []).map((section) => ({
      key: `id:${section.id}`,
      id: section.id,
      label: section.label,
    })),
    units: (quotes?.units ?? []).join("\n"),
    vatNote: quotes?.terms?.vatNote ?? "",
    payments: quotes?.terms?.payments ?? "",
    scope: quotes?.terms?.scope ?? "",
    termsVersion: quotes?.termsVersion ?? "",
    termsUrl: quotes?.termsUrl ?? "",
    dueDays: settings ? String(settings.paymentDueDays) : "",
  };
}

/** A new id from a label that no other entry has: `jednani`, `jednani-2`. */
export function freshId(label: string, taken: readonly string[], fallback: string): string {
  const base = slugify(label) || fallback;
  let id = base;
  for (let index = 2; taken.includes(id); index += 1) id = `${base}-${index}`;
  return id;
}

/** A stage's probability as written, or `null` while it is no whole number from 0 to 100. */
export function probabilityOf(row: StageRow): number | null {
  const value = Number(row.probability);
  return row.probability.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/** A whole number in a range as written, or `null`. */
function wholeIn(text: string, min: number, max: number): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** The VAT rate as written in basis points, or `null` while it is no rate from 0 to 100 %. */
export function vatRateOf(text: string, locale: Locale = "cs"): number | null {
  const value = parseScaled(text, 2, locale);
  return value !== null && value >= 0 && value <= 10_000 ? value : null;
}

/** The ids of rows; a new row gets one from its label that no other row has. */
function idsOf(rows: readonly { id: string; label: string }[], fallback: string): string[] {
  const taken = rows.map((row) => row.id).filter(Boolean);
  return rows.map((row) => {
    if (row.id) return row.id;
    const id = freshId(row.label, taken, fallback);
    taken.push(id);
    return id;
  });
}

const unitsOf = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

/**
 * Sends the settings' form as a change of the settings it came from, with
 * their revision as the base.
 */
export function submitSettings(base: Stored<Settings>, form: SettingsForm, locale: Locale = "cs") {
  const { dealTypes: _types, billingEntities: _entities, ...rest } = base.value;
  const trimmed = (value: string) => value.trim();
  const optional = <K extends string>(key: K, value: string) =>
    trimmed(value) ? ({ [key]: trimmed(value) } as Record<K, string>) : {};
  const typeIds = idsOf(form.types, "type");
  const entityIds = idsOf(
    form.entities.map((row) => ({ id: row.id, label: row.name })),
    "entity",
  );
  const sectionIds = idsOf(form.sections, "section");
  const entities = form.entities.map((row, index): BillingEntity => {
    const address = Object.fromEntries(
      (["street", "city", "postalCode", "country"] as const).flatMap((key) =>
        trimmed(row[key]) ? [[key, trimmed(row[key])]] : [],
      ),
    );
    return {
      id: entityIds[index] as string,
      name: trimmed(row.name),
      ...(trimmed(row.ico) ? { ico: trimmed(row.ico).replace(/\s/g, "") } : {}),
      ...optional("dic", row.dic),
      ...(Object.keys(address).length > 0 ? { address } : {}),
      ...optional("email", row.email),
      ...optional("phone", row.phone),
      ...optional("website", row.website),
      ...optional("bankAccount", row.bankAccount),
    };
  });
  const terms = {
    ...optional("vatNote", form.vatNote),
    ...optional("payments", form.payments),
    ...optional("scope", form.scope),
  };
  const record: Settings = {
    ...rest,
    currency: form.currency,
    stages: form.stages.map((row) => ({
      id: row.id,
      label: row.label.trim(),
      kind: row.kind,
      probability: probabilityOf(row) ?? 0,
    })),
    lossReasons: form.reasons.map((reason) => ({ id: reason.id, label: reason.label.trim() })),
    ...(form.types.length > 0
      ? {
          dealTypes: form.types.map((row, index) => ({
            id: typeIds[index] as string,
            label: row.label.trim(),
          })),
        }
      : {}),
    ...(entities.length > 0 ? { billingEntities: entities } : {}),
    quotes: {
      vatRate: vatRateOf(form.vatRate, locale) ?? 0,
      validityDays: wholeIn(form.validityDays, 1, 365) ?? 30,
      sections: form.sections.map((row, index) => ({
        id: sectionIds[index] as string,
        label: row.label.trim(),
      })),
      units: unitsOf(form.units),
      ...(Object.keys(terms).length > 0 ? { terms } : {}),
      ...optional("termsVersion", form.termsVersion),
      ...optional("termsUrl", form.termsUrl),
    },
    paymentDueDays: wholeIn(form.dueDays, 0, 365) ?? 0,
    aresLookup: form.ares,
  };
  return api.saveSettings(record, base.revision);
}

/** Terms as a quote prints them: headings, paragraphs and bullets of the light markup. */
function TermsPreview({ title, source }: { title: string; source: string }) {
  const blocks = termsBlocks(source);
  if (blocks.length === 0) return null;
  return (
    <section className="terms-preview-part">
      <h4>{title}</h4>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") return <h5 key={key}>{block.text}</h5>;
        if (block.kind === "list") {
          return (
            <ul key={key}>
              {block.items.map((item, at) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a read-only preview; a bullet may repeat
                <li key={`${at}-${item}`}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{block.text}</p>;
      })}
    </section>
  );
}

const RECORDS: CountWords = {
  cs: { one: "záznam", few: "záznamy", many: "záznamů" },
  en: { one: "record", other: "records" },
};

type Section = "stages" | "reasons" | "types" | "entities" | "sections";

/**
 * The settings of the pipeline: the stages in their order with their names
 * and probabilities, the loss reasons, the types of deals, the entities that
 * invoice, what a new quote starts with, the currency, the days an invoice
 * is due and the ARES lookup. One record, saved with the revision it came
 * from. A stage, a reason, a type or an entity something uses stays: the
 * page says why, and the rules refuse it on saving too.
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
  // The form keeps the settings it came from: a reload of the data never
  // replaces what the person is typing, and the save sends that revision.
  const edit = useRecordForm<Settings, SettingsForm>(data.settings, (value) =>
    settingsFormOf(value, locale),
  );
  const form = edit.form;
  const { stages, reasons, types, entities, sections } = form;
  const update = edit.update;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refusal, setRefusal] = useState<{ section: Section; text: string } | null>(null);
  const [tab, setTab] = useState("settings-pipeline");
  const counter = useRef(0);
  const newKey = () => {
    counter.current += 1;
    return `new-${counter.current}`;
  };
  const errors = fieldErrors(error);

  // What uses an id now: deals, manual forecast rows and quotes.
  const named = [
    ...data.deals.map((entry) => entry.value),
    ...data.forecastEntries.map((entry) => entry.value),
    ...data.quotes.map((entry) => entry.value),
  ] as { stageId?: string; lossReasonId?: string; dealTypeId?: string; billingEntityId?: string }[];
  const uses = (pick: (entry: (typeof named)[number]) => string | undefined, id: string) =>
    id ? named.filter((entry) => pick(entry) === id).length : 0;
  const problems: string[] = [];
  if (stages.some((row) => !row.label.trim() || probabilityOf(row) === null))
    problems.push(
      t(
        "fáze potřebují název a pravděpodobnost 0–100",
        "stages need a name and a probability of 0–100",
      ),
    );
  if (reasons.length === 0 || reasons.some((reason) => !reason.label.trim()))
    problems.push(t("důvody ztráty potřebují název", "loss reasons need a name"));
  if (types.some((row) => !row.label.trim()))
    problems.push(t("typy zakázek potřebují název", "deal types need a name"));
  if (entities.some((row) => !row.name.trim()))
    problems.push(t("fakturační firmy potřebují název", "billing entities need a name"));
  if (entities.some((row) => row.ico.trim() && !/^[0-9]{8}$/.test(row.ico.replace(/\s/g, ""))))
    problems.push(
      t("IČO fakturační firmy má osm číslic", "a billing entity's company ID has eight digits"),
    );
  if (vatRateOf(form.vatRate, locale) === null)
    problems.push(t("sazba DPH je 0–100 %", "the VAT rate is 0–100%"));
  if (wholeIn(form.validityDays, 1, 365) === null)
    problems.push(t("platnost nabídky je 1–365 dní", "a quote is valid for 1–365 days"));
  if (sections.length === 0 || sections.some((row) => !row.label.trim()))
    problems.push(
      t(
        "nabídka potřebuje aspoň jednu pojmenovanou sekci",
        "a quote needs at least one named section",
      ),
    );
  if (unitsOf(form.units).length === 0)
    problems.push(t("nabídka potřebuje aspoň jednu jednotku", "a quote needs at least one unit"));
  if (wholeIn(form.dueDays, 0, 365) === null)
    problems.push(t("splatnost je 0–365 dní", "the due days are 0–365"));
  if (!/^[A-Z]{3}$/.test(form.currency))
    problems.push(t("měna je kód ISO 4217", "the currency is an ISO 4217 code"));
  const invalid = problems.length > 0;

  /** Removes a row unless something uses it; then the page says why. */
  const removeRow = <R,>(
    section: Section,
    rows: R[],
    index: number,
    count: number,
    what: string,
    set: (next: R[]) => void,
  ) => {
    if (count > 0) {
      setRefusal({
        section,
        text: t(
          `${what} se používá (${t.count(count, RECORDS)}). Nejde odebrat; nejdřív to u těchto záznamů změňte.`,
          `${what} is in use (${t.count(count, RECORDS)}). It cannot be removed; change it on those records first.`,
        ),
      });
      return;
    }
    setRefusal(null);
    set(rows.filter((_, at) => at !== index));
  };
  const refusalOf = (section: Section) =>
    refusal?.section === section ? (
      <Alert tone="warning" live="polite" locale={locale}>
        {refusal.text}
      </Alert>
    ) : null;

  const moveStage = (index: number, by: -1 | 1) => {
    const next = [...stages];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + by, 0, row);
    update({ stages: next });
  };
  const editStage = (index: number, patch: Partial<StageRow>) =>
    update({ stages: stages.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
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
    update({ stages: next });
  };
  const addReason = () => {
    const label = t("Jiný důvod", "Another reason");
    update({
      reasons: [
        ...reasons,
        {
          id: freshId(
            label,
            reasons.map((reason) => reason.id),
            "reason",
          ),
          label,
        },
      ],
    });
  };
  const editNamed = (key: "types" | "sections", index: number, label: string) =>
    update({ [key]: form[key].map((row, at) => (at === index ? { ...row, label } : row)) });
  const editEntity = (index: number, patch: Partial<EntityRow>) =>
    update({ entities: entities.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  const makeDefault = (index: number) => {
    const next = [...entities];
    const [row] = next.splice(index, 1);
    if (row) update({ entities: [row, ...next] });
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    setRefusal(null);
    try {
      const submitted = edit.form;
      edit.saved(await submitSettings(edit.base ?? data.settings, submitted, locale), submitted);
      await onChanged();
      setSaved(true);
    } catch (caught) {
      // The settings stored now, so the person can load them; their values stay.
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const removeButton = (onClick: () => void, disabled = false) => (
    <Button variant="quiet" size="sm" disabled={disabled} onClick={onClick}>
      {t("Odebrat", "Remove")}
    </Button>
  );

  const pipeline = (
    <div className="settings-panel">
      <article className="ds-card">
        <h2>{t("Fáze pipeline", "Pipeline stages")}</h2>
        <p className="muted small">
          {t(
            "V pořadí, v jakém jimi případ prochází. Vyhraná a ztracená fáze zůstávají vždy; pravděpodobnost otevřené fáze je výchozí šance případu.",
            "In the order a deal goes through them. The won and the lost stage always stay; the probability of an open stage is a deal's default chance.",
          )}
        </p>
        {refusalOf("stages")}
        <ol className="stage-rows">
          {stages.map((row, index) => {
            const closed = row.kind !== "open";
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
                    onClick={() => moveStage(index, -1)}
                  />
                  <Button
                    variant="quiet"
                    size="sm"
                    iconOnly
                    icon="nav-arrow-down"
                    label={t("Posunout níž", "Move down")}
                    disabled={index === stages.length - 1}
                    onClick={() => moveStage(index, 1)}
                  />
                  {closed
                    ? null
                    : removeButton(
                        () =>
                          removeRow(
                            "stages",
                            stages,
                            index,
                            uses((entry) => entry.stageId, row.id),
                            t(`Fáze ${row.label}`, `The stage ${row.label}`),
                            (next) => update({ stages: next }),
                          ),
                        stages.filter((other) => other.kind === "open").length < 2,
                      )}
                </span>
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" size="sm" icon="plus" onClick={addStage}>
          {t("Přidat otevřenou fázi", "Add an open stage")}
        </Button>
      </article>

      <article className="ds-card">
        <h2>{t("Důvody ztráty", "Loss reasons")}</h2>
        {refusalOf("reasons")}
        <ul className="reason-rows">
          {reasons.map((reason, index) => (
            <li key={reason.id} className="reason-row">
              <input
                className="ds-input"
                value={reason.label}
                aria-label={t(`Důvod ${index + 1}`, `Reason ${index + 1}`)}
                onChange={(event) =>
                  update({
                    reasons: reasons.map((other, at) =>
                      at === index ? { ...other, label: event.target.value } : other,
                    ),
                  })
                }
              />
              {removeButton(
                () =>
                  removeRow(
                    "reasons",
                    reasons,
                    index,
                    uses((entry) => entry.lossReasonId, reason.id),
                    t(`Důvod ${reason.label}`, `The reason ${reason.label}`),
                    (next) => update({ reasons: next }),
                  ),
                reasons.length < 2,
              )}
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" icon="plus" onClick={addReason}>
          {t("Přidat důvod", "Add a reason")}
        </Button>
      </article>
    </div>
  );

  const business = (
    <div className="settings-panel">
      <article className="ds-card">
        <h2>{t("Typy zakázek", "Deal types")}</h2>
        <p className="muted small">
          {t(
            "Případ a řádek forecastu může uvést typ; přehledy podle něj filtrují.",
            "A deal and a forecast row may name a type; the overviews filter by it.",
          )}
        </p>
        {refusalOf("types")}
        {types.length === 0 ? (
          <p className="muted">{t("Zatím žádný typ.", "No type yet.")}</p>
        ) : (
          <ul className="reason-rows">
            {types.map((row, index) => (
              <li key={row.key} className="reason-row">
                <input
                  className="ds-input"
                  value={row.label}
                  aria-label={t(`Typ zakázky ${index + 1}`, `Deal type ${index + 1}`)}
                  onChange={(event) => editNamed("types", index, event.target.value)}
                />
                {removeButton(() =>
                  removeRow(
                    "types",
                    types,
                    index,
                    uses((entry) => entry.dealTypeId, row.id),
                    t(`Typ ${row.label}`, `The type ${row.label}`),
                    (next) => update({ types: next }),
                  ),
                )}
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => update({ types: [...types, { key: newKey(), id: "", label: "" }] })}
        >
          {t("Přidat typ", "Add a type")}
        </Button>
      </article>

      <article className="ds-card">
        <h2>{t("Fakturační firmy", "Billing entities")}</h2>
        <p className="muted small">
          {t(
            "Firmy Organizace, které vystavují nabídky a faktury. První v seznamu je výchozí: dostane ji nový případ i nabídka, která žádnou neuvádí.",
            "The Organization's entities that issue quotes and invoices. The first one is the default: a new deal and a quote that names none get it.",
          )}
        </p>
        {refusalOf("entities")}
        {entities.length === 0 ? (
          <p className="muted">{t("Zatím žádná firma.", "No entity yet.")}</p>
        ) : null}
        {entities.map((row, index) => {
          const at = (field: string) => errors[`billingEntities.${index}.${field}`];
          const field = (
            key: EntityText,
            label: string,
            wide = false,
            mode?: "email" | "tel" | "url" | "numeric",
          ) => (
            <Field
              label={label}
              error={at(
                key === "street" || key === "city" || key === "postalCode" || key === "country"
                  ? `address.${key}`
                  : key,
              )}
              wide={wide}
            >
              <input
                value={row[key]}
                inputMode={mode}
                autoComplete="off"
                onChange={(event) => editEntity(index, { [key]: event.target.value })}
              />
            </Field>
          );
          return (
            <section
              key={row.key}
              className="entity-block"
              aria-label={row.name || t("Nová fakturační firma", "New billing entity")}
            >
              <div className="entity-head">
                <strong className="entity-name">
                  {row.name || t("Nová fakturační firma", "New billing entity")}
                </strong>
                {index === 0 ? (
                  <Badge tone="accent" icon={false}>
                    {t("Výchozí", "Default")}
                  </Badge>
                ) : null}
                <span className="entity-actions">
                  {index > 0 ? (
                    <Button variant="quiet" size="sm" onClick={() => makeDefault(index)}>
                      {t("Nastavit jako výchozí", "Make it the default")}
                    </Button>
                  ) : null}
                  {removeButton(() =>
                    removeRow(
                      "entities",
                      entities,
                      index,
                      uses((entry) => entry.billingEntityId, row.id),
                      t(`Fakturační firma ${row.name}`, `The billing entity ${row.name}`),
                      (next) => update({ entities: next }),
                    ),
                  )}
                </span>
              </div>
              <div className="form-grid">
                {field("name", t("Název", "Name"), true)}
                {field("ico", t("IČO", "Company ID"), false, "numeric")}
                {field("dic", t("DIČ", "VAT ID"))}
                {field("street", t("Ulice a číslo", "Street and number"), true)}
                {field("postalCode", t("PSČ", "Postal code"))}
                {field("city", t("Obec", "City"))}
                {field("country", t("Stát", "Country"))}
                {field("email", t("E-mail", "E-mail"), false, "email")}
                {field("phone", t("Telefon", "Phone"), false, "tel")}
                {field("website", t("Web", "Website"), false, "url")}
                {field("bankAccount", t("Bankovní účet", "Bank account"))}
              </div>
            </section>
          );
        })}
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() =>
            update({
              entities: [
                ...entities,
                {
                  key: newKey(),
                  id: "",
                  ...(Object.fromEntries(ENTITY_TEXTS.map((key) => [key, ""])) as Record<
                    EntityText,
                    string
                  >),
                },
              ],
            })
          }
        >
          {t("Přidat fakturační firmu", "Add a billing entity")}
        </Button>
      </article>
    </div>
  );

  const termsPreview = [
    { title: t("Poznámka k DPH", "Note on VAT"), source: form.vatNote },
    { title: t("Platby a zálohy", "Payments and deposits"), source: form.payments },
    { title: t("Rozsah a další podmínky", "Scope and other terms"), source: form.scope },
  ];
  const quotes = (
    <div className="settings-panel">
      <article className="ds-card">
        <h2>{t("Výchozí hodnoty nabídky", "Quote defaults")}</h2>
        <p className="muted small">
          {t(
            "S čím začíná nová nabídka. Hotové nabídky se nemění.",
            "What a new quote starts with. Existing quotes stay as they are.",
          )}
        </p>
        <div className="form-grid">
          <Field label={t("Sazba DPH v %", "VAT rate in %")} error={errors["quotes.vatRate"]}>
            <input
              value={form.vatRate}
              inputMode="decimal"
              autoComplete="off"
              onChange={(event) => update({ vatRate: event.target.value })}
            />
          </Field>
          <Field
            label={t("Platnost nabídky ve dnech", "Valid for days")}
            error={errors["quotes.validityDays"]}
          >
            <input
              value={form.validityDays}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => update({ validityDays: event.target.value })}
            />
          </Field>
          <Field
            label={t("Jednotky", "Units")}
            hint={t("Jedna na řádek, třeba ks, h, MD.", "One a line, such as pcs, h, MD.")}
            error={errors["quotes.units"]}
          >
            <textarea
              rows={4}
              value={form.units}
              onChange={(event) => update({ units: event.target.value })}
            />
          </Field>
        </div>
        <h3>{t("Sekce nabídky", "Quote sections")}</h3>
        {refusalOf("sections")}
        <ul className="reason-rows">
          {sections.map((row, index) => (
            <li key={row.key} className="reason-row">
              <input
                className="ds-input"
                value={row.label}
                aria-label={t(`Sekce ${index + 1}`, `Section ${index + 1}`)}
                onChange={(event) => editNamed("sections", index, event.target.value)}
              />
              {removeButton(
                () => update({ sections: sections.filter((_, at) => at !== index) }),
                sections.length < 2,
              )}
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => update({ sections: [...sections, { key: newKey(), id: "", label: "" }] })}
        >
          {t("Přidat sekci", "Add a section")}
        </Button>
      </article>

      <article className="ds-card">
        <h2>{t("Obchodní podmínky", "Commercial terms")}</h2>
        <p className="muted small">
          {t(
            "Řádek „## Nadpis“ je nadpis, řádek „- položka“ odrážka, prázdný řádek nový odstavec.",
            "A line „## Heading“ is a heading, a line „- item“ a bullet, an empty line a new paragraph.",
          )}
        </p>
        <div className="terms-layout">
          <div className="terms-fields">
            <Field
              label={t("Poznámka k DPH", "Note on VAT")}
              error={errors["quotes.terms.vatNote"]}
            >
              <textarea
                rows={3}
                value={form.vatNote}
                onChange={(event) => update({ vatNote: event.target.value })}
              />
            </Field>
            <Field
              label={t("Platby a zálohy", "Payments and deposits")}
              error={errors["quotes.terms.payments"]}
            >
              <textarea
                rows={6}
                value={form.payments}
                onChange={(event) => update({ payments: event.target.value })}
              />
            </Field>
            <Field
              label={t("Rozsah a další podmínky", "Scope and other terms")}
              error={errors["quotes.terms.scope"]}
            >
              <textarea
                rows={6}
                value={form.scope}
                onChange={(event) => update({ scope: event.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field
                label={t("Verze podmínek", "Terms version")}
                error={errors["quotes.termsVersion"]}
              >
                <input
                  value={form.termsVersion}
                  autoComplete="off"
                  onChange={(event) => update({ termsVersion: event.target.value })}
                />
              </Field>
              <Field label={t("Adresa podmínek", "Terms URL")} error={errors["quotes.termsUrl"]}>
                <input
                  value={form.termsUrl}
                  inputMode="url"
                  autoComplete="off"
                  onChange={(event) => update({ termsUrl: event.target.value })}
                />
              </Field>
            </div>
          </div>
          <aside className="terms-preview" aria-label={t("Náhled podmínek", "Terms preview")}>
            <p className="eyebrow">{t("Náhled v nabídce", "Preview on a quote")}</p>
            {termsPreview.some((part) => part.source.trim()) ? (
              termsPreview.map((part) => <TermsPreview key={part.title} {...part} />)
            ) : (
              <p className="muted small">{t("Zatím žádný text.", "No text yet.")}</p>
            )}
            {form.termsVersion.trim() || form.termsUrl.trim() ? (
              <p className="muted small">
                {[
                  form.termsVersion.trim() &&
                    t(`Verze ${form.termsVersion.trim()}`, `Version ${form.termsVersion.trim()}`),
                  form.termsUrl.trim(),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </aside>
        </div>
      </article>
    </div>
  );

  const general = (
    <div className="settings-panel">
      <article className="ds-card">
        <h2>{t("Obecné", "General")}</h2>
        <div className="form-grid">
          <Field
            label={t("Měna", "Currency")}
            hint={t("Kód ISO 4217, třeba CZK nebo EUR.", "An ISO 4217 code, such as CZK or EUR.")}
            error={errors.currency}
          >
            <input
              value={form.currency}
              maxLength={3}
              autoComplete="off"
              onChange={(event) => update({ currency: event.target.value.toUpperCase() })}
            />
          </Field>
          <Field
            label={t("Splatnost faktury ve dnech", "Invoice due in days")}
            hint={t(
              "Platí, pokud firma nemá vlastní splatnost.",
              "Applies unless a company has its own.",
            )}
            error={errors.paymentDueDays}
          >
            <input
              value={form.dueDays}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => update({ dueDays: event.target.value })}
            />
          </Field>
          <div className="field-wide">
            <Switch
              id="ares-lookup"
              label={t(
                "Dohledávat firmy v ARES podle IČO (dotaz jde přes server aplikace)",
                "Look companies up in ARES by their company ID (the App's server asks)",
              )}
              checked={form.ares}
              onChange={(event) => update({ ares: event.target.checked })}
            />
          </div>
        </div>
      </article>
      <article className="ds-card">
        <h2>{t("Obchodníci", "Salespeople")}</h2>
        <p className="muted small">
          {t(
            "Obchodníci mají vlastní stránku: tam je přidáte, upravíte nebo označíte jako neaktivní.",
            "The salespeople have a page of their own: add, edit or mark them inactive there.",
          )}
        </p>
        <div>
          <Button variant="secondary" size="sm" href={href({ page: "salespeople" })}>
            {t("Otevřít Obchodníky", "Open Salespeople")}
          </Button>
        </div>
      </article>
    </div>
  );

  // A refusal names fields of every tab; each tab shows how many are its.
  const issueCount = (prefixes: readonly string[]) => {
    const count = Object.keys(errors).filter((path) =>
      prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)),
    ).length;
    return count > 0 ? String(count) : undefined;
  };
  const tabs: { id: string; label: string; badge?: string; panel: ReactNode }[] = [
    {
      id: "settings-pipeline",
      label: t("Pipeline", "Pipeline"),
      badge: issueCount(["stages", "lossReasons"]),
      panel: pipeline,
    },
    {
      id: "settings-business",
      label: t("Typy a firmy", "Types and entities"),
      badge: issueCount(["dealTypes", "billingEntities"]),
      panel: business,
    },
    {
      id: "settings-quotes",
      label: t("Nabídky", "Quotes"),
      badge: issueCount(["quotes"]),
      panel: quotes,
    },
    {
      id: "settings-general",
      label: t("Obecné", "General"),
      badge: issueCount(["currency", "paymentDueDays", "aresLookup"]),
      panel: general,
    },
  ];

  return (
    <section>
      <PageHeader
        title={t("Nastavení", "Settings")}
        subtitle={t(
          "Fáze pipeline, důvody ztráty, typy zakázek, fakturační firmy, výchozí hodnoty nabídky a splatnost. Změna se uloží jako koncept.",
          "The stages of the pipeline, the loss reasons, the deal types, the billing entities, the quote defaults and the due days. A change is saved as a draft.",
        )}
      />
      <form className="form form-wide" onSubmit={save}>
        <fieldset className="form-fieldset" disabled={!canWrite}>
          <EditNotices edit={edit} error={error} onClear={() => setError(null)} settings />
          {saved ? (
            <Alert tone="success" locale={locale}>
              {t("Uloženo do konceptu.", "Saved to the draft.")}
            </Alert>
          ) : null}
          <Tabs
            label={t("Části nastavení", "Parts of the settings")}
            items={tabs.map(({ id, label, badge }) =>
              badge ? { id, label, badge } : { id, label },
            )}
            panels={Object.fromEntries(tabs.map((entry) => [entry.id, entry.panel]))}
            selected={tab}
            onSelect={setTab}
          />
          {canWrite ? (
            <div className="form-actions settings-actions">
              <Button variant="primary" type="submit" busy={busy} disabled={invalid}>
                {t("Uložit do konceptu", "Save to the draft")}
              </Button>
              {invalid ? (
                <p className="muted small">
                  {t("Než uložíte: ", "Before saving: ")}
                  {problems.join("; ")}.
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      </form>
    </section>
  );
}
