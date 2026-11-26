import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CHANGES, type DealsStore, readOnly } from "../src/data/store.ts";
import { forecast } from "../src/domain/forecast.ts";
import { errorsOf, warningsOf } from "../src/domain/rules.ts";
import {
  newActivity,
  newCompany,
  newContact,
  newDeal,
  newPricebookItem,
  newSalesperson,
  sampleData,
  TODAY,
} from "./support/seed.ts";

/**
 * The shared test suite of the storage port. Every implementation runs it:
 * the repository-db store of generation v3 and the memory store today, the
 * store of a later engine then. An implementation that passes it can replace
 * another without a change to the server or the UI.
 *
 * `setup` returns a store over the fictional Czech example data.
 */
export function storeContract(
  name: string,
  setup: () => Promise<{ store: DealsStore; cleanup(): void }>,
) {
  describe(`storage port: ${name}`, () => {
    let store: DealsStore;
    let cleanup: () => void;

    beforeEach(async () => {
      ({ store, cleanup } = await setup());
    });
    afterEach(() => {
      store.close();
      cleanup();
    });

    const refusal = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        return (error as { code?: string }).code;
      }
      throw new Error("expected a refusal");
    };

    const refused = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        return error as { code?: string; currentRevision?: string | null };
      }
      throw new Error("expected a refusal");
    };

    test("a read-only view refuses every change and changes nothing", async () => {
      const view = readOnly(store);
      const state = async () => ({
        settings: await store.settings(),
        companies: await store.listCompanies(),
        contacts: await store.listContacts(),
        deals: await store.listDeals(),
        activities: await store.listActivities(),
        pricebook: await store.list("pricebook"),
        notes: await store.list("forecastNotes"),
        draft: (await store.draft()).records?.length ?? 0,
      });
      const before = await state();
      const attempts: Record<keyof typeof CHANGES, () => Promise<unknown>> = {
        saveSettings: () => view.saveSettings(before.settings.value, before.settings.revision),
        saveCompany: () => view.saveCompany(newCompany(), null),
        saveContact: () => view.saveContact(newContact(), null),
        saveDeal: () => view.saveDeal(newDeal(), null),
        saveActivity: () => view.saveActivity(newActivity(), null),
        save: () => view.save("pricebook", newPricebookItem(), null),
        saveAll: () =>
          view.saveAll([
            { collection: "salespeople", value: newSalesperson(), baseRevision: null },
          ]),
        remove: () => view.remove("forecastNotes", "2026-12", "r"),
        publish: () => view.publish({ expectedRevision: "r" }),
        finishSend: () => view.finishSend("h"),
        discard: () => view.discard({ kind: "draft" }, "r"),
        pull: () => view.pull(),
      };
      for (const attempt of Object.values(attempts))
        expect(await refusal(attempt)).toBe("data_read_only");
      expect(await view.listDeals()).toEqual(before.deals);
      expect(await state()).toEqual(before);
    });

    test("reads the settings, companies, contacts, deals and activities in order", async () => {
      expect(await store.available()).toEqual({ ok: true });
      const settings = (await store.settings()).value;
      expect(settings.stages.map((stage) => stage.id)).toEqual([
        "lead",
        "qualified",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ]);
      expect(settings.currency).toBe("CZK");
      const companies = await store.listCompanies();
      expect(companies.map((entry) => entry.value.name)).toEqual([
        "Fiktivní Stavby s.r.o.",
        "Modelový Software s.r.o.",
        "Pokusná Pekárna s.r.o.",
        "Smyšlená Klinika s.r.o.",
        "Ukázka Nábytek s.r.o.",
        "Vzorová Logistika a.s.",
      ]);
      expect(companies.every((entry) => entry.revision.length > 0)).toBe(true);
      expect(await store.listContacts()).toHaveLength(10);
      expect((await store.getContact("P-0006"))?.value.companyId).toBe("C-0004");
      const deals = await store.listDeals();
      expect(deals).toHaveLength(14);
      expect(deals[0]?.value.id).toBe("D-2026-0014");
      expect(deals.at(-1)?.value.id).toBe("D-2026-0001");
      expect((await store.getDeal("D-2026-0004"))?.value.probability).toBe(45);
      expect(await store.getDeal("D-2026-0404")).toBeNull();
      const activities = await store.listActivities();
      expect(activities).toHaveLength(20);
      // Newest first: the task planned for December comes before November's call.
      expect(activities[0]?.value.id).toBe("A-2026-00013");
      expect(activities.at(-1)?.value.id).toBe("A-2026-00004");
      expect((await store.getActivity("A-2026-00015"))?.value.done).toBe(true);
      // The collections of 0.2.0, through the generic reads.
      const people = await store.list("salespeople");
      expect(people.map((entry) => entry.value.name)).toEqual([
        "Jana Ukázková",
        "Karel Příkladný",
        "Petr Vzorný",
      ]);
      expect((await store.list("pricebook")).map((entry) => entry.value.id)).toHaveLength(8);
      // Quotes: the newest number first, its latest revision before the older one.
      expect((await store.list("quotes")).map((entry) => entry.value.id)).toEqual([
        "Q-2026-0006-r1",
        "Q-2026-0005-r1",
        "Q-2026-0004-r1",
        "Q-2026-0003-r1",
        "Q-2026-0002-r1",
        "Q-2026-0001-r2",
        "Q-2026-0001-r1",
      ]);
      expect((await store.list("forecastEntries")).map((entry) => entry.value.id)).toEqual([
        "F-2026-0001",
        "F-2026-0002",
        "F-2026-0003",
      ]);
      expect((await store.get("forecastNotes", "2026-12"))?.value.text).toContain("1. etapy");
      expect(await store.get("quotes", "Q-2026-0404-r1")).toBeNull();
      // The sample has no error and the two warnings it is meant to show.
      const issues = await store.check("en", TODAY);
      expect(errorsOf(issues)).toEqual([]);
      expect(warningsOf(issues).map((issue) => [issue.record, issue.code])).toEqual([
        ["deals/D-2026-0007", "expected_close_missing"],
        ["deals/D-2026-0008", "expected_close_past"],
      ]);
    });

    test("reads every record at once, as the forecast is computed from", async () => {
      const data = await store.readData();
      expect(data.deals).toHaveLength(14);
      expect(data.activities).toHaveLength(20);
      expect(data.salespeople).toHaveLength(3);
      expect(data.quotes).toHaveLength(7);
      expect(data.forecastEntries).toHaveLength(3);
      expect(forecast(data, { today: TODAY })).toEqual(forecast(sampleData(), { today: TODAY }));
    });

    test("a published state has no draft", async () => {
      const card = await store.draft();
      expect(card.status?.state).toBe("published");
      expect(card.records ?? []).toEqual([]);
    });

    test("a new deal becomes a draft with one record, labelled in the asked language", async () => {
      const created = await store.saveDeal(newDeal(), null);
      expect((await store.getDeal("D-2026-0015"))?.revision).toBe(created.revision);
      const card = await store.draft();
      expect(card.status?.state).toBe("draft");
      expect(card.records?.map((record) => record.resource.label)).toEqual([
        "D-2026-0015 · Vybavení recepce",
      ]);
      expect(card.records?.[0]?.resource.metadata?.typeLabel).toBe("Obchodní případ");
      const english = await store.draft("en");
      expect(english.records?.[0]?.resource.metadata?.typeLabel).toBe("Deal");
      expect(english.records?.[0]?.resource.changes[0]?.summary).toBe("New record");
      expect(card.revision).toBeString();
    });

    test("a save names the version it was edited from", async () => {
      const opened = await store.getDeal("D-2026-0002");
      if (!opened) throw new Error("D-2026-0002 missing");
      const saved = await store.saveDeal(
        { ...opened.value, stageId: "negotiation" },
        opened.revision,
      );
      expect(saved.revision).not.toBe(opened.revision);
      // A second editor that opened the old version is refused, not overwritten.
      expect(
        await refusal(() => store.saveDeal({ ...opened.value, value: 1 }, opened.revision)),
      ).toBe("record_changed");
      expect((await store.getDeal("D-2026-0002"))?.value.stageId).toBe("negotiation");
      // A new record under an existing id is refused.
      const taken = await refused(() => store.saveDeal(newDeal("D-2026-0002"), null));
      expect(taken.code).toBe("record_changed");
      expect(taken.currentRevision).toBe(saved.revision);
    });

    test("every write of every collection gives a new revision, also after A → B → A", async () => {
      const settings = await store.settings();
      const company = await store.getCompany("C-0001");
      const contact = await store.getContact("P-0001");
      const deal = await store.getDeal("D-2026-0001");
      const activity = await store.getActivity("A-2026-00001");
      if (!company || !contact || !deal || !activity) throw new Error("sample records missing");
      const generic = new Map<string, { value: object; revision: string }>();
      for (const [collection, id] of [
        ["salespeople", "S-0002"],
        ["pricebook", "I-0001"],
        ["quotes", "Q-2026-0003-r1"],
        ["forecastEntries", "F-2026-0002"],
        ["forecastNotes", "2026-12"],
      ] as const) {
        const found = await store.get(collection, id);
        if (found) generic.set(collection, found);
      }
      const cases = [
        {
          opened: settings,
          edit: { ...settings.value, aresLookup: !settings.value.aresLookup },
          save: (value: unknown, base: string) => store.saveSettings(value as never, base),
          read: async () => (await store.settings()).revision,
        },
        {
          opened: company,
          edit: { ...company.value, name: "Ukázka B s.r.o." },
          save: (value: unknown, base: string) => store.saveCompany(value as never, base),
          read: async () => (await store.getCompany("C-0001"))?.revision,
        },
        {
          opened: contact,
          edit: { ...contact.value, phone: "+420 000 000 999" },
          save: (value: unknown, base: string) => store.saveContact(value as never, base),
          read: async () => (await store.getContact("P-0001"))?.revision,
        },
        {
          opened: deal,
          edit: { ...deal.value, title: "Případ B" },
          save: (value: unknown, base: string) => store.saveDeal(value as never, base),
          read: async () => (await store.getDeal("D-2026-0001"))?.revision,
        },
        {
          opened: activity,
          edit: { ...activity.value, summary: "Hovor B" },
          save: (value: unknown, base: string) => store.saveActivity(value as never, base),
          read: async () => (await store.getActivity("A-2026-00001"))?.revision,
        },
        ...(
          [
            ["salespeople", "S-0002", { role: "Senior obchodník" }],
            ["pricebook", "I-0001", { unitPrice: 1_390_000 }],
            ["quotes", "Q-2026-0003-r1", { title: "Pokladna B" }],
            ["forecastEntries", "F-2026-0002", { title: "Paušál B" }],
            ["forecastNotes", "2026-12", { text: "Poznámka B" }],
          ] as const
        ).map(([collection, id, change]) => {
          const opened = generic.get(collection);
          if (!opened) throw new Error(`${collection}/${id} missing`);
          return {
            opened,
            edit: { ...opened.value, ...change },
            save: (value: unknown, base: string) => store.save(collection, value as never, base),
            read: async () => (await store.get(collection, id))?.revision,
          };
        }),
      ];
      for (const { opened, edit, save, read } of cases) {
        const b = await save(edit, opened.revision);
        const back = await save(opened.value, b.revision);
        // A again: the same content, a new revision each time, never a repeat.
        expect(back.value as unknown).toEqual(opened.value);
        expect(new Set([opened.revision, b.revision, back.revision]).size).toBe(3);
        expect(await read()).toBe(back.revision);
        // The value handed out carries no audit fields.
        for (const field of ["revision", "updatedAt", "updatedBy"]) {
          expect(Object.keys(back.value as object)).not.toContain(field);
        }
        // An editor who opened A or B before is refused, not overwritten, and
        // learns the revision stored now.
        for (const stale of [opened.revision, b.revision]) {
          const error = await refused(() => save(edit, stale));
          expect(error.code).toBe("record_changed");
          expect(error.currentRevision).toBe(back.revision);
        }
        expect(await read()).toBe(back.revision);
      }
    });

    test("no value it hands out or takes in shares a nested object or array with the stored state", async () => {
      const before = await store.getCompany("C-0001");
      if (!before?.value.address) throw new Error("C-0001 has no address");
      // A value read and then changed in place changes nothing stored.
      before.value.address.city = "Jinde";
      const deal = await store.getDeal("D-2026-0002");
      if (!deal?.value.contactIds) throw new Error("D-2026-0002 has no contacts");
      deal.value.contactIds.push("P-0404");
      const listed = await store.listCompanies();
      const first = listed.find((entry) => entry.value.id === "C-0001");
      if (first?.value.address) first.value.address.city = "Jinde";
      const data = await store.readData();
      const read = data.companies.find((company) => company.id === "C-0001");
      if (read?.address) read.address.city = "Jinde";
      const again = await store.getCompany("C-0001");
      expect(again?.value.address?.city).not.toBe("Jinde");
      expect(again?.revision).toBe(before.revision);
      expect((await store.getDeal("D-2026-0002"))?.value.contactIds).not.toContain("P-0404");
      expect((await store.draft()).status?.state).toBe("published");

      // A value saved and then changed in place, or the saved value handed
      // back and changed, changes nothing stored either.
      const input = newCompany();
      const saved = await store.saveCompany(input, null);
      if (!input.address || !saved.value.address) throw new Error("newCompany has no address");
      input.address.city = "Jinde";
      saved.value.address.city = "Jinde";
      const stored = await store.getCompany(input.id);
      expect(stored?.value.address?.city).toBe("Brno");
      expect(stored?.revision).toBe(saved.revision);
    });

    test("a save that changes nothing writes nothing and keeps the revision", async () => {
      const opened = await store.getCompany("C-0002");
      if (!opened) throw new Error("C-0002 missing");
      const saved = await store.saveCompany({ ...opened.value }, opened.revision);
      expect(saved.revision).toBe(opened.revision);
      expect((await store.draft()).records ?? []).toEqual([]);
    });

    test("refuses a record that breaks its schema or a rule across records", async () => {
      const deal = newDeal();
      for (const value of [
        { ...deal, title: "" },
        { ...deal, value: 10.5 },
        { ...deal, value: -1 },
        { ...deal, probability: 101 },
        { ...deal, companyId: "C-0404" },
        { ...deal, contactIds: ["P-0404"] },
        { ...deal, stageId: "nowhere" },
        { ...deal, closedAt: "2026-11-25" },
        { ...deal, lossReasonId: "price" },
        { ...deal, stageId: "won", closedAt: undefined },
        { ...deal, stageId: "won", closedAt: "2026-11-25", value: 0 },
        { ...deal, stageId: "lost", closedAt: "2026-11-25" },
        { ...deal, stageId: "lost", closedAt: "2026-11-25", lossReasonId: "weather" },
        { ...deal, stageId: "won", closedAt: "2026-11-01" },
        // Days the calendar does not have.
        { ...deal, createdAt: "2027-02-31" },
        { ...deal, expectedClose: "2027-02-29" },
        { ...deal, stageId: "lost", closedAt: "2026-04-31", lossReasonId: "price" },
      ]) {
        expect({ value, code: await refusal(() => store.saveDeal(value, null)) }).toEqual({
          value,
          code: "invalid_record",
        });
      }
      expect(await refusal(() => store.saveActivity({ ...newActivity(), done: true }, null))).toBe(
        "invalid_record",
      );
      expect(
        await refusal(() => store.saveActivity({ ...newActivity(), dealId: "D-2026-0404" }, null)),
      ).toBe("invalid_record");
      expect(
        await refusal(() =>
          store.saveActivity({ ...newActivity(), at: "2027-02-31T10:00+01:00" }, null),
        ),
      ).toBe("invalid_record");
      expect(
        await refusal(() => store.saveContact({ ...newContact(), companyId: "C-0404" }, null)),
      ).toBe("invalid_record");
      // An IČO whose check digit is wrong: 0000000 gives the check digit 1.
      expect(
        await refusal(() => store.saveCompany({ ...newCompany(), ico: "00000002" }, null)),
      ).toBe("invalid_record");
      expect((await store.draft()).records ?? []).toEqual([]);
    });

    test("refuses a second company with the same IČO", async () => {
      // 0000000 weighted 8…2 sums to 0, remainder 0, so the check digit is 1.
      const first = await store.saveCompany({ ...newCompany(), ico: "00000001" }, null);
      expect(first.value.ico).toBe("00000001");
      expect(
        await refusal(() =>
          store.saveCompany({ ...newCompany("C-0008", "Druhá s.r.o."), ico: "00000001" }, null),
        ),
      ).toBe("invalid_record");
      expect(await store.getCompany("C-0008")).toBeNull();
    });

    test("a warning never blocks a save", async () => {
      // P-0003 belongs to C-0002, not to the deal's C-0001, and S-0003 has
      // left: warnings. A salesperson who does not exist is an error.
      const saved = await store.saveDeal(
        { ...newDeal(), contactIds: ["P-0003"], ownerId: "S-0003", expectedClose: undefined },
        null,
      );
      expect(saved.value.contactIds).toEqual(["P-0003"]);
      const issues = (await store.check("en", TODAY)).filter(
        (issue) => issue.record === "deals/D-2026-0015",
      );
      expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([
        ["warning", "contact_other_company"],
        ["warning", "expected_close_missing"],
        ["warning", "salesperson_inactive"],
      ]);
      expect(
        await refusal(() => store.saveDeal({ ...newDeal("D-2026-0016"), ownerId: "S-0404" }, null)),
      ).toBe("invalid_record");
    });

    test("a record of any collection is saved, read and listed through the generic port", async () => {
      const person = await store.save("salespeople", newSalesperson(), null);
      expect(person.value).toEqual(newSalesperson());
      expect((await store.get("salespeople", "S-0004"))?.revision).toBe(person.revision);
      expect((await store.list("salespeople")).map((entry) => entry.value.id)).toContain("S-0004");
      const item = await store.save("pricebook", newPricebookItem(), null);
      expect(item.value.unitPrice).toBe(250_000);
      expect(
        await refusal(() =>
          store.save("pricebook", { ...newPricebookItem(), unitPrice: -1 }, null),
        ),
      ).toBe("invalid_record");
      expect(
        (await refused(() => store.save("pricebook", newPricebookItem(), null))).currentRevision,
      ).toBe(item.revision);
      const card = await store.draft("en");
      expect(card.records?.map((record) => record.resource.metadata?.typeLabel).sort()).toEqual([
        "Price list item",
        "Salesperson",
      ]);
    });

    test("saveAll writes records of several collections as one write, or nothing", async () => {
      const deal = await store.getDeal("D-2026-0004");
      const quote = await store.get("quotes", "Q-2026-0002-r1");
      if (!deal || !quote) throw new Error("sample records missing");
      const before = (await store.draft()).records?.length ?? 0;
      // A stale revision of one change refuses the whole write.
      const stale = await refused(() =>
        store.saveAll([
          { collection: "salespeople", value: newSalesperson(), baseRevision: null },
          { collection: "deals", value: { ...deal.value, title: "Nový" }, baseRevision: "stale" },
        ]),
      );
      expect(stale.code).toBe("record_changed");
      expect(stale.currentRevision).toBe(deal.revision);
      expect(await store.get("salespeople", "S-0004")).toBeNull();
      // So does a change that breaks a rule across records.
      expect(
        await refusal(() =>
          store.saveAll([
            { collection: "salespeople", value: newSalesperson(), baseRevision: null },
            {
              collection: "deals",
              value: { ...deal.value, ownerId: "S-0404" },
              baseRevision: deal.revision,
            },
          ]),
        ),
      ).toBe("invalid_record");
      expect(await store.get("salespeople", "S-0004")).toBeNull();
      expect((await store.draft()).records?.length ?? 0).toBe(before);
      // The same record twice in one write is refused.
      expect(
        await refusal(() =>
          store.saveAll([
            { collection: "deals", value: deal.value, baseRevision: deal.revision },
            { collection: "deals", value: deal.value, baseRevision: deal.revision },
          ]),
        ),
      ).toBe("bad_request");
      // A new salesperson and the deal handed to them, together: one depends on the other.
      const [person, moved, revised] = await store.saveAll([
        { collection: "salespeople", value: newSalesperson(), baseRevision: null },
        {
          collection: "deals",
          value: { ...deal.value, ownerId: "S-0004" },
          baseRevision: deal.revision,
        },
        {
          collection: "quotes",
          value: { ...quote.value, title: "Chladicí vozy, revize" },
          baseRevision: quote.revision,
        },
      ]);
      expect(person?.revision).toBe((await store.get("salespeople", "S-0004"))?.revision);
      expect(moved?.revision).toBe((await store.getDeal("D-2026-0004"))?.revision);
      expect(revised?.revision).toBe((await store.get("quotes", "Q-2026-0002-r1"))?.revision);
      expect((await store.getDeal("D-2026-0004"))?.value.ownerId).toBe("S-0004");
      expect((await store.draft()).records).toHaveLength(3);
    });

    test("a removal is a draft, names its revision and is refused while a record names it", async () => {
      const note = await store.get("forecastNotes", "2026-12");
      if (!note) throw new Error("2026-12 missing");
      expect(await refusal(() => store.remove("forecastNotes", "2026-12", "stale"))).toBe(
        "record_changed",
      );
      await store.remove("forecastNotes", "2026-12", note.revision);
      expect(await store.get("forecastNotes", "2026-12")).toBeNull();
      const card = await store.draft("en");
      expect(card.records?.map((record) => record.resource.changes[0]?.kind)).toEqual(["deleted"]);
      // Gone already: a second removal is refused.
      expect(await refusal(() => store.remove("forecastNotes", "2026-12", note.revision))).toBe(
        "record_changed",
      );
      // A salesperson, a company or a deal another record names stays.
      for (const [collection, id] of [
        ["salespeople", "S-0001"],
        ["companies", "C-0002"],
        ["deals", "D-2026-0002"],
        ["contacts", "P-0001"],
      ] as const) {
        const found = await store.get(collection, id);
        if (!found) throw new Error(`${collection}/${id} missing`);
        expect({
          id,
          code: await refusal(() => store.remove(collection, id, found.revision)),
        }).toEqual({ id, code: "invalid_record" });
        expect(await store.get(collection, id)).not.toBeNull();
      }
      // A forecast row nothing names goes; saveAll removes and saves at once.
      const row = await store.get("forecastEntries", "F-2026-0002");
      const item = await store.get("pricebook", "I-0008");
      if (!row || !item) throw new Error("sample records missing");
      const result = await store.saveAll([
        { collection: "forecastEntries", remove: "F-2026-0002", baseRevision: row.revision },
        {
          collection: "pricebook",
          value: { ...item.value, active: false },
          baseRevision: item.revision,
        },
      ]);
      expect(result[0]).toBeNull();
      expect(await store.get("forecastEntries", "F-2026-0002")).toBeNull();
      expect((await store.get("pricebook", "I-0008"))?.value.active).toBe(false);
      // Discarding the draft brings the removed records back.
      await store.discard({ kind: "draft" }, (await store.draft()).revision ?? "");
      expect(await store.get("forecastNotes", "2026-12")).not.toBeNull();
      expect(await store.get("forecastEntries", "F-2026-0002")).not.toBeNull();
    });

    test("a stage or a loss reason a deal uses cannot be removed", async () => {
      const opened = await store.settings();
      const withoutLead = {
        ...opened.value,
        stages: opened.value.stages.filter((stage) => stage.id !== "lead"),
      };
      expect(await refusal(() => store.saveSettings(withoutLead, opened.revision))).toBe(
        "invalid_record",
      );
      const withoutPrice = {
        ...opened.value,
        lossReasons: opened.value.lossReasons.filter((reason) => reason.id !== "price"),
      };
      expect(await refusal(() => store.saveSettings(withoutPrice, opened.revision))).toBe(
        "invalid_record",
      );
      // One no deal names goes.
      const withoutTiming = {
        ...opened.value,
        lossReasons: opened.value.lossReasons.filter((reason) => reason.id !== "timing"),
      };
      const saved = await store.saveSettings(withoutTiming, opened.revision);
      expect(saved.value.lossReasons.map((reason) => reason.id)).toEqual([
        "price",
        "competitor",
        "no-decision",
      ]);
      // A pipeline needs exactly one won and one lost stage.
      const twoWon = {
        ...saved.value,
        stages: saved.value.stages.map((stage) =>
          stage.id === "lost" ? { ...stage, kind: "won" as const, probability: 100 } : stage,
        ),
      };
      expect(await refusal(() => store.saveSettings(twoWon, saved.revision))).toBe(
        "invalid_record",
      );
    });

    test("publishes exactly the draft that was shown", async () => {
      await store.saveDeal(newDeal(), null);
      const shown = await store.draft();
      await store.saveActivity({ ...newActivity(), dealId: "D-2026-0015" }, null);
      expect(await refusal(() => store.publish({ expectedRevision: shown.revision ?? "" }))).toBe(
        "draft_changed",
      );
      const current = await store.draft();
      await store.publish({ expectedRevision: current.revision ?? "", summary: "Nový případ" });
      const after = await store.draft();
      expect(after.status?.state).toBe("published");
      expect(after.records ?? []).toEqual([]);
      expect(await store.getActivity("A-2026-00021")).not.toBeNull();
    });

    test("refuses to publish a draft that breaks a rule across records", async () => {
      await store.saveCompany(newCompany(), null);
      await store.saveDeal({ ...newDeal(), companyId: "C-0007", contactIds: [] }, null);
      const card = await store.draft();
      const company = card.records?.find(
        (record) => record.resource.stableResourceId === "companies:C-0007",
      );
      if (!company) throw new Error("C-0007 is not in the draft");
      // Taking the company back leaves the deal naming a company that is gone.
      await store.discard({ kind: "record", path: company.technicalPath }, card.revision ?? "");
      const issues = errorsOf(await store.check("en", TODAY));
      expect(issues.map((issue) => [issue.record, issue.code])).toEqual([
        ["deals/D-2026-0015", "unknown_company"],
      ]);
      const left = await store.draft();
      expect(await refusal(() => store.publish({ expectedRevision: left.revision ?? "" }))).toBe(
        "rules_failed",
      );
      expect((await store.draft()).status?.state).toBe("draft");
    });

    test("returns one record or the whole draft to the published state", async () => {
      const opened = await store.getContact("P-0001");
      if (!opened) throw new Error("P-0001 missing");
      await store.saveContact({ ...opened.value, phone: "+420 000 000 999" }, opened.revision);
      await store.saveDeal(newDeal(), null);
      const card = await store.draft();
      const changed = card.records?.find(
        (record) => record.resource.stableResourceId === "contacts:P-0001",
      );
      if (!changed) throw new Error("P-0001 is not in the draft");
      await store.discard({ kind: "record", path: changed.technicalPath }, card.revision ?? "");
      expect((await store.getContact("P-0001"))?.value.phone).toBe(opened.value.phone);
      expect((await store.draft()).records?.length).toBe(1);

      const rest = await store.draft();
      await store.discard({ kind: "draft" }, rest.revision ?? "");
      expect(await store.getDeal("D-2026-0015")).toBeNull();
      expect((await store.draft()).records ?? []).toEqual([]);
    });

    test("tells subscribers that the draft moved", async () => {
      const events: string[] = [];
      const stop = store.subscribe((event) => events.push(event.type));
      await store.saveCompany(newCompany(), null);
      stop();
      expect(events).toContain("draft-changed");
    });

    test("tells every subscriber that records changed on a write and a discard", async () => {
      // Two open pages over the same store: the one that writes and another.
      const writer: string[] = [];
      const other: string[] = [];
      const stops = [
        store.subscribe((event) => writer.push(event.type)),
        store.subscribe((event) => other.push(event.type)),
      ];
      try {
        await store.saveCompany(newCompany(), null);
        expect(writer).toContain("records-changed");
        expect(other).toContain("records-changed");
        const opened = await store.getDeal("D-2026-0004");
        if (!opened) throw new Error("D-2026-0004 missing");
        other.length = 0;
        await store.saveDeal({ ...opened.value, title: "Přejmenovaný případ" }, opened.revision);
        expect(other).toContain("records-changed");

        // A refused write changes no record and says none changed.
        other.length = 0;
        await expect(
          store.saveDeal({ ...opened.value, title: "Zastaralé" }, opened.revision),
        ).rejects.toMatchObject({ code: "record_changed" });
        expect(other).not.toContain("records-changed");

        await store.discard({ kind: "draft" }, (await store.draft()).revision ?? "");
        expect(other).toContain("records-changed");
      } finally {
        for (const stop of stops) stop();
      }
    });
  });
}
