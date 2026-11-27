import { Badge, Button, EmptyState, Icon, Switch } from "design-system/react";
import { useMemo, useState } from "react";
import type { Deal } from "../../domain/deal.ts";
import { sumAmounts } from "../../domain/money.ts";
import { latestRevisions, type Quote } from "../../domain/quote.ts";
import { initialsOf, type Salesperson } from "../../domain/salesperson.ts";
import type { AppData } from "../App.tsx";
import { PageHeader } from "../components/common.tsx";
import { useFormat, useT } from "../i18n.tsx";
import { type Lookups, readLocal, useLookups, writeLocal } from "../lookups.ts";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

/** What a salesperson has in the pipeline: their deals and the quotes of those deals. */
export interface SalespersonFigures {
  deals: Deal[];
  open: Deal[];
  won: Deal[];
  lost: Deal[];
  openValue: number;
  wonValue: number;
  /** The latest revision of every quote of their deals. */
  quotes: Quote[];
  approved: Quote[];
  sent: Quote[];
  drafts: Quote[];
  /** The approved quotes' value without VAT. */
  approvedValue: number;
}

export function salespersonFigures(
  data: AppData,
  lookups: Lookups,
  id: string,
): SalespersonFigures {
  const deals = data.deals.map((entry) => entry.value).filter((deal) => deal.ownerId === id);
  const kind = (deal: Deal) => lookups.stage(deal.stageId)?.kind;
  const open = deals.filter((deal) => kind(deal) === "open");
  const won = deals.filter((deal) => kind(deal) === "won");
  const lost = deals.filter((deal) => kind(deal) === "lost");
  const quotes = latestRevisions(deals.flatMap((deal) => lookups.quotesOf(deal.id)));
  const approved = quotes.filter((quote) => quote.status === "approved");
  return {
    deals,
    open,
    won,
    lost,
    openValue: sumAmounts(open.map((deal) => deal.value)),
    wonValue: sumAmounts(won.map((deal) => deal.value)),
    quotes,
    approved,
    sent: quotes.filter((quote) => quote.status === "active"),
    drafts: quotes.filter((quote) => quote.status === "draft"),
    approvedValue: sumAmounts(approved.map((quote) => lookups.quoteSubtotal(quote))),
  };
}

/** A salesperson's initials in a circle. */
export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={large ? "person-avatar person-avatar--large" : "person-avatar"}
      aria-hidden="true"
    >
      {initialsOf(name) || "?"}
    </span>
  );
}

const SHOW_INACTIVE = "deals.salespeople.showInactive";

/** The sales team: a card per salesperson with what they have in the pipeline. */
export function SalespeopleListPage({ data }: { data: AppData }) {
  const t = useT();
  const canWrite = useCanWrite();
  const f = useFormat(data.settings.value.currency);
  const lookups = useLookups(data);
  const [showInactive, setShowInactive] = useState(() => readLocal(SHOW_INACTIVE, false));
  const people = useMemo(
    () =>
      data.salespeople
        .map((entry) => entry.value)
        .sort(
          (left, right) =>
            Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, "cs"),
        ),
    [data.salespeople],
  );
  const inactive = people.filter((person) => !person.active).length;
  const shown = showInactive ? people : people.filter((person) => person.active);

  return (
    <section>
      <PageHeader
        title={t("Obchodníci", "Salespeople")}
        actions={
          canWrite ? (
            <Button variant="primary" icon="plus" href={href({ page: "new-salesperson" })}>
              {t("Nový obchodník", "New salesperson")}
            </Button>
          ) : null
        }
      />
      {inactive > 0 ? (
        <div className="filter-bar">
          <Switch
            id="salespeople-inactive"
            label={t(`Zobrazit neaktivní (${inactive})`, `Show inactive (${inactive})`)}
            checked={showInactive}
            onChange={(event) => {
              setShowInactive(event.target.checked);
              writeLocal(SHOW_INACTIVE, event.target.checked);
            }}
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          icon="user"
          title={
            people.length === 0
              ? t("Zatím žádný obchodník.", "No salesperson yet.")
              : t("Žádný aktivní obchodník.", "No active salesperson.")
          }
          headingLevel={2}
          actions={
            canWrite && people.length === 0 ? (
              <Button variant="primary" href={href({ page: "new-salesperson" })}>
                {t("Přidat prvního obchodníka", "Add the first salesperson")}
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="person-grid">
          {shown.map((person) => (
            <li key={person.id}>
              <PersonCard
                person={person}
                figures={salespersonFigures(data, lookups, person.id)}
                money={f.money}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonCard({
  person,
  figures,
  money,
}: {
  person: Salesperson;
  figures: SalespersonFigures;
  money: (amount: number) => string;
}) {
  const t = useT();
  return (
    <a
      className="ds-card ds-card--link person-card"
      href={href({ page: "salesperson", id: person.id })}
    >
      <span className="person-card-head">
        <Avatar name={person.name} />
        <span className="person-card-name">
          <strong>{person.name}</strong>
          {person.role ? <span className="muted small">{person.role}</span> : null}
        </span>
        {person.active ? null : (
          <Badge tone="neutral" icon={false}>
            {t("Neaktivní", "Inactive")}
          </Badge>
        )}
      </span>
      <dl className="person-figures">
        <div>
          <dt>{t("Případů celkem", "Deals in total")}</dt>
          <dd className="num">{figures.deals.length}</dd>
        </div>
        <div>
          <dt>{t("Aktivní", "Open")}</dt>
          <dd className="num">{figures.open.length}</dd>
        </div>
        <div>
          <dt>{t("Vyhrané", "Won")}</dt>
          <dd className="num">{figures.won.length}</dd>
        </div>
        <div>
          <dt>{t("Hodnota vyhraných", "Value won")}</dt>
          <dd className="num">{money(figures.wonValue)}</dd>
        </div>
      </dl>
      <Icon name="arrow-right" className="ds-card__arrow" />
    </a>
  );
}
