import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, toStableYaml } from "@lazurio/repository-db";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { storeContract } from "./store-contract.ts";
import { colleagueClone, createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newCompany, newContact, newDeal } from "./support/seed.ts";

// These tests run real Git and the data repository's validator for every
// publish. On a Windows runner one publish takes several seconds, more than
// bun's default of 5 s per test, so they get a minute.
setDefaultTimeout(60_000);

function storeOver(
  fixture: ReturnType<typeof createFixtureRepo>,
  remote = fixture.origin,
  writes = true,
) {
  return createRepositoryDbStore({
    mountRoot: fixture.mountRoot,
    expect: { remote, branch: "v3", within: fixture.moduleRoot },
    intervalMs: 0,
    writes,
  });
}

storeContract("repository-db", async () => {
  const fixture = createFixtureRepo();
  return { store: storeOver(fixture), cleanup: fixture.cleanup };
});

describe("repository-db store", () => {
  test("keeps the collection layout and publishes one validated commit", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    try {
      await store.saveDeal(newDeal(), null);
      const path = "data/deals/D-2026-0015.yaml";
      expect(existsSync(join(fixture.mountRoot, path))).toBe(true);
      const card = await store.draft();
      expect(card.records?.[0]?.technicalPath).toBe(path);
      expect(card.records?.[0]?.resource.routeTarget?.href).toBe("#/deals/D-2026-0015");

      await store.publish({
        expectedRevision: card.revision ?? "",
        summary: "Obchodní případ D-2026-0015",
      });
      const log = git(fixture.originPath, ["log", "-1", "--format=%s%n%(trailers:only)", "v3"]);
      expect(log).toContain("Obchodní případ D-2026-0015");
      expect(log).toContain("Repository-Db-Source: deals-v3");
      expect(git(fixture.originPath, ["rev-list", "--count", "v3"])).toBe("2");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("every write stores a new random write revision in the record's file", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    const file = join(fixture.mountRoot, "data/companies/C-0003.yaml");
    const stored = () =>
      (parseYaml(readFileSync(file, "utf8")) as { record: Record<string, unknown> }).record;
    try {
      // The seed has none: such a record is read as before.
      expect(stored().revision).toBeUndefined();
      const opened = await store.getCompany("C-0003");
      if (!opened) throw new Error("C-0003 missing");
      await store.saveCompany({ ...opened.value, name: "Pekárna B" }, opened.revision);
      const first = stored();
      expect(String(first.revision)).toMatch(/^[0-9a-f-]{36}$/);
      expect(String(first.updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Nobody stated a person: the write names none.
      expect(first.updatedBy).toBeUndefined();
      const current = await store.getCompany("C-0003");
      await store.saveCompany(opened.value, current?.revision ?? "");
      expect(stored().revision).not.toBe(first.revision);
      // Audit fields a caller sent in the record are not kept.
      const latest = await store.getCompany("C-0003");
      await store.saveCompany(
        {
          ...opened.value,
          name: "Pekárna C",
          revision: "mine",
          updatedAt: "2020-01-01T00:00:00.000Z",
          updatedBy: "someone-else",
        } as never,
        latest?.revision ?? "",
      );
      expect(stored().revision).not.toBe("mine");
      expect(stored().updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
      expect(stored().updatedBy).toBeUndefined();
      expect((await store.getCompany("C-0003"))?.value).not.toHaveProperty("revision");
      // The data repository's validator takes the audit fields.
      const card = await store.draft();
      await store.publish({ expectedRevision: card.revision ?? "" });
      expect((await store.draft()).status?.state).toBe("published");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a direct change of a record's file that kept its write revision is a change", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    const file = join(fixture.mountRoot, "data/companies/C-0003.yaml");
    try {
      const opened = await store.getCompany("C-0003");
      if (!opened) throw new Error("C-0003 missing");
      const saved = await store.saveCompany(
        { ...opened.value, name: "Pekárna B" },
        opened.revision,
      );
      const text = readFileSync(file, "utf8");
      // An agent edits the file by hand and keeps `record.revision` as it was.
      writeFileSync(file, text.replace("name: Pekárna B", "name: Pekárna ručně"));
      const direct = await store.getCompany("C-0003");
      expect(direct?.value.name).toBe("Pekárna ručně");
      expect(direct?.revision).not.toBe(saved.revision);
      expect(
        await (async () => {
          try {
            await store.saveCompany(
              { ...opened.value, website: "https://b.example" },
              saved.revision,
            );
          } catch (error) {
            return (error as { code?: string }).code;
          }
          return null;
        })(),
      ).toBe("record_changed");
      expect((await store.getCompany("C-0003"))?.value.name).toBe("Pekárna ručně");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a colleague's change of another field of the same record merges", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    try {
      // Both start from a record the App wrote, with a write revision.
      const opened = await store.getDeal("D-2026-0006");
      if (!opened) throw new Error("D-2026-0006 missing");
      await store.saveDeal({ ...opened.value, title: "Školení B" }, opened.revision);
      let card = await store.draft();
      await store.publish({ expectedRevision: card.revision ?? "" });

      // A colleague's App changes the stage and publishes first.
      const colleague = colleagueClone(fixture);
      const theirs = join(colleague, "data/deals/D-2026-0006.yaml");
      const document = parseYaml(readFileSync(theirs, "utf8")) as {
        record: Record<string, unknown>;
      };
      writeFileSync(
        theirs,
        toStableYaml({
          ...document,
          record: {
            ...document.record,
            stageId: "proposal",
            revision: crypto.randomUUID(),
            updatedAt: new Date(Date.now() - 1000).toISOString(),
            updatedBy: "colleague-subject",
          },
        }),
      );
      git(colleague, ["commit", "--quiet", "--all", "--message", "Zpět do fáze Nabídka"]);
      git(colleague, ["push", "--quiet"]);

      // Here the value changes; the publish takes the colleague's work along.
      const mine = await store.getDeal("D-2026-0006");
      await store.saveDeal({ ...opened.value, value: 16_000_000 }, mine?.revision ?? "");
      card = await store.draft();
      await store.publish({ expectedRevision: card.revision ?? "" });
      const merged = await store.getDeal("D-2026-0006");
      expect(merged?.value.value).toBe(16_000_000);
      expect(merged?.value.stageId).toBe("proposal");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("refuses a publish the data repository's validator rejects", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    try {
      // An agent wrote a broken record by hand, past the App and its command line.
      writeFileSync(
        join(fixture.mountRoot, "data/companies/C-0999.yaml"),
        toStableYaml({ schemaVersion: "deals.company.v1", id: "C-0999", record: { id: "C-0999" } }),
      );
      expect((await store.check()).length).toBeGreaterThan(0);
      expect((await store.check("en"))[0]?.message).toContain("required");
      const card = await store.draft();
      let code: string | undefined;
      try {
        await store.publish({ expectedRevision: card.revision ?? "" });
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe("validation_failed");
      expect(git(fixture.originPath, ["rev-list", "--count", "v3"])).toBe("1");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("serves only its own data repository", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture, "git@github.com:SomeoneElse/deals-data.git");
    try {
      const available = await store.available();
      expect(available.ok).toBe(false);
      if (!available.ok) expect(available.code).toBe("boundary_violation");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("takes a colleague's published work and says which records changed", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    try {
      const colleague = colleagueClone(fixture);
      const file = join(colleague, "data/deals/D-2026-0002.yaml");
      writeFileSync(
        file,
        readFileSync(file, "utf8")
          .replace("stageId: proposal", "stageId: won")
          .replace(
            "expectedClose: 2026-12-15",
            "closedAt: 2026-11-24\n  expectedClose: 2026-12-15",
          ),
      );
      git(colleague, ["commit", "--quiet", "--all", "--message", "D-2026-0002 vyhráno"]);
      git(colleague, ["push", "--quiet"]);

      const events: string[] = [];
      const stop = store.subscribe((event) => events.push(event.type));
      await store.pull();
      stop();
      expect((await store.getDeal("D-2026-0002"))?.value.stageId).toBe("won");
      expect(events).toContain("records-changed");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a read-only replica shows its draft without the network", async () => {
    const fixture = createFixtureRepo();
    const writer = storeOver(fixture);
    await writer.saveDeal(newDeal(), null);
    writer.close();
    // The origin is gone: a fetch would fail, so a status needing one shows it.
    rmSync(fixture.originPath, { recursive: true, force: true });
    const store = storeOver(fixture, fixture.origin, false);
    try {
      expect((await store.available()).ok).toBe(true);
      const card = await store.draft();
      expect(card.unavailableReason).toBeUndefined();
      expect(card.status?.dirtyPaths).toEqual(["data/deals/D-2026-0015.yaml"]);
      expect(card.records).toHaveLength(1);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a copy that may not write never fetches, pulls or changes a record", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture, fixture.origin, false);
    try {
      const colleague = colleagueClone(fixture);
      writeFileSync(join(colleague, "colleague.txt"), "newer work\n");
      git(colleague, ["add", "colleague.txt"]);
      git(colleague, ["commit", "--quiet", "--message", "A colleague's newer work"]);
      git(colleague, ["push", "--quiet"]);
      const tracked = git(fixture.mountRoot, ["rev-parse", "origin/v3"]);
      await store.draft();
      await store.check();
      await store.listDeals();
      expect(git(fixture.mountRoot, ["rev-parse", "origin/v3"])).toBe(tracked);
      expect(existsSync(join(fixture.mountRoot, "colleague.txt"))).toBe(false);
      await expect(store.saveDeal(newDeal(), null)).rejects.toMatchObject({
        code: "data_read_only",
      });
      await expect(store.pull()).rejects.toMatchObject({ code: "data_read_only" });
      expect(git(fixture.mountRoot, ["status", "--porcelain"])).toBe("");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears when the host updates the replica", async () => {
    const fixture = createFixtureRepo();
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      const colleague = colleagueClone(fixture);
      const path = git(colleague, ["ls-files", "data/companies"])
        .split("\n")
        .find((entry) => entry.endsWith(".yaml"));
      const file = join(colleague, path ?? "");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(/^(\s*)name: .*$/m, "$1name: Replica update"),
      );
      git(colleague, ["commit", "--quiet", "--all", "--message", "Rename a company"]);
      git(colleague, ["push", "--quiet"]);
      // The application host updates its replica; the App itself never pulls.
      git(fixture.mountRoot, ["pull", "--quiet", "--ff-only"]);
      for (let waited = 0; !events.includes("records-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("records-changed");
      expect(events).toContain("draft-changed");
      expect((await store.listCompanies()).some((row) => row.value.name === "Replica update")).toBe(
        true,
      );
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears every change of a draft record, also the same one again", async () => {
    const fixture = createFixtureRepo();
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    const recordChanges = () => events.filter((type) => type === "records-changed").length;
    const path = git(fixture.mountRoot, ["ls-files", "data/companies"])
      .split("\n")
      .find((entry) => entry.endsWith(".yaml"));
    const file = join(fixture.mountRoot, path ?? "");
    const original = readFileSync(file, "utf8");
    // The host changes the replica's draft; the App itself never writes.
    const edit = async (value: string) => {
      const before = recordChanges();
      writeFileSync(file, original.replace(/^(\s*)name: .*$/m, `$1name: ${value}`));
      for (let waited = 0; recordChanges() === before && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(recordChanges()).toBeGreaterThan(before);
      expect(events.at(-1)).toBe("draft-changed");
      expect((await store.listCompanies()).some((row) => row.value.name === value)).toBe(true);
    };
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      await edit("First edit");
      await edit("Second edit");
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears when its data become available", async () => {
    const fixture = createFixtureRepo();
    // The page opens before the host has mounted the data checkout.
    renameSync(fixture.mountRoot, `${fixture.mountRoot}.later`);
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      expect((await store.available()).ok).toBe(false);
      renameSync(`${fixture.mountRoot}.later`, fixture.mountRoot);
      for (let waited = 0; !events.includes("records-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("records-changed");
      expect(events).toContain("draft-changed");
      expect((await store.available()).ok).toBe(true);
      expect((await store.listCompanies()).length).toBeGreaterThan(0);
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears a fetched newer state it does not pull", async () => {
    const fixture = createFixtureRepo();
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      expect((await store.draft()).status?.state).toBe("published");
      const colleague = colleagueClone(fixture);
      writeFileSync(join(colleague, "colleague.txt"), "newer work\n");
      git(colleague, ["add", "colleague.txt"]);
      git(colleague, ["commit", "--quiet", "--message", "A colleague's newer work"]);
      git(colleague, ["push", "--quiet"]);
      const head = git(fixture.mountRoot, ["rev-parse", "HEAD"]);
      // The host fetches but does not pull yet; the App itself does neither.
      git(fixture.mountRoot, ["fetch", "--quiet"]);
      for (let waited = 0; !events.includes("draft-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("draft-changed");
      expect((await store.draft()).status?.state).toBe("pull_needed");
      expect(git(fixture.mountRoot, ["rev-parse", "HEAD"])).toBe(head);
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("a write the file system refuses leaves nothing in the draft", async () => {
    const fixture = createFixtureRepo();
    const store = storeOver(fixture);
    try {
      const before = git(fixture.mountRoot, ["status", "--porcelain"]);
      // The contact's file cannot be written: a directory stands there.
      const blocked = join(fixture.mountRoot, "data/contacts/P-0011.yaml");
      mkdirSync(blocked, { recursive: true });
      writeFileSync(join(blocked, "keep"), "x\n");
      await expect(store.saveContact(newContact(), null)).rejects.toThrow();
      rmSync(blocked, { recursive: true, force: true });
      expect(git(fixture.mountRoot, ["status", "--porcelain"])).toBe(before);
      expect(await store.getContact("P-0011")).toBeNull();
      // The store goes on working.
      await store.saveCompany(newCompany(), null);
      expect(await store.getCompany("C-0007")).not.toBeNull();
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
