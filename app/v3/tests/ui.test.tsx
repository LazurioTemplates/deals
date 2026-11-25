import { describe, expect, test } from "bun:test";
import { deriveDraftPanel } from "@lazurio/repository-db";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataSet } from "../src/domain/collections.ts";
import type { Locale } from "../src/i18n/locale.ts";
import { type AppData, detailKey } from "../src/ui/App.tsx";
import { englishModel } from "../src/ui/components/DraftCard.tsx";
import { LocaleContext } from "../src/ui/i18n.tsx";
import { CompanyListPage } from "../src/ui/pages/CompanyListPage.tsx";
import { CompanyPage } from "../src/ui/pages/CompanyPage.tsx";
import { ContactListPage } from "../src/ui/pages/ContactListPage.tsx";
import { ContactPage } from "../src/ui/pages/ContactPage.tsx";
import { DealListPage } from "../src/ui/pages/DealListPage.tsx";
import { DealPage } from "../src/ui/pages/DealPage.tsx";
import { OverviewPage } from "../src/ui/pages/OverviewPage.tsx";
import { freshId, SettingsPage } from "../src/ui/pages/SettingsPage.tsx";
import { href, parseRoute, type Route } from "../src/ui/routes.ts";
import { withOffset } from "../src/ui/time.ts";
import { followWriteStatus, statusRetryDelay, WriteContext } from "../src/ui/write.tsx";
import { sampleData, TODAY } from "./support/seed.ts";

const stored = <T,>(value: T) => ({ value, revision: "r" });

/** Amounts and rates part their groups and units with non-breaking spaces. */
const nb = (value: string) => value.replaceAll(" ", "\u00a0");

function appDataOf(data: DataSet & { settings: NonNullable<DataSet["settings"]> }): AppData {
  return {
    settings: stored(data.settings),
    companies: data.companies.map(stored),
    contacts: data.contacts.map(stored),
    deals: data.deals.map(stored),
    activities: data.activities.map(stored),
  };
}

const appData = (locale: Locale) => appDataOf(sampleData(locale));

/** A page as a person with the writer sees it, unless `canWrite` says otherwise. */
function render(locale: Locale, node: ReactNode, canWrite: boolean | null = true): string {
  return renderToStaticMarkup(
    <LocaleContext.Provider value={locale}>
      <WriteContext.Provider value={canWrite}>{node}</WriteContext.Provider>
    </LocaleContext.Provider>,
  );
}

const changed = async () => {};

/** Every page over a data set. */
function pages(locale: Locale, data: AppData = appData(locale)): Record<string, string> {
  return {
    overview: render(locale, <OverviewPage data={data} onChanged={changed} today={TODAY} />),
    deals: render(locale, <DealListPage data={data} tab="all" />),
    lost: render(locale, <DealListPage data={data} tab="lost" />),
    deal: render(
      locale,
      <DealPage data={data} id="D-2026-0004" company={null} onChanged={changed} today={TODAY} />,
    ),
    wonDeal: render(
      locale,
      <DealPage data={data} id="D-2026-0010" company={null} onChanged={changed} today={TODAY} />,
    ),
    newDeal: render(
      locale,
      <DealPage data={data} id={null} company="C-0001" onChanged={changed} today={TODAY} />,
    ),
    companies: render(locale, <CompanyListPage data={data} />),
    company: render(locale, <CompanyPage data={data} id="C-0002" onChanged={changed} />),
    newCompany: render(locale, <CompanyPage data={data} id={null} onChanged={changed} />),
    contacts: render(locale, <ContactListPage data={data} />),
    contact: render(
      locale,
      <ContactPage data={data} id="P-0004" company={null} onChanged={changed} />,
    ),
    settings: render(locale, <SettingsPage data={data} onChanged={changed} />),
  };
}

