import { z } from "zod";
import { channelOf, withOrigin } from "../data/origin.ts";
import { issuesOf } from "../data/records.ts";
import { type DealsStore, readOnly, StoreError } from "../data/store.ts";
import { activity } from "../domain/activity.ts";
import { isoDate, localToday, slug } from "../domain/common.ts";
import { company } from "../domain/company.ts";
import { contact } from "../domain/contact.ts";
import { deal } from "../domain/deal.ts";
import { forecastEntry, forecastNote } from "../domain/forecast-entry.ts";
import { money } from "../domain/money.ts";
import { MONTH, paymentPlan } from "../domain/payment-plan.ts";
import { pricebookItem } from "../domain/pricebook.ts";
import { QUOTE_STATUSES, quote } from "../domain/quote.ts";
import { salesperson } from "../domain/salesperson.ts";
import { settings } from "../domain/settings.ts";
import { LOCALES, type Locale, localeOfAcceptLanguage } from "../i18n/locale.ts";
import { createService, type DealsService, lastDays } from "../service/deals-service.ts";
import { ALL_IMPORT_FIELDS, IMPORT_KINDS, importRecords } from "../service/import.ts";
import type { AresClient } from "./ares.ts";

/**
 * The HTTP API of Deals. The browser talks only to this API; the API talks
 * only to the service over the storage port, never to files or Git, and only
 * the server talks to ARES.
 */
export interface ApiOptions {
  /** Origins a writing request may come from (the App's own, loopback and hosted). */
  allowedOrigins: ReadonlySet<string>;
  /** Who came and whether they may write now; `accessOf` of `access.ts` in the App. */
  access: (request: Request) => { admitted: boolean; mayWrite: boolean; subject?: string | null };
  /** Today's date for new records, the forecast and the statistics; injectable for tests. */
  today?: () => string;
  /** The ARES lookup (`createAres` of `ares.ts`); without it ARES is unavailable. */
  ares?: AresClient;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const revision = z.string().min(1);
const save = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ record: schema, baseRevision: revision });
const create = <T extends z.ZodType>(schema: T) => z.strictObject({ record: schema });

const newDeal = deal.omit({ id: true, createdAt: true }).extend({ createdAt: isoDate.optional() });

const stageMove = z.strictObject({
  stageId: slug,
  baseRevision: revision,
  value: money.optional(),
  closedAt: isoDate.optional(),
  lossReasonId: slug.optional(),
  lossNote: z.string().max(2000).optional(),
  paymentPlan: paymentPlan.optional(),
});

const paymentChange = z.strictObject({
  baseRevision: revision,
  invoicedOn: isoDate.nullable().optional(),
  paidOn: isoDate.nullable().optional(),
});

const removal = z.strictObject({ baseRevision: revision });

const newQuote = z.strictObject({
  dealId: z.string().min(1),
  title: z.string().max(200).optional(),
  pricebookItemIds: z.array(z.string()).max(200).optional(),
});

const importField = z.enum(ALL_IMPORT_FIELDS);
const importInput = z.strictObject({
  kind: z.enum(IMPORT_KINDS),
  rows: z
    .array(
      z.strictObject({
        row: z.int().min(1),
        values: z.partialRecord(importField, z.string().max(10_000)),
      }),
    )
    .min(1)
    .max(5_000),
  createCompanies: z.boolean(),
  numberLocale: z.enum(LOCALES),
  defaultOwnerId: z.string().min(1).optional(),
});

const publishInput = z.strictObject({
  expectedRevision: z.string().min(1),
  summary: z.string().trim().min(1).optional(),
});

