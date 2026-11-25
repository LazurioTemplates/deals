import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import packageJson from "../package.json";
import { lockProblem, parseDesignSystemPin } from "./support/design-system-pin.ts";

// The contract of the Module, checked on every pull request: the license,
// exact versions, the built version to run from `main`, and paths that check
// out on Windows. The part only the template keeps (its placeholder identity
// and its own pins) runs only while the identity is the template's and is
// skipped in an adopted Module. The documents, the skills and the
// screenshots join this contract with the parts of the template that add
// them.
const ROOT = resolve(import.meta.dir, "..", "..", "..");
const APP = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const TEMPLATE = JSON.parse(read("lazurio.module.json")).company === "REPLACE-WITH-ORG-NAME";

describe("module contract", () => {
  test("MIT by Lazurio contributors", () => {
    expect(read("LICENSE")).toContain("MIT License");
    expect(read("LICENSE")).toContain("Copyright (c) 2026 Lazurio contributors");
  });

  test("exact versions, Bun 1.4.4 and the stack profile's pins", () => {
    expect(packageJson.packageManager).toBe("bun@1.4.4");
    const all = { ...packageJson.dependencies, ...packageJson.devDependencies } as Record<
      string,
      string
    >;
    for (const [name, version] of Object.entries(all)) {
      const exact =
        name === "design-system"
          ? parseDesignSystemPin(version) !== null
          : /^(\d+\.\d+\.\d+|github:Lazurio\/[a-z-]+#v\d+\.\d+\.\d+)$/.test(version);
      expect({ name, exact }).toEqual({ name, exact: true });
    }
    expect(all).toMatchObject({
      typescript: "7.0.2",
      vite: "8.3.5",
      react: "19.3.1",
      zod: "4.6.7",
      "@biomejs/biome": "2.6.4",
      "@lazurio/repository-db": "github:Lazurio/repository-db#v3.4.0",
      "@lazurio/module-kit": "github:Lazurio/module-kit#v0.6.0",
    });
    // bun.lock locks the design system exactly as package.json names it.
    const spec = packageJson.dependencies["design-system"];
    expect(lockProblem(readFileSync(resolve(APP, "bun.lock"), "utf8"), spec)).toBeNull();
    for (const workflow of [
      ".github/workflows/check.yml",
      ".github/workflows/windows-portability.yml",
    ]) {
      expect(read(workflow)).toContain("bun-version: 1.4.4");
      expect(read(workflow)).toContain("bun install --frozen-lockfile");
      expect(read(workflow)).toContain("bun run check");
    }
  });

  test("declares the built version that runs from main, in one process", () => {
    const runtime = packageJson.lazurio.runtime;
    const scripts = packageJson.scripts as Record<string, string>;
    expect(runtime.schema_version).toBe("lazurio.runtime.v1");
    expect(runtime.module).toBe("deals");
    expect(runtime.title).toBe("Obchodní případy");
    expect(runtime.tags).toEqual(["deals", "pipeline", "repository-db"]);
    expect(runtime.dev_script).toBe("dev");
    expect(runtime.start_script).toBe("start");
    expect(runtime.build_script).toBe("build");
    expect(runtime.build_output).toBe("dist");
    expect(runtime.listeners).toEqual([
      expect.objectContaining({
        lease: "main",
        protocol: "http",
        health: { kind: "http", path: "/healthz" },
      }),
    ]);
    for (const name of [
      runtime.dev_script,
      runtime.start_script,
      runtime.build_script,
      "check",
      "test",
      "validate:data",
      "schema:check",
    ]) {
      expect({ name, defined: typeof scripts[name] === "string" }).toEqual({ name, defined: true });
    }
    for (const name of [runtime.dev_script, runtime.start_script]) {
      expect(scripts[name]).toMatch(/^bun --no-env-file run [^&|;]+$/);
    }
    expect(scripts.check).toContain("schema:check");
    expect(scripts.check).toContain("validate:data");
    expect(scripts.check).toContain("bun test");
    expect(packageJson.lazurio.preparation).toEqual({
      schema_version: "lazurio.preparation.v1",
      owner_package: "app/v3/package.json",
      check_script: "check:prepared",
    });
    expect(typeof scripts["check:prepared"]).toBe("string");
  });

  test("leases one port for its one process", () => {
    const manifest = JSON.parse(read("lazurio.module.json"));
    expect(manifest).toMatchObject({
      schema_version: "lazurio.module.v1",
      id: "deals",
      tcp_port_policy: { mode: "single" },
      port_leases: [{ id: "main", host: "127.0.0.1", port: 24940 }],
      apps: ["app/v3/package.json"],
      default_app: "app/v3/package.json",
    });
  });

  test("every tracked path checks out on Windows", () => {
    const listed = spawnSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" });
    if (listed.status !== 0) return;
    for (const path of listed.stdout.split("\n").filter(Boolean)) {
      const bad =
        /[<>:"|?*\\]/.test(path) ||
        path
          .split("/")
          .some(
            (part) => /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(part) || /[ .]$/.test(part),
          ) ||
        path.length > 180;
      expect({ path, bad }).toEqual({ path, bad: false });
    }
  });
});

describe.skipIf(!TEMPLATE)("template contract (skipped in an adopted Module)", () => {
  test("the template pins the public design system", () => {
    expect(packageJson.dependencies["design-system"]).toBe(
      "github:LazurioTemplates/design-system#v2.2.0",
    );
    expect(packageJson.version).toBe("0.0.0");
  });

  test("leaves the Organization's identity as placeholders", () => {
    expect(JSON.parse(read("lazurio.module.json")).company).toBe("REPLACE-WITH-ORG-NAME");
    expect(packageJson.lazurio.runtime.company).toBe("REPLACE-WITH-ORG-NAME");
    expect(packageJson.lazurio.runtime.id).toBe("replace-with-org-slug-deals-v3");
    expect(read("app/v3/config/data-repository.json")).toContain(
      "REPLACE-WITH-ORG-NAME/deals-data",
    );
    expect(read("templates/data-repo/repository-db.yaml")).toContain(
      "REPLACE_WITH_ORGANIZATION/deals-data",
    );
  });
});
