import type { DraftPanelInput } from "@lazurio/repository-db";
import type { IconName } from "design-system";
import { Alert, Icon, Nav } from "design-system/react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Localized } from "../../i18n/locale.ts";
import { dealsBrand } from "../../instance/brand.ts";
import { useLocale, useT } from "../i18n.tsx";
import { type DealTab, href, type Route } from "../routes.ts";
import { useReadOnly } from "../write.tsx";

interface NavItem {
  label: Localized;
  icon: IconName;
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
        icon: "home-simple",
        route: { page: "overview" },
        matches: ["overview"],
      },
      {
        label: { cs: "Všechny případy", en: "All deals" },
        icon: "list",
        route: { page: "deals", tab: "all" },
        matches: ["deals", "deal", "new-deal"],
        tab: "all",
      },
      {
        label: { cs: "Aktivní", en: "Active" },
        icon: "clock",
        route: { page: "deals", tab: "open" },
        matches: ["deals"],
        tab: "open",
      },
      {
        label: { cs: "Vyhrané", en: "Won" },
        icon: "check-circle",
        route: { page: "deals", tab: "won" },
        matches: ["deals"],
        tab: "won",
      },
      {
        label: { cs: "Ztracené", en: "Lost" },
        icon: "xmark-circle",
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
        icon: "page",
        route: { page: "quotes" },
        matches: ["quotes", "quote", "quote-print"],
      },
      {
        label: { cs: "Ceník", en: "Price list" },
        icon: "folder",
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
        icon: "user",
        route: { page: "contacts" },
        matches: ["contacts", "contact", "new-contact"],
      },
      {
        label: { cs: "Firmy", en: "Companies" },
        icon: "computer",
        route: { page: "companies" },
        matches: ["companies", "company", "new-company"],
      },
      {
        label: { cs: "Obchodníci", en: "Salespeople" },
        icon: "group",
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
        icon: "calendar",
        route: { page: "forecast" },
        matches: ["forecast"],
      },
      {
        label: { cs: "Statistiky", en: "Statistics" },
        icon: "sort",
        route: { page: "stats" },
        matches: ["stats"],
      },
    ],
  },
  {
    title: { cs: "Nástroje", en: "Tools" },
    items: [
      {
        label: { cs: "Import", en: "Import" },
        icon: "upload",
        route: { page: "import" },
        matches: ["import"],
      },
      {
        label: { cs: "Nastavení", en: "Settings" },
        icon: "settings",
        route: { page: "settings" },
        matches: ["settings"],
      },
      {
        label: { cs: "Koncept a publikování", en: "Draft & publish" },
        icon: "edit-pencil",
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

/** Where the page shown sits: the section of the navigation and its first page. */
export interface PagePlace {
  section: string;
  sectionHref: string;
}

const PlaceContext = createContext<PagePlace | null>(null);

/** The section of the page shown, for the path at the top of the page. */
export function usePagePlace(): PagePlace | null {
  return useContext(PlaceContext);
}

/** The count beside a navigation item: deals of a tab, records of a list. */
export type NavCounts = Partial<Record<DealTab | Route["page"], number>>;

function countOf(item: NavItem, counts: NavCounts): number | undefined {
  if (item.tab) return counts[item.tab];
  return counts[item.route.page];
}

export function Layout({
  route,
  draft,
  counts = {},
  children,
}: {
  route: Route;
  draft: DraftPanelInput | null;
  counts?: NavCounts;
  children: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const draftChanges = draftCount(draft);
  const readOnly = useReadOnly();
  const section = SECTIONS.find((entry) => entry.items.some((item) => isCurrent(item, route)));
  const place: PagePlace | null = section
    ? {
        section: t.of(section.title),
        sectionHref: href((section.items[0] as NavItem).route),
      }
    : null;
  const organization = dealsBrand.organization;
  // On a narrow screen the navigation folds behind a button; a new page closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  const routeKey = href(route);
  useEffect(() => {
    if (routeKey) setMenuOpen(false);
  }, [routeKey]);
  return (
    <div className="shell">
      <aside className={menuOpen ? "sidebar is-open" : "sidebar"}>
        <div className="sidebar-header">
          <span className="sidebar-mark" aria-hidden="true">
            {organization.trim().charAt(0).toUpperCase() || "O"}
          </span>
          <span className="sidebar-names">
            <span className="sidebar-product">{t("Obchodní případy", "Deals")}</span>
            <span className="sidebar-context">{organization}</span>
          </span>
          <button
            type="button"
            className="sidebar-menu-button"
            aria-expanded={menuOpen}
            aria-controls="sidebar-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "xmark" : "menu"} size="sm" />
            <span>{menuOpen ? t("Zavřít", "Close") : t("Menu", "Menu")}</span>
          </button>
        </div>
        <div className="sidebar-nav" id="sidebar-nav">
          {SECTIONS.map((section, index) => (
            <Nav
              key={section.title.en}
              id={`nav-section-${index}`}
              title={t.of(section.title)}
              items={section.items.map((item) => {
                const count =
                  item.route.page === "draft" ? draftChanges : (countOf(item, counts) ?? null);
                return {
                  href: href(item.route),
                  label: t.of(item.label),
                  icon: item.icon,
                  current: isCurrent(item, route),
                  ...(count !== null && count > 0 ? { badge: String(count) } : {}),
                };
              })}
            />
          ))}
        </div>
      </aside>
      <main className="content-area">
        <PlaceContext.Provider value={place}>
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
        </PlaceContext.Provider>
      </main>
    </div>
  );
}
