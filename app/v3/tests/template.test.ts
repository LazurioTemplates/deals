import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { hostedEnvironment } from "@lazurio/module-kit/tools/testing";
import packageJson from "../package.json";
import { createAgentTools } from "../src/server/agent-tools.ts";
import { lockProblem, parseDesignSystemPin } from "./support/design-system-pin.ts";

// The contract of the Module, checked on every pull request: the license,
// exact versions, the built version to run from `main`, and paths that check
// out on Windows, a client that loads nothing from another origin and ARES
// asked only by the server. The part only the template keeps (its
// placeholder identity and its own pins) runs only while the identity is the
// template's and is skipped in an adopted Module. The documents, the skills
// and the screenshots join this contract with the parts of the template that
// add them. The skills and the tools for agents are checked here as well.
const ROOT = resolve(import.meta.dir, "..", "..", "..");
const APP = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const TEMPLATE = JSON.parse(read("lazurio.module.json")).company === "REPLACE-WITH-ORG-NAME";

describe("module contract", () => {
  test("MIT by Lazurio contributors, with the documents an adoption needs", () => {
    expect(read("LICENSE")).toContain("MIT License");
    expect(read("LICENSE")).toContain("Copyright (c) 2026 Lazurio contributors");
    for (const file of [
      "README.md",
      "AGENTS.md",
      "CHANGELOG.md",
      "NOTICE.md",
      "SECURITY.md",
      "CONTRIBUTING.md",
      "docs/adoption.md",
      "docs/extending.md",
      "docs/data.md",
      "docs/agents.md",
    ]) {
      expect({ file, exists: existsSync(resolve(ROOT, file)) }).toEqual({ file, exists: true });
    }
    expect(read("docs/extending.md")).toContain("app-data@2027.03");
    expect(read("docs/adoption.md")).toContain(
      "lazurio module create <Org>/<slug> --stack vite-react",
    );
    expect(read("docs/adoption.md")).toContain("git merge-base --is-ancestor");
    expect(read("NOTICE.md")).toContain("design-system");
    expect(read("NOTICE.md")).toContain("`example.com` and `.example`");
  });

  test("the changelog gathers changes under Unreleased; a version is a dated heading", () => {
    expect(changelogProblems(read("CHANGELOG.md"))).toEqual([]);
  });

  test("a release as AGENTS.md describes it keeps the changelog check passing", () => {
    // The release pull request puts the version under Unreleased's entries
    // and keeps a new, empty Unreleased above it.
    const changelog = read("CHANGELOG.md");
    const released = changelog.replace(
      /^## Unreleased\n\n/m,
      "## Unreleased\n\n## 0.1.0 — 2026-11-25\n\n",
    );
    expect(released).not.toBe(changelog);
    expect(changelogProblems(released)).toEqual([]);
    // Turning Unreleased into the version, without a new one, is caught.
    expect(
      changelogProblems(changelog.replace(/^## Unreleased$/m, "## 0.1.0 — 2026-11-25")),
    ).toEqual(["no ## Unreleased heading"]);
  });

  test("CI judges the readiness with a pinned Lazurio CLI and wants ready-for-live", () => {
    const check = read(".github/workflows/check.yml");
    expect(check).toMatch(/LAZURIO_VERSION: v\d+\.\d+\.\d+/);
    expect(check).toContain(`releases/download/${"$"}{LAZURIO_VERSION}/install.sh`);
    expect(check).toContain('lazurio module readiness "$GITHUB_WORKSPACE" --json');
    expect(check).toContain('[ "$verdict" != "ready-for-live" ]');
    // The readiness runs after the build, from the repository's root.
    expect(check.indexOf("bun run build")).toBeLessThan(check.indexOf("module readiness"));
    expect(check).toContain("working-directory: .");
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
    // The module's slug is the Organization's (`deals`, or another agreed at
    // adoption); it only has to match the Module manifest.
    expect(identityProblems(JSON.parse(read("lazurio.module.json")), runtime)).toEqual([]);
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

  test("its dev and start scripts run the one server, its build the client with Vite", () => {
    const scripts = packageJson.scripts as Record<string, string>;
    for (const name of ["dev", "start"]) {
      const entry = /run (\S+)$/.exec(scripts[name] ?? "")?.[1] ?? "";
      expect({ name, entry, exists: existsSync(resolve(APP, entry)) }).toEqual({
        name,
        entry: "src/server/main.ts",
        exists: true,
      });
    }
    expect(scripts.build).toContain("vite");
    const vite = read("app/v3/vite.config.ts");
    expect(vite).toContain('root: "src/ui"');
    expect(vite).toContain("envDir: false");
    expect(vite).toContain('outDir: "../../dist"');
    expect(read(".github/workflows/check.yml")).toContain("bun run build");
  });

  test("the page loads nothing from another origin and works at a phone's width", () => {
    const html = read("app/v3/src/ui/index.html");
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
    expect(html).not.toMatch(/user-scalable|maximum-scale/);
    expect(html.match(/name="theme-color"/g)).toHaveLength(2);
    // No address of another origin in the client's sources: no web fonts,
    // icons or scripts from a CDN. The fonts come with the design system.
    const sources: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = resolve(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else sources.push(path);
      }
    };
    walk(resolve(APP, "src", "ui"));
    walk(resolve(APP, "src", "instance"));
    for (const file of sources) {
      const urls = readFileSync(file, "utf8").match(/(?:https?:)?\/\/[a-z0-9-]+\.[a-z0-9.-]+/gi);
      expect({ file, urls: urls ?? [] }).toEqual({ file, urls: [] });
    }
  });

  test("only the server asks ARES", () => {
    const files = new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: APP });
    const asking = [...files].filter((file) =>
      readFileSync(resolve(APP, file), "utf8").includes("ares.gov.cz"),
    );
    expect(asking.map((file) => file.replaceAll("\\", "/"))).toEqual(["src/server/ares.ts"]);
  });

  test("carries the process for agents, the same for Codex and Claude Code", () => {
    const names = readdirSync(resolve(ROOT, ".agents/skills")).sort();
    expect(names).toEqual(["close-deal", "create-deal-from-message", "weekly-pipeline-review"]);
    expect(readdirSync(resolve(ROOT, ".claude/skills")).sort()).toEqual(names);
    const registry = createAgentTools({
      api: async () => Response.json({}),
      origin: "http://127.0.0.1:24940",
      locale: "en",
      env: hostedEnvironment({ writer: true }),
      audit: () => {},
    });
    const tools = new Set(
      registry
        .list({
          entry: "app",
          appRole: "admin",
          person: { subject: "s", username: "u" },
          source: "gateway",
          reason: null,
        } as never)
        .map((tool) => tool.name),
    );
    for (const name of names) {
      const skill = read(`.agents/skills/${name}/SKILL.md`);
      expect(read(`.claude/skills/${name}/SKILL.md`)).toBe(skill);
      const [, frontmatter = ""] = /^---\n([\s\S]*?)\n---\n/.exec(skill) ?? [];
      expect(frontmatter).toContain(`name: ${name}`);
      const description = /^description: (.*)$/m.exec(frontmatter)?.[1] ?? "";
      expect(typeof JSON.parse(description)).toBe("string");
      // Every tool a skill names is one the App offers.
      const named = skill.match(
        /`((?:find|get|check|create|update|move|add|discard|publish)_[a-z_]+)`/g,
      );
      for (const tool of named ?? []) {
        const bare = tool.replaceAll("`", "");
        expect({ skill: name, tool: bare, offered: tools.has(bare) }).toEqual({
          skill: name,
          tool: bare,
          offered: true,
        });
      }
      // A skill publishes only on the person's instruction.
      if (skill.includes("publish_draft")) expect(skill).toMatch(/Publikuj/);
      expect(read("AGENTS.md")).toContain(`.agents/skills/${name}/SKILL.md`);
    }
    // docs/agents.md names every tool with its effect.
    const agents = read("docs/agents.md");
    for (const tool of registry.list({
      entry: "app",
      appRole: "admin",
      person: { subject: "s", username: "u" },
      source: "gateway",
      reason: null,
    } as never)) {
      if (tool.name === "get_app_context") continue;
      expect({
        tool: tool.name,
        documented: agents.includes(`| \`${tool.name}\` | ${tool.effect} |`),
      }).toEqual({
        tool: tool.name,
        documented: true,
      });
    }
  });

  test("offers its tools on /mcp and to the page from one server", () => {
    const serve = read("app/v3/src/server/serve.ts");
    expect(serve).toContain('url.pathname === "/mcp"');
    expect(serve).toContain("tools.handlePage(req)");
    const page = read("app/v3/src/ui/tools.ts");
    expect(page).toContain("@lazurio/module-kit/webmcp");
    // The kit's AbortError on removing a tool is handled (Lazurio/module-kit#14).
    expect(page).toContain("quietModelContext");
  });

  test("leases one port for its one process", () => {
    const manifest = JSON.parse(read("lazurio.module.json"));
    expect(manifest).toMatchObject({
      schema_version: "lazurio.module.v1",
      tcp_port_policy: { mode: "single" },
      apps: ["app/v3/package.json"],
      default_app: "app/v3/package.json",
    });
    expect(identityProblems(manifest, packageJson.lazurio.runtime)).toEqual([]);
  });

  test("an adopted Module keeps its own slug and port lease", () => {
    const runtime = packageJson.lazurio.runtime;
    const adopted = (id: string, port: number) => ({
      manifest: { id, port_leases: [{ id: "main", host: "127.0.0.1", port }] },
      runtime: { ...runtime, module: id },
    });
    // Another agreed slug and another free port pass.
    for (const { manifest, runtime: own } of [adopted("obchod", 31_207), adopted("deals", 41_000)])
      expect(identityProblems(manifest, own)).toEqual([]);
    // A slug the manifest and the runtime disagree on, or a lease the
    // listener does not name, or no valid port, fail.
    const { manifest } = adopted("obchod", 31_207);
    expect(identityProblems(manifest, { ...runtime, module: "deals" })).not.toEqual([]);
    expect(
      identityProblems(
        { ...manifest, port_leases: [{ id: "web", host: "127.0.0.1", port: 1 }] },
        {
          ...runtime,
          module: "obchod",
        },
      ),
    ).not.toEqual([]);
    expect(
      identityProblems(
        { ...manifest, port_leases: [{ id: "main", host: "0.0.0.0", port: 0 }] },
        {
          ...runtime,
          module: "obchod",
        },
      ),
    ).not.toEqual([]);
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
  });

  test("the App's version is the newest release in the changelog", () => {
    // Before the first release 0.0.0; a release pull request sets both.
    const newest = /^## (\d+\.\d+\.\d+) — /m.exec(read("CHANGELOG.md"))?.[1] ?? "0.0.0";
    expect(packageJson.version).toBe(newest);
  });

  test("ships the same screenshots in Czech and English, 1600 px wide", () => {
    const shots = (locale: string) =>
      readdirSync(resolve(ROOT, "docs/screenshots", locale))
        .filter((name) => name.endsWith(".webp"))
        .sort();
    const cs = shots("cs");
    expect(cs).toEqual([
      "company.webp",
      "deal.webp",
      "deals.webp",
      "overview.webp",
      "settings.webp",
    ]);
    expect(shots("en")).toEqual(cs);
    const readme = read("README.md");
    for (const locale of ["cs", "en"]) {
      expect(readme).toContain(`docs/screenshots/${locale}/overview.webp`);
      for (const name of cs) {
        const file = readFileSync(resolve(ROOT, "docs/screenshots", locale, name));
        expect({ file: `${locale}/${name}`, width: webpWidth(file) }).toEqual({
          file: `${locale}/${name}`,
          width: 1600,
        });
      }
    }
  });

  test("the template's own slug and port", () => {
    const manifest = JSON.parse(read("lazurio.module.json"));
    expect(manifest.id).toBe("deals");
    expect(manifest.port_leases).toEqual([{ id: "main", host: "127.0.0.1", port: 24940 }]);
    expect(packageJson.lazurio.runtime.module).toBe("deals");
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

/** What is wrong with a changelog: one `## Unreleased` first, then dated versions only. */
function changelogProblems(changelog: string): string[] {
  const headings = changelog.match(/^## .+$/gm) ?? [];
  const problems: string[] = [];
  if (headings[0] !== "## Unreleased") problems.push("no ## Unreleased heading");
  for (const heading of headings.slice(1)) {
    if (!/^## \d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}$/.test(heading))
      problems.push(`not a dated version: ${heading}`);
  }
  return problems;
}

/**
 * What does not hold between the Module manifest and the App's runtime
 * declaration, whatever slug and port the Organization chose: the slug is
 * the same in both, a lowercase slug; one lease on 127.0.0.1 with a port
 * Lazurio can give, and the entrypoint listener uses it.
 */
function identityProblems(
  manifest: { id?: unknown; port_leases?: { id?: unknown; host?: unknown; port?: unknown }[] },
  runtime: { module?: unknown; listeners?: { lease?: unknown }[] },
): string[] {
  const problems: string[] = [];
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id))
    problems.push("the manifest id is not a lowercase slug");
  if (runtime.module !== manifest.id) problems.push("runtime.module is not the manifest id");
  const leases = manifest.port_leases ?? [];
  const [lease] = leases;
  if (leases.length !== 1 || !lease) problems.push("not exactly one port lease");
  else {
    if (lease.host !== "127.0.0.1") problems.push("the lease is not on 127.0.0.1");
    const port = lease.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65_535)
      problems.push("the lease has no port Lazurio can give");
    if (!(runtime.listeners ?? []).every((listener) => listener.lease === lease.id))
      problems.push("a listener names another lease");
  }
  return problems;
}

/** The canvas width of a WebP file (VP8, VP8L or VP8X). */
function webpWidth(bytes: Buffer): number {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP")
    return -1;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return 1 + bytes.readUIntLE(24, 3);
  if (chunk === "VP8 ") return bytes.readUInt16LE(26) & 0x3fff;
  if (chunk === "VP8L") return 1 + ((bytes.readUInt32LE(21) & 0x3fff) >>> 0);
  return -1;
}
