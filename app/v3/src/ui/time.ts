/**
 * A time of the browser as an `<input type="datetime-local">` holds it,
 * `2026-11-24T10:00`, for the instant `now`.
 */
export function localDateTime(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

/**
 * `2026-11-24T10:00` in the browser's time zone → `2026-11-24T10:00:00+01:00`:
 * the time as the person wrote it, with the offset it had then, so it reads
 * the same wherever it is shown. Null when it is not a date and a time.
 */
export function withOffset(local: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!match) return null;
  const instant = new Date(`${local}:00`);
  if (Number.isNaN(instant.getTime())) return null;
  const minutes = -instant.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const rest = String(absolute % 60).padStart(2, "0");
  return `${match[1]}T${match[2]}:00${sign}${hours}:${rest}`;
}
