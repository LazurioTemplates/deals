import type { Locale } from "../../../i18n/locale.ts";

/**
 * The geometry of the App's own charts, pure so it is tested apart from the
 * page: the axis, the bands of columns, the paths of bars and lines, and the
 * compact labels of the ticks. Pixels may be fractions; amounts stay whole
 * haléře until a tick label shows them.
 */

export interface Axis {
  /** The top of the axis, a clean number at or above the largest value. */
  max: number;
  /** The tick values from 0 to `max`, ascending. */
  ticks: number[];
}

/** A clean step near `rough`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * An axis from 0 that holds `max` in about `count` clean steps. Counts
 * (`integer`) step by whole numbers; an empty chart still has an axis to 1.
 */
export function axisOf(max: number, count = 4, integer = false): Axis {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  let step = niceStep(max / count);
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step)
    ticks.push(Math.round(value * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Where a value lies on an axis of `height` pixels, from the bottom. */
export function scaleOf(value: number, axis: Axis, height: number): number {
  if (axis.max <= 0) return 0;
  return (Math.max(0, value) / axis.max) * height;
}

export interface Bands {
  /** The width of one category's band. */
  step: number;
  /** The width of one bar: at most `maxBar`, never wider than its share of the band. */
  bar: number;
  /** The x of the first bar of a category, its group centred in the band. */
  start: (index: number) => number;
}

/**
 * Bands for `count` categories of `series` bars each across `width` pixels,
 * bars `gap` apart within a band and capped at `maxBar`, so wide charts get
 * air between groups rather than fat bars.
 */
export function bandsOf(count: number, series: number, width: number, maxBar = 24, gap = 2): Bands {
  const step = count > 0 ? width / count : width;
  const room = step * 0.7 - gap * (series - 1);
  const bar = Math.max(2, Math.min(maxBar, room / Math.max(1, series)));
  const group = bar * series + gap * (series - 1);
  return { step, bar, start: (index) => index * step + (step - group) / 2 };
}

/**
 * A column from the baseline up to `top`: its data end rounded by `radius`,
 * square at the baseline. A column lower than the radius rounds less.
 */
export function columnPath(
  x: number,
  top: number,
  width: number,
  baseline: number,
  radius = 4,
): string {
  const height = baseline - top;
  if (height <= 0) return "";
  const r = Math.min(radius, height, width / 2);
  const right = x + width;
  return [
    `M${fmt(x)},${fmt(baseline)}`,
    `V${fmt(top + r)}`,
    `Q${fmt(x)},${fmt(top)} ${fmt(x + r)},${fmt(top)}`,
    `H${fmt(right - r)}`,
    `Q${fmt(right)},${fmt(top)} ${fmt(right)},${fmt(top + r)}`,
    `V${fmt(baseline)}`,
    "Z",
  ].join(" ");
}

/** A bar from `x` to the right, `length` long: its data end rounded, square at the start. */
export function barPath(
  x: number,
  y: number,
  length: number,
  thickness: number,
  radius = 4,
): string {
  if (length <= 0) return "";
  const r = Math.min(radius, length, thickness / 2);
  const end = x + length;
  const bottom = y + thickness;
  return [
    `M${fmt(x)},${fmt(y)}`,
    `H${fmt(end - r)}`,
    `Q${fmt(end)},${fmt(y)} ${fmt(end)},${fmt(y + r)}`,
    `V${fmt(bottom - r)}`,
    `Q${fmt(end)},${fmt(bottom)} ${fmt(end - r)},${fmt(bottom)}`,
    `H${fmt(x)}`,
    "Z",
  ].join(" ");
}

/** A polyline through points. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join(" ");
}

/** Which of `count` labels to show so that at most `fit` show, evenly, always the last. */
export function labelEvery(count: number, fit: number): number {
  if (count <= 0 || fit <= 0) return 1;
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(fit))));
}

/** The index nearest to `x` among `count` points spread over `width`. */
export function nearestIndex(x: number, count: number, width: number): number {
  if (count <= 1 || width <= 0) return 0;
  const index = Math.round((x / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

const NBSP = " ";

/**
 * A number for a tick: in full under 10 000 (`9 000`, `9,000`), else
 * compact with one decimal at most: `12,5 tis.` / `12.5K`, `3 mil.` / `3M`,
 * `1,2 mld.` / `1.2B`.
 */
export function compactNumber(value: number, locale: Locale): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const sign = negative ? "−" : "";
  if (absolute < 10_000) {
    const whole = String(Math.round(absolute)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      locale === "en" ? "," : NBSP,
    );
    return `${sign}${whole}`;
  }
  const units: [number, string, string][] = [
    [1e9, `${NBSP}mld.`, "B"],
    [1e6, `${NBSP}mil.`, "M"],
    [1e3, `${NBSP}tis.`, "K"],
  ];
  const [size, cs, en] =
    units.find(([unit]) => absolute >= unit) ?? ([1e3, `${NBSP}tis.`, "K"] as const);
  const scaled = Math.round((absolute / size) * 10) / 10;
  const text = Number.isInteger(scaled)
    ? String(scaled)
    : scaled.toFixed(1).replace(".", locale === "en" ? "." : ",");
  return `${sign}${text}${locale === "en" ? en : cs}`;
}

/** An amount in haléře as a compact number of whole crowns, for a tick. */
export function compactMoney(amount: number, locale: Locale): string {
  return compactNumber(Math.trunc(amount / 100), locale);
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}
