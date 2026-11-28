import { cx } from "design-system";
import { Button, Switch } from "design-system/react";
import { useState } from "react";
import { sumAmounts } from "../../../domain/money.ts";
import type { PricebookItem } from "../../../domain/pricebook.ts";
import type { QuoteSection, Settings } from "../../../domain/settings.ts";
import { useFormat, useLocale, useT } from "../../i18n.tsx";
import { ItemNameField, PricebookPickerDialog } from "./PricebookPick.tsx";
import {
  customLine,
  formatEditAmount,
  type LineForm,
  type LineProblems,
  lineFormAmount,
  lineFromItem,
  type QuoteForm,
  sectionIdFor,
} from "./quoteForm.ts";

const CUSTOM = "__custom";

/**
 * „Položky“: the quote's sections in order, each with its lines. A line
 * starts from the price list or is the person's own; it moves within its
 * section, and a section is added from the settings or named anew.
 */
export function QuoteLines({
  form,
  setForm,
  settings,
  pricebook,
  problems,
  locked,
  discounts,
  onDiscounts,
}: {
  form: QuoteForm;
  setForm: (patch: Partial<QuoteForm>) => void;
  settings: Settings;
  pricebook: readonly PricebookItem[];
  problems: Record<string, LineProblems>;
  locked: boolean;
  discounts: boolean;
  onDiscounts: (on: boolean) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(settings.currency);
  const [picking, setPicking] = useState<QuoteSection | null>(null);
  const [adding, setAdding] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const units = settings.quotes.units;
  const missing = settings.quotes.sections.filter(
    (section) => !form.sections.some((own) => own.id === section.id),
  );

  const setLines = (lines: LineForm[], sections = form.sections) => setForm({ lines, sections });
  const changeLine = (id: string, patch: Partial<LineForm>) =>
    setLines(form.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  /** The section an item's line goes to: the item's own when the quote has it or can take it from the settings. */
  function sectionForItem(item: PricebookItem, fallback: string) {
    if (!item.sectionId) return { sectionId: fallback, sections: form.sections };
    if (form.sections.some((section) => section.id === item.sectionId))
      return { sectionId: item.sectionId, sections: form.sections };
    const known = settings.quotes.sections.find((section) => section.id === item.sectionId);
    if (known) return { sectionId: known.id, sections: [...form.sections, { ...known }] };
    return { sectionId: fallback, sections: form.sections };
  }

  function pickForLine(line: LineForm, item: PricebookItem) {
    const target = sectionForItem(item, line.sectionId);
    setLines(
      form.lines.map((entry) =>
        entry.id === line.id
          ? {
              ...entry,
              sectionId: target.sectionId,
              pricebookItemId: item.id,
              name: item.name,
              description: entry.description || item.description || "",
              unit: item.unit,
              unitPrice: formatEditAmount(item.unitPrice, locale),
            }
          : entry,
      ),
      target.sections,
    );
  }

  function move(line: LineForm, direction: -1 | 1) {
    const same = form.lines.filter((entry) => entry.sectionId === line.sectionId);
    const at = same.findIndex((entry) => entry.id === line.id);
    const other = same[at + direction];
    if (!other) return;
    const lines = [...form.lines];
    const from = lines.findIndex((entry) => entry.id === line.id);
    const to = lines.findIndex((entry) => entry.id === other.id);
    [lines[from], lines[to]] = [lines[to] as LineForm, lines[from] as LineForm];
    setLines(lines);
  }

  function addSection(value: string) {
    if (value === CUSTOM) {
      setAdding(CUSTOM);
      return;
    }
    const known = settings.quotes.sections.find((section) => section.id === value);
    if (known) setForm({ sections: [...form.sections, { ...known }] });
    setAdding("");
  }

  function addCustomSection() {
    const label = customLabel.trim();
    if (!label) return;
    setForm({ sections: [...form.sections, { id: sectionIdFor(label, form.sections), label }] });
    setCustomLabel("");
    setAdding("");
  }

  function renameSection(id: string, label: string) {
    setForm({
      sections: form.sections.map((section) =>
        section.id === id ? { ...section, label } : section,
      ),
    });
  }

  function restoreLabel(section: QuoteSection) {
    if (section.label.trim()) return;
    const known = settings.quotes.sections.find((entry) => entry.id === section.id);
    renameSection(section.id, known?.label ?? section.id);
  }

  return (
    <article className="ds-card quote-card">
      <div className="quote-card-heading">
        <h2>{t("Položky", "Items")}</h2>
        <Switch
          id="quote-discounts"
          label={t("Slevy", "Discounts")}
          checked={discounts}
          disabled={locked}
          onChange={(event) => onDiscounts(event.target.checked)}
        />
      </div>
      {form.sections.map((section) => {
        const lines = form.lines.filter((line) => line.sectionId === section.id);
        const subtotal = sumAmounts(lines.map((line) => lineFormAmount(line, locale) ?? 0));
        return (
          <section
            key={section.id}
            className={cx("quote-section", locked && "quote-section--locked")}
            aria-label={section.label}
          >
            <header className="quote-section-head">
              <input
                className="ds-input quote-section-label"
                value={section.label}
                aria-label={t("Název sekce", "Section name")}
                disabled={locked}
                onChange={(event) => renameSection(section.id, event.target.value)}
                onBlur={() => restoreLabel(section)}
              />
              <span className="num quote-section-total">{f.money(subtotal)}</span>
              {!locked && lines.length === 0 && form.sections.length > 1 ? (
                <Button
                  variant="quiet"
                  size="sm"
                  icon="trash"
                  iconOnly
                  label={t(`Odebrat sekci ${section.label}`, `Remove the section ${section.label}`)}
                  onClick={() =>
                    setForm({ sections: form.sections.filter((entry) => entry.id !== section.id) })
                  }
                />
              ) : null}
            </header>
            {lines.length === 0 ? (
              <p className="muted small quote-section-empty">
                {t("Sekce zatím nemá položky.", "The section has no items yet.")}
              </p>
            ) : (
              <ul
                className={cx(
                  "quote-lines",
                  discounts && "quote-lines--discounts",
                  locked && "quote-lines--locked",
                )}
              >
                <li className="quote-line quote-line-labels" aria-hidden="true">
                  <span className="quote-line-name">{t("Položka", "Item")}</span>
                  <span className="quote-line-numbers">
                    <span className="quote-line-qty">{t("Počet", "Qty")}</span>
                    <span className="quote-line-unit">{t("MJ", "Unit")}</span>
                    <span className="quote-line-price">{t("Cena MJ", "Unit price")}</span>
                    {discounts ? (
                      <span className="quote-line-discount">{t("Sleva %", "Discount %")}</span>
                    ) : null}
                    <span className="quote-line-total">{t("Celkem", "Total")}</span>
                  </span>
                  {!locked ? <span className="quote-line-actions" /> : null}
                </li>
                {lines.map((line, index) => (
                  <QuoteLineRow
                    key={line.id}
                    line={line}
                    units={units}
                    pricebook={pricebook}
                    currency={settings.currency}
                    problems={problems[line.id] ?? {}}
                    locked={locked}
                    discounts={discounts}
                    first={index === 0}
                    last={index === lines.length - 1}
                    onChange={(patch) => changeLine(line.id, patch)}
                    onPick={(item) => pickForLine(line, item)}
                    onMove={(direction) => move(line, direction)}
                    onRemove={() => setLines(form.lines.filter((entry) => entry.id !== line.id))}
                  />
                ))}
              </ul>
            )}
            {!locked ? (
              <div className="quote-section-add">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  disabled={pricebook.every((item) => !item.active)}
                  onClick={() => setPicking(section)}
                >
                  {t("Z ceníku", "From the price list")}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    setLines([...form.lines, customLine(section.id, form.lines, units[0] ?? "")])
                  }
                >
                  {t("Vlastní položka", "Own item")}
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
      {!locked ? (
        <div className="quote-add-section">
          {adding === CUSTOM ? (
            // Inside the quote's form: Enter adds the section instead of saving the quote.
            <div className="quote-add-section-form">
              <input
                className="ds-input"
                value={customLabel}
                aria-label={t("Název nové sekce", "Name of the new section")}
                placeholder={t("Název sekce", "Section name")}
                enterKeyHint="done"
                onChange={(event) => setCustomLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomSection();
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!customLabel.trim()}
                onClick={addCustomSection}
              >
                {t("Přidat sekci", "Add the section")}
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setAdding("")}>
                {t("Zrušit", "Cancel")}
              </Button>
            </div>
          ) : (
            <div className="ds-select-wrap quote-add-section-select">
              <select
                className="ds-select"
                value=""
                aria-label={t("Přidat sekci", "Add a section")}
                onChange={(event) => addSection(event.target.value)}
              >
                <option value="" disabled>
                  {t("+ Přidat sekci", "+ Add a section")}
                </option>
                {missing.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
                <option value={CUSTOM}>{t("Vlastní sekce…", "Own section…")}</option>
              </select>
            </div>
          )}
        </div>
      ) : null}
      <PricebookPickerDialog
        open={picking !== null}
        items={pricebook}
        currency={settings.currency}
        sectionLabel={picking?.label ?? ""}
        onClose={() => setPicking(null)}
        onPick={(item) => {
          if (picking)
            setLines([...form.lines, lineFromItem(item, picking.id, form.lines, locale)]);
          setPicking(null);
        }}
      />
    </article>
  );
}

function QuoteLineRow({
  line,
  units,
  pricebook,
  currency,
  problems,
  locked,
  discounts,
  first,
  last,
  onChange,
  onPick,
  onMove,
  onRemove,
}: {
  line: LineForm;
  units: readonly string[];
  pricebook: readonly PricebookItem[];
  currency: string;
  problems: LineProblems;
  locked: boolean;
  discounts: boolean;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<LineForm>) => void;
  onPick: (item: PricebookItem) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(currency);
  const amount = lineFormAmount(line, locale);
  const unitOptions = units.includes(line.unit) || !line.unit ? units : [...units, line.unit];
  const invalid = (flag: true | undefined) => (flag ? "true" : undefined);
  const name = line.name || t("položka", "item");
  return (
    <li className="quote-line">
      <div className="quote-line-name">
        <ItemNameField
          value={line.name}
          items={pricebook}
          currency={currency}
          invalid={problems.name === true}
          disabled={locked}
          label={t("Název položky", "Item name")}
          onChange={(value) => onChange({ name: value })}
          onPick={onPick}
        />
        <div className="quote-line-detail">
          <input
            className="ds-input quote-line-description"
            value={line.description}
            aria-label={t(`Popis: ${name}`, `Description: ${name}`)}
            placeholder={t("Popis (nepovinný)", "Description (optional)")}
            disabled={locked}
            onChange={(event) => onChange({ description: event.target.value })}
          />
          {line.pricebookItemId ? (
            <span className="quote-line-code">
              <span className="ds-visually-hidden">{t("Z ceníku", "From the price list")} </span>
              {line.pricebookItemId}
            </span>
          ) : null}
        </div>
      </div>
      <div className="quote-line-numbers">
        <label className="quote-line-qty">
          <span className="quote-line-label" aria-hidden="true">
            {t("Počet", "Qty")}
          </span>
          <input
            className="ds-input num"
            value={line.quantity}
            inputMode="decimal"
            autoComplete="off"
            aria-label={t(`Počet: ${name}`, `Qty: ${name}`)}
            aria-invalid={invalid(problems.quantity)}
            title={
              problems.quantity
                ? t(
                    "Kladné číslo, nejvýš 3 desetinná místa.",
                    "A positive number, at most 3 decimals.",
                  )
                : undefined
            }
            disabled={locked}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
        </label>
        <label className="quote-line-unit">
          <span className="quote-line-label" aria-hidden="true">
            {t("MJ", "Unit")}
          </span>
          <span className="ds-select-wrap">
            <select
              className="ds-select"
              value={line.unit}
              aria-label={t(`MJ: ${name}`, `Unit: ${name}`)}
              aria-invalid={invalid(problems.unit)}
              disabled={locked}
              onChange={(event) => onChange({ unit: event.target.value })}
            >
              {!line.unit ? <option value="">–</option> : null}
              {unitOptions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="quote-line-price">
          <span className="quote-line-label" aria-hidden="true">
            {t("Cena MJ", "Unit price")}
          </span>
          <input
            className="ds-input num"
            value={line.unitPrice}
            inputMode="decimal"
            autoComplete="off"
            aria-label={t(`Cena MJ: ${name}`, `Unit price: ${name}`)}
            aria-invalid={invalid(problems.unitPrice)}
            title={
              problems.unitPrice
                ? t("Částka, třeba 1290 nebo 47,50.", "An amount, e.g. 1290 or 47.50.")
                : undefined
            }
            disabled={locked}
            onChange={(event) => onChange({ unitPrice: event.target.value })}
          />
        </label>
        {discounts ? (
          <label className="quote-line-discount">
            <span className="quote-line-label" aria-hidden="true">
              {t("Sleva %", "Discount %")}
            </span>
            <input
              className="ds-input num"
              value={line.discount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label={t(`Sleva %: ${name}`, `Discount %: ${name}`)}
              aria-invalid={invalid(problems.discount)}
              title={problems.discount ? t("0 až 100 %.", "0 to 100%.") : undefined}
              disabled={locked}
              onChange={(event) => onChange({ discount: event.target.value })}
            />
          </label>
        ) : null}
        <span className="quote-line-total">
          <span className="quote-line-label">{t("Celkem", "Total")}</span>
          <span className="num">
            {amount === null ? <span className="danger">–</span> : f.money(amount)}
          </span>
        </span>
      </div>
      {!locked ? (
        <span className="quote-line-actions">
          <Button
            variant="quiet"
            size="sm"
            icon="nav-arrow-up"
            iconOnly
            disabled={first}
            label={t(`Posunout výš: ${name}`, `Move up: ${name}`)}
            onClick={() => onMove(-1)}
          />
          <Button
            variant="quiet"
            size="sm"
            icon="nav-arrow-down"
            iconOnly
            disabled={last}
            label={t(`Posunout níž: ${name}`, `Move down: ${name}`)}
            onClick={() => onMove(1)}
          />
          <Button
            variant="quiet"
            size="sm"
            icon="trash"
            iconOnly
            label={t(`Odebrat: ${name}`, `Remove: ${name}`)}
            onClick={onRemove}
          />
        </span>
      ) : null}
    </li>
  );
}
