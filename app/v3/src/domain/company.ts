import { z } from "zod";
import { nextNumber, optionalText, text, writeRevision, writtenAt, writtenBy } from "./common.ts";

/** A company the Organization sells to (`data/companies/<id>.yaml`). */
export const COMPANY_ID = /^C-[0-9]{4,6}$/;
export const companyId = z.string().regex(COMPANY_ID, { message: "expected C-0001" });

/** A Czech company id (IČO): eight digits. The checksum is a rule (`isValidIco`). */
export const ico = z.string().regex(/^[0-9]{8}$/, { message: "expected eight digits" });

export const address = z.strictObject({
  street: optionalText,
  city: optionalText,
  postalCode: optionalText,
  country: optionalText,
});

export const company = z.strictObject({
  id: companyId,
  name: text,
  ico: ico.optional(),
  dic: optionalText,
  address: address.optional(),
  website: optionalText,
  paymentDueDays: z
    .int()
    .min(0)
    .max(365)
    .optional()
    .describe("Days from an invoice to its due date for this company, else the settings'."),
  note: optionalText,
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Company = z.infer<typeof company>;
export type Address = z.infer<typeof address>;

/**
 * The check digit of the first seven digits of an IČO (modulo 11): the
 * digits weighted 8 to 2, the remainder of their sum by 11, and then 1 for a
 * remainder of 0, 0 for 1, otherwise 11 − remainder.
 */
export function icoCheckDigit(first7: string): number {
  if (!/^[0-9]{7}$/.test(first7)) throw new RangeError("expected seven digits");
  let sum = 0;
  for (let index = 0; index < 7; index += 1) sum += Number(first7[index]) * (8 - index);
  const remainder = sum % 11;
  return remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
}

/** True for eight digits whose last one is the check digit of the first seven. */
export function isValidIco(value: string): boolean {
  if (!/^[0-9]{8}$/.test(value)) return false;
  return icoCheckDigit(value.slice(0, 7)) === Number(value[7]);
}

/** The next free company id after the highest one used: `C-0007`. */
export function nextCompanyId(existing: readonly string[]): string {
  return `C-${String(nextNumber(existing, /^C-([0-9]+)$/)).padStart(4, "0")}`;
}

/** The address of a company as lines, without empty ones. */
export function addressLines(value: Address | undefined): string[] {
  if (!value) return [];
  const town = [value.postalCode, value.city].filter(Boolean).join(" ");
  return [value.street, town, value.country].filter((line): line is string => Boolean(line));
}
