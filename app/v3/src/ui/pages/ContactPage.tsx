import { Button } from "design-system/react";
import { useState } from "react";
import type { Contact } from "../../domain/contact.ts";
import { stageById } from "../../domain/settings.ts";
import type { AppData } from "../App.tsx";
import { api } from "../api.ts";
import { ErrorNotice, Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { useT } from "../i18n.tsx";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

type ContactForm = Record<"name" | "email" | "phone" | "role" | "companyId" | "note", string>;

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
  const stored = id ? data.contacts.find((entry) => entry.value.id === id) : undefined;
  const [form, setForm] = useState<ContactForm>(() => ({
    name: stored?.value.name ?? "",
    email: stored?.value.email ?? "",
    phone: stored?.value.phone ?? "",
    role: stored?.value.role ?? "",
    companyId: stored?.value.companyId ?? company ?? "",
    note: stored?.value.note ?? "",
  }));
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
  const update = (patch: Partial<ContactForm>) => setForm({ ...form, ...patch });
  const deals = stored
    ? data.deals.filter((entry) => entry.value.contactIds?.includes(stored.value.id))
    : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const record = Object.fromEntries(
      Object.entries(form).flatMap(([key, value]) =>
        value.trim() === "" ? [] : [[key, value.trim()]],
      ),
    ) as Omit<Contact, "id">;
    try {
      const saved = stored
        ? await api.saveContact({ ...record, id: stored.value.id }, stored.revision)
        : await api.createContact(record);
      await onChanged();
      navigate({ page: "contact", id: saved.value.id });
    } catch (caught) {
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
          <fieldset className="form-fieldset" disabled={!canWrite}>
            <ErrorNotice error={error} />
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
