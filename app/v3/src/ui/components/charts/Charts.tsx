import { cx } from "design-system";
import { Button, Table } from "design-system/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useT } from "../../i18n.tsx";
import {
  axisOf,
  bandsOf,
  barPath,
  columnPath,
  labelEvery,
  linePath,
  nearestIndex,
  scaleOf,
} from "./geometry.ts";

/**
 * The App's own charts in inline SVG: columns (side by side or stacked), a
 * list of bars and lines. Each is an image with a label for screen readers
 * and a table of its values beside it, hidden until the person asks for it.
 * Colours are the design system's tokens, softened toward the surface so a
 * chart stays calm: the current period in the accent, the previous one a
 * light gray; open, won and lost in the colours of their stages.
 */
export type ChartTone = "accent" | "previous" | "open" | "won" | "lost";

const soft = (token: string, share: number) =>
  `color-mix(in srgb, var(${token}) ${share}%, var(--ds-color-surface))`;

const FILL: Record<ChartTone, string> = {
  accent: soft("--ds-color-accent", 62),
  previous: "color-mix(in srgb, var(--ds-color-ink) 12%, transparent)",
  open: soft("--ds-color-info", 55),
  won: soft("--ds-color-success", 62),
  lost: soft("--ds-color-danger", 62),
};

/** The stroke of a line: full colour, and the previous period a darker gray than a bar. */
const STROKE: Record<ChartTone, string> = {
  accent: soft("--ds-color-accent", 80),
  previous: "color-mix(in srgb, var(--ds-color-ink) 30%, transparent)",
  open: soft("--ds-color-info", 75),
  won: soft("--ds-color-success", 80),
  lost: soft("--ds-color-danger", 80),
};

export interface LegendItem {
  name: string;
  tone: ChartTone;
}

export interface ChartTable {
  columns: string[];
  rows: { key: string; cells: ReactNode[]; onOpen?: (() => void) | undefined }[];
}

