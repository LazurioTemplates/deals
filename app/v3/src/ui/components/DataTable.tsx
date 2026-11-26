import { cx } from "design-system";
import { Button, Icon } from "design-system/react";
import {
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useT } from "../i18n.tsx";
import { readLocal, writeLocal } from "../lookups.ts";

/**
 * A table of records the way a sales team reads them: every column sorts
 * by a click on its header, a header dragged onto another moves the column,
 * the edge of a header resizes it. The order, the widths and the sort are a
 * view of one viewer: kept in the browser under `storageKey` (when given),
 * never in the data, and „Výchozí“ puts them back.
 *
 * Long lists show `pageSize` rows first and more on request, so a pipeline
 * of thousands of deals stays quick.
 */
export interface Column<R> {
  id: string;
  label: string;
  /** What a cell shows. */
  render: (row: R) => ReactNode;
  /** What the column sorts by; a column without one does not sort. */
  sortValue?: (row: R) => string | number | null | undefined;
  /** The width in pixels at first. */
  width?: number;
  align?: "start" | "end";
  /** A cell that holds its own controls: a click in it does not open the row. */
  interactive?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface TableView {
  sort: string | null;
  direction: SortDirection;
  order: string[];
  widths: Record<string, number>;
}

const MIN_WIDTH = 72;

/** The view of a table, kept per viewer under a key; the default when none is kept. */
export function useTableView(storageKey: string | undefined, defaults: TableView) {
  const [view, setView] = useState<TableView>(() => {
    if (!storageKey) return defaults;
    const kept = readLocal<Partial<TableView> | null>(storageKey, null);
    if (!kept) return defaults;
    const known = new Set(defaults.order);
    const order = (kept.order ?? []).filter((id) => known.has(id));
    for (const id of defaults.order) if (!order.includes(id)) order.push(id);
    return {
      sort: kept.sort && known.has(kept.sort) ? kept.sort : defaults.sort,
      direction:
        kept.direction === "asc" || kept.direction === "desc" ? kept.direction : defaults.direction,
      order,
      widths: { ...defaults.widths, ...(kept.widths ?? {}) },
    };
  });
  const update = useCallback(
    (next: TableView) => {
      setView(next);
      if (storageKey) writeLocal(storageKey, next);
    },
    [storageKey],
  );
  const reset = useCallback(() => {
    setView(defaults);
    if (storageKey) writeLocal(storageKey, undefined);
  }, [storageKey, defaults]);
  const isDefault = JSON.stringify(view) === JSON.stringify(defaults);
  return { view, update, reset, isDefault };
}

function compare(left: unknown, right: unknown): number {
  const empty = (value: unknown) => value === null || value === undefined || value === "";
  if (empty(left) && empty(right)) return 0;
  if (empty(left)) return 1;
  if (empty(right)) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "cs", { numeric: true });
}

