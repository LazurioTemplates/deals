import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_ORIGIN } from "@lazurio/module-kit/tools/testing";
import { parseYaml } from "@lazurio/repository-db";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { CHANNEL_HEADER, createApi } from "../src/server/api.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newCompany } from "./support/seed.ts";

// Real Git and the data repository's validator run here; see repository-db-store.test.ts.
setDefaultTimeout(60_000);

/**
 * Author and channel (Module Standard, One data port): every change records
 * the person's subject and the channel it came by, in the draft, in the
 * record's audit fields and when it is published; a caller without a subject
 * records none. The channel is the one the request states in its header.
 */
function setup(subject: string | null) {
  const fixture = createFixtureRepo();
  const store = createRepositoryDbStore({
    mountRoot: fixture.mountRoot,
    expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
    intervalMs: 0,
  });
  const handle = createApi(store, {
    allowedOrigins: new Set([TEST_ORIGIN]),
    access: () => ({ admitted: true, mayWrite: true, subject }),
    today: () => "2026-11-25",
  });
  const call = (
    method: string,
    path: string,
    body: unknown,
    // The interface states its channel unless a test says otherwise.
    headers: Record<string, string> = { [CHANNEL_HEADER]: "ui" },
  ) =>
    handle(
      new Request(`${TEST_ORIGIN}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: TEST_ORIGIN, ...headers },
        body: JSON.stringify(body),
      }),
    );
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
  return { fixture, store, call, origins, audit };
}

describe("author and channel", () => {
  test("a change from the interface records the person and the channel ui", async () => {
    const { fixture, store, call, origins, audit } = setup("subject-1");
    try {
      const response = await call("POST", "/api/companies", { record: { name: "Alfa s.r.o." } });
      expect(response.status).toBe(201);
      expect(((await response.json()) as { value: { id: string } }).value.id).toBe("C-0007");
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
    const { fixture, store, call, origins } = setup("subject-1");
    try {
      const response = await call(
        "POST",
        "/api/companies",
        { record: { name: "Beta s.r.o." } },
        { [CHANNEL_HEADER]: "webmcp" },
      );
      expect(response.status).toBe(201);
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "agent", actor: "subject-1", source: "deals-v3/webmcp" }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a caller without a subject invents none", async () => {
    const { fixture, store, call, origins, audit } = setup(null);
    try {
      expect(
        (await call("POST", "/api/companies", { record: { name: "Gama s.r.o." } })).status,
      ).toBe(201);
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
    const { fixture, store, call, audit } = setup("subject-5");
    try {
      const opened = await store.getCompany("C-0001");
      if (!opened) throw new Error("C-0001 missing");
      // Audit fields a caller sends in the record are not kept.
      const saved = await call("PUT", "/api/companies/C-0001", {
        record: {
          ...opened.value,
          name: "Ukázka B s.r.o.",
          updatedBy: "someone-else",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
        baseRevision: opened.revision,
      });
      expect(saved.status).toBe(200);
      const record = audit("data/companies/C-0001.yaml");
      expect(record.updatedBy).toBe("subject-5");
      expect(record.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
      expect(String(record.updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(((await saved.json()) as { value: object }).value).not.toHaveProperty("updatedBy");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a publication records who published and by which channel", async () => {
    const { fixture, store, call } = setup("subject-2");
    try {
      expect(
        (await call("POST", "/api/companies", { record: { name: "Delta s.r.o." } })).status,
      ).toBe(201);
      const card = await store.draft("en");
      const published = await call("POST", "/api/draft/publish", {
        expectedRevision: card.revision,
      });
      expect(published.status).toBe(200);
      const trailers = git(fixture.originPath, ["log", "-1", "--format=%(trailers:only)", "v3"]);
      expect(trailers).toContain("Repository-Db-Actor: subject-2");
      expect(trailers).toContain("Repository-Db-Source: deals-v3/ui");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a change nobody stated the origin of is recorded as unknown, without a channel or a person", async () => {
    const { fixture, store, origins } = setup(null);
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
    const { fixture, store, call } = setup("subject-3");
    try {
      // The origin hint cannot be written: a directory stands where its file goes.
      mkdirSync(join(fixture.mountRoot, ".repository-db", "draft-origin.json"), {
        recursive: true,
      });
      const response = await call("POST", "/api/companies", { record: { name: "Epsilon s.r.o." } });
      expect(response.status).toBe(201);
      const saved = (await response.json()) as { value: { id: string } };
      expect(await store.getCompany(saved.value.id)).not.toBeNull();
      expect(existsSync(join(fixture.mountRoot, "data/companies"))).toBe(true);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a request that states no channel is unknown, with the gateway's person", async () => {
    const { fixture, store, call, origins } = setup("subject-4");
    try {
      expect(
        (await call("POST", "/api/companies", { record: { name: "Zeta s.r.o." } }, {})).status,
      ).toBe(201);
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "unknown", actor: "subject-4", source: "deals-v3" }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