/** The width of a chart's box, followed as it resizes; `fallback` until it is known. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A chart's frame: its heading, legend, the picture and its table of values. */
export function ChartFrame({
  title,
  legend,
  table,
  tools,
  children,
}: {
  title: string;
  legend?: LegendItem[] | undefined;
  table: ChartTable;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3 className="chart-title">{title}</h3>
        <div className="chart-tools">
          {tools}
          <Button
            variant="quiet"
            size="sm"
            icon="list"
            aria-pressed={showTable}
            onClick={() => setShowTable(!showTable)}
          >
            {showTable ? t("Graf", "Chart") : t("Tabulka", "Table")}
          </Button>
        </div>
      </figcaption>
      {legend && legend.length > 1 ? (
        <ul className="chart-legend">
          {legend.map((item) => (
            <li key={item.name}>
              <span
                className="chart-swatch"
                aria-hidden="true"
                style={{ background: FILL[item.tone] }}
              />
              {item.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={cx(showTable && "ds-visually-hidden")}>{children}</div>
      <div className={cx(!showTable && "ds-visually-hidden")}>
        <Table id={`${id}-table`} caption={title} hideCaption density="compact">
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th key={column} scope="col" className={index > 0 ? "ds-table__num" : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: the cells of a row are positional
                    key={index}
                    className={index > 0 ? "ds-table__num" : undefined}
                  >
                    {index === 0 && row.onOpen && showTable ? (
                      <button type="button" className="chart-open" onClick={row.onOpen}>
                        {cell}
                      </button>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </figure>
  );
}

const MARGIN = { top: 12, right: 8, bottom: 26, left: 56 };

export interface ColumnCategory {
  key: string;
  /** The short label under the column. */
  label: string;
  /** One value per series, or per segment of a stacked column. */
  values: number[];
  /** What a pointer resting on the column shows. */
  title: string;
}

/**
 * Columns per category: the series side by side (the period and the one
 * before), or stacked as segments (open, won, lost). A click on a column
 * opens what is behind it.
 */
export function ColumnChart({
  label,
  categories,
  tones,
  tick,
  stacked = false,
  integer = false,
  height = 220,
  onOpen,
}: {
  label: string;
  categories: ColumnCategory[];
  tones: ChartTone[];
  tick: (value: number) => string;
  stacked?: boolean;
  integer?: boolean;
  height?: number;
  onOpen?: ((index: number) => void) | undefined;
}) {
  const [ref, width] = useWidth();
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const sums = categories.map((category) =>
    stacked
      ? category.values.reduce((sum, value) => sum + value, 0)
      : Math.max(0, ...category.values),
  );
  const axis = axisOf(Math.max(0, ...sums), 4, integer);
  const bands = bandsOf(
    categories.length,
    stacked ? 1 : tones.length,
    plotWidth,
    stacked ? 28 : 24,
  );
  const every = labelEvery(categories.length, plotWidth / 56);
  const y = (value: number) => baseline - scaleOf(value, axis, plotHeight);
  return (
    <div ref={ref} className="chart-box">
      <svg
        className="chart-svg"
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {axis.ticks.map((value) => (
          <g key={value}>
            <line
              className="chart-grid"
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text
              className="chart-tick"
              x={MARGIN.left - 6}
              y={y(value)}
              dy="0.32em"
              textAnchor="end"
            >
              {tick(value)}
            </text>
          </g>
        ))}
        {categories.map((category, index) => {
          const start = MARGIN.left + bands.start(index);
          const showLabel = (categories.length - 1 - index) % every === 0;
          let marks: ReactNode[];
          if (stacked) {
            let bottom = baseline;
            const last = category.values.reduce((at, value, i) => (value > 0 ? i : at), -1);
            marks = category.values.map((value, segment) => {
              if (value <= 0) return null;
              const top = y(
                category.values.slice(0, segment + 1).reduce((sum, entry) => sum + entry, 0),
              );
              const fill = FILL[tones[segment] ?? "accent"];
              const gapTop = segment === last ? top : Math.min(bottom, top + 2);
              const path =
                segment === last
                  ? columnPath(start, top, bands.bar, bottom)
                  : `M${start},${bottom} V${gapTop} H${start + bands.bar} V${bottom} Z`;
              bottom = top;
              return <path key={tones[segment] ?? segment} d={path} style={{ fill }} />;
            });
          } else {
            marks = category.values.map((value, series) => (
              <path
                key={tones[series] ?? series}
                d={columnPath(start + series * (bands.bar + 2), y(value), bands.bar, baseline)}
                style={{ fill: FILL[tones[series] ?? "accent"] }}
              />
            ));
          }
          return (
            <g key={category.key} className={cx("chart-band", onOpen && "is-open")}>
              {marks}
              {showLabel ? (
                <text
                  className="chart-tick"
                  x={MARGIN.left + index * bands.step + bands.step / 2}
                  y={baseline + 16}
                  textAnchor="middle"
                >
                  {category.label}
                </text>
              ) : null}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the table of the chart opens the same by keyboard */}
              <rect
                className="chart-hit"
                x={MARGIN.left + index * bands.step}
                y={MARGIN.top}
                width={bands.step}
                height={plotHeight}
                onClick={onOpen ? () => onOpen(index) : undefined}
              >
                <title>{category.title}</title>
              </rect>
            </g>
          );
        })}
        <line
          className="chart-axis"
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={baseline}
          y2={baseline}
        />
      </svg>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  /** The period's value and the previous one's. */
  values: [number, number];
  /** The period's value, formatted, at the end of the row. */
  valueText: string;
  title: string;
}

/** A ranked list of bars: a name with its value, the period's bar and the previous one under it. */
export function BarListChart({
  label,
  rows,
  onOpen,
}: {
  label: string;
  rows: BarRow[];
  onOpen?: ((index: number) => void) | undefined;
}) {
  const [ref, width] = useWidth();
  const rowHeight = 46;
  const height = Math.max(rowHeight, rows.length * rowHeight);
  const max = Math.max(0, ...rows.flatMap((row) => row.values));
  const scale = (value: number) => (max > 0 ? (Math.max(0, value) / max) * width : 0);
  return (
    <div ref={ref} className="chart-box">
      <svg
        className="chart-svg"
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {rows.map((row, index) => {
          const top = index * rowHeight;
          return (
            <g key={row.key} className={cx("chart-band", onOpen && "is-open")}>
              <text className="chart-label" x={0} y={top + 14}>
                {row.label}
              </text>
              <text className="chart-value" x={width} y={top + 14} textAnchor="end">
                {row.valueText}
              </text>
              <rect className="chart-track" x={0} y={top + 24} width={width} height={6} rx={3} />
              <path
                d={barPath(0, top + 24, scale(row.values[0]), 6, 3)}
                style={{ fill: FILL.accent }}
              />
              <path
                d={barPath(0, top + 34, scale(row.values[1]), 3, 1.5)}
                style={{ fill: FILL.previous }}
              />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the table of the chart opens the same by keyboard */}
              <rect
                className="chart-hit"
                x={0}
                y={top}
                width={width}
                height={rowHeight}
                onClick={onOpen ? () => onOpen(index) : undefined}
              >
                <title>{row.title}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface LineSeries {
  name: string;
  tone: ChartTone;
  values: number[];
}

/**
 * Lines over the same x (a day of the period, say): the current one with
 * its value at its end. A pointer over the chart shows a crosshair and the
 * values of that point.
 */
export function LineChart({
  label,
  series,
  xLabel,
  tick,
  tooltip,
  endLabel,
  height = 220,
}: {
  label: string;
  series: LineSeries[];
  /** The label of a point on the x axis; shown for the first, the middle and the last. */
  xLabel: (index: number) => string;
  tick: (value: number) => string;
  tooltip: (index: number) => ReactNode;
  endLabel?: string | undefined;
  height?: number;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const right = endLabel ? 76 : MARGIN.right;
  const plotWidth = width - MARGIN.left - right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;
  const count = Math.max(0, ...series.map((entry) => entry.values.length));
  const axis = axisOf(Math.max(0, ...series.flatMap((entry) => entry.values)));
  const x = (index: number) =>
    MARGIN.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) => baseline - scaleOf(value, axis, plotHeight);
  const marks =
    count === 0
      ? []
      : plotWidth < 280
        ? [0, count - 1]
        : [0, Math.floor((count - 1) / 2), count - 1];
  const first = series[0];
  return (
    <div ref={ref} className="chart-box chart-box--line">
      <svg
        className="chart-svg"
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(nearestIndex(event.clientX - box.left - MARGIN.left, count, plotWidth));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {axis.ticks.map((value) => (
          <g key={value}>
            <line
              className="chart-grid"
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={y(value)}
              y2={y(value)}
            />
            <text
              className="chart-tick"
              x={MARGIN.left - 6}
              y={y(value)}
              dy="0.32em"
              textAnchor="end"
            >
              {tick(value)}
            </text>
          </g>
        ))}
        {[...new Set(marks)].map((index) => (
          <text
            key={index}
            className="chart-tick"
            x={x(index)}
            y={baseline + 16}
            textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
          >
            {xLabel(index)}
          </text>
        ))}
        {[...series].reverse().map((entry) => (
          <path
            key={entry.name}
            d={linePath(entry.values.map((value, index) => [x(index), y(value)] as const))}
            className="chart-line"
            style={{ stroke: STROKE[entry.tone] }}
          />
        ))}
        {first && first.values.length > 0 ? (
          <>
            <circle
              className="chart-dot"
              cx={x(first.values.length - 1)}
              cy={y(first.values.at(-1) ?? 0)}
              r={4}
              style={{ fill: STROKE[first.tone] }}
            />
            {endLabel ? (
              <text
                className="chart-value"
                x={x(first.values.length - 1) + 8}
                y={y(first.values.at(-1) ?? 0)}
                dy="0.32em"
              >
                {endLabel}
              </text>
            ) : null}
          </>
        ) : null}
        {hover !== null ? (
          <g>
            <line
              className="chart-crosshair"
              x1={x(hover)}
              x2={x(hover)}
              y1={MARGIN.top}
              y2={baseline}
            />
            {series.map((entry) => (
              <circle
                key={entry.name}
                className="chart-dot"
                cx={x(hover)}
                cy={y(entry.values[hover] ?? 0)}
                r={4}
                style={{ fill: STROKE[entry.tone] }}
              />
            ))}
          </g>
        ) : null}
        <line
          className="chart-axis"
          x1={MARGIN.left}
          x2={MARGIN.left + plotWidth}
          y1={baseline}
          y2={baseline}
        />
      </svg>
      {hover !== null ? (
        <div
          className={cx("chart-tooltip", x(hover) > width / 2 && "is-left")}
          style={{ left: x(hover) }}
          aria-hidden="true"
        >
          {tooltip(hover)}
        </div>
      ) : null}
    </div>
  );
}
