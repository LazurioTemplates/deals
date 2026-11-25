import type { DraftPanelInput } from "@lazurio/repository-db";
import type { Activity } from "../domain/activity.ts";
import type { Company } from "../domain/company.ts";
import type { Contact } from "../domain/contact.ts";
import type { Deal } from "../domain/deal.ts";
import type { RuleIssue } from "../domain/rules.ts";
import type { Settings } from "../domain/settings.ts";
import { DEFAULT_LOCALE, type Locale, type Localized } from "../i18n/locale.ts";
import type { AresCompany } from "../server/ares.ts";
import type { StageMove } from "../service/deals-service.ts";

/** What the server stores, as the browser receives it. */
export interface Stored<T> {
  value: T;
  revision: string;
}

export interface FieldIssue {
  path: string;
  message: string;
}

/** A refusal of the API, with the code the engine documents. */
export class ApiError extends Error {
  readonly code: string;
  readonly issues: FieldIssue[];
  /** With `record_changed`: the revision stored now. */
  readonly currentRevision: string | null | undefined;

  constructor(
    code: string,
    message: string,
    issues: FieldIssue[] = [],
    currentRevision?: string | null,
  ) {
    super(message);
    this.code = code;
    this.issues = issues;
    this.currentRevision = currentRevision;
  }
}

/** The interface's language, which the server words its answers in (`Accept-Language`). */
let locale: Locale = DEFAULT_LOCALE;

export function setApiLocale(value: Locale): void {
  locale = value;
}

/** The wording of the refusals a person can meet. */
const MESSAGES: Record<string, Localized> = {
  record_changed: {
    cs: "Záznam mezitím uložil někdo jiný. Načtěte ho znovu; vaše úpravy zůstávají ve formuláři.",
    en: "Someone else saved the record meanwhile. Load it again; your edits stay in the form.",
  },
  draft_changed: {
    cs: "Koncept se od zobrazení změnil. Podívejte se na něj znovu a potvrďte.",
    en: "The draft changed since it was shown. Look at it again and confirm.",
  },
  draft_write_blocked: {
    cs: "Právě probíhá publikování. Zkuste to za chvíli znovu.",
    en: "A publish is running. Try again in a moment.",
  },
  conflict_active: {
    cs: "Publikování zastavil konflikt; změny zůstávají vidět v konceptu.",
    en: "A conflict stopped publishing; the changes stay visible in the draft.",
  },
  publish_conflict: {
    cs: "Novější práci kolegy nešlo bezpečně spojit s vaší. Postup ukazuje karta konceptu.",
    en: "A colleague's newer work could not be combined with yours safely. The draft card shows the way out.",
  },
  pull_blocked_by_draft: {
    cs: "Kolega změnil stejný záznam, který upravujete. Vraťte ho, stáhněte a upravte znovu.",
    en: "A colleague changed the record you are editing. Return it, take their work and edit again.",
  },
  publish_push_failed: {
    cs: "Uloženo, ale server nebyl dostupný. Dokončete odeslání.",
    en: "Saved, but the server was not reached. Finish sending.",
  },
  send_pending: {
    cs: "Publikování čeká na odeslání; nejdřív ho dokončete.",
    en: "A publish waits to be sent; finish it first.",
  },
  identity_missing: {
    cs: "Toto Prostředí nemá jméno a e-mail pro Git; přihlaste se ke GitHubu v Lazuriu.",
    en: "This Environment has no Git name and e-mail; sign in to GitHub in Lazurio.",
  },
  credentials: {
    cs: "Toto Prostředí se k datovému repozitáři nedostane; přihlaste se.",
    en: "This Environment cannot reach the data repository; sign in.",
  },
  validation_failed: {
    cs: "Data porušují pravidlo datového repozitáře. Nic se nepublikovalo.",
    en: "The data breaks a rule of the data repository. Nothing was published.",
  },
  mount_unavailable: { cs: "Data zatím nejsou k dispozici.", en: "The data is not available yet." },
  settings_missing: {
    cs: "Datový repozitář zatím nemá nastavení obchodních případů.",
    en: "The data repository has no deal settings yet.",
  },
  origin_refused: {
    cs: "Změnu lze poslat jen z aplikace Obchodní případy.",
    en: "A change is accepted only from the Deals App.",
  },
  data_read_only: {
    cs: "Tato kopie Obchodních případů je teď jen ke čtení, změna se neuložila.",
    en: "This copy of Deals is read-only now; the change was not saved.",
  },
  forbidden: {
    cs: "V Obchodních případech nemáte roli. O přístup požádejte Admina Organizace.",
    en: "You have no role in Deals. Ask the Organization Admin for access.",
  },
};

