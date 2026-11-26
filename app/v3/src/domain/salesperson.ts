import { z } from "zod";
import { nextNumber, optionalText, text, writeRevision, writtenAt, writtenBy } from "./common.ts";

/**
 * A salesperson of the Organization (`data/salespeople/<id>.yaml`), id
 * `S-0001`. A deal names its salesperson by id. Somebody who left stays a
 * record with `active: false`, so their deals keep their name; a new deal
 * offers only the active ones.
 */
export const SALESPERSON_ID = /^S-[0-9]{4,6}$/;
export const salespersonId = z.string().regex(SALESPERSON_ID, { message: "expected S-0001" });

export const salesperson = z.strictObject({
  id: salespersonId,
  name: text,
  role: optionalText,
  email: optionalText,
  phone: optionalText,
  active: z.boolean().describe("Whether a new deal may be assigned to them."),
  note: optionalText,
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Salesperson = z.infer<typeof salesperson>;

/** The next free salesperson id after the highest one used: `S-0004`. */
export function nextSalespersonId(existing: readonly string[]): string {
  return `S-${String(nextNumber(existing, /^S-([0-9]+)$/)).padStart(4, "0")}`;
}

/** Initials for an avatar: `Jana Ukázková` → `JU`. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase("cs");
}
