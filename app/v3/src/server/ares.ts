import { StoreError } from "../data/store.ts";
import type { Address } from "../domain/company.ts";
import { isValidIco } from "../domain/company.ts";

/**
 * Looks a Czech company up in ARES, the public register of the Ministry of
 * Finance, by its IČO. Only the server calls ARES: the browser asks the App's
 * own API (`GET /api/ares/:ico`), so the page loads nothing from another
 * origin and the limits below hold for every visitor of this process.
 *
 * - The IČO is normalized to eight digits and checked modulo 11 before any
 *   call; a number that cannot be an IČO is refused with `invalid_ico`.
 * - A call waits at most 5 s; a timeout, a network error or an unexpected
 *   answer is `ares_unavailable`, and the person fills the company in by hand.
 * - An answer is kept in memory for 24 hours, a company ARES does not know
 *   too; a kept answer calls nothing.
 * - At most 30 calls a minute leave this process; more is `ares_rate_limited`.
 * - `fetch` is injected, so the tests use a stub and never the network.
 */
export const ARES_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

/** What ARES says of a company, in the fields of a company record. */
export interface AresCompany {
  ico: string;
  name: string;
  dic?: string;
  address?: Address;
}

export interface AresOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** The clock, in milliseconds; injectable for tests. */
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
  perMinute?: number;
}

export type AresClient = (ico: string) => Promise<AresCompany>;

/** `12345678`, ` 1234 5678 ` or `45678` (leading zeros left out) → eight digits; null otherwise. */
export function normalizeIco(input: string): string | null {
  const digits = input.replace(/[\s ]/g, "");
  if (!/^[0-9]{1,8}$/.test(digits)) return null;
  return digits.padStart(8, "0");
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const number = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined;

/** `60200` → `602 00`; anything else as it came. */
function postalCode(value: unknown): string | undefined {
  const raw = number(value);
  if (!raw) return undefined;
  const digits = raw.replace(/\s/g, "");
  return /^[0-9]{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : raw;
}

/**
 * The seat of a company as ARES gives it (`sidlo`): the street, or the part
 * of the municipality where a village has no streets, with the house number
 * and the orientation number (`Ukázková 1234/12a`).
 */
export function addressOf(seat: unknown): Address | undefined {
  if (!seat || typeof seat !== "object") return undefined;
  const value = seat as Record<string, unknown>;
  const house = number(value.cisloDomovni);
  const orientation = number(value.cisloOrientacni);
  const letter = text(value.cisloOrientacniPismeno) ?? "";
  const numbers = [house, orientation ? `${orientation}${letter}` : undefined]
    .filter(Boolean)
    .join("/");
  const streetName = text(value.nazevUlice) ?? text(value.nazevCastiObce);
  const street = [streetName, numbers].filter(Boolean).join(" ") || undefined;
  const address: Address = {
    ...(street ? { street } : {}),
    ...(text(value.nazevObce) ? { city: text(value.nazevObce) } : {}),
    ...(postalCode(value.psc) ? { postalCode: postalCode(value.psc) } : {}),
    ...(text(value.nazevStatu) ? { country: text(value.nazevStatu) } : {}),
  };
  return Object.keys(address).length > 0 ? address : undefined;
}

/** The company of an ARES answer, or null when the answer is not one. */
export function companyOf(ico: string, body: unknown): AresCompany | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const name = text(value.obchodniJmeno);
  if (!name) return null;
  const dic = text(value.dic);
  const address = addressOf(value.sidlo);
  return { ico, name, ...(dic ? { dic } : {}), ...(address ? { address } : {}) };
}

const unavailable = () =>
  new StoreError("ares_unavailable", {
    cs: "ARES teď neodpovídá. Vyplňte firmu ručně, nebo to zkuste později.",
    en: "ARES does not answer now. Fill the company in by hand, or try again later.",
  });

const unknown = (ico: string) =>
  new StoreError("ares_not_found", {
    cs: `ARES nezná firmu s IČO ${ico}. Vyplňte ji ručně.`,
    en: `ARES knows no company with the company id (IČO) ${ico}. Fill it in by hand.`,
  });

export function createAres(options: AresOptions = {}): AresClient {
  const call = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 5_000;
  const cacheMs = options.cacheMs ?? 24 * 60 * 60 * 1000;
  const perMinute = options.perMinute ?? 30;
  const kept = new Map<string, { at: number; company: AresCompany | null }>();
  const calls: number[] = [];

  return async function lookup(input: string): Promise<AresCompany> {
    const ico = normalizeIco(input);
    if (!ico || !isValidIco(ico)) {
      throw new StoreError("invalid_ico", {
        cs: `${input.trim() || "Prázdné IČO"} není platné IČO (8 číslic s kontrolní číslicí).`,
        en: `${input.trim() || "An empty value"} is not a valid company id (IČO): eight digits with a check digit.`,
      });
    }
    const at = now();
    const hit = kept.get(ico);
    if (hit && at - hit.at < cacheMs) {
      if (hit.company) return hit.company;
      throw unknown(ico);
    }
    while (calls.length > 0 && at - (calls[0] as number) >= 60_000) calls.shift();
    if (calls.length >= perMinute) {
      throw new StoreError("ares_rate_limited", {
        cs: "Do ARES už tato aplikace minutu posílá příliš mnoho dotazů. Zkuste to za chvíli.",
        en: "This App sent too many questions to ARES within a minute. Try again in a moment.",
      });
    }
    calls.push(at);
    let response: Response;
    try {
      response = await call(`${ARES_URL}/${ico}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 404) {
      kept.set(ico, { at, company: null });
      throw unknown(ico);
    }
    if (!response.ok) throw unavailable();
    const body = await response.json().catch(() => null);
    const company = companyOf(ico, body);
    if (!company) throw unavailable();
    kept.set(ico, { at, company });
    return company;
  };
}
