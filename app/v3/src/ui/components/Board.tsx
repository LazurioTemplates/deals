import { cx } from "design-system";
import { Button, Icon } from "design-system/react";
import { type ReactNode, useState } from "react";
import { useT } from "../i18n.tsx";
import { readLocal, writeLocal } from "../lookups.ts";

/**
 * A board: one column per state (a stage of the pipeline, a status of a
 * quote), a card per record. A card dragged onto another column moves the
 * record there (`onMove`); a column may refuse it (`accepts`). Each column
 * shows its count and, under it, the sum of its cards. A card is a link, so
 * it opens by keyboard; moving by keyboard stays with the record's page.
 */
export interface BoardColumn<R> {
  id: string;
  label: ReactNode;
  cards: R[];
  /** The sum under the column, already formatted; none when not given. */
  total?: string | undefined;
  tone?: "open" | "won" | "lost" | "muted" | undefined;
  /** A link that creates a record in this column, e.g. a deal already in the stage. */
  createHref?: string | undefined;
}

export function Board<R>({
  label,
  columns,
  cardKey,
  renderCard,
  cardHref,
  onMove,
  accepts,
  canMove,
}: {
  label: string;
  columns: BoardColumn<R>[];
  cardKey: (card: R) => string;
  renderCard: (card: R) => ReactNode;
  cardHref: (card: R) => string;
  onMove?: (card: R, toColumn: string) => void;
  accepts?: (card: R, toColumn: string) => boolean;
  canMove: boolean;
}) {
  const t = useT();
  const [dragged, setDragged] = useState<{ card: R; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const allowed = (columnId: string) =>
    dragged !== null &&
    dragged.from !== columnId &&
    (accepts ? accepts(dragged.card, columnId) : true);
  return (
    <section className="board" aria-label={label}>
      {columns.map((column) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for a dragged card; a record moves by keyboard on its own page
        <div
          key={column.id}
          className={cx(
            "board-column",
            column.tone && `board-column--${column.tone}`,
            over === column.id && allowed(column.id) && "board-column--over",
          )}
          onDragOver={(event) => {
            if (!allowed(column.id)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(column.id);
          }}
          onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            if (dragged && allowed(column.id)) onMove?.(dragged.card, column.id);
            setDragged(null);
          }}
        >
          <header className="board-column-header">
            <span className="board-column-title">{column.label}</span>
            <span className="board-column-count">{column.cards.length}</span>
            {column.createHref && canMove ? (
              <Button
                variant="quiet"
                size="sm"
                icon="plus"
                iconOnly
                label={t("Nový záznam v tomto sloupci", "A new record in this column")}
                href={column.createHref}
              />
            ) : null}
          </header>
          <ul className="board-column-body">
            {column.cards.length === 0 ? (
              <li className="board-empty muted small">{t("Prázdné", "Empty")}</li>
            ) : null}
            {column.cards.map((card) => (
              <li
                key={cardKey(card)}
                className={cx("board-card", dragged?.card === card && "board-card--dragging")}
                draggable={canMove && onMove !== undefined}
                onDragStart={(event) => {
                  setDragged({ card, from: column.id });
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", cardKey(card));
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
              >
                <a className="board-card-link" href={cardHref(card)} draggable={false}>
                  {renderCard(card)}
                </a>
              </li>
            ))}
          </ul>
          {column.total !== undefined ? (
            <footer className="board-column-footer">
              <span className="muted small">{t("Celkem", "Total")}</span>
              <span className="num">{column.total}</span>
            </footer>
          ) : null}
        </div>
      ))}
    </section>
  );
}

export type ViewMode = "list" | "board";

/** The list or the board, remembered per viewer under a key. */
export function useViewMode(storageKey: string, fallback: ViewMode = "list") {
  const [mode, setMode] = useState<ViewMode>(() => {
    const kept = readLocal<string>(storageKey, fallback);
    return kept === "board" || kept === "list" ? kept : fallback;
  });
  return [
    mode,
    (next: ViewMode) => {
      setMode(next);
      writeLocal(storageKey, next);
    },
  ] as const;
}

/** The switch between the list and the board. */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const t = useT();
  return (
    <fieldset className="view-toggle">
      <legend className="ds-visually-hidden">{t("Zobrazení", "View")}</legend>
      <button
        type="button"
        className={cx("view-toggle-button", mode === "list" && "is-active")}
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
      >
        <Icon name="list" size="sm" />
        <span>{t("Seznam", "List")}</span>
      </button>
      <button
        type="button"
        className={cx("view-toggle-button", mode === "board" && "is-active")}
        aria-pressed={mode === "board"}
        onClick={() => onChange("board")}
      >
        <Icon name="menu" size="sm" />
        <span>{t("Board", "Board")}</span>
      </button>
    </fieldset>
  );
}

/** A row of choices shown as chips, one chosen: periods, suppliers, groupings. */
export function ChipChoice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; count?: number | undefined }[];
  onChange: (value: V) => void;
}) {
  return (
    <fieldset className="chip-choice">
      <legend className="ds-visually-hidden">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("chip", option.value === value && "is-active")}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? <span className="chip-count">{option.count}</span> : null}
        </button>
      ))}
    </fieldset>
  );
}

/** A figure tile: a label, a value and an optional comparison or note. */
export function StatTile({
  label,
  value,
  note,
  change,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** The change against the previous period in basis points; null when there is nothing to compare. */
  change?: { basisPoints: number | null; text: string } | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value num">{value}</span>
      {/* Nothing before to compare with: the note says so, no chip. */}
      {change && change.basisPoints !== null ? (
        <span
          className={cx(
            "stat-tile-change",
            change.basisPoints > 0 && "is-up",
            change.basisPoints < 0 && "is-down",
          )}
        >
          {change.text}
        </span>
      ) : null}
      {note ? <span className="stat-tile-note muted small">{note}</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className="stat-tile stat-tile--button" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="stat-tile">{body}</div>
  );
}
