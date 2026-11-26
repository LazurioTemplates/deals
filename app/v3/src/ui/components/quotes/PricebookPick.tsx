import { cx } from "design-system";
import { Dialog, EmptyState } from "design-system/react";
import { type KeyboardEvent, useId, useState } from "react";
import type { PricebookItem } from "../../../domain/pricebook.ts";
import { useFormat, useLocale, useT } from "../../i18n.tsx";
import { findItems } from "./search.ts";

/**
 * The name of a quote line, which searches the price list as the person
 * types: picking an item copies its name, unit, price and section into the
 * line. A name typed without picking stays the line's own.
 */
export function ItemNameField({
  value,
  items,
  currency,
  invalid,
  disabled,
  label,
  onChange,
  onPick,
}: {
  value: string;
  items: readonly PricebookItem[];
  currency: string;
  invalid: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  onPick: (item: PricebookItem) => void;
}) {
  const t = useT();
  const f = useFormat(currency);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = open && value.trim().length > 0 ? findItems(items, value, 8) : [];
  const shown = found.length > 0;

  function pick(item: PricebookItem) {
    onPick(item);
    setOpen(false);
  }

  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (!shown) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((active + 1) % found.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((active - 1 + found.length) % found.length);
    } else if (event.key === "Enter") {
      const item = found[active];
      if (item) {
        event.preventDefault();
        pick(item);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="item-name">
      <input
        className="ds-input"
        value={value}
        role="combobox"
        aria-label={label}
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        aria-invalid={invalid ? "true" : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={t("Název nebo hledání v ceníku", "Name, or search the price list")}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={key}
        onBlur={() => setOpen(false)}
      />
      {shown ? (
        <div
          className="item-name-list"
          id={listId}
          role="listbox"
          aria-label={t("Ceník", "Price list")}
        >
          {found.map((item, index) => (
            <div
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cx("item-name-option", index === active && "is-active")}
              // The input keeps focus, so the pick happens before its blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
            >
              <span className="item-name-option-name">{item.name}</span>
              <span className="muted small num">
                {f.money(item.unitPrice)} / {item.unit}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A dialog that picks an item of the price list by search. */
export function PricebookPickerDialog({
  open,
  items,
  currency,
  sectionLabel,
  onClose,
  onPick,
}: {
  open: boolean;
  items: readonly PricebookItem[];
  currency: string;
  sectionLabel: string;
  onClose: () => void;
  onPick: (item: PricebookItem) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat(currency);
  const [query, setQuery] = useState("");
  const found = findItems(items, query, 50);
  return (
    <Dialog
      id="quote-pricebook-picker"
      title={t("Položka z ceníku", "An item from the price list")}
      description={t(
        `Přidá se do sekce ${sectionLabel}.`,
        `It is added to the section ${sectionLabel}.`,
      )}
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      dismissable
      locale={locale}
    >
      <div className="picker">
        <input
          className="ds-input"
          type="search"
          value={query}
          aria-label={t("Hledat v ceníku", "Search the price list")}
          placeholder={t("Název nebo kód", "Name or code")}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {found.length === 0 ? (
          <EmptyState
            icon="search"
            headingLevel={3}
            title={t("Nic nenalezeno.", "Nothing found.")}
          />
        ) : (
          <ul className="picker-list">
            {found.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    setQuery("");
                    onPick(item);
                  }}
                >
                  <span className="picker-option-main">
                    <span className="picker-option-name">{item.name}</span>
                    {item.code ? <span className="muted small mono">{item.code}</span> : null}
                  </span>
                  <span className="num small">
                    {f.money(item.unitPrice)} / {item.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
