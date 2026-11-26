import { describe, expect, test } from "bun:test";
import type { AppAccess } from "@lazurio/module-kit";
import { hostedEnvironment } from "@lazurio/module-kit/tools/testing";
import type { WebMcpTool } from "@lazurio/module-kit/webmcp";
import { LOCALES } from "../src/i18n/locale.ts";
import { createAgentTools, TOOL_DESCRIPTIONS, type ToolName } from "../src/server/agent-tools.ts";
import { fetchIn, installTools } from "../src/ui/tools.ts";

/** Every tool of the App in the order the registry lists them. */
const NAMES = [
  "get_settings",
  "list_salespeople",
  "list_pricebook",
  "find_deals",
  "get_deal",
  "find_companies",
  "get_company",
  "find_contacts",
  "get_contact",
  "list_quotes",
  "get_quote",
  "get_forecast",
  "get_stats",
  "check_data",
  "get_draft",
  "create_deal",
  "update_deal",
  "move_deal_stage",
  "plan_payments",
  "mark_payment",
  "create_company",
  "update_company",
  "create_contact",
  "update_contact",
  "add_activity",
  "create_quote",
  "save_quote",
  "set_quote_status",
  "revise_quote",
  "create_forecast_entry",
  "discard_draft",
  "publish_draft",
];

/** What each tool does to the data: reads, a draft, or the one publication. */
const EFFECTS: Record<string, "read" | "write" | "publish"> = Object.fromEntries(
  NAMES.map((name) => [
    name,
    name === "publish_draft" ? "publish" : /^(get|find|list|check)_/.test(name) ? "read" : "write",
  ]),
);

const ADMIN = {
  entry: "app",
  appRole: "admin",
  person: { subject: "2659b76d-0000-4000-8000-000000000001", username: "me" },
  source: "gateway",
  reason: null,
} as AppAccess;

