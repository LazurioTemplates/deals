import { Button } from "design-system/react";
import { useState } from "react";
import type { Contact } from "../../domain/contact.ts";
import { stageById } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { api, type Stored } from "../api.ts";
import { Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { EditNotices, formLocked, isRecordChanged, useRecordForm } from "../edit.tsx";
import { useT } from "../i18n.tsx";
import { useLookups } from "../lookups.ts";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

export type ContactForm = Record<
  "name" | "email" | "phone" | "role" | "companyId" | "note",
  string
>;

/** The form of a contact as stored, or of a new one (of `company` when the route names it). */
export function contactFormOf(contact: Contact | undefined, company: string | null): ContactForm {
  return {
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    role: contact?.role ?? "",
    companyId: contact?.companyId ?? company ?? "",
    note: contact?.note ?? "",
  };
}

/**
 * Sends a contact's form: a change of the contact the form came from, with
 * that contact's revision as the base, or a new contact.
 */
export function submitContact(
  base: Stored<Contact> | undefined,
  form: ContactForm,
): Promise<Stored<Contact>> {
  const record = Object.fromEntries(
    Object.entries(form).flatMap(([key, value]) =>
      value.trim() === "" ? [] : [[key, value.trim()]],
    ),
  ) as Omit<Contact, "id">;
  return base
    ? api.saveContact({ ...record, id: base.value.id }, base.revision)
    : api.createContact(record);
}

/** A contact's detail and its edit, with the deals that name the contact. */
export function ContactPage({
  data,
  id,
  company,
  onChanged,
}: {
  data: AppData;
  id: string | null;
  company: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const lookups = useLookups(data);
  const current = id ? data.contacts.find((entry) => entry.value.id === id) : undefined;
  // The form keeps the contact it came from: a reload of the data never
  // replaces what the person is typing, and the save sends that revision.
  const edit = useRecordForm<Contact, ContactForm>(current, (value) =>
    contactFormOf(value, company),
  );
  const form = edit.form;
  // The page shows the contact as stored now; the form edits the one it came from.
  const stored = current ?? edit.base;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  if (id && !stored) {
    return (
      <section>
        <PageHeader title={t("Kontakt neexistuje", "This contact does not exist")} />
      </section>
    );
  }
  const update = edit.update;
  const deals = stored
    ? data.deals.filter((entry) => entry.value.contactIds?.includes(stored.value.id))
    : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const opened = edit.base;
    try {
      const saved = await submitContact(opened, form);
      if (opened) edit.saved(saved, form);
      await onChanged();
      navigate({ page: "contact", id: saved.value.id });
    } catch (caught) {
      // The contact stored now, so the person can load it; their values stay.
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow={
          stored ? `${t("Kontakt", "Contact")} ${stored.value.id}` : t("Kontakty", "Contacts")
        }
        title={stored ? stored.value.name : t("Nový kontakt", "New contact")}
      />
      <div className="detail-grid">
        <form className="form" onSubmit={save}>
          <fieldset
            className="form-fieldset"
            disabled={formLocked(canWrite, busy, edit.base === undefined)}
          >
            <EditNotices edit={edit} error={error} onClear={() => setError(null)} />
            <article className="ds-card">
              <div className="form-grid">
                <Field label={t("Jméno", "Name")} error={errors.name} wide>
                  <input
                    value={form.name}
                    required
                    autoComplete="off"
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </Field>
                <Field label={t("Firma", "Company")} error={errors.companyId}>
                  <select
                    value={form.companyId}
                    onChange={(event) => update({ companyId: event.target.value })}
                  >
                    <option value="">{t("Bez firmy", "No company")}</option>
                    {data.companies.map((entry) => (
                      <option key={entry.value.id} value={entry.value.id}>
                        {entry.value.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Role", "Role")} error={errors.role}>
                  <input
                    value={form.role}
                    onChange={(event) => update({ role: event.target.value })}
                  />
                </Field>
                <Field label={t("E-mail", "E-mail")} error={errors.email}>
                  <input
                    value={form.email}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    onChange={(event) => update({ email: event.target.value })}
                  />
                </Field>
                <Field label={t("Telefon", "Phone")} error={errors.phone}>
                  <input
                    value={form.phone}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    onChange={(event) => update({ phone: event.target.value })}
                  />
                </Field>
                <Field label={t("Poznámka", "Note")} wide>
                  <textarea
                    rows={2}
                    value={form.note}
                    onChange={(event) => update({ note: event.target.value })}
                  />
                </Field>
              </div>
            </article>
            {canWrite ? (
              <div className="form-actions">
                <Button variant="primary" type="submit" busy={busy} disabled={!form.name.trim()}>
                  {stored
                    ? t("Uložit do konceptu", "Save to the draft")
                    : t("Založit kontakt", "Create the contact")}
                </Button>
              </div>
            ) : null}
          </fieldset>
        </form>
        {stored ? (
          <aside className="aside">
            <article className="ds-card">
              <h2>{t("Obchodní případy", "Deals")}</h2>
              {deals.length === 0 ? (
                <p className="muted">{t("Zatím žádný.", "None yet.")}</p>
              ) : (
                <ul className="related">
                  {deals.map((entry) => (
                    <li key={entry.value.id}>
                      <a href={href({ page: "deal", id: entry.value.id })}>{entry.value.title}</a>
                      <span className="related-meta">
                        <StageChip stage={stageById(settings, entry.value.stageId)} />
                        <span className="muted small">
                          {lookups.salespersonName(entry.value.ownerId)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
