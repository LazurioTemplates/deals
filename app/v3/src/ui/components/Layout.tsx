import type { DraftPanelInput } from "@lazurio/repository-db";
import { Alert, Nav } from "design-system/react";
import type { ReactNode } from "react";
import type { Localized } from "../../i18n/locale.ts";
import { dealsBrand } from "../../instance/brand.ts";
import { useLocale, useT } from "../i18n.tsx";
import { type DealTab, href, type Route } from "../routes.ts";
import { useReadOnly } from "../write.tsx";

interface NavItem {
  label: Localized;
  route: Route;
  matches: Route["page"][];
  /** For the deal tabs: the tab the item stands for. */
  tab?: DealTab;
}

/**
 * The navigation in sections, as a sales team works: the pipeline, the
 * offers, the people, the numbers, and the tools. Each deal tab is an item
 * of its own, so a list of active deals is one click away.
 */
const SECTIONS: { title: Localized; items: NavItem[] }[] = [
  {
    title: { cs: "Obchod", en: "Sales" },
    items: [
      {
        label: { cs: "Přehled", en: "Overview" },
        route: { page: "overview" },
        matches: ["overview"],
      },
      {
        label: { cs: "Všechny případy", en: "All deals" },
        route: { page: "deals", tab: "all" },
        matches: ["deals", "deal", "new-deal"],
        tab: "all",
      },
      {
        label: { cs: "Aktivní", en: "Active" },
        route: { page: "deals", tab: "open" },
        matches: ["deals"],
        tab: "open",
      },
      {
        label: { cs: "Vyhrané", en: "Won" },
        route: { page: "deals", tab: "won" },
        matches: ["deals"],
        tab: "won",
      },
      {
        label: { cs: "Ztracené", en: "Lost" },
        route: { page: "deals", tab: "lost" },
        matches: ["deals"],
        tab: "lost",
      },
    ],
  },
  {
    title: { cs: "Nabídky", en: "Quotes" },
    items: [
      {
        label: { cs: "Cenové nabídky", en: "Quotes" },
        route: { page: "quotes" },
        matches: ["quotes", "quote", "quote-print"],
      },
      {
        label: { cs: "Ceník", en: "Price list" },
        route: { page: "pricebook" },
        matches: ["pricebook"],
      },
    ],
  },
  {
    title: { cs: "Kontakty", en: "Contacts" },
    items: [
      {
        label: { cs: "Kontakty", en: "Contacts" },
        route: { page: "contacts" },
        matches: ["contacts", "contact", "new-contact"],
      },
      {
        label: { cs: "Firmy", en: "Companies" },
        route: { page: "companies" },
        matches: ["companies", "company", "new-company"],
      },
      {
        label: { cs: "Obchodníci", en: "Salespeople" },
        route: { page: "salespeople" },
        matches: ["salespeople", "salesperson", "new-salesperson"],
      },
    ],
  },
  {
    title: { cs: "Analytika", en: "Analytics" },
    items: [
      {
        label: { cs: "Forecast", en: "Forecast" },
        route: { page: "forecast" },
        matches: ["forecast"],
      },
      {
        label: { cs: "Statistiky", en: "Statistics" },
        route: { page: "stats" },
        matches: ["stats"],
      },
    ],
  },
  {
    title: { cs: "Nástroje", en: "Tools" },
    items: [
      { label: { cs: "Import", en: "Import" }, route: { page: "import" }, matches: ["import"] },
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
    ],
  },
];

/** Whether a navigation item is the page shown: a deal tab only on its own tab. */
function isCurrent(item: NavItem, route: Route): boolean {
  if (route.page === "deals") return item.tab === route.tab;
  if (item.tab && item.tab !== "all") return false;
  return item.matches.includes(route.page);
}

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
        <div className="sidebar-nav">
          {SECTIONS.map((section, index) => (
            <Nav
              key={section.title.en}
              id={`nav-section-${index}`}
              title={t.of(section.title)}
              items={section.items.map((item) => ({
                href: href(item.route),
                label: t.of(item.label),
                current: isCurrent(item, route),
                ...(item.route.page === "draft" && count !== null ? { badge: String(count) } : {}),
              }))}
            />
          ))}
        </div>
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