describe("tools for agents: names, inputs and the page", () => {
  test("the server's tools are named verb first, take JSON Schema inputs and speak both languages; one publishes", () => {
    for (const locale of LOCALES) {
      const registry = createAgentTools({
        api: async () => Response.json({}),
        origin: "http://127.0.0.1:24940",
        locale,
        env: hostedEnvironment({ writer: true }),
        audit: () => {},
      });
      const own = registry.list(ADMIN).filter((tool) => tool.name !== "get_app_context");
      expect(own.map((tool) => tool.name)).toEqual(NAMES);
      expect(Object.keys(TOOL_DESCRIPTIONS)).toEqual(NAMES);
      for (const tool of own) {
        expect(tool.name).toMatch(/^[a-z]+(?:_[a-z]+)+$/);
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.description).toBe(TOOL_DESCRIPTIONS[tool.name as ToolName][locale]);
        expect({ name: tool.name, publishes: tool.effect === "publish" }).toEqual({
          name: tool.name,
          publishes: tool.name === "publish_draft",
        });
        expect(tool.annotations.destructiveHint).toBe(tool.effect === "publish");
        expect({ name: tool.name, effect: tool.effect as string }).toEqual({
          name: tool.name,
          effect: EFFECTS[tool.name] ?? "unknown",
        });
      }
      if (locale === "en")
        for (const tool of own)
          expect(tool.description.replace("IČO", "")).not.toMatch(/[ěščřžýáíéůú]/i);
      // ARES is the page's, never a tool; nothing sends or deletes.
      expect(own.map((tool) => tool.name).join(" ")).not.toMatch(/ares|send|delete/);
    }
  });

  test("the inputs an agent must give are required", () => {
    const registry = createAgentTools({
      api: async () => Response.json({}),
      origin: "http://127.0.0.1:24940",
      locale: "cs",
      env: hostedEnvironment({ writer: true }),
      audit: () => {},
    });
    const required = Object.fromEntries(
      registry
        .list(ADMIN)
        .map((tool) => [tool.name, [...((tool.inputSchema.required ?? []) as string[])].sort()]),
    );
    expect(required.get_deal).toEqual(["id"]);
    expect(required.create_deal).toEqual(["company_id", "owner_id", "title", "value"]);
    expect(required.update_deal).toEqual(["base_revision", "changes", "id"]);
    expect(required.move_deal_stage).toEqual(["base_revision", "id", "stage_id"]);
    expect(required.create_company).toEqual(["name"]);
    expect(required.add_activity).toEqual(["at", "deal_id", "summary", "type"]);
    expect(required.publish_draft).toEqual(["expected_revision"]);
    expect(required.find_deals).toEqual([]);
    expect(required.list_salespeople).toEqual([]);
    expect(required.list_pricebook).toEqual([]);
    expect(required.get_quote).toEqual(["id"]);
    expect(required.create_quote).toEqual(["deal_id"]);
    expect(required.save_quote).toEqual(["base_revision", "record"]);
    expect(required.set_quote_status).toEqual(["base_revision", "id", "status"]);
    expect(required.revise_quote).toEqual(["id"]);
    expect(required.plan_payments).toEqual(["base_revision", "deal_id"]);
    expect(required.mark_payment).toEqual(["base_revision"]);
    expect(required.get_forecast).toEqual([]);
    expect(required.get_stats).toEqual([]);
    expect(required.create_forecast_entry).toEqual(["amount", "month", "title"]);
  });

  test("the page registers what its server lists, in its language, and asks again", async () => {
    const registered: string[] = [];
    const asked: Array<string | null> = [];
    const context = {
      registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
        registered.push(tool.name);
        options?.signal?.addEventListener("abort", () => {
          registered.splice(registered.indexOf(tool.name), 1);
        });
      },
    };
    let names = ["find_deals", "create_deal"];
    const server = (async (_input: string | URL | Request, init?: RequestInit) => {
      asked.push(new Headers(init?.headers).get("accept-language"));
      return Response.json({
        tools: names.map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
        })),
      });
    }) as typeof fetch;
    const installed = installTools("en", { modelContext: context, fetch: server });
    await Bun.sleep(0);
    expect(registered).toEqual(["find_deals", "create_deal"]);
    names = ["find_deals"];
    installed.refresh();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(registered).toEqual(["find_deals"]);
    expect(asked).toEqual(["en", "en"]);
    installed.remove();
    expect(registered).toEqual([]);
  });

  test("a browser whose registration rejects on abort leaves no unhandled rejection, and refresh registers again", async () => {
    // As the WebMCP API in the Environment browser: `registerTool` returns a
    // promise that rejects with an `AbortError` once its signal aborts.
    const registered: string[] = [];
    const context = {
      registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
        registered.push(tool.name);
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            registered.splice(registered.indexOf(tool.name), 1);
            reject(new DOMException("signal is aborted without reason", "AbortError"));
          });
        });
      },
    };
    const server = (async () =>
      Response.json({
        tools: ["find_deals", "get_forecast"].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
        })),
      })) as unknown as typeof fetch;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const settle = async () => {
        for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0);
      };
      const installed = installTools("cs", { modelContext: context, fetch: server });
      await settle();
      expect(registered).toEqual(["find_deals", "get_forecast"]);
      // As after `/api/status`: the page asks again, twice in a row.
      installed.refresh();
      installed.refresh();
      await settle();
      expect(registered).toEqual(["find_deals", "get_forecast"]);
      installed.remove();
      expect(registered).toEqual([]);
      installed.refresh();
      await settle();
      expect(registered).toEqual([]);
      // A page removed while a refresh waits for the server's list: the tools
      // that refresh registers afterwards go too.
      let release: () => void = () => {};
      let calls = 0;
      const slow = (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        if (calls === 2) await new Promise<void>((resolve) => (release = resolve));
        return (server as (...a: Parameters<typeof fetch>) => Promise<Response>)(...args);
      }) as unknown as typeof fetch;
      const pending = installTools("cs", { modelContext: context, fetch: slow });
      await settle();
      expect(registered).toEqual(["find_deals", "get_forecast"]);
      pending.refresh();
      await settle();
      pending.remove();
      expect(registered).toEqual([]);
      release();
      await settle();
      await Bun.sleep(5);
      expect(registered).toEqual([]);
      // A page whose registration is removed before it finished.
      const early = installTools("en", { modelContext: context, fetch: server });
      early.remove();
      await settle();
      expect(registered).toEqual([]);
      await Bun.sleep(10);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("without WebMCP nothing is registered and the page works the same", async () => {
    const installed = installTools("cs", { modelContext: null });
    installed.refresh();
    installed.remove();
    let header: string | null = null;
    await fetchIn("cs", (async (_input: string | URL | Request, init?: RequestInit) => {
      header = new Headers(init?.headers).get("accept-language");
      return new Response();
    }) as typeof fetch)("/api/agent-tools", { headers: { accept: "application/json" } });
    expect(header as string | null).toBe("cs");
  });
});
