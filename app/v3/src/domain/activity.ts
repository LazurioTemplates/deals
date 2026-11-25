import { z } from "zod";
import { isoDateTime, nextNumber, text, writeRevision, writtenAt, writtenBy } from "./common.ts";
import { contactId } from "./contact.ts";
import { dealId } from "./deal.ts";

/** What happened on a deal (`data/activities/<id>.yaml`), id `A-2026-00001`. */
export const ACTIVITY_ID = /^A-[0-9]{4}-[0-9]{5}$/;
export const activityId = z.string().regex(ACTIVITY_ID, { message: "expected A-2026-00001" });

export const ACTIVITY_TYPES = ["call", "meeting", "email", "note", "task"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activity = z.strictObject({
  id: activityId,
  dealId,
  type: z.enum(ACTIVITY_TYPES),
  at: isoDateTime,
  summary: text,
  contactIds: z.array(contactId).optional(),
  done: z.boolean().optional().describe("Whether a task is done; only a task has it."),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Activity = z.infer<typeof activity>;

/** The next free activity id of a year: `A-2026-00021` after `A-2026-00020`. */
export function nextActivityId(year: string | number, existing: readonly string[]): string {
  const pattern = new RegExp(`^A-${year}-([0-9]+)$`);
  return `A-${year}-${String(nextNumber(existing, pattern)).padStart(5, "0")}`;
}
