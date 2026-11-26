import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { deriveDraftPanel } from "@lazurio/repository-db";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryStore } from "../src/data/memory-store.ts";
import type { DealsStore } from "../src/data/store.ts";
import type { DataSet } from "../src/domain/collections.ts";
import type { Company } from "../src/domain/company.ts";
import type { Contact } from "../src/domain/contact.ts";
import type { Deal } from "../src/domain/deal.ts";
import type { Locale } from "../src/i18n/locale.ts";
import { createApi } from "../src/server/api.ts";
import { type AppData, detailKey, loadAppData } from "../src/ui/App.tsx";
import { ApiError, api, type Stored } from "../src/ui/api.ts";
import { englishModel } from "../src/ui/components/DraftCard.tsx";
import {
  afterSave,
  ChangedNotice,
  driftOf,
  followRecord,
  formLocked,
  isTouched,
  openForm,
  type RecordForm,
} from "../src/ui/edit.tsx";
import { formatIn, LocaleContext } from "../src/ui/i18n.tsx";
import { CompanyListPage } from "../src/ui/pages/CompanyListPage.tsx";
import { CompanyPage, companyFormOf, submitCompany } from "../src/ui/pages/CompanyPage.tsx";
import { ContactListPage } from "../src/ui/pages/ContactListPage.tsx";
import { ContactPage, contactFormOf, submitContact } from "../src/ui/pages/ContactPage.tsx";
import { DealListPage } from "../src/ui/pages/DealListPage.tsx";
import { DealPage, dealFormOf, submitDeal } from "../src/ui/pages/DealPage.tsx";
import { ForecastPage } from "../src/ui/pages/ForecastPage.tsx";
import { ImportPage } from "../src/ui/pages/ImportPage.tsx";
import { OverviewPage } from "../src/ui/pages/OverviewPage.tsx";
import { PricebookPage } from "../src/ui/pages/PricebookPage.tsx";
import { QuoteListPage } from "../src/ui/pages/QuoteListPage.tsx";
import { QuotePage } from "../src/ui/pages/QuotePage.tsx";
import { QuotePrintPage } from "../src/ui/pages/QuotePrintPage.tsx";
import { SalespeopleListPage } from "../src/ui/pages/SalespeopleListPage.tsx";
import { SalespersonPage } from "../src/ui/pages/SalespersonPage.tsx";
import {
  freshId,
  SettingsPage,
  settingsFormOf,
  submitSettings,
} from "../src/ui/pages/SettingsPage.tsx";
import { StatsPage } from "../src/ui/pages/StatsPage.tsx";
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
    salespeople: (data.salespeople ?? []).map(stored),
    companies: data.companies.map(stored),
    contacts: data.contacts.map(stored),
    deals: data.deals.map(stored),
    activities: data.activities.map(stored),
    pricebook: (data.pricebook ?? []).map(stored),
    quotes: (data.quotes ?? []).map(stored),
    forecastEntries: (data.forecastEntries ?? []).map(stored),
    forecastNotes: (data.forecastNotes ?? []).map(stored),
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
    open: render(locale, <DealListPage data={data} tab="open" />),
    lost: render(locale, <DealListPage data={data} tab="lost" />),
    deal: render(
      locale,
      <DealPage
        data={data}
        id="D-2026-0004"
        company={null}
        stage={null}
        onChanged={changed}
        today={TODAY}
      />,
    ),
    wonDeal: render(
      locale,
      <DealPage
        data={data}
        id="D-2026-0011"
        company={null}
        stage={null}
        onChanged={changed}
        today={TODAY}
      />,
    ),
    newDeal: render(
      locale,
      <DealPage
        data={data}
        id={null}
        company="C-0001"
        stage={null}
        onChanged={changed}
        today={TODAY}
      />,
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
    quotes: render(locale, <QuoteListPage data={data} onChanged={changed} today={TODAY} />),
    quote: render(locale, <QuotePage data={data} id="Q-2026-0001-r2" onChanged={changed} />),
    quotePrint: render(locale, <QuotePrintPage data={data} id="Q-2026-0001-r2" />),
    pricebook: render(locale, <PricebookPage data={data} onChanged={changed} />),
    salespeople: render(locale, <SalespeopleListPage data={data} />),
    salesperson: render(locale, <SalespersonPage data={data} id="S-0001" onChanged={changed} />),
    forecast: render(locale, <ForecastPage data={data} onChanged={changed} today={TODAY} />),
    stats: render(locale, <StatsPage data={data} today={TODAY} />),
    import: render(locale, <ImportPage data={data} onChanged={changed} />),
  };
}

