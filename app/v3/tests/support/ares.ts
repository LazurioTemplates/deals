import { createAres } from "../../src/server/ares.ts";

/** An ARES answer of a fictional company, shaped as ARES gives it. */
export const ARES_BODY = {
  ico: "00000001",
  obchodniJmeno: "Smyšlená Strojírna s.r.o.",
  dic: "CZ00000001",
  sidlo: {
    kodStatu: "CZ",
    nazevStatu: "Česká republika",
    nazevObce: "Brno",
    nazevUlice: "Ukázková",
    cisloDomovni: 1234,
    cisloOrientacni: 12,
    cisloOrientacniPismeno: "a",
    psc: 60200,
  },
};

/** A stub of ARES: answers the fictional company, counts its calls, never the network. */
export function aresStub(answer: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    return answer(url);
  };
  return { calls, client: createAres({ fetch }) };
}
