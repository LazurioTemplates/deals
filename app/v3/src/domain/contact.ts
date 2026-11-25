import { z } from "zod";
import { nextNumber, optionalText, text, writeRevision, writtenAt, writtenBy } from "./common.ts";
import { companyId } from "./company.ts";

/** A person the Organization deals with (`data/contacts/<id>.yaml`). */
export const CONTACT_ID = /^P-[0-9]{4,6}$/;
export const contactId = z.string().regex(CONTACT_ID, { message: "expected P-0001" });

export const contact = z.strictObject({
  id: contactId,
  name: text,
  email: optionalText,
  phone: optionalText,
  role: optionalText,
  companyId: companyId.optional(),
  note: optionalText,
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Contact = z.infer<typeof contact>;

/** The next free contact id after the highest one used: `P-0011`. */
export function nextContactId(existing: readonly string[]): string {
  return `P-${String(nextNumber(existing, /^P-([0-9]+)$/)).padStart(4, "0")}`;
}
