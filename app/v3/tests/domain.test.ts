import { describe, expect, test } from "bun:test";
import { nextActivityId } from "../src/domain/activity.ts";
import { canonicalJson } from "../src/domain/canonical.ts";
import { type DataSet, emptyDataSet } from "../src/domain/collections.ts";
import {
  addDays,
  daysBetween,
  formatDate,
  formatMonth,
  monthOf,
  slugify,
} from "../src/domain/common.ts";
import {
  addressLines,
  company,
  icoCheckDigit,
  isValidIco,
  nextCompanyId,
} from "../src/domain/company.ts";
import { nextContactId } from "../src/domain/contact.ts";
import { nextDealId, probabilityOf } from "../src/domain/deal.ts";
import { checkRules, checkRulesLocalized, errorsOf, warningsOf } from "../src/domain/rules.ts";
import { stageById } from "../src/domain/settings.ts";
import { localeOfAcceptLanguage } from "../src/i18n/locale.ts";
import { newActivity, newCompany, newContact, newDeal, sampleData, TODAY } from "./support/seed.ts";

describe("dates and ids", () => {
  test("dates and months in Czech and English", () => {
    expect(formatDate("2026-11-06")).toBe("6. 11. 2026");
    expect(formatDate("2026-11-06", "en")).toBe("6 Nov 2026");
    expect(formatMonth("2026-11")).toBe("11/2026");
    expect(formatMonth("2026-11", "en")).toBe("Nov 2026");
    expect(monthOf("2026-11-06")).toBe("2026-11");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    // Whole days, also over the change to summer time.
    expect(daysBetween("2026-07-01", "2026-09-14")).toBe(75);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-11-06", "2026-11-06")).toBe(0);
    expect(slugify("Bez rozhodnutí")).toBe("bez-rozhodnuti");
  });

  test("the next free id of every collection", () => {
    expect(nextCompanyId(["C-0001", "C-0009", "X"])).toBe("C-0010");
    expect(nextCompanyId([])).toBe("C-0001");
    expect(nextContactId(["P-0010", "P-0002"])).toBe("P-0011");
    expect(nextDealId(2026, ["D-2026-0014", "D-2025-0090"])).toBe("D-2026-0015");
    expect(nextDealId("2027", ["D-2026-0014"])).toBe("D-2027-0001");
    expect(nextActivityId(2026, ["A-2026-00020", "A-2025-00400"])).toBe("A-2026-00021");
  });

  test("the language of a request", () => {
    expect(localeOfAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(localeOfAcceptLanguage("de, cs;q=0.5")).toBe("cs");
    expect(localeOfAcceptLanguage(null)).toBe("cs");
  });

  test("equal values give equal canonical JSON", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("the IČO", () => {
  test("its check digit is modulo 11 of the first seven digits weighted 8 to 2", () => {
    // 0000000 sums to 0: remainder 0 → 1.
    expect(icoCheckDigit("0000000")).toBe(1);
    // 1234567: 8 + 14 + 18 + 20 + 20 + 18 + 14 = 112, 112 mod 11 = 2 → 9.
    expect(icoCheckDigit("1234567")).toBe(9);
    // 0000001: 2, remainder 2 → 9.
    expect(icoCheckDigit("0000001")).toBe(9);
    // 0000006: 12, remainder 1 → 0.
    expect(icoCheckDigit("0000006")).toBe(0);
    // 0000010: 3, remainder 3 → 8.
    expect(icoCheckDigit("0000010")).toBe(8);
    expect(() => icoCheckDigit("123")).toThrow(RangeError);
  });

  test("is valid only with its check digit", () => {
    for (const first7 of ["0000000", "1234567", "0000006", "0000010", "7654321"]) {
      const digit = icoCheckDigit(first7);
      expect(isValidIco(`${first7}${digit}`)).toBe(true);
      expect(isValidIco(`${first7}${(digit + 1) % 10}`)).toBe(false);
    }
    expect(isValidIco("1234567")).toBe(false);
    expect(isValidIco("1234567a")).toBe(false);
    // The schema takes eight digits; the checksum is a rule.
    expect(company.safeParse({ ...newCompany(), ico: "12345678" }).success).toBe(true);
    expect(company.safeParse({ ...newCompany(), ico: "1234567" }).success).toBe(false);
  });

  test("addresses as lines", () => {
    expect(
      addressLines({ street: "Ukázková 12", postalCode: "602 00", city: "Brno", country: "ČR" }),
    ).toEqual(["Ukázková 12", "602 00 Brno", "ČR"]);
    expect(addressLines(undefined)).toEqual([]);
  });
});

describe("the probability of a deal", () => {
  test("is its own, else its stage's", () => {
    const { settings } = sampleData();
    const stage = stageById(settings, "proposal");
    expect(probabilityOf({ probability: 33 }, stage)).toBe(33);
    expect(probabilityOf({ probability: 0 }, stage)).toBe(0);
    expect(probabilityOf({}, stage)).toBe(50);
    expect(probabilityOf({}, undefined)).toBe(0);
  });
});

/** The sample with some records changed, as a rule sees it. */
function changed(change: (data: ReturnType<typeof sampleData>) => Partial<DataSet>): DataSet {
  const data = sampleData();
  return { ...data, ...change(data) };
}

const codes = (data: DataSet, today: string = TODAY) =>
  checkRules(data, { today }).map((issue) => [issue.severity, issue.record, issue.code]);

describe("rules across records", () => {
  test("the sample breaks none and warns about its two undated deals", () => {
    expect(codes(sampleData())).toEqual([
      ["warning", "deals/D-2026-0007", "expected_close_missing"],
      ["warning", "deals/D-2026-0008", "expected_close_past"],
    ]);
    // Without today only the missing date warns.
    expect(checkRules(sampleData()).map((issue) => issue.code)).toEqual(["expected_close_missing"]);
  });

  test("data without settings is an error", () => {
    expect(codes(emptyDataSet())).toEqual([["error", "settings/settings", "settings_missing"]]);
  });

  test("the pipeline needs one won, one lost and an open stage, each id once", () => {
    const pipeline = (stages: ReturnType<typeof sampleData>["settings"]["stages"]) =>
      changed((data) => ({ settings: { ...data.settings, stages }, deals: [], activities: [] }));
    const { settings } = sampleData();
    const [lead, , , , won, lost] = settings.stages;
    if (!lead || !won || !lost) throw new Error("stages missing");
    expect(codes(pipeline([lead, won]))).toEqual([
      ["error", "settings/settings", "stage_lost_count"],
    ]);
    expect(codes(pipeline([won, lost]))).toEqual([
      ["error", "settings/settings", "stage_open_missing"],
    ]);
    expect(codes(pipeline([lead, lead, won, lost]))).toEqual([
      ["error", "settings/settings", "stage_duplicate_id"],
    ]);
    expect(
      codes(pipeline([lead, { ...won, probability: 90 }, { ...lost, probability: 5 }])),
    ).toEqual([
      ["error", "settings/settings", "stage_won_probability"],
      ["error", "settings/settings", "stage_lost_probability"],
    ]);
    expect(codes(pipeline([lead, won, { ...won, id: "won-2" }, lost]))).toEqual([
      ["error", "settings/settings", "stage_won_count"],
    ]);
    const reasons = changed((data) => ({
      settings: {
        ...data.settings,
        lossReasons: [...data.settings.lossReasons, { id: "price", label: "Znovu" }],
      },
    }));
    expect(codes(reasons)).toContainEqual([
      "error",
      "settings/settings",
      "loss_reason_duplicate_id",
    ]);
  });

  test("a stage or a reason in use cannot leave the settings", () => {
    const data = changed((sample) => ({
      settings: {
        ...sample.settings,
        stages: sample.settings.stages.filter((stage) => stage.id !== "proposal"),
        lossReasons: sample.settings.lossReasons.filter((reason) => reason.id !== "competitor"),
      },
    }));
    const errors = errorsOf(checkRules(data, { today: TODAY }));
    expect(errors.map((issue) => [issue.record, issue.code])).toEqual([
      ["settings/settings", "stage_in_use"],
      ["settings/settings", "loss_reason_in_use"],
      ["deals/D-2026-0002", "unknown_stage"],
      ["deals/D-2026-0005", "unknown_stage"],
      ["deals/D-2026-0009", "unknown_stage"],
      ["deals/D-2026-0014", "unknown_loss_reason"],
    ]);
  });

  test("an IČO is valid and used by one company", () => {
    const ico = `1234567${icoCheckDigit("1234567")}`;
    const data = changed((sample) => ({
      companies: [
        ...sample.companies.map((entry) => (entry.id === "C-0001" ? { ...entry, ico } : entry)),
        { ...newCompany(), ico },
        { ...newCompany("C-0008", "Třetí s.r.o."), ico: "12345670" },
      ],
    }));
    expect(errorsOf(checkRules(data)).map((issue) => [issue.record, issue.code])).toEqual([
      ["companies/C-0008", "ico_checksum"],
      ["companies/C-0001", "ico_duplicate"],
      ["companies/C-0007", "ico_duplicate"],
    ]);
  });

  test("a deal needs what its stage asks for", () => {
    const deal = newDeal();
    const one = (value: object) =>
      errorsOf(checkRules(changed((data) => ({ deals: [...data.deals, { ...deal, ...value }] }))))
        .filter((issue) => issue.record === "deals/D-2026-0015")
        .map((issue) => issue.code);
    expect(one({})).toEqual([]);
    expect(one({ companyId: "C-0404" })).toEqual(["unknown_company"]);
    expect(one({ contactIds: ["P-0404"] })).toEqual(["unknown_contact"]);
    expect(one({ stageId: "paused" })).toEqual(["unknown_stage"]);
    expect(one({ closedAt: "2026-11-25" })).toEqual(["open_with_closed_date"]);
    expect(one({ lossReasonId: "price" })).toEqual(["reason_outside_lost"]);
    expect(one({ stageId: "won" })).toEqual(["closed_without_date"]);
    expect(one({ stageId: "won", closedAt: "2026-11-25", value: 0 })).toEqual([
      "won_without_value",
    ]);
    expect(one({ stageId: "won", closedAt: "2026-11-25", lossReasonId: "price" })).toEqual([
      "reason_outside_lost",
    ]);
    expect(one({ stageId: "lost" })).toEqual(["closed_without_date", "lost_without_reason"]);
    expect(one({ stageId: "lost", closedAt: "2026-11-25", lossReasonId: "weather" })).toEqual([
      "unknown_loss_reason",
    ]);
    expect(
      one({ stageId: "lost", closedAt: "2026-11-25", lossReasonId: "price", value: 0 }),
    ).toEqual([]);
    expect(one({ stageId: "won", closedAt: "2026-11-01" })).toEqual(["closed_before_created"]);
  });

  test("warnings name a contact of another company, an unknown owner and dates", () => {
    const data = changed((sample) => ({
      deals: [
        ...sample.deals,
        { ...newDeal(), contactIds: ["P-0003"], owner: "Někdo Jiný", expectedClose: "2026-11-24" },
      ],
    }));
    expect(
      warningsOf(checkRules(data, { today: TODAY }))
        .filter((issue) => issue.record === "deals/D-2026-0015")
        .map((issue) => issue.code),
    ).toEqual(["contact_other_company", "owner_unknown", "expected_close_past"]);
    // Without a list of salespeople any owner goes.
    const free = changed((sample) => ({
      settings: { ...sample.settings, owners: undefined },
      deals: [...sample.deals, { ...newDeal(), owner: "Někdo Jiný" }],
    }));
    expect(checkRules(free, { today: TODAY }).map((issue) => issue.code)).not.toContain(
      "owner_unknown",
    );
  });

  test("contacts and activities name records that exist; only a task is done", () => {
    const data = changed((sample) => ({
      contacts: [...sample.contacts, { ...newContact(), companyId: "C-0404" }],
      activities: [
        ...sample.activities,
        { ...newActivity(), dealId: "D-2026-0404", contactIds: ["P-0404"], done: true },
        { ...newActivity("A-2026-00022"), type: "task", done: false },
      ],
    }));
    expect(errorsOf(checkRules(data)).map((issue) => [issue.record, issue.code])).toEqual([
      ["contacts/P-0011", "unknown_company"],
      ["activities/A-2026-00021", "unknown_deal"],
      ["activities/A-2026-00021", "unknown_contact"],
      ["activities/A-2026-00021", "done_outside_task"],
    ]);
  });

  test("every issue is worded in Czech and in English", () => {
    const data = changed((sample) => ({
      settings: { ...sample.settings, stages: sample.settings.stages.slice(1) },
      companies: [...sample.companies, { ...newCompany(), ico: "00000002" }],
      deals: [
        ...sample.deals,
        { ...newDeal(), stageId: "lost", contactIds: ["P-0003"], owner: "Somebody" },
      ],
    }));
    const issues = checkRulesLocalized(data, { today: TODAY });
    expect(issues.length).toBeGreaterThan(5);
    for (const issue of issues) {
      expect(issue.message.cs.length).toBeGreaterThan(0);
      expect(issue.message.en.length).toBeGreaterThan(0);
      expect(issue.message.en).not.toBe(issue.message.cs);
      expect(issue.message.en.match(/[ěščřžýáíéůúťďň]/gi) ?? []).toEqual(
        issue.message.en.includes("IČO") ? ["Č"] : [],
      );
    }
    const unknown = issues.find((issue) => issue.code === "stage_in_use");
    expect(unknown?.message.cs).toBe("fázi lead používá obchodní případ, nejde ji odebrat");
    expect(unknown?.message.en).toBe("a deal is in the stage lead; it cannot be removed");
    expect(checkRules(data, { locale: "en" })[0]?.message).toBe(
      checkRulesLocalized(data)[0]?.message.en,
    );
  });
});