const discardInput = z.strictObject({
  scope: z.union([
    z.strictObject({ kind: z.literal("draft") }),
    z.strictObject({ kind: z.literal("record"), path: z.string().min(1) }),
  ]),
  expectedRevision: z.string().min(1),
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function refusal(
  code: string,
  message: string,
  status: number,
  issues: unknown[] = [],
  extra: Record<string, unknown> = {},
) {
  return json({ code, message, issues, ...extra }, status);
}

const STATUS_BY_CODE: Record<string, number> = {
  bad_request: 400,
  not_found: 404,
  invalid_record: 422,
  rules_failed: 422,
  validation_failed: 422,
  materialize_failed: 422,
  invalid_ico: 422,
  ares_disabled: 404,
  ares_not_found: 404,
  ares_rate_limited: 429,
  ares_unavailable: 502,
  record_changed: 409,
  draft_changed: 409,
  draft_write_blocked: 409,
  conflict_active: 409,
  publish_conflict: 409,
  pull_blocked_by_draft: 409,
  send_pending: 409,
  publish_push_failed: 502,
  credentials: 401,
  identity_missing: 401,
  settings_missing: 503,
  mount_unavailable: 503,
  boundary_violation: 503,
  config_changed: 503,
};

function errorResponse(error: unknown, locale: Locale): Response {
  if (error instanceof StoreError) {
    // A stale save names the revision stored now, so the editor can reload it.
    const extra =
      error.code === "record_changed" ? { current_revision: error.currentRevision ?? null } : {};
    return refusal(
      error.code,
      error.messageIn(locale),
      STATUS_BY_CODE[error.code] ?? 409,
      error.issuesIn(locale),
      extra,
    );
  }
  console.error(error);
  return refusal("unexpected", error instanceof Error ? error.message : String(error), 500);
}

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new StoreError("bad_request", {
      cs: "Tělo požadavku není JSON.",
      en: "The request body is not JSON.",
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = issuesOf(parsed.error.issues, ["record"]);
    throw new StoreError(
      "invalid_record",
      {
        cs: issues.map((issue) => `${issue.path}: ${issue.message.cs}`).join("; "),
        en: issues.map((issue) => `${issue.path}: ${issue.message.en}`).join("; "),
      },
      issues,
    );
  }
  return parsed.data;
}

/** A write is accepted only as JSON from one of the App's own origins (no cross-site writes). */
function writeRefusal(
  req: Request,
  allowedOrigins: ReadonlySet<string>,
  locale: Locale,
): Response | null {
  if (!WRITE_METHODS.has(req.method)) return null;
  const origin = req.headers.get("origin");
  const en = locale === "en";
  if (!origin || !allowedOrigins.has(origin)) {
    return refusal(
      "origin_refused",
      en
        ? "A change is accepted only from the Deals App."
        : "Změnu lze poslat jen z aplikace Obchodní případy.",
      403,
    );
  }
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return refusal(
      "bad_request",
      en ? "A change is sent as application/json." : "Změna se posílá jako application/json.",
      415,
    );
  }
  return null;
}

/** The header the interface and a page tool send so a change is recorded with its channel. */
export const CHANNEL_HEADER = "x-lazurio-channel";

const sameId = (stated: string, path: string, what: { cs: string; en: string }) => {
  if (stated !== path) {
    throw new StoreError("bad_request", {
      cs: `Id ${what.cs} se nemění.`,
      en: `The id of ${what.en} does not change.`,
    });
  }
};

export function createApi(store: DealsStore, options: ApiOptions) {
  const today = options.today ?? (() => localToday());
  const serviceOver = (port: DealsStore): DealsService => createService(port, { today });
  // A request that may not write gets the store as a read-only view, and the
  // service over it, so a change is refused at the port too.
  const writing = { store, service: serviceOver(store) };
  const reading = { store: readOnly(store), service: serviceOver(readOnly(store)) };

  function events(req: Request): Response {
    let stop = () => {};
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(": connected\n\n");
        const unsubscribe = store.subscribe((event) => {
          controller.enqueue(`event: ${event.type}\ndata: {}\n\n`);
        });
        const keepAlive = setInterval(() => controller.enqueue(": keep-alive\n\n"), 25_000);
        stop = () => {
          clearInterval(keepAlive);
          unsubscribe();
        };
        req.signal.addEventListener("abort", () => {
          stop();
          controller.close();
        });
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }

  const one = (pattern: RegExp, pathname: string) => {
    const match = pattern.exec(pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  };

  const notFound = (locale: Locale, cs: string, en: string) =>
    refusal("not_found", locale === "en" ? en : cs, 404);

  async function route(
    req: Request,
    url: URL,
    locale: Locale,
    mayWrite: boolean,
    port: { store: DealsStore; service: DealsService },
  ): Promise<Response> {
    // The store and the service as this request may use them.
    const { store, service } = port;
    const { pathname } = url;
    const method = req.method;
    const get = method === "GET";

    // The one writer rule for this request (Module Standard): the page
    // offers changes only while `mayWrite` is true.
    if (pathname === "/api/status" && get) return json({ ...(await store.available()), mayWrite });
    if (pathname === "/api/settings" && get) return json(await store.settings());
    if (pathname === "/api/settings" && method === "PUT") {
      const input = await body(req, save(settings));
      return json(await store.saveSettings(input.record, input.baseRevision));
    }

    if (pathname === "/api/companies" && get) return json(await store.listCompanies());
    if (pathname === "/api/companies" && method === "POST") {
      const input = await body(req, create(company.omit({ id: true })));
      return json(await service.createCompany(input.record), 201);
    }
    const companyId = one(/^\/api\/companies\/([^/]+)$/, pathname);
    if (companyId && get) {
      const found = await store.getCompany(companyId);
      return found
        ? json(found)
        : notFound(
            locale,
            `Firma ${companyId} neexistuje.`,
            `The company ${companyId} does not exist.`,
          );
    }
    if (companyId && method === "PUT") {
      const input = await body(req, save(company));
      sameId(input.record.id, companyId, { cs: "firmy", en: "a company" });
      return json(await store.saveCompany(input.record, input.baseRevision));
    }

    if (pathname === "/api/contacts" && get) return json(await store.listContacts());
    if (pathname === "/api/contacts" && method === "POST") {
      const input = await body(req, create(contact.omit({ id: true })));
      return json(await service.createContact(input.record), 201);
    }
    const contactId = one(/^\/api\/contacts\/([^/]+)$/, pathname);
    if (contactId && get) {
      const found = await store.getContact(contactId);
      return found
        ? json(found)
        : notFound(
            locale,
            `Kontakt ${contactId} neexistuje.`,
            `The contact ${contactId} does not exist.`,
          );
    }
    if (contactId && method === "PUT") {
      const input = await body(req, save(contact));
      sameId(input.record.id, contactId, { cs: "kontaktu", en: "a contact" });
      return json(await store.saveContact(input.record, input.baseRevision));
    }

    if (pathname === "/api/deals" && get) return json(await store.listDeals());
    if (pathname === "/api/deals" && method === "POST") {
      const input = await body(req, create(newDeal));
      return json(await service.createDeal(input.record), 201);
    }
    const planOf = one(/^\/api\/deals\/([^/]+)\/plan$/, pathname);
    if (planOf && method === "PUT") {
      const input = await body(req, z.strictObject({ plan: paymentPlan, baseRevision: revision }));
      return json(await service.planPayments(planOf, input.plan, input.baseRevision));
    }
    const paymentOf = /^\/api\/deals\/([^/]+)\/payments\/([^/]+)$/.exec(pathname);
    if (paymentOf?.[1] && paymentOf[2] && method === "POST") {
      const input = await body(req, paymentChange);
      return json(
        await service.changePayment(
          decodeURIComponent(paymentOf[1]),
          decodeURIComponent(paymentOf[2]),
          input,
        ),
      );
    }
    const stageOf = one(/^\/api\/deals\/([^/]+)\/stage$/, pathname);
    if (stageOf && method === "POST") {
      return json(await service.moveDeal(stageOf, await body(req, stageMove)));
    }
    const dealId = one(/^\/api\/deals\/([^/]+)$/, pathname);
    if (dealId && get) {
      const found = await store.getDeal(dealId);
      return found
        ? json(found)
        : notFound(
            locale,
            `Obchodní případ ${dealId} neexistuje.`,
            `The deal ${dealId} does not exist.`,
          );
    }
    if (dealId && method === "PUT") {
      const input = await body(req, save(deal));
      sameId(input.record.id, dealId, { cs: "obchodního případu", en: "a deal" });
      return json(await service.saveDeal(input.record, input.baseRevision));
    }

    if (pathname === "/api/activities" && get) return json(await store.listActivities());
    if (pathname === "/api/activities" && method === "POST") {
      const input = await body(req, create(activity.omit({ id: true })));
      return json(await service.logActivity(input.record), 201);
    }
    const activityId = one(/^\/api\/activities\/([^/]+)$/, pathname);
    if (activityId && method === "PUT") {
      const input = await body(req, save(activity));
      sameId(input.record.id, activityId, { cs: "aktivity", en: "an activity" });
      return json(await store.saveActivity(input.record, input.baseRevision));
    }

    if (pathname === "/api/salespeople" && get) return json(await store.list("salespeople"));
    if (pathname === "/api/salespeople" && method === "POST") {
      const input = await body(req, create(salesperson.omit({ id: true })));
      return json(await service.createSalesperson(input.record), 201);
    }
    const salespersonId = one(/^\/api\/salespeople\/([^/]+)$/, pathname);
    if (salespersonId && method === "PUT") {
      const input = await body(req, save(salesperson));
      sameId(input.record.id, salespersonId, { cs: "obchodníka", en: "a salesperson" });
      return json(await store.save("salespeople", input.record, input.baseRevision));
    }

    if (pathname === "/api/pricebook" && get) return json(await store.list("pricebook"));
    if (pathname === "/api/pricebook" && method === "POST") {
      const input = await body(req, create(pricebookItem.omit({ id: true })));
      return json(await service.createPricebookItem(input.record), 201);
    }
    const itemId = one(/^\/api\/pricebook\/([^/]+)$/, pathname);
    if (itemId && method === "PUT") {
      const input = await body(req, save(pricebookItem));
      sameId(input.record.id, itemId, { cs: "položky ceníku", en: "a price list item" });
      return json(await store.save("pricebook", input.record, input.baseRevision));
    }

    if (pathname === "/api/quotes" && get) return json(await store.list("quotes"));
    if (pathname === "/api/quotes" && method === "POST") {
      return json(await service.createQuote(await body(req, newQuote)), 201);
    }
    const reviseOf = one(/^\/api\/quotes\/([^/]+)\/revise$/, pathname);
    if (reviseOf && method === "POST") return json(await service.reviseQuote(reviseOf), 201);
    const statusOf = one(/^\/api\/quotes\/([^/]+)\/status$/, pathname);
    if (statusOf && method === "POST") {
      const input = await body(
        req,
        z.strictObject({ status: z.enum(QUOTE_STATUSES), baseRevision: revision }),
      );
      return json(await service.setQuoteStatus(statusOf, input.status, input.baseRevision));
    }
    const quoteId = one(/^\/api\/quotes\/([^/]+)$/, pathname);
    if (quoteId && get) {
      const found = await store.get("quotes", quoteId);
      return found
        ? json(found)
        : notFound(
            locale,
            `Nabídka ${quoteId} neexistuje.`,
            `The quote ${quoteId} does not exist.`,
          );
    }
    if (quoteId && method === "PUT") {
      const input = await body(req, save(quote));
      sameId(input.record.id, quoteId, { cs: "nabídky", en: "a quote" });
      return json(await service.saveQuote(input.record, input.baseRevision));
    }

    if (pathname === "/api/forecast-entries" && get) {
      return json(await store.list("forecastEntries"));
    }
    if (pathname === "/api/forecast-entries" && method === "POST") {
      const input = await body(req, create(forecastEntry.omit({ id: true })));
      return json(await service.createForecastEntry(input.record), 201);
    }
    const entryPayment = one(/^\/api\/forecast-entries\/([^/]+)\/payment$/, pathname);
    if (entryPayment && method === "POST") {
      return json(await service.changeForecastEntry(entryPayment, await body(req, paymentChange)));
    }
    const entryId = one(/^\/api\/forecast-entries\/([^/]+)$/, pathname);
    if (entryId && method === "PUT") {
      const input = await body(req, save(forecastEntry));
      sameId(input.record.id, entryId, { cs: "řádku forecastu", en: "a forecast row" });
      return json(await store.save("forecastEntries", input.record, input.baseRevision));
    }
    if (entryId && method === "DELETE") {
      const input = await body(req, removal);
      await store.remove("forecastEntries", entryId, input.baseRevision);
      return json({ ok: true });
    }

    if (pathname === "/api/forecast-notes" && get) return json(await store.list("forecastNotes"));
    const noteMonth = one(/^\/api\/forecast-notes\/([^/]+)$/, pathname);
    if (noteMonth && method === "PUT") {
      if (!MONTH.test(noteMonth)) {
        throw new StoreError("bad_request", {
          cs: "Měsíc poznámky je ve tvaru YYYY-MM.",
          en: "The month of a note is YYYY-MM.",
        });
      }
      const input = await body(
        req,
        z.strictObject({
          text: forecastNote.shape.text.or(z.literal("")),
          baseRevision: revision.nullable(),
        }),
      );
      return json(await service.saveForecastNote(noteMonth, input.text, input.baseRevision));
    }

    if (pathname === "/api/forecast" && get) {
      const year = url.searchParams.get("year");
      const parsedYear = year && /^[0-9]{4}$/.test(year) ? Number(year) : undefined;
      return json(
        await service.forecast(parsedYear, {
          ownerId: url.searchParams.get("owner") || undefined,
          dealTypeId: url.searchParams.get("type") || undefined,
          billingEntityId: url.searchParams.get("entity") || undefined,
        }),
      );
    }
    if (pathname === "/api/stats" && get) {
      const fallback = lastDays(today());
      const period = z.strictObject({ from: isoDate, to: isoDate }).safeParse({
        from: url.searchParams.get("from") ?? fallback.from,
        to: url.searchParams.get("to") ?? fallback.to,
      });
      if (!period.success || period.data.to < period.data.from) {
        throw new StoreError("bad_request", {
          cs: "Období potřebuje from a to ve tvaru YYYY-MM-DD, from nejpozději v den to.",
          en: "A period needs from and to as YYYY-MM-DD, from no later than to.",
        });
      }
      return json(
        await service.stats(period.data, {
          ownerId: url.searchParams.get("owner") || undefined,
          dealTypeId: url.searchParams.get("type") || undefined,
        }),
      );
    }

    const ico = one(/^\/api\/ares\/([^/]+)$/, pathname);
    if (ico && get) {
      // ARES is asked only while the Organization turned it on.
      if (!(await store.settings()).value.aresLookup) {
        throw new StoreError("ares_disabled", {
          cs: "Vyhledávání v ARES je v nastavení vypnuté.",
          en: "The ARES lookup is turned off in the settings.",
        });
      }
      if (!options.ares) {
        throw new StoreError("ares_unavailable", {
          cs: "ARES teď není dostupný. Vyplňte firmu ručně.",
          en: "ARES is not available now. Fill the company in by hand.",
        });
      }
      return json(await options.ares(ico));
    }

    // An import writes every new record in one draft and answers in the person's language.
    if (pathname === "/api/import" && method === "POST") {
      const input = await body(req, importInput);
      return json(await importRecords(store, input, { today: today(), locale }));
    }

    if (pathname === "/api/check" && get) return json(await store.check(locale, today()));
    if (pathname === "/api/draft" && get) return json(await store.draft(locale));
    if (pathname === "/api/draft/publish" && method === "POST") {
      const input = await body(req, publishInput);
      await store.publish(input.summary ? input : { expectedRevision: input.expectedRevision });
      return json({ ok: true });
    }
    if (pathname === "/api/draft/finish-send" && method === "POST") {
      const input = await body(req, z.strictObject({ expectedHead: z.string().min(1) }));
      await store.finishSend(input.expectedHead);
      return json({ ok: true });
    }
    if (pathname === "/api/draft/discard" && method === "POST") {
      const input = await body(req, discardInput);
      await store.discard(input.scope, input.expectedRevision);
      return json({ ok: true });
    }
    if (pathname === "/api/draft/pull" && method === "POST") {
      await store.pull();
      return json({ ok: true });
    }
    if (pathname === "/api/events" && get) return events(req);
    return refusal(
      "not_found",
      locale === "en"
        ? `${method} ${pathname} is not part of the API.`
        : `${method} ${pathname} není součást API.`,
      404,
    );
  }

  /** Answers an `/api/…` request; every other path is not the API's. */
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const locale = localeOfAcceptLanguage(req.headers.get("accept-language"));
    const refused = writeRefusal(req, options.allowedOrigins, locale);
    if (refused) return refused;
    // Who came: no application role grants nothing (decision 0231).
    const access = options.access(req);
    if (!access.admitted)
      return refusal(
        "forbidden",
        locale === "en"
          ? "Deals needs an application role."
          : "Obchodní případy potřebují roli v aplikaci.",
        403,
      );
    // One writer: a copy that may not write refuses every change before it
    // reaches the store, so no draft, publish or pull starts there either.
    if (WRITE_METHODS.has(req.method) && !access.mayWrite)
      return refusal(
        "data_read_only",
        locale === "en"
          ? "This copy of Deals does not change data now; it only reads them."
          : "Tato kopie Obchodních případů teď data nemění, jen je čte.",
        409,
      );
    try {
      // Who made the change and by which channel (Module Standard, One data
      // port): the interface or a page tool, as the page states it. The
      // page's statement is the App's, not a proof.
      const channel = channelOf(req.headers.get(CHANNEL_HEADER));
      return await withOrigin({ subject: access.subject ?? null, channel }, () =>
        route(req, url, locale, access.mayWrite, access.mayWrite ? writing : reading),
      );
    } catch (error) {
      return errorResponse(error, locale);
    }
  };
}