/** Who sends a request: the interface (`ui`). The tools for agents state their own channel. */
export type ClientChannel = "ui";

async function send<T>(
  channel: ClientChannel,
  path: string,
  init?: { method: string; body: unknown },
): Promise<T> {
  // The page states its channel, so the server records the change as the
  // interface's or the page tools'.
  const said: Record<string, string> = { "x-lazurio-channel": channel };
  const response = await fetch(
    path,
    init
      ? {
          method: init.method,
          headers: { "content-type": "application/json", "accept-language": locale, ...said },
          body: JSON.stringify(init.body),
        }
      : { headers: { accept: "application/json", "accept-language": locale, ...said } },
  );
  const data = (await response.json().catch(() => null)) as
    | (T & {
        code?: string;
        message?: string;
        issues?: FieldIssue[];
        current_revision?: string | null;
      })
    | null;
  if (!response.ok) {
    const code = data?.code ?? "unexpected";
    throw new ApiError(
      code,
      MESSAGES[code]?.[locale] ?? data?.message ?? response.statusText,
      data?.issues,
      data?.current_revision,
    );
  }
  return data as T;
}

const at = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

type Without<T> = Omit<T, "id" | "revision" | "updatedAt" | "updatedBy">;

/** The API client for one channel. */
function makeApi(channel: ClientChannel) {
  const request = <T>(path: string, init?: { method: string; body: unknown }) =>
    send<T>(channel, path, init);
  const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body });
  const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body });
  return {
    /** Whether the data are open, and whether this copy lets the person change them now. */
    status: () =>
      request<{ ok: boolean; code?: string; message?: string; mayWrite?: boolean }>("/api/status"),
    settings: () => request<Stored<Settings>>("/api/settings"),
    saveSettings: (record: Settings, baseRevision: string) =>
      put<Stored<Settings>>("/api/settings", { record, baseRevision }),
    companies: () => request<Stored<Company>[]>("/api/companies"),
    createCompany: (record: Without<Company>) =>
      post<Stored<Company>>("/api/companies", { record }),
    saveCompany: (record: Company, baseRevision: string) =>
      put<Stored<Company>>(at("/api/companies", record.id), { record, baseRevision }),
    contacts: () => request<Stored<Contact>[]>("/api/contacts"),
    createContact: (record: Without<Contact>) => post<Stored<Contact>>("/api/contacts", { record }),
    saveContact: (record: Contact, baseRevision: string) =>
      put<Stored<Contact>>(at("/api/contacts", record.id), { record, baseRevision }),
    deals: () => request<Stored<Deal>[]>("/api/deals"),
    createDeal: (record: Omit<Without<Deal>, "createdAt">) =>
      post<Stored<Deal>>("/api/deals", { record }),
    saveDeal: (record: Deal, baseRevision: string) =>
      put<Stored<Deal>>(at("/api/deals", record.id), { record, baseRevision }),
    moveDeal: (id: string, move: StageMove) =>
      post<Stored<Deal>>(`${at("/api/deals", id)}/stage`, move),
    activities: () => request<Stored<Activity>[]>("/api/activities"),
    createActivity: (record: Without<Activity>) =>
      post<Stored<Activity>>("/api/activities", { record }),
    saveActivity: (record: Activity, baseRevision: string) =>
      put<Stored<Activity>>(at("/api/activities", record.id), { record, baseRevision }),
    /** A company by its IČO from ARES, through the server. */
    ares: (ico: string) => request<AresCompany>(at("/api/ares", ico)),
    check: () => request<RuleIssue[]>("/api/check"),
    draft: () => request<DraftPanelInput>("/api/draft"),
    publish: (expectedRevision: string) =>
      post<{ ok: true }>("/api/draft/publish", { expectedRevision }),
    finishSend: (expectedHead: string) =>
      post<{ ok: true }>("/api/draft/finish-send", { expectedHead }),
    discard: (
      scope: { kind: "draft" } | { kind: "record"; path: string },
      expectedRevision: string,
    ) => post<{ ok: true }>("/api/draft/discard", { scope, expectedRevision }),
    pull: () => post<{ ok: true }>("/api/draft/pull", {}),
  };
}

/** The interface's client: its changes are recorded with the channel `ui`. */
export const api = makeApi("ui");

/** Server events: records came in or the draft moved. Returns the unsubscribe function. */
export function subscribe(onChange: (type: "records-changed" | "draft-changed") => void) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource("/api/events");
  source.addEventListener("records-changed", () => onChange("records-changed"));
  source.addEventListener("draft-changed", () => onChange("draft-changed"));
  return () => source.close();
}
