import {
  allowedHosts,
  type Listener,
  listener,
  ModuleKitError,
  onShutdown,
  withHealth,
} from "@lazurio/module-kit";
import type { DealsStore } from "../data/store.ts";
import { accessOf, LISTENER } from "./access.ts";
import { createAgentToolsHandler } from "./agent-tools.ts";
import { createApi } from "./api.ts";
import { type AresClient, createAres } from "./ares.ts";
import { clientDirectory, createStaticHandler } from "./static.ts";

export const HEALTH_PATH = "/healthz";

/**
 * Starts the one server process of the App over a store: the API (with the
 * ARES lookup, which only the server calls), the tools for agents (`/mcp`
 * and the page's `/api/agent-tools`), the health path and the client.
 * Host and port come only from the Lazurio listener (Module Standard);
 * without them the process exits 2.
 */
export async function serve(
  createStore: () => DealsStore,
  label: string,
  options: {
    /** Only a copy whose data live in memory admits and writes without Lazurio. */
    access?: (request: Request) => { admitted: boolean; mayWrite: boolean };
    /** The ARES lookup; the public ARES by default. */
    ares?: AresClient;
  } = {},
) {
  let app: Listener;
  try {
    app = listener(LISTENER);
  } catch (error) {
    if (!(error instanceof ModuleKitError)) throw error;
    console.error(`Start through Lazurio lifecycle: ${error.message}`);
    process.exit(2);
  }

  const store = createStore();
  const hosts = new Set(allowedHosts(LISTENER));
  const origins = new Set<string>();
  for (const host of hosts) {
    origins.add(`http://${host.includes(":") ? `[${host}]` : host}:${app.port}`);
  }
  if (app.externalOrigin) origins.add(app.externalOrigin);
  const access = options.access ?? ((request: Request) => accessOf(request));
  const api = createApi(store, {
    allowedOrigins: origins,
    access,
    ares: options.ares ?? createAres(),
  });

  // The tools for agents call the same API (`agent-tools.ts`), offered on
  // `/mcp` and to the page on `/api/agent-tools`.
  const [ownOrigin] = origins;
  const tools = createAgentToolsHandler({
    api,
    origin: app.externalOrigin ?? ownOrigin ?? `http://127.0.0.1:${app.port}`,
  });

  const hostAllowed = (req: Request) => {
    const header = req.headers.get("host") ?? "";
    const hostname = header.startsWith("[")
      ? header.slice(1, header.indexOf("]"))
      : header.split(":")[0];
    return hostname !== undefined && hosts.has(hostname);
  };

  const production = process.env.NODE_ENV === "production";
  const serveClient = production ? createStaticHandler(clientDirectory()) : null;
  const handle = withHealth(
    async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === "/mcp") return tools.handleMcp(req);
      const toolPage = await tools.handlePage(req);
      if (toolPage) return toolPage;
      if (url.pathname.startsWith("/api/")) return api(req);
      if (serveClient && (req.method === "GET" || req.method === "HEAD")) {
        return serveClient(url.pathname);
      }
      return new Response("Not found", { status: 404 });
    },
    HEALTH_PATH,
    async () => (await store.available()).ok,
  );
  const guarded = (req: Request) =>
    hostAllowed(req) ? handle(req) : new Response("Forbidden host", { status: 403 });

  // A development run bundles the client itself (Bun's HTML import with hot
  // reload), a production run serves the client build: one process either way.
  const server = production
    ? Bun.serve({ hostname: app.host, port: app.port, idleTimeout: 0, fetch: guarded })
    : Bun.serve({
        hostname: app.host,
        port: app.port,
        idleTimeout: 0,
        development: { hmr: true, console: false },
        routes: {
          "/api/*": guarded,
          "/mcp": guarded,
          [HEALTH_PATH]: guarded,
          "/*": (await import("../ui/index.html")).default,
        },
        fetch: guarded,
      });

  console.log(`Deals ${label} serves ${server.url.href}`);

  // SIGTERM from Lazurio: stop the data sync, close every connection, exit 0.
  onShutdown(async () => {
    store.close();
    await server.stop(true);
  });
}