export function DataTable<R>({
  id,
  caption,
  columns,
  rows,
  rowKey,
  onOpen,
  rowHref,
  storageKey,
  defaultSort,
  defaultDirection = "asc",
  pageSize = 80,
  selection,
  empty,
  rowClassName,
  footer,
}: {
  id: string;
  caption: string;
  columns: Column<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  /** Opens a row; a click anywhere in it but an interactive cell. */
  onOpen?: (row: R) => void;
  /** The link of a row's first cell, so the row opens by keyboard too. */
  rowHref?: (row: R) => string;
  storageKey?: string;
  defaultSort?: string;
  defaultDirection?: SortDirection;
  pageSize?: number;
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void };
  empty?: ReactNode;
  rowClassName?: (row: R) => string | undefined;
  footer?: ReactNode;
}) {
  const t = useT();
  const defaults = useMemo<TableView>(
    () => ({
      sort: defaultSort ?? null,
      direction: defaultDirection,
      order: columns.map((column) => column.id),
      widths: Object.fromEntries(columns.map((column) => [column.id, column.width ?? 160])),
    }),
    [columns, defaultSort, defaultDirection],
  );
  const { view, update, reset, isDefault } = useTableView(storageKey, defaults);
  const [limit, setLimit] = useState(pageSize);
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const ordered = view.order.flatMap((columnId) => {
    const column = byId.get(columnId);
    return column ? [column] : [];
  });
  const sortColumn = view.sort ? byId.get(view.sort) : undefined;
  const sorted = useMemo(() => {
    if (!sortColumn?.sortValue) return [...rows];
    const value = sortColumn.sortValue;
    const sign = view.direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => sign * compare(value(left), value(right)));
  }, [rows, sortColumn, view.direction]);
  const shown = sorted.slice(0, limit);

  function sortBy(column: Column<R>) {
    if (!column.sortValue) return;
    const direction: SortDirection =
      view.sort === column.id ? (view.direction === "asc" ? "desc" : "asc") : "asc";
    update({ ...view, sort: column.id, direction });
  }

  function drop(event: DragEvent<HTMLTableCellElement>, target: string) {
    event.preventDefault();
    const source = dragging ?? event.dataTransfer.getData("text/x-column");
    setDragging(null);
    if (!source || source === target) return;
    const order = view.order.filter((columnId) => columnId !== source);
    order.splice(order.indexOf(target), 0, source);
    update({ ...view, order });
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>, columnId: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = view.widths[columnId] ?? 160;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let latest = startWidth;
    const move = (moved: PointerEvent) => {
      latest = Math.max(MIN_WIDTH, Math.round(startWidth + moved.clientX - startX));
      const header = handle.parentElement;
      if (header) header.style.width = `${latest}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      update({ ...view, widths: { ...view.widths, [columnId]: latest } });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  const allSelected =
    selection !== undefined &&
    rows.length > 0 &&
    rows.every((row) => selection.selected.has(rowKey(row)));
  const someSelected =
    selection !== undefined &&
    !allSelected &&
    rows.some((row) => selection.selected.has(rowKey(row)));

  return (
    <div className="data-table">
      {storageKey && !isDefault ? (
        <div className="data-table-tools">
          <Button variant="quiet" size="sm" onClick={reset}>
            {t("Výchozí sloupce a řazení", "Default columns and sort")}
          </Button>
        </div>
      ) : null}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a table that scrolls sideways must be reachable by keyboard */}
      <section className="ds-table-wrap" aria-labelledby={`${id}-caption`} tabIndex={0}>
        <table
          className={cx(
            "ds-table",
            "ds-table--compact",
            onOpen && "ds-table--interactive",
            "data-table-grid",
          )}
        >
          <caption id={`${id}-caption`} className="ds-table__caption ds-visually-hidden">
            {caption}
          </caption>
          <colgroup>
            {selection ? <col style={{ width: 44 }} /> : null}
            {ordered.map((column) => (
              <col
                key={column.id}
                style={{ width: view.widths[column.id] ?? column.width ?? 160 }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {selection ? (
                <th scope="col" className="data-table-select">
                  <input
                    type="checkbox"
                    className="ds-check__input"
                    aria-label={t("Vybrat vše", "Select all")}
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected;
                    }}
                    onChange={(event) =>
                      selection.onChange(
                        event.target.checked ? new Set(rows.map(rowKey)) : new Set<string>(),
                      )
                    }
                  />
                </th>
              ) : null}
              {ordered.map((column) => {
                const sortedHere = view.sort === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cx(
                      column.align === "end" && "num",
                      dragging === column.id && "data-table-dragging",
                    )}
                    style={{ width: view.widths[column.id] ?? column.width ?? 160 }}
                    aria-sort={
                      sortedHere
                        ? view.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    draggable
                    onDragStart={(event) => {
                      setDragging(column.id);
                      event.dataTransfer.setData("text/x-column", column.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, column.id)}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className="data-table-sort"
                        onClick={() => sortBy(column)}
                      >
                        <span>{column.label}</span>
                        <Icon
                          name={
                            sortedHere
                              ? view.direction === "asc"
                                ? "sort-up"
                                : "sort-down"
                              : "sort"
                          }
                          size="sm"
                        />
                      </button>
                    ) : (
                      <span>{column.label}</span>
                    )}
                    <span
                      className="data-table-resize"
                      aria-hidden="true"
                      onPointerDown={(event) => startResize(event, column.id)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={ordered.length + (selection ? 1 : 0)} className="muted">
                  {empty ?? t("Nic tu není.", "Nothing here.")}
                </td>
              </tr>
            ) : null}
            {shown.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={rowClassName?.(row)}
                  onClick={(event) => {
                    if (!onOpen) return;
                    const target = event.target as HTMLElement;
                    if (target.closest("a, button, input, select, textarea, [data-interactive]"))
                      return;
                    onOpen(row);
                  }}
                >
                  {selection ? (
                    <td className="data-table-select" data-interactive>
                      <input
                        type="checkbox"
                        className="ds-check__input"
                        aria-label={t("Vybrat", "Select")}
                        checked={selection.selected.has(key)}
                        onChange={(event) => {
                          const next = new Set(selection.selected);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          selection.onChange(next);
                        }}
                      />
                    </td>
                  ) : null}
                  {ordered.map((column, index) => (
                    <td
                      key={column.id}
                      className={column.align === "end" ? "num" : undefined}
                      data-interactive={column.interactive ? "" : undefined}
                    >
                      {index === 0 && rowHref ? (
                        <a className="data-table-link" href={rowHref(row)}>
                          {column.render(row)}
                        </a>
                      ) : (
                        column.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </section>
      {sorted.length > shown.length ? (
        <div className="data-table-more">
          <Button variant="secondary" size="sm" onClick={() => setLimit(limit + pageSize)}>
            {t(
              `Zobrazit dalších ${Math.min(pageSize, sorted.length - shown.length)}`,
              `Show ${Math.min(pageSize, sorted.length - shown.length)} more`,
            )}
          </Button>
          <span className="muted small">
            {t(`${shown.length} z ${sorted.length}`, `${shown.length} of ${sorted.length}`)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
