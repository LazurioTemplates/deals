import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "@lazurio/repository-db";
import { type Origin, withOrigin } from "../src/data/origin.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { createService } from "../src/service/deals-service.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newCompany } from "./support/seed.ts";

// Real Git and the data repository's validator run here; see repository-db-store.test.ts.
setDefaultTimeout(60_000);

/**
 * Author and channel (Module Standard, One data port): every change records
 * the person's subject and the channel it came by, in the draft, in the
 * record's audit fields and when it is published; a caller without a subject
 * records none. The HTTP API states the origin of a request; here the origin
 * is stated directly, as the API does.
 */
function setup() {
  const fixture = createFixtureRepo();
  const store = createRepositoryDbStore({
    mountRoot: fixture.mountRoot,
    expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
    intervalMs: 0,
  });
  const service = createService(store, { today: () => "2026-11-25" });
  const as = <T>(origin: Origin, operation: () => Promise<T>) => withOrigin(origin, operation);
  const origins = async () =>
    ((await store.draft("en")).records ?? []).map(
      (record) => record.resource.changes[0]?.origin ?? null,
    );
  const audit = (path: string) =>
    (
      parseYaml(readFileSync(join(fixture.mountRoot, path), "utf8")) as {
        record: Record<string, unknown>;
      }
    ).record;
  return { fixture, store, service, as, origins, audit };
}

describe("author and channel", () => {
  test("a change from the interface records the person and the channel ui", async () => {
    const { fixture, store, service, as, origins, audit } = setup();
    try {
      const saved = await as({ subject: "subject-1", channel: "ui" }, () =>
        service.createCompany({ name: "Alfa s.r.o." }),
      );
      expect(saved.value.id).toBe("C-0007");
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "app", actor: "subject-1", source: "deals-v3/ui" }),
      ]);
      // The record names the person the writer wrote it for.
      expect(audit("data/companies/C-0007.yaml").updatedBy).toBe("subject-1");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a page tool's change is recorded as an agent's, channel webmcp", async () => {
    const { fixture, store, service, as, origins } = setup();
    try {
      await as({ subject: "subject-1", channel: "webmcp" }, () =>
        service.createCompany({ name: "Beta s.r.o." }),
      );
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "agent", actor: "subject-1", source: "deals-v3/webmcp" }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a caller without a subject invents none", async () => {
    const { fixture, store, service, as, origins, audit } = setup();
    try {
      await as({ subject: null, channel: "ui" }, () =>
        service.createCompany({ name: "Gama s.r.o." }),
      );
      const [origin] = await origins();
      expect(origin?.source).toBe("deals-v3/ui");
      expect(origin?.actor).toBeUndefined();
      expect(audit("data/companies/C-0007.yaml")).not.toHaveProperty("updatedBy");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("the person in the record is the writer's, never the caller's", async () => {
    const { fixture, store, as, audit } = setup();
    try {
      await as({ subject: "subject-5", channel: "ui" }, () =>
        store.saveCompany(
          {
            ...newCompany(),
            updatedBy: "someone-else",
            updatedAt: "2020-01-01T00:00:00.000Z",
          } as never,
          null,
        ),
      );
      const record = audit("data/companies/C-0007.yaml");
      expect(record.updatedBy).toBe("subject-5");
      expect(record.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
      expect((await store.getCompany("C-0007"))?.value).not.toHaveProperty("updatedBy");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a publication records who published and by which channel", async () => {
    const { fixture, store, service, as } = setup();
    try {
      await as({ subject: "subject-2", channel: "ui" }, async () => {
        await service.createCompany({ name: "Delta s.r.o." });
        const card = await store.draft("en");
        await store.publish({ expectedRevision: card.revision ?? "" });
      });
      const trailers = git(fixture.originPath, ["log", "-1", "--format=%(trailers:only)", "v3"]);
      expect(trailers).toContain("Repository-Db-Actor: subject-2");
      expect(trailers).toContain("Repository-Db-Source: deals-v3/ui");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a change nobody stated the origin of is recorded as unknown, without a channel or a person", async () => {
    const { fixture, store, origins } = setup();
    try {
      await store.saveCompany(newCompany(), null);
      const [origin] = await origins();
      expect(origin).toEqual(expect.objectContaining({ kind: "unknown", source: "deals-v3" }));
      expect(origin?.actor).toBeUndefined();
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a failure to record the origin never fails the saved write", async () => {
    const { fixture, store, service, as } = setup();
    try {
      // The origin hint cannot be written: a directory stands where its file goes.
      mkdirSync(join(fixture.mountRoot, ".repository-db", "draft-origin.json"), {
        recursive: true,
      });
      const saved = await as({ subject: "subject-3", channel: "ui" }, () =>
        service.createCompany({ name: "Epsilon s.r.o." }),
      );
      expect(await store.getCompany(saved.value.id)).not.toBeNull();
      expect(existsSync(join(fixture.mountRoot, "data/companies"))).toBe(true);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a request that states no channel is unknown, with the gateway's person", async () => {
    const { fixture, store, service, as, origins } = setup();
    try {
      await as({ subject: "subject-4", channel: null }, () =>
        service.createCompany({ name: "Zeta s.r.o." }),
      );
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "unknown", actor: "subject-4", source: "deals-v3" }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