describe("routes", () => {
  test("every page round-trips through its hash", () => {
    const routes: Route[] = [
      { page: "overview" },
      { page: "deals", tab: "all" },
      { page: "deals", tab: "won" },
      { page: "deals", tab: "lost" },
      { page: "new-deal", company: null, stage: null },
      { page: "new-deal", company: "C-0001", stage: "proposal" },
      { page: "quotes" },
      { page: "quote", id: "Q-2026-0001-r2" },
      { page: "quote-print", id: "Q-2026-0001-r2" },
      { page: "pricebook" },
      { page: "salespeople" },
      { page: "new-salesperson" },
      { page: "salesperson", id: "S-0001" },
      { page: "forecast" },
      { page: "stats" },
      { page: "import" },
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
    for (const link of [
      "#/deals/D-2026-0001",
      "#/companies/C-0001",
      "#/contacts/P-0001",
      "#/quotes/Q-2026-0001-r1",
      "#/salespeople/S-0001",
      "#/pricebook",
      "#/forecast",
    ]) {
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
    // This month's forecast: the paid service fee of November.
    expect(html.overview).toContain(nb("24 000,00 Kč"));
    // Invoiced and unpaid: the deposit of D-2026-0011 and the consulting row.
    expect(html.overview).toContain("Na cestě");
    expect(html.overview).toContain(nb("170 780,00 Kč"));
    // D-2026-0008 was expected on 30. 10. 2026.
    expect(html.overview).toContain("po termínu");
    // The last 90 days: three won and two lost.
    expect(html.overview).toContain(nb("60 %"));
    expect(html.overview).toContain("71 dní");
  });

  test("the deals: tabs, a deal with its activities, closing", () => {
    expect(html.deals).toContain("Všechny případy");
    expect(html.deals).toContain("Hodnota aktivních");
    expect(html.deals).toContain(nb("2 435 900,10 Kč"));
    expect(html.deals).toContain(nb("759 400,00 Kč"));
    expect(html.open).toContain("Aktivní");
    expect(html.open).not.toContain("Vybavení prodejny");
    expect(html.lost).toContain("Konkurence");
    expect(html.lost).not.toContain("Vybavení prodejny");
    expect(html.deal).toContain("Chladicí vozy do flotily");
    expect(html.deal).toContain("Vyhráno");
    expect(html.deal).toContain("Ztraceno");
    expect(html.deal).toContain("Aktivity");
    expect(html.deal).toContain("Poslat upravené podmínky");
    expect(html.wonDeal).toContain("Upravit uzavření");
    expect(html.wonDeal).toContain("Znovu otevřít");
    expect(html.wonDeal).toContain("Plán plateb");
    expect(html.wonDeal).toContain("Cenové nabídky");
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
    expect(html.overview).toContain(nb("CZK 170,780.00"));
    expect(html.overview).toContain("71 days");
    expect(html.deals).toContain("Value of won deals");
    expect(html.forecast).toContain("Forecast 2026");
    expect(html.quotes).toContain("Quotes");
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
    expect(html.deals).toContain("Zatím žádný obchodní případ.");
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

/**
 * The interface's API client over the real HTTP API and a memory store, in
 * this process: `fetch` of the page answers through the server's handler, so
 * every page of a test is one browser tab over the same store.
 */
function serveInProcess(): { store: DealsStore; handle: (request: Request) => Promise<Response> } {
  const origin = "http://127.0.0.1:24941";
  const store = createMemoryStore(sampleData("cs"));
  const handle = createApi(store, {
    allowedOrigins: new Set([origin]),
    access: () => ({ admitted: true, mayWrite: true }),
    today: () => TODAY,
  });
  const fetchInProcess = (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    return handle(new Request(new URL(String(input), origin), { ...init, headers }));
  };
  globalThis.fetch = fetchInProcess as typeof fetch;
  return { store, handle };
}

describe("a form over a record that changes meanwhile", () => {
  const realFetch = globalThis.fetch;
  let store: DealsStore;
  beforeEach(() => {
    ({ store } = serveInProcess());
  });
  afterEach(() => {
    store.close();
    globalThis.fetch = realFetch;
  });

  /** A record's form as the page builds and sends it. */
  interface Case<T, F> {
    name: string;
    open: (data: AppData) => Stored<T> | undefined;
    formOf: (data: AppData) => (value: T | undefined) => F;
    /** What the person types into the open form. */
    typed: Partial<F>;
    /** What the colleague saves meanwhile, and how to read it back. */
    colleague: (stored: Stored<T>) => Promise<unknown>;
    colleagues: (value: T) => unknown;
    submit: (data: AppData, base: Stored<T> | undefined, form: F) => Promise<Stored<T>>;
  }

  const f = formatIn("cs", "CZK");
  const deal: Case<Deal, ReturnType<typeof dealFormOf>> = {
    name: "a deal",
    open: (data) => data.deals.find((entry) => entry.value.id === "D-2026-0004"),
    formOf: (data) => (value) => dealFormOf(value, data.settings.value, f, null),
    typed: { title: "Chladicí vozy, upravená nabídka" },
    colleague: (stored) =>
      api.saveDeal({ ...stored.value, description: "Popis kolegy" }, stored.revision),
    colleagues: (value) => value.description,
    submit: (data, base, form) => submitDeal(base, form, data.settings.value, f),
  };
  const company: Case<Company, ReturnType<typeof companyFormOf>> = {
    name: "a company",
    open: (data) => data.companies.find((entry) => entry.value.id === "C-0002"),
    formOf: () => (value) => companyFormOf(value, "Česká republika"),
    typed: { note: "Moje poznámka" },
    colleague: (stored) =>
      api.saveCompany({ ...stored.value, website: "https://kolega.example" }, stored.revision),
    colleagues: (value) => value.website,
    submit: (_data, base, form) => submitCompany(base, form),
  };
  const contact: Case<Contact, ReturnType<typeof contactFormOf>> = {
    name: "a contact",
    open: (data) => data.contacts.find((entry) => entry.value.id === "P-0004"),
    formOf: () => (value) => contactFormOf(value, null),
    typed: { role: "Moje role" },
    colleague: (stored) =>
      api.saveContact({ ...stored.value, phone: "+420 000 000 111" }, stored.revision),
    colleagues: (value) => value.phone,
    submit: (_data, base, form) => submitContact(base, form),
  };

  async function staleSave<T, F>(which: Case<T, F>) {
    // The person opens the form and types.
    const opened = await loadAppData();
    const record = which.open(opened);
    if (!record) throw new Error(`${which.name} missing`);
    const formOf = which.formOf(opened);
    let state: RecordForm<T, F> = openForm(record, formOf);
    state = { ...state, form: { ...state.form, ...which.typed } };

    // A colleague saves a change, then the person adds an activity, which
    // reloads the data under the open form.
    await which.colleague(record);
    await api.createActivity({
      dealId: "D-2026-0004",
      type: "note",
      at: "2026-11-25T09:00:00+01:00",
      summary: "Aktivita během úprav",
    });
    const reloaded = await loadAppData();
    const current = which.open(reloaded);
    if (!current) throw new Error(`${which.name} missing after the reload`);
    state = followRecord(state, current, which.formOf(reloaded));

    // The reload kept the typed values and the revision they came from.
    expect(state.form).toMatchObject(which.typed as object);
    expect(state.base?.revision).toBe(record.revision);
    expect(driftOf(state.base, current)).toBe("changed");

    // The save sends that revision and is refused; the colleague's change stays.
    const refused = await which.submit(reloaded, state.base, state.form).catch((error) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ code: "record_changed", currentRevision: current.revision });
    expect((refused as ApiError).message).toContain("někdo jiný");
    const after = which.open(await loadAppData());
    expect(after?.revision).toBe(current.revision);
    expect(which.colleagues(after?.value as T)).toBe(which.colleagues(current.value));
    expect(state.form).toMatchObject(which.typed as object);

    // Loading the current version takes the colleague's change; the save goes through.
    const fresh = openForm(current, which.formOf(reloaded));
    const saved = await which.submit(reloaded, fresh.base, {
      ...fresh.form,
      ...which.typed,
    });
    expect(which.colleagues(saved.value)).toBe(which.colleagues(current.value));
  }

  /**
   * A save that answers late: the fields stay editable while it waits, and
   * what the person types meanwhile stays in the form, unsaved, on top of
   * the stored record; the next save sends the stored revision and keeps it.
   */
  async function slowSave<T, F>(which: Case<T, F>, later: Partial<F>) {
    const opened = await loadAppData();
    const record = which.open(opened);
    if (!record) throw new Error(`${which.name} missing`);
    const formOf = which.formOf(opened);
    let state: RecordForm<T, F> = openForm(record, formOf);
    state = { ...state, form: { ...state.form, ...which.typed } };
    const submitted = state.form;
    // The save is sent; before it answers, the person types on.
    let answer!: (value: Stored<T>) => void;
    const answered = new Promise<Stored<T>>((resolve) => {
      answer = resolve;
    });
    const sending = which.submit(opened, state.base, submitted).then(answer);
    state = { ...state, form: { ...state.form, ...later } };
    await sending;
    const stored = await answered;
    state = afterSave(state, stored, submitted, formOf);

    // The typing during the save stays, on top of what was stored.
    expect(state.form).toMatchObject({ ...which.typed, ...later } as object);
    expect(state.base?.revision).toBe(stored.revision);
    expect(isTouched(state, formOf)).toBe(true);
    // The reload after the save keeps it too.
    const reloaded = await loadAppData();
    state = followRecord(state, which.open(reloaded), which.formOf(reloaded));
    expect(state.form).toMatchObject(later as object);
    // The next save goes through and stores it.
    const next = await which.submit(reloaded, state.base, state.form);
    expect(formOf(next.value)).toMatchObject({ ...which.typed, ...later } as object);

    // Without typing during the save, the form continues from what was stored.
    const quiet = afterSave(
      { ...openForm(next, formOf), form: formOf(next.value) },
      next,
      formOf(next.value),
      formOf,
    );
    expect(isTouched(quiet, formOf)).toBe(false);
  }

  test("a new record's form takes no input while its save waits; an existing one does", () => {
    // New: the save opens the record's page, so typing meanwhile has nowhere to stay.
    expect(formLocked(true, true, true)).toBe(true);
    expect(formLocked(true, false, true)).toBe(false);
    // Existing: the form stays open and keeps what is typed (afterSave).
    expect(formLocked(true, true, false)).toBe(false);
    // A copy that may not write never takes input.
    expect(formLocked(false, false, false)).toBe(true);
    expect(formLocked(false, false, true)).toBe(true);
  });

  test("a deal: what is typed while a save waits stays in the form", () =>
    slowSave(deal, { description: "Dopsáno během ukládání" }));
  test("a company: what is typed while a save waits stays in the form", () =>
    slowSave(company, { website: "https://dopsano.example" }));
  test("a contact: what is typed while a save waits stays in the form", () =>
    slowSave(contact, { phone: "+420 000 000 222" }));

  test("a deal: a stale save is refused and keeps the colleague's change and the values", () =>
    staleSave(deal));
  test("a company: a stale save is refused and keeps the colleague's change and the values", () =>
    staleSave(company));
  test("a contact: a stale save is refused and keeps the colleague's change and the values", () =>
    staleSave(contact));

  test("an untouched form follows the record as it is stored now", async () => {
    const opened = await loadAppData();
    const record = deal.open(opened);
    if (!record) throw new Error("D-2026-0004 missing");
    const state = openForm(record, deal.formOf(opened));
    await deal.colleague(record);
    const reloaded = await loadAppData();
    const current = deal.open(reloaded);
    const followed = followRecord(state, current, deal.formOf(reloaded));
    expect(followed.base?.revision).toBe(current?.revision as string);
    expect(followed.form.description).toBe("Popis kolegy");
    // A reload that changed nothing keeps the very same form.
    expect(followRecord(followed, current, deal.formOf(reloaded))).toBe(followed);
  });

  test("the settings: the edits outlive a reload, and a stale save is record_changed", async () => {
    const opened = await loadAppData();
    let state = openForm(opened.settings, settingsFormOf);
    state = {
      ...state,
      form: {
        ...state.form,
        types: [...state.form.types, { key: "new-1", id: "", label: "Nový typ" }],
      },
    };

    // A colleague renames a stage; another action reloads the data.
    await api.saveSettings(
      {
        ...opened.settings.value,
        stages: opened.settings.value.stages.map((stage, index) =>
          index === 0 ? { ...stage, label: "Zájemce" } : stage,
        ),
      },
      opened.settings.revision,
    );
    await api.createActivity({
      dealId: "D-2026-0004",
      type: "note",
      at: "2026-11-25T09:00:00+01:00",
      summary: "Jiná akce",
    });
    const reloaded = await loadAppData();
    // The settings page stays mounted on a copy that writes, whatever the revision.
    expect(detailKey("settings", opened.settings.revision, true)).toBe(
      detailKey("settings", reloaded.settings.revision, true),
    );
    state = followRecord(state, reloaded.settings, settingsFormOf);
    expect(state.form.types.at(-1)?.label).toBe("Nový typ");
    expect(state.base?.revision).toBe(opened.settings.revision);
    expect(driftOf(state.base, reloaded.settings)).toBe("changed");

    const refused = await submitSettings(state.base ?? opened.settings, state.form).catch(
      (error) => error,
    );
    expect(refused).toMatchObject({
      code: "record_changed",
      currentRevision: reloaded.settings.revision,
    });
    const after = await loadAppData();
    expect(after.settings.value.stages[0]?.label).toBe("Zájemce");
    expect(after.settings.value.dealTypes).toEqual(opened.settings.value.dealTypes);
  });

  test("the settings: what is typed while a save waits stays in the form", async () => {
    const opened = await loadAppData();
    let state = openForm(opened.settings, settingsFormOf);
    state = {
      ...state,
      form: {
        ...state.form,
        types: [...state.form.types, { key: "new-1", id: "", label: "Nový typ" }],
      },
    };
    const submitted = state.form;
    const sending = submitSettings(opened.settings, submitted);
    // The person switches the ARES lookup on before the save answers.
    state = { ...state, form: { ...state.form, ares: true } };
    const stored = await sending;
    state = afterSave(state, stored, submitted, settingsFormOf);
    expect(state.form.types.at(-1)?.label).toBe("Nový typ");
    expect(state.form.ares).toBe(true);
    expect(state.base?.revision).toBe(stored.revision);
    expect(stored.value.aresLookup).toBe(false);
    expect(isTouched(state, settingsFormOf)).toBe(true);
    const next = await submitSettings(state.base ?? stored, state.form);
    expect(next.value.aresLookup).toBe(true);
    expect(next.value.dealTypes).toContainEqual({ id: "novy-typ", label: "Nový typ" });
  });

  test("the notice says what happened and offers the current version or going on", () => {
    const noop = () => {};
    const changedCs = render(
      "cs",
      <ChangedNotice drift="changed" refused={false} onLoadCurrent={noop} onKeepEditing={noop} />,
    );
    expect(changedCs).toContain("Záznam mezitím změnil někdo jiný.");
    expect(changedCs).toContain("Vaše rozpracované úpravy zůstávají ve formuláři.");
    expect(changedCs).toContain("Načíst aktuální verzi");
    expect(changedCs).toContain("Pokračovat v úpravách");
    const refusedCs = render(
      "cs",
      <ChangedNotice drift="changed" refused settings onLoadCurrent={noop} onKeepEditing={noop} />,
    );
    expect(refusedCs).toContain("Neuloženo. Nastavení mezitím změnil někdo jiný.");
    const refusedEn = render(
      "en",
      <ChangedNotice drift="changed" refused onLoadCurrent={noop} onKeepEditing={noop} />,
    );
    expect(refusedEn).toContain("Not saved. Someone else changed the record meanwhile.");
    expect(refusedEn).toContain("Load the current version");
    expect(refusedEn).toContain("Keep editing");
    expect(refusedEn.match(/[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚ]+/g) ?? []).toEqual([]);
  });
});

describe("two pages over one store", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a write of one page reaches the lists and the overview of the other", async () => {
    const { store, handle } = serveInProcess();
    // The other page listens to the server's events, as `subscribe` of the client does.
    const stop = new AbortController();
    const events = await handle(
      new Request("http://127.0.0.1:24941/api/events", { signal: stop.signal }),
    );
    const reader = (events.body as ReadableStream<Uint8Array | string>).getReader();
    let heard = "";
    const hear = async (type: string) => {
      while (!heard.includes(`event: ${type}`)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the stream ended before ${type}`);
        heard += typeof value === "string" ? value : new TextDecoder().decode(value);
      }
      heard = "";
    };
    try {
      const other = await loadAppData();
      expect(other.deals.some((entry) => entry.value.title === "Vybavení recepce")).toBe(false);

      // This page creates a deal and renames another one.
      await api.createDeal({
        title: "Vybavení recepce",
        companyId: "C-0001",
        ownerId: "S-0001",
        stageId: "qualified",
        value: 6_400_000,
        expectedClose: "2027-03-31",
      });
      await hear("records-changed");
      const renamed = other.deals.find((entry) => entry.value.id === "D-2026-0004");
      if (!renamed) throw new Error("D-2026-0004 missing");
      await api.saveDeal({ ...renamed.value, title: "Přejmenovaný případ" }, renamed.revision);
      await hear("records-changed");

      // The other page reloads on the event, as the App does.
      const reloaded = await loadAppData();
      const overview = render(
        "cs",
        <OverviewPage data={reloaded} onChanged={changed} today={TODAY} />,
      );
      const list = render("cs", <DealListPage data={reloaded} tab="all" />);
      for (const shown of [overview, list]) {
        expect(shown).toContain("Vybavení recepce");
        expect(shown).toContain("Přejmenovaný případ");
      }
      expect(list).toContain(">10</span>");
    } finally {
      stop.abort();
      store.close();
    }
  });
});
