import { Button, EmptyState, Table } from "design-system/react";
import { useState } from "react";
import { sumAmounts } from "../../domain/money.ts";
import { stageById } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { PageHeader } from "../components/common.tsx";
import { useFormat, useT } from "../i18n.tsx";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

export function CompanyListPage({ data }: { data: AppData }) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const companies = data.companies
    .map((entry) => entry.value)
    .filter((company) =>
      [company.name, company.ico, company.address?.city, company.website]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  const openDeals = (id: string) =>
    data.deals.filter(
      (entry) =>
        entry.value.companyId === id && stageById(settings, entry.value.stageId)?.kind === "open",
    );
  return (
    <section>
      <PageHeader
        title={t("Firmy", "Companies")}
        actions={
          canWrite ? (
            <Button variant="primary" icon="plus" href={href({ page: "new-company" })}>
              {t("Nová firma", "New company")}
            </Button>
          ) : null
        }
      />
      <div className="toolbar-row">
        <input
          className="ds-input"
          type="search"
          placeholder={t(
            "Hledat název, IČO, obec nebo web",
            "Search a name, company ID, city or website",
          )}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("Hledat firmu", "Search a company")}
        />
      </div>
      {companies.length === 0 ? (
        <EmptyState
          icon="search"
          title={
            data.companies.length === 0
              ? t("Zatím žádná firma.", "No company yet.")
              : t("Žádná firma neodpovídá hledání.", "No company matches the search.")
          }
          headingLevel={2}
        />
      ) : (
        <Table id="companies" caption={t("Firmy", "Companies")} hideCaption>
          <thead>
            <tr>
              <th>{t("Název", "Name")}</th>
              <th>{t("IČO", "Company ID")}</th>
              <th>{t("Obec", "City")}</th>
              <th className="ds-table__num">{t("Otevřené případy", "Open deals")}</th>
              <th className="ds-table__num">{t("Otevřená hodnota", "Open value")}</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => {
              const deals = openDeals(company.id);
              return (
                <tr key={company.id}>
                  <td className="cell-title">
                    <a href={href({ page: "company", id: company.id })}>{company.name}</a>
                  </td>
                  <td>{company.ico ?? ""}</td>
                  <td>{company.address?.city ?? ""}</td>
                  <td className="ds-table__num">{deals.length}</td>
                  <td className="ds-table__num">
                    {f.money(sumAmounts(deals.map((entry) => entry.value.value)))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </section>
  );
}
