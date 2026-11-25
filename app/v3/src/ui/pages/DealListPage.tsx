import { Button, EmptyState, Table } from "design-system/react";
import type { Deal } from "../../domain/deal.ts";
import type { StageKind } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { PageHeader, StageChip } from "../components/common.tsx";
import { useFormat, useT } from "../i18n.tsx";
import { DEAL_TABS, type DealTab, href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

const TAB_LABELS: Record<DealTab, { cs: string; en: string }> = {
  all: { cs: "Všechny", en: "All" },
  open: { cs: "Otevřené", en: "Open" },
  won: { cs: "Vyhrané", en: "Won" },
  lost: { cs: "Ztracené", en: "Lost" },
};

/** Every deal, or those of one kind of stage, newest first. */
export function DealListPage({ data, tab }: { data: AppData; tab: DealTab }) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const stages = new Map(settings.stages.map((stage) => [stage.id, stage]));
  const reasons = new Map(settings.lossReasons.map((reason) => [reason.id, reason.label]));
  const companies = new Map(data.companies.map((entry) => [entry.value.id, entry.value.name]));
  const kindOf = (deal: Deal): StageKind | undefined => stages.get(deal.stageId)?.kind;
  const deals = data.deals.map((entry) => entry.value);
  const inTab = (value: DealTab) =>
    value === "all" ? deals : deals.filter((deal) => kindOf(deal) === value);
  const shown = inTab(tab);
  const closed = tab === "won" || tab === "lost";

  return (
    <section>
      <PageHeader
        title={t("Obchodní případy", "Deals")}
        actions={
          canWrite ? (
            <Button variant="primary" href={href({ page: "new-deal", company: null })}>
              {t("Nový případ", "New deal")}
            </Button>
          ) : null
        }
      />
      <nav className="filters" aria-label={t("Druh případů", "Kind of deals")}>
        {DEAL_TABS.map((value) => (
          <a
            key={value}
            className={`filter${tab === value ? " active" : ""}`}
            aria-current={tab === value ? "page" : undefined}
            href={href({ page: "deals", tab: value })}
          >
            {t.of(TAB_LABELS[value])} ({inTab(value).length})
          </a>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState
          icon="search"
          title={t("Žádný případ v této záložce.", "No deal in this tab.")}
          headingLevel={2}
        />
      ) : (
        <Table id="deals" caption={t("Obchodní případy", "Deals")} hideCaption>
          <thead>
            <tr>
              <th>{t("Případ", "Deal")}</th>
              <th>{t("Firma", "Company")}</th>
              <th>{t("Fáze", "Stage")}</th>
              <th>{t("Obchodník", "Owner")}</th>
              <th>
                {closed
                  ? t("Uzavřeno", "Closed")
                  : tab === "open"
                    ? t("Očekávané uzavření", "Expected close")
                    : t("Uzavření", "Close")}
              </th>
              {tab === "lost" ? <th>{t("Důvod", "Reason")}</th> : null}
              <th className="ds-table__num">{t("Hodnota", "Value")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((deal) => (
              <tr key={deal.id}>
                <td className="cell-title">
                  <a href={href({ page: "deal", id: deal.id })}>{deal.title}</a>
                  <span className="muted small cell-id">{deal.id}</span>
                </td>
                <td className="cell-title">
                  <a href={href({ page: "company", id: deal.companyId })}>
                    {companies.get(deal.companyId) ?? deal.companyId}
                  </a>
                </td>
                <td>
                  <StageChip stage={stages.get(deal.stageId)} />
                </td>
                <td>{deal.owner}</td>
                <td className="nowrap">
                  {kindOf(deal) === "open"
                    ? deal.expectedClose
                      ? f.date(deal.expectedClose)
                      : t("bez data", "no date")
                    : f.date(deal.closedAt)}
                </td>
                {tab === "lost" ? (
                  <td>
                    {deal.lossReasonId ? (reasons.get(deal.lossReasonId) ?? deal.lossReasonId) : ""}
                  </td>
                ) : null}
                <td className="ds-table__num">{f.money(deal.value)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
