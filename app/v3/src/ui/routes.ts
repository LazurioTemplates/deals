/** The tabs of the list of deals. */
export const DEAL_TABS = ["all", "open", "won", "lost"] as const;
export type DealTab = (typeof DEAL_TABS)[number];

/** The App's pages, addressed by the URL hash so a reload keeps the page. */
export type Route =
  | { page: "overview" }
  | { page: "deals"; tab: DealTab }
  | { page: "new-deal"; company: string | null }
  | { page: "deal"; id: string }
  | { page: "companies" }
  | { page: "new-company" }
  | { page: "company"; id: string }
  | { page: "contacts" }
  | { page: "new-contact"; company: string | null }
  | { page: "contact"; id: string }
  | { page: "settings" }
  | { page: "draft" }
  | { page: "not-found" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  let parts: string[];
  try {
    parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { page: "not-found" };
  }
  const params = new URLSearchParams(query);
  const [first, second] = parts;
  if (parts.length === 0) return { page: "overview" };
  if (first === "deals") {
    if (parts.length === 1) {
      const tab = params.get("tab");
      return { page: "deals", tab: DEAL_TABS.includes(tab as DealTab) ? (tab as DealTab) : "all" };
    }
    if (second === "new" && parts.length === 2) {
      return { page: "new-deal", company: params.get("company") || null };
    }
    if (second && parts.length === 2) return { page: "deal", id: second };
  }
  if (first === "companies") {
    if (parts.length === 1) return { page: "companies" };
    if (second === "new" && parts.length === 2) return { page: "new-company" };
    if (second && parts.length === 2) return { page: "company", id: second };
  }
  if (first === "contacts") {
    if (parts.length === 1) return { page: "contacts" };
    if (second === "new" && parts.length === 2) {
      return { page: "new-contact", company: params.get("company") || null };
    }
    if (second && parts.length === 2) return { page: "contact", id: second };
  }
  if (first === "settings" && parts.length === 1) return { page: "settings" };
  if (first === "draft" && parts.length === 1) return { page: "draft" };
  return { page: "not-found" };
}

const withCompany = (base: string, company: string | null) =>
  company ? `${base}?company=${encodeURIComponent(company)}` : base;

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "deals":
      return route.tab === "all" ? "#/deals" : `#/deals?tab=${route.tab}`;
    case "new-deal":
      return withCompany("#/deals/new", route.company);
    case "deal":
      return `#/deals/${encodeURIComponent(route.id)}`;
    case "companies":
      return "#/companies";
    case "new-company":
      return "#/companies/new";
    case "company":
      return `#/companies/${encodeURIComponent(route.id)}`;
    case "contacts":
      return "#/contacts";
    case "new-contact":
      return withCompany("#/contacts/new", route.company);
    case "contact":
      return `#/contacts/${encodeURIComponent(route.id)}`;
    case "settings":
      return "#/settings";
    case "draft":
      return "#/draft";
    case "not-found":
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}
