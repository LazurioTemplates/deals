import { Button, EmptyState, Table } from "design-system/react";
import { useState } from "react";
import type { AppData } from "../App.tsx";
import { PageHeader } from "../components/common.tsx";
import { useT } from "../i18n.tsx";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

export function ContactListPage({ data }: { data: AppData }) {
  const t = useT();
  const canWrite = useCanWrite();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const companies = new Map(data.companies.map((entry) => [entry.value.id, entry.value.name]));
  const contacts = data.contacts
    .map((entry) => entry.value)
    .filter((contact) =>
      [
        contact.name,
        contact.email,
        contact.phone,
        contact.role,
        contact.companyId ? companies.get(contact.companyId) : undefined,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  return (
    <section>
      <PageHeader
        title={t("Kontakty", "Contacts")}
        actions={
          canWrite ? (
            <Button
              variant="primary"
              icon="plus"
              href={href({ page: "new-contact", company: null })}
            >
              {t("Nový kontakt", "New contact")}
            </Button>
          ) : null
        }
      />
      <div className="toolbar-row">
        <input
          className="ds-input"
          type="search"
          placeholder={t(
            "Hledat jméno, firmu, e-mail nebo telefon",
            "Search a name, company, e-mail or phone",
          )}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("Hledat kontakt", "Search a contact")}
        />
      </div>
      {contacts.length === 0 ? (
        <EmptyState
          icon="search"
          title={
            data.contacts.length === 0
              ? t("Zatím žádný kontakt.", "No contact yet.")
              : t("Žádný kontakt neodpovídá hledání.", "No contact matches the search.")
          }
          headingLevel={2}
        />
      ) : (
        <Table id="contacts" caption={t("Kontakty", "Contacts")} hideCaption>
          <thead>
            <tr>
              <th>{t("Jméno", "Name")}</th>
              <th>{t("Firma", "Company")}</th>
              <th>{t("Role", "Role")}</th>
              <th>{t("E-mail", "E-mail")}</th>
              <th>{t("Telefon", "Phone")}</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td className="cell-title">
                  <a href={href({ page: "contact", id: contact.id })}>{contact.name}</a>
                </td>
                <td className="cell-title">
                  {contact.companyId ? (
                    <a href={href({ page: "company", id: contact.companyId })}>
                      {companies.get(contact.companyId) ?? contact.companyId}
                    </a>
                  ) : (
                    ""
                  )}
                </td>
                <td>{contact.role ?? ""}</td>
                <td className="cell-break">{contact.email ?? ""}</td>
                <td className="nowrap">{contact.phone ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
