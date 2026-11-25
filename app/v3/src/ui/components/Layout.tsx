import type { DraftPanelInput } from "@lazurio/repository-db";
import { Alert, Nav } from "design-system/react";
import type { ReactNode } from "react";
import type { Localized } from "../../i18n/locale.ts";
import { dealsBrand } from "../../instance/brand.ts";
import { useLocale, useT } from "../i18n.tsx";
import { href, type Route } from "../routes.ts";
import { useReadOnly } from "../write.tsx";

const NAV: { label: Localized; route: Route; matches: Route["page"][] }[] = [
  { label: { cs: "Přehled", en: "Overview" }, route: { page: "overview" }, matches: ["overview"] },
  {
    label: { cs: "Obchodní případy", en: "Deals" },
    route: { page: "deals", tab: "all" },
    matches: ["deals", "deal", "new-deal"],
  },
  {
    label: { cs: "Firmy", en: "Companies" },
    route: { page: "companies" },
    matches: ["companies", "company", "new-company"],
  },
  {
    label: { cs: "Kontakty", en: "Contacts" },
    route: { page: "contacts" },
    matches: ["contacts", "contact", "new-contact"],
  },
  {
    label: { cs: "Nastavení", en: "Settings" },
    route: { page: "settings" },
    matches: ["settings"],
  },
  {
    label: { cs: "Koncept a publikování", en: "Draft & publish" },
    route: { page: "draft" },
    matches: ["draft"],
  },
];

/** How many records the unpublished draft changes; null when there is no draft. */
function draftCount(draft: DraftPanelInput | null): number | null {
  if (!draft?.status) return null;
  const count = draft.records?.length ?? draft.status.dirtyPaths.length;
  return count > 0 ? count : null;
}

export function Layout({
  route,
  draft,
  children,
}: {
  route: Route;
  draft: DraftPanelInput | null;
  children: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const count = draftCount(draft);
  const readOnly = useReadOnly();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-product">{t("Obchodní případy", "Deals")}</span>
          <span className="sidebar-context">{dealsBrand.organization}</span>
        </div>
        <Nav
          label={t("Hlavní navigace", "Main navigation")}
          items={NAV.map((item) => ({
            href: href(item.route),
            label: t.of(item.label),
            current: item.matches.includes(route.page),
            ...(item.route.page === "draft" && count !== null ? { badge: String(count) } : {}),
          }))}
        />
      </aside>
      <main className="content-area">
        {readOnly ? (
          <Alert tone="warning" live="polite" locale={locale}>
            <p>
              {t(
                "Tato kopie Obchodních případů je teď jen ke čtení: případy, firmy, kontakty, aktivity ani koncept tu změnit nejde.",
                "This copy of Deals is read-only now: deals, companies, contacts, activities and the draft cannot be changed here.",
              )}
            </p>
          </Alert>
        ) : null}
        {children}
      </main>
    </div>
  );
}
