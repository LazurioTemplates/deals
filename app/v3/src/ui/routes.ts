/** The tabs of the list of deals. */
export const DEAL_TABS = ["all", "open", "won", "lost"] as const;
export type DealTab = (typeof DEAL_TABS)[number];

/** The App's pages, addressed by the URL hash so a reload keeps the page. */
export type Route =
  | { page: "overview" }
  | { page: "deals"; tab: DealTab }
  | { page: "new-deal"; company: string | null; stage: string | null }
  | { page: "deal"; id: string }
  | { page: "quotes" }
  | { page: "quote"; id: string }
  | { page: "quote-print"; id: string }
  | { page: "pricebook" }
  | { page: "companies" }
  | { page: "new-company" }
  | { page: "company"; id: string }
  | { page: "contacts" }
  | { page: "new-contact"; company: string | null }
  | { page: "contact"; id: string }
  | { page: "salespeople" }
  | { page: "new-salesperson" }
  | { page: "salesperson"; id: string }
  | { page: "forecast" }
  | { page: "stats" }
  | { page: "import" }
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
  const [first, second, third] = parts;
  if (parts.length === 0) return { page: "overview" };
  if (first === "deals") {
    if (parts.length === 1) {
      const tab = params.get("tab");
      return { page: "deals", tab: DEAL_TABS.includes(tab as DealTab) ? (tab as DealTab) : "all" };
    }
    if (second === "new" && parts.length === 2) {
      return {
        page: "new-deal",
        company: params.get("company") || null,
        stage: params.get("stage") || null,
      };
    }
    if (second && parts.length === 2) return { page: "deal", id: second };
  }
  if (first === "quotes") {
    if (parts.length === 1) return { page: "quotes" };
    if (second && parts.length === 2) return { page: "quote", id: second };
    if (second && third === "print" && parts.length === 3)
      return { page: "quote-print", id: second };
  }
  if (first === "pricebook" && parts.length === 1) return { page: "pricebook" };
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
  if (first === "salespeople") {
    if (parts.length === 1) return { page: "salespeople" };
    if (second === "new" && parts.length === 2) return { page: "new-salesperson" };
    if (second && parts.length === 2) return { page: "salesperson", id: second };
  }
  if (first === "forecast" && parts.length === 1) return { page: "forecast" };
  if (first === "stats" && parts.length === 1) return { page: "stats" };
  if (first === "import" && parts.length === 1) return { page: "import" };
  if (first === "settings" && parts.length === 1) return { page: "settings" };
  if (first === "draft" && parts.length === 1) return { page: "draft" };
  return { page: "not-found" };
}

const withParams = (base: string, params: Record<string, string | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `${base}?${text}` : base;
};

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "deals":
      return route.tab === "all" ? "#/deals" : `#/deals?tab=${route.tab}`;
    case "new-deal":
      return withParams("#/deals/new", { company: route.company, stage: route.stage });
    case "deal":
      return `#/deals/${encodeURIComponent(route.id)}`;
    case "quotes":
      return "#/quotes";
    case "quote":
      return `#/quotes/${encodeURIComponent(route.id)}`;
    case "quote-print":
      return `#/quotes/${encodeURIComponent(route.id)}/print`;
    case "pricebook":
      return "#/pricebook";
    case "companies":
      return "#/companies";
    case "new-company":
      return "#/companies/new";
    case "company":
      return `#/companies/${encodeURIComponent(route.id)}`;
    case "contacts":
      return "#/contacts";
    case "new-contact":
      return withParams("#/contacts/new", { company: route.company });
    case "contact":
      return `#/contacts/${encodeURIComponent(route.id)}`;
    case "salespeople":
      return "#/salespeople";
    case "new-salesperson":
      return "#/salespeople/new";
    case "salesperson":
      return `#/salespeople/${encodeURIComponent(route.id)}`;
    case "forecast":
      return "#/forecast";
    case "stats":
      return "#/stats";
    case "import":
      return "#/import";
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