describe("routes", () => {
  test("every page round-trips through its hash", () => {
    const routes: Route[] = [
      { page: "overview" },
      { page: "deals", tab: "all" },
      { page: "deals", tab: "won" },
      { page: "deals", tab: "lost" },
      { page: "new-deal", company: null },
      { page: "new-deal", company: "C-0001" },
      { page: "deal", id: "D-2026-0002" },
      { page: "companies" },
      { page: "new-company" },
      { page: "company", id: "C-0001" },
      { page: "contacts" },
      { page: "new-contact", company: "C-0002" },
      { page: "contact", id: "P-0001" },
      { page: "settings" },
      { page: "draft" },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
    expect(parseRoute("#/deals?tab=nonsense")).toEqual({ page: "deals", tab: "all" });
    expect(parseRoute("#/nowhere/at/all").page).toBe("not-found");
  });

  test("the review's links open the record's page", () => {
    for (const link of ["#/deals/D-2026-0001", "#/companies/C-0001", "#/contacts/P-0001"]) {
      expect(parseRoute(link).page).not.toBe("not-found");
    }
  });
});

describe("pages in Czech", () => {
  const html = pages("cs");

  test("the overview: the pipeline, the forecast and the period", () => {
    expect(html.overview).toContain("Přehled obchodu");
    for (const stage of ["Nový kontakt", "Ověřená potřeba", "Nabídka", "Jednání"]) {
      expect(html.overview).toContain(stage);
    }
    expect(html.overview).not.toContain("<h3>Vyhráno</h3>");
    // Lead: D-2026-0001 and D-2026-0007, 210 000 Kč.
    expect(html.overview).toContain("2 případy");
    expect(html.overview).toContain(nb("210 000,00 Kč"));
    // The forecast of the sample, counted by hand (tests/forecast.test.ts).
    expect(html.overview).toContain(nb("287 175,12 Kč"));
    expect(html.overview).toContain(nb("802 625,19 Kč"));
    expect(html.overview).toContain("Bez data");
    // D-2026-0008 was expected on 30. 10. 2026.
    expect(html.overview).toContain("po termínu");
    // The last 90 days: 28. 8. – 25. 11. 2026, three won and two lost.
    expect(html.overview).toContain('value="2026-08-28"');
    expect(html.overview).toContain(nb("60 %"));
    expect(html.overview).toContain("71 dní");
  });

  test("the deals: tabs, a deal with its activities, closing", () => {
    expect(html.deals).toContain("Všechny (14)");
    expect(html.deals).toContain("Otevřené (9)");
    expect(html.deals).toContain("Vyhrané (3)");
    expect(html.deals).toContain("Ztracené (2)");
    expect(html.lost).toContain("Konkurence");
    expect(html.lost).not.toContain("Vybavení prodejny");
    expect(html.deal).toContain("Chladicí vozy do flotily");
    expect(html.deal).toContain("Vyhráno");
    expect(html.deal).toContain("Ztraceno");
    expect(html.deal).toContain("Aktivity");
    expect(html.deal).toContain("Poslat upravené podmínky");
    expect(html.wonDeal).toContain("Upravit uzavření");
    expect(html.wonDeal).toContain("Znovu otevřít");
    expect(html.newDeal).toContain("Nový obchodní případ");
  });

  test("companies, contacts and settings", () => {
    expect(html.companies).toContain("Vzorová Logistika a.s.");
    expect(html.company).toContain("Rámcová smlouva na přepravu");
    expect(html.company).toContain("Lenka Vzorová");
    expect(html.contacts).toContain("lenka.vzorova@vzorova-logistika.example");
    expect(html.contact).toContain("Martin Modelový");
    expect(html.settings).toContain("Fáze pipeline");
    expect(html.settings).toContain("Důvody ztráty");
  });
});

describe("pages in English", () => {
  const html = pages("en");

  test("say the same in English", () => {
    expect(html.overview).toContain("Sales overview");
    expect(html.overview).toContain(nb("CZK 802,625.19"));
    expect(html.overview).toContain("71 days");
    expect(html.deals).toContain("Won (3)");
    expect(html.deal).toContain("Activities");
    expect(html.settings).toContain("Pipeline stages");
  });

  test("mix no Czech into an English screen", () => {
    // Labels, hints, placeholders and accessible names included.
    for (const [page, markup] of Object.entries(html)) {
      expect({ page, czech: markup.match(/[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚ]+/g) ?? [] }).toEqual({
        page,
        czech: [],
      });
    }
  });
});

describe("ARES on a company's page", () => {
  test("the button shows only while the settings turn ARES on", () => {
    const data = appData("cs");
    const off = render("cs", <CompanyPage data={data} id="C-0001" onChanged={changed} />);
    expect(off).not.toContain("Dohledat v ARES");
    const on = {
      ...data,
      settings: stored({ ...data.settings.value, aresLookup: true }),
    };
    expect(render("cs", <CompanyPage data={on} id="C-0001" onChanged={changed} />)).toContain(
      "Dohledat v ARES",
    );
    expect(
      render("cs", <CompanyPage data={on} id="C-0001" onChanged={changed} />, false),
    ).not.toContain("Dohledat v ARES");
  });
});

describe("the worst real data", () => {
  const long =
    "Nejneobhospodařovávatelnějšími Kancelářskými Prostory Společnosti s Opravdu Dlouhým Názvem";

  test("long names, zero, huge amounts and a one-letter title render", () => {
    const sample = sampleData("cs");
    const [first, ...rest] = sample.deals;
    if (!first) throw new Error("no deal");
    const data = appDataOf({
      ...sample,
      companies: sample.companies.map((company, index) =>
        index === 0 ? { ...company, name: `${long} a.s.` } : company,
      ),
      deals: [
        { ...first, title: long, value: 99_999_999_999_999 },
        { ...first, id: "D-2026-0099", title: "X", value: 0 },
        ...rest,
      ],
    });
    const html = pages("cs", data);
    expect(html.overview).toContain(long);
    expect(html.overview).toContain(nb("999 999 999 999,99 Kč"));
    expect(html.overview).toContain(nb("0,00 Kč"));
    expect(html.deals).toContain(">X</a>");
  });

  test("empty data says what to do next", () => {
    const empty = sampleData("cs");
    const data = appDataOf({ ...empty, companies: [], contacts: [], deals: [], activities: [] });
    const html = pages("cs", data);
    expect(html.overview).toContain("Žádný případ.");
    expect(html.overview).toContain("0 případů");
    expect(html.deals).toContain("Žádný případ v této záložce.");
    expect(html.companies).toContain("Zatím žádná firma.");
    expect(html.contacts).toContain("Zatím žádný kontakt.");
    expect(html.newDeal).toContain("Nejdřív založte firmu.");
  });
});

describe("the Draft & Publish card in English", () => {
  test("keeps the engine's state and actions and words them in English", () => {
    const model = deriveDraftPanel({
      status: {
        state: "draft",
        branch: "v3",
        ahead: 0,
        behind: 0,
        dirtyPaths: ["data/deals/D-2026-0001.yaml"],
        head: null,
        conflict: false,
        fetched: true,
      },
      revision: "r1",
    });
    const english = englishModel(model);
    expect(english.tone).toBe("draft");
    expect(english.pill).toBe("Draft");
    expect(english.headline).toBe("One change waits to be published.");
    expect(english.actions.map((action) => [action.kind, action.label, action.enabled])).toEqual([
      ["publish", "Publish all", true],
      ["discard_draft", "Discard all", true],
    ]);
  });
});

describe("the one writer rule on the page", () => {
  const data = appData("en");
  for (const canWrite of [false, null]) {
    test(`a copy ${canWrite === false ? "that may not write" : "not yet known to write"} offers no change`, () => {
      const shown = [
        render("en", <OverviewPage data={data} onChanged={changed} today={TODAY} />, canWrite),
        render("en", <DealListPage data={data} tab="all" />, canWrite),
        render(
          "en",
          <DealPage data={data} id="D-2026-0004" company={null} onChanged={changed} />,
          canWrite,
        ),
        render("en", <CompanyListPage data={data} />, canWrite),
        render("en", <CompanyPage data={data} id="C-0001" onChanged={changed} />, canWrite),
        render("en", <ContactListPage data={data} />, canWrite),
        render("en", <SettingsPage data={data} onChanged={changed} />, canWrite),
      ].join("\n");
      for (const write of ["#/deals/new", "#/companies/new", "#/contacts/new"])
        expect(shown).not.toContain(write);
      for (const word of ["Move to…", "Add the activity", "Mark as won", ">Won</button>"])
        expect(shown).not.toContain(word);
      expect(shown).not.toContain('type="submit"');
    });
  }

  test("a record's form shows its fields disabled and no save", () => {
    const html = render("en", <CompanyPage data={data} id="C-0001" onChanged={changed} />, false);
    expect(html).toContain('<fieldset class="form-fieldset" disabled="">');
    expect(html).not.toContain("Save to the draft");
  });
});

describe("the page learns whether it may write", () => {
  test("a passing failure of /api/status is asked again until it answers", async () => {
    const answers: (() => Promise<{ mayWrite?: boolean }>)[] = [
      () => Promise.reject(new Error("offline")),
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve({ mayWrite: true }),
    ];
    const waits: number[] = [];
    const known = await new Promise<boolean>((done) => {
      followWriteStatus(
        () => (answers.shift() ?? (() => Promise.resolve({ mayWrite: false })))(),
        done,
        async (ms) => {
          waits.push(ms);
        },
      );
    });
    expect(known).toBe(true);
    expect(waits).toEqual([1_000, 2_000]);
  });

  test("the pause grows and stays at most 30 s", () => {
    expect([1, 2, 3, 6, 20].map(statusRetryDelay)).toEqual([1_000, 2_000, 4_000, 30_000, 30_000]);
  });

  test("a read-only copy opens a record afresh on a new revision", () => {
    expect(detailKey("C-0001", "r1", false)).not.toBe(detailKey("C-0001", "r2", false));
    expect(detailKey("C-0001", "r1", true)).toBe(detailKey("C-0001", "r2", true));
  });
});

describe("small helpers of the interface", () => {
  test("a time as written, with the browser's offset", () => {
    const at = withOffset("2026-11-24T10:00");
    expect(at).toMatch(/^2026-11-24T10:00:00[+-]\d{2}:\d{2}$/);
    expect(withOffset("2026-11-24")).toBeNull();
  });

  test("a new id never repeats one taken", () => {
    expect(freshId("Nová fáze", ["lead"], "stage")).toBe("nova-faze");
    expect(freshId("Nová fáze", ["nova-faze", "nova-faze-2"], "stage")).toBe("nova-faze-3");
    expect(freshId("???", [], "stage")).toBe("stage");
  });
});
