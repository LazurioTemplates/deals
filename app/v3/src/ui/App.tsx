import type { DraftPanelInput } from "@lazurio/repository-db";
import { Alert } from "design-system/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity } from "../domain/activity.ts";
import type { DataSet } from "../domain/collections.ts";
import type { Company } from "../domain/company.ts";
import type { Contact } from "../domain/contact.ts";
import type { Deal } from "../domain/deal.ts";
import type { Settings } from "../domain/settings.ts";
import { ApiError, api, type Stored, subscribe } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { useLocale, useT } from "./i18n.tsx";
import { CompanyListPage } from "./pages/CompanyListPage.tsx";
import { CompanyPage } from "./pages/CompanyPage.tsx";
import { ContactListPage } from "./pages/ContactListPage.tsx";
import { ContactPage } from "./pages/ContactPage.tsx";
import { DealListPage } from "./pages/DealListPage.tsx";
import { DealPage } from "./pages/DealPage.tsx";
import { DraftPage } from "./pages/DraftPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { parseRoute, type Route } from "./routes.ts";
import { followWriteStatus, useCanWrite, WriteContext } from "./write.tsx";

/** Everything the pages read, loaded once and again whenever the data moves. */
export interface AppData {
  settings: Stored<Settings>;
  companies: Stored<Company>[];
  contacts: Stored<Contact>[];
  deals: Stored<Deal>[];
  activities: Stored<Activity>[];
}

/** The records of the App's data without their revisions, as the domain reads them. */
export function dataSetOf(data: AppData): DataSet & { settings: Settings } {
  const values = <T,>(entries: readonly Stored<T>[]) => entries.map((entry) => entry.value);
  return {
    settings: data.settings.value,
    companies: values(data.companies),
    contacts: values(data.contacts),
    deals: values(data.deals),
    activities: values(data.activities),
  };
}

/** Every record the pages read, as the API stores them now. */
export async function loadAppData(): Promise<AppData> {
  const [settings, companies, contacts, deals, activities] = await Promise.all([
    api.settings(),
    api.companies(),
    api.contacts(),
    api.deals(),
    api.activities(),
  ]);
  return { settings, companies, contacts, deals, activities };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function App() {
  const t = useT();
  const locale = useLocale();
  const route = useHashRoute();
  const [data, setData] = useState<AppData | null>(null);
  const [draft, setDraft] = useState<DraftPanelInput | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  // The one writer rule for this visitor: `null` until the server said it.
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  useEffect(() => followWriteStatus(api.status, setCanWrite), []);
  const reloadStatus = useCallback(async () => {
    await api.status().then(
      (status) => setCanWrite(status.mayWrite === true),
      () => {},
    );
  }, []);

  // Only the reload asked last shows: an earlier one that answers later
  // never puts older records back under the forms.
  const asked = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const loaded = await loadAppData();
      if (mine !== asked.current) return;
      setData(loaded);
      setError(null);
    } catch (caught) {
      if (mine !== asked.current) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }, []);
  const reloadDraft = useCallback(async () => {
    setDraft(await api.draft().catch(() => null));
  }, []);

  useEffect(() => {
    void reload();
    void reloadDraft();
    // Every write of any page, a discard and a colleague's work that came in
    // say `records-changed`: the lists and the overview reload, and an open
    // form keeps what the person is typing (`useRecordForm`).
    return subscribe((type) => {
      if (type === "records-changed") {
        void reload();
        void reloadStatus();
      }
      void reloadDraft();
    });
  }, [reload, reloadDraft, reloadStatus]);

  const changed = async () => {
    await Promise.all([reload(), reloadDraft(), reloadStatus()]);
  };

  const quiet =
    error instanceof ApiError &&
    (error.code === "mount_unavailable" || error.code === "settings_missing");
  return (
    <WriteContext.Provider value={canWrite}>
      <Layout route={route} draft={draft}>
        {error ? (
          <Alert
            tone={quiet ? "info" : "danger"}
            live={quiet ? "polite" : "assertive"}
            locale={locale}
          >
            <strong>
              {quiet
                ? t("Data zatím nejsou k dispozici.", "The data is not available yet.")
                : t("Data se nepodařilo načíst.", "The data could not be loaded.")}
            </strong>{" "}
            {error.message}
          </Alert>
        ) : null}
        {data ? <Page route={route} data={data} onChanged={changed} /> : null}
        {!data && !error ? <p className="muted">{t("Načítám…", "Loading…")}</p> : null}
      </Layout>
    </WriteContext.Provider>
  );
}

/**
 * The key of a record's detail page or the settings. A copy that writes
 * keeps the page while the record changes, so what the person is typing
 * stays with the revision it came from; a copy that may not write shows the
 * record as it is now, so a new revision opens the page afresh with its
 * fields filled from it.
 */
export function detailKey(id: string, revision: string | undefined, canWrite: boolean): string {
  return canWrite ? id : `${id}@${revision ?? ""}`;
}

function Page({
  route,
  data,
  onChanged,
}: {
  route: Route;
  data: AppData;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  // A copy that may not write opens no form that only creates; the notice
  // above says why.
  if (!canWrite && ["new-deal", "new-company", "new-contact"].includes(route.page)) {
    return <OverviewPage data={data} onChanged={onChanged} />;
  }
  const revisionOf = (entries: readonly Stored<{ id: string }>[], id: string) =>
    entries.find((entry) => entry.value.id === id)?.revision;
  switch (route.page) {
    case "overview":
      return <OverviewPage data={data} onChanged={onChanged} />;
    case "deals":
      return <DealListPage data={data} tab={route.tab} />;
    case "new-deal":
      return (
        <DealPage
          key={`new:${route.company ?? ""}`}
          data={data}
          id={null}
          company={route.company}
          onChanged={onChanged}
        />
      );
    case "deal":
      return (
        <DealPage
          key={detailKey(route.id, revisionOf(data.deals, route.id), canWrite)}
          data={data}
          id={route.id}
          company={null}
          onChanged={onChanged}
        />
      );
    case "companies":
      return <CompanyListPage data={data} />;
    case "new-company":
      return <CompanyPage key="new" data={data} id={null} onChanged={onChanged} />;
    case "company":
      return (
        <CompanyPage
          key={detailKey(route.id, revisionOf(data.companies, route.id), canWrite)}
          data={data}
          id={route.id}
          onChanged={onChanged}
        />
      );
    case "contacts":
      return <ContactListPage data={data} />;
    case "new-contact":
      return (
        <ContactPage
          key={`new:${route.company ?? ""}`}
          data={data}
          id={null}
          company={route.company}
          onChanged={onChanged}
        />
      );
    case "contact":
      return (
        <ContactPage
          key={detailKey(route.id, revisionOf(data.contacts, route.id), canWrite)}
          data={data}
          id={route.id}
          company={null}
          onChanged={onChanged}
        />
      );
    case "settings":
      return (
        <SettingsPage
          key={detailKey("settings", data.settings.revision, canWrite)}
          data={data}
          onChanged={onChanged}
        />
      );
    case "draft":
      return <DraftPage onChanged={onChanged} />;
    case "not-found":
      return (
        <section>
          <h1 className="page-title">{t("Stránka neexistuje", "This page does not exist")}</h1>
          <p>
            <a href="#/">{t("Zpět na přehled", "Back to the overview")}</a>
          </p>
        </section>
      );
  }
}
