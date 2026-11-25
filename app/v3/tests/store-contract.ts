import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CHANGES, type DealsStore, readOnly } from "../src/data/store.ts";
import { forecast } from "../src/domain/forecast.ts";
import { errorsOf, warningsOf } from "../src/domain/rules.ts";
import { newActivity, newCompany, newContact, newDeal, sampleData, TODAY } from "./support/seed.ts";

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

    test("a read-only view refuses every change and changes nothing", async () => {
      const view = readOnly(store);
      const state = async () => ({
        settings: await store.settings(),
        companies: await store.listCompanies(),
        contacts: await store.listContacts(),
        deals: await store.listDeals(),
        activities: await store.listActivities(),
        draft: (await store.draft()).records?.length ?? 0,
      });
      const before = await state();
      const attempts: Record<keyof typeof CHANGES, () => Promise<unknown>> = {
        saveSettings: () => view.saveSettings(before.settings.value, before.settings.revision),
        saveCompany: () => view.saveCompany(newCompany(), null),
        saveContact: () => view.saveContact(newContact(), null),
        saveDeal: () => view.saveDeal(newDeal(), null),
        saveActivity: () => view.saveActivity(newActivity(), null),
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
      expect(await refusal(() => store.saveDeal(newDeal("D-2026-0002"), null))).toBe(
        "record_changed",
      );
    });

    test("every write of every collection gives a new revision, also after A → B → A", async () => {
      const settings = await store.settings();
      const company = await store.getCompany("C-0001");
      const contact = await store.getContact("P-0001");
      const deal = await store.getDeal("D-2026-0001");
      const activity = await store.getActivity("A-2026-00001");
      if (!company || !contact || !deal || !activity) throw new Error("sample records missing");
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
      ];
      for (const { opened, edit, save, read } of cases) {
        const b = await save(edit, opened.revision);
        const back = await save(opened.value, b.revision);
        // A again: the same content, a new revision each time, never a repeat.
        expect(back.value).toEqual(opened.value);
        expect(new Set([opened.revision, b.revision, back.revision]).size).toBe(3);
        expect(await read()).toBe(back.revision);
        // The value handed out carries no audit fields.
        for (const field of ["revision", "updatedAt", "updatedBy"]) {
          expect(Object.keys(back.value as object)).not.toContain(field);
        }
        // An editor who opened A or B before is refused, not overwritten.
        expect(await refusal(() => save(edit, opened.revision))).toBe("record_changed");
        expect(await refusal(() => save(edit, b.revision))).toBe("record_changed");
        expect(await read()).toBe(back.revision);
      }
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
      // P-0003 belongs to C-0002, not to the deal's C-0001: a warning.
      const saved = await store.saveDeal(
        { ...newDeal(), contactIds: ["P-0003"], owner: "Someone Else", expectedClose: undefined },
        null,
      );
      expect(saved.value.contactIds).toEqual(["P-0003"]);
      const issues = (await store.check("en", TODAY)).filter(
        (issue) => issue.record === "deals/D-2026-0015",
      );
      expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([
        ["warning", "contact_other_company"],
        ["warning", "owner_unknown"],
        ["warning", "expected_close_missing"],
      ]);
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
  });
}
