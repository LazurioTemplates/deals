import { describe, expect, test } from "bun:test";
import { icoCheckDigit } from "../src/domain/company.ts";
import { addressOf, companyOf, createAres, normalizeIco } from "../src/server/ares.ts";
import { ARES_BODY } from "./support/ares.ts";

const refusal = async (operation: () => Promise<unknown>) => {
  try {
    await operation();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error("expected a refusal");
};

/** A valid IČO computed from seven digits, never one taken from the world. */
const valid = (first7: string) => `${first7}${icoCheckDigit(first7)}`;

describe("the ARES lookup", () => {
  test("normalizes the IČO to eight digits and checks it modulo 11", () => {
    expect(normalizeIco(" 0000 0001 ")).toBe("00000001");
    expect(normalizeIco("1")).toBe("00000001");
    expect(normalizeIco("123456789")).toBeNull();
    expect(normalizeIco("12a")).toBeNull();
    expect(normalizeIco("")).toBeNull();
  });

  test("never calls ARES for a number that cannot be an IČO", async () => {
    let calls = 0;
    const lookup = createAres({
      fetch: async () => {
        calls += 1;
        return Response.json(ARES_BODY);
      },
    });
    for (const input of ["00000002", "123", "abc", "", "123456789"]) {
      expect(await refusal(() => lookup(input))).toBe("invalid_ico");
    }
    expect(calls).toBe(0);
    // Leading zeros may be left out.
    expect((await lookup("1")).ico).toBe("00000001");
    expect(calls).toBe(1);
  });

  test("maps the name, the VAT id and the seat", () => {
    expect(companyOf("00000001", ARES_BODY)).toEqual({
      ico: "00000001",
      name: "Smyšlená Strojírna s.r.o.",
      dic: "CZ00000001",
      address: {
        street: "Ukázková 1234/12a",
        city: "Brno",
        postalCode: "602 00",
        country: "Česká republika",
      },
    });
    // A village without streets: its part and the house number.
    expect(
      addressOf({
        nazevCastiObce: "Smyšlená Lhota",
        cisloDomovni: 7,
        nazevObce: "Lhota",
        psc: "39601",
      }),
    ).toEqual({ street: "Smyšlená Lhota 7", city: "Lhota", postalCode: "396 01" });
    expect(companyOf("00000001", { obchodniJmeno: "Jen Název s.r.o." })).toEqual({
      ico: "00000001",
      name: "Jen Název s.r.o.",
    });
    expect(companyOf("00000001", { ico: "00000001" })).toBeNull();
    expect(addressOf(null)).toBeUndefined();
  });

  test("keeps an answer for 24 hours, a company ARES does not know too", async () => {
    let now = 0;
    const urls: string[] = [];
    const known = valid("1234567");
    const lookup = createAres({
      now: () => now,
      fetch: async (url) => {
        urls.push(url);
        return url.endsWith(known)
          ? Response.json({ ...ARES_BODY, ico: known })
          : new Response("{}", { status: 404 });
      },
    });
    await lookup(known);
    await lookup(known);
    expect(await refusal(() => lookup("00000001"))).toBe("ares_not_found");
    expect(await refusal(() => lookup("00000001"))).toBe("ares_not_found");
    expect(urls).toHaveLength(2);
    now = 24 * 60 * 60 * 1000 - 1;
    await lookup(known);
    expect(urls).toHaveLength(2);
    now = 24 * 60 * 60 * 1000;
    await lookup(known);
    expect(urls).toHaveLength(3);
  });

  test("sends at most 30 questions a minute; a kept answer does not count", async () => {
    let now = 0;
    let calls = 0;
    const lookup = createAres({
      now: () => now,
      fetch: async (url) => {
        calls += 1;
        return Response.json({ ...ARES_BODY, ico: url.slice(-8) });
      },
    });
    const icos = Array.from({ length: 31 }, (_, index) =>
      valid(String(index + 1).padStart(7, "0")),
    );
    for (const ico of icos.slice(0, 30)) await lookup(ico);
    expect(await refusal(() => lookup(icos[30] as string))).toBe("ares_rate_limited");
    // A kept answer still comes.
    expect((await lookup(icos[0] as string)).ico).toBe(icos[0] as string);
    expect(calls).toBe(30);
    now = 60_000;
    expect((await lookup(icos[30] as string)).ico).toBe(icos[30] as string);
    expect(calls).toBe(31);
  });

  test("gives up after the time limit and on an answer it cannot read", async () => {
    const slow = createAres({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(await refusal(() => slow("00000001"))).toBe("ares_unavailable");
    const garbled = createAres({ fetch: async () => new Response("<html>", { status: 200 }) });
    expect(await refusal(() => garbled("00000001"))).toBe("ares_unavailable");
    const offline = createAres({
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    expect(await refusal(() => offline("00000001"))).toBe("ares_unavailable");
  });
});
