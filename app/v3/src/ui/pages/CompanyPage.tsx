import { Alert, Button } from "design-system/react";
import { useState } from "react";
import type { Address, Company } from "../../domain/company.ts";
import { stageById } from "../../domain/settings.ts";
import type { Localized } from "../../i18n/locale.ts";
import type { AppData } from "../App.tsx";
import { ApiError, api, type Stored } from "../api.ts";
import { Field, fieldErrors, PageHeader, StageChip } from "../components/common.tsx";
import { EditNotices, isRecordChanged, useRecordForm } from "../edit.tsx";
import { useFormat, useLocale, useT } from "../i18n.tsx";
import { href, navigate } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

interface CompanyForm {
  name: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  website: string;
  note: string;
}

const ADDRESS_FIELDS: { key: keyof Address; label: Localized }[] = [
  { key: "street", label: { cs: "Ulice a číslo", en: "Street and number" } },
  { key: "postalCode", label: { cs: "PSČ", en: "Postal code" } },
  { key: "city", label: { cs: "Obec", en: "City" } },
  { key: "country", label: { cs: "Stát", en: "Country" } },
];

export function companyFormOf(company: Company | undefined, country: string): CompanyForm {
  return {
    name: company?.name ?? "",
    ico: company?.ico ?? "",
    dic: company?.dic ?? "",
    street: company?.address?.street ?? "",
    city: company?.address?.city ?? "",
    postalCode: company?.address?.postalCode ?? "",
    country: company?.address?.country ?? (company ? "" : country),
    website: company?.website ?? "",
    note: company?.note ?? "",
  };
}

/**
 * Sends a company's form: a change of the company the form came from, with
 * that company's revision as the base, or a new company.
 */
export function submitCompany(
  base: Stored<Company> | undefined,
  form: CompanyForm,
): Promise<Stored<Company>> {
  const trimmed = (value: string) => value.trim();
  const address: Address = Object.fromEntries(
    ADDRESS_FIELDS.flatMap((field) =>
      trimmed(form[field.key]) ? [[field.key, trimmed(form[field.key])]] : [],
    ),
  );
  const record = {
    name: trimmed(form.name),
    ...(trimmed(form.ico) ? { ico: trimmed(form.ico).replace(/\s/g, "") } : {}),
    ...(trimmed(form.dic) ? { dic: trimmed(form.dic) } : {}),
    ...(Object.keys(address).length > 0 ? { address } : {}),
    ...(trimmed(form.website) ? { website: trimmed(form.website) } : {}),
    ...(trimmed(form.note) ? { note: trimmed(form.note) } : {}),
  };
  return base
    ? api.saveCompany({ ...record, id: base.value.id }, base.revision)
    : api.createCompany(record);
}

/** A company's detail and its edit, with its deals and contacts. */
export function CompanyPage({
  data,
  id,
  onChanged,
}: {
  data: AppData;
  id: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const canWrite = useCanWrite();
  const settings = data.settings.value;
  const f = useFormat(settings.currency);
  const current = id ? data.companies.find((entry) => entry.value.id === id) : undefined;
  // The form keeps the company it came from: a reload of the data never
  // replaces what the person is typing, and the save sends that revision.
  const country = t("Česká republika", "Czech Republic");
  const edit = useRecordForm<Company, CompanyForm>(current, (value) =>
    companyFormOf(value, country),
  );
  const { form, setForm } = edit;
  // The page shows the company as stored now; the form edits the one it came from.
  const stored = current ?? edit.base;
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [aresNote, setAresNote] = useState<{ tone: "success" | "warning"; text: string } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  if (id && !stored) {
    return (
      <section>
        <PageHeader title={t("Firma neexistuje", "This company does not exist")} />
      </section>
    );
  }
  const update = edit.update;
  const deals = stored
    ? data.deals.filter((entry) => entry.value.companyId === stored.value.id)
    : [];
  const contacts = stored
    ? data.contacts.filter((entry) => entry.value.companyId === stored.value.id)
    : [];

  async function lookUp() {
    setLooking(true);
    setAresNote(null);
    try {
      const found = await api.ares(form.ico);
      setForm({
        ...form,
        ico: found.ico,
        name: found.name,
        dic: found.dic ?? form.dic,
        street: found.address?.street ?? form.street,
        city: found.address?.city ?? form.city,
        postalCode: found.address?.postalCode ?? form.postalCode,
        country: found.address?.country ?? form.country,
      });
      setAresNote({
        tone: "success",
        text: t(
          "Údaje z ARES jsou ve formuláři. Zkontrolujte je a uložte.",
          "The details from ARES are in the form. Check them and save.",
        ),
      });
    } catch (caught) {
      setAresNote({
        tone: "warning",
        text:
          caught instanceof ApiError
            ? caught.message
            : t(
                "ARES teď neodpovídá. Vyplňte firmu ručně.",
                "ARES does not answer now. Fill the company in by hand.",
              ),
      });
    } finally {
      setLooking(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const opened = edit.base;
    try {
      const saved = await submitCompany(opened, form);
      if (opened) edit.saved(saved, form);
      await onChanged();
      navigate({ page: "company", id: saved.value.id });
    } catch (caught) {
      // The company stored now, so the person can load it; their values stay.
      if (isRecordChanged(caught)) await onChanged();
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow={stored ? `${t("Firma", "Company")} ${stored.value.id}` : t("Firmy", "Companies")}
        title={stored ? stored.value.name : t("Nová firma", "New company")}
        actions={
          stored && canWrite ? (
            <>
              <Button variant="primary" href={href({ page: "new-deal", company: stored.value.id })}>
                {t("Nový případ", "New deal")}
              </Button>
              <Button
                variant="secondary"
                href={href({ page: "new-contact", company: stored.value.id })}
              >
                {t("Nový kontakt", "New contact")}
              </Button>
            </>
          ) : null
        }
      />
      <div className="detail-grid">
        <form className="form" onSubmit={save}>
          <fieldset className="form-fieldset" disabled={!canWrite}>
            <EditNotices edit={edit} error={error} onClear={() => setError(null)} />
            <article className="ds-card">
              <div className="form-grid">
                <Field label={t("IČO", "Company ID")} error={errors.ico}>
                  <input
                    value={form.ico}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                    onChange={(event) => update({ ico: event.target.value })}
                  />
                </Field>
                {settings.aresLookup && canWrite ? (
                  <div className="ds-field ares-field">
                    <span className="ds-field__label" aria-hidden="true">
                      &nbsp;
                    </span>
                    <Button
                      variant="secondary"
                      busy={looking}
                      disabled={!form.ico.trim()}
                      onClick={() => void lookUp()}
                    >
                      {t("Dohledat v ARES", "Look up in ARES")}
                    </Button>
                  </div>
                ) : null}
                {aresNote ? (
                  <div className="field-wide">
                    <Alert tone={aresNote.tone} live="polite" locale={locale}>
                      {aresNote.text}
                    </Alert>
                  </div>
                ) : null}
                <Field label={t("Název", "Name")} error={errors.name} wide>
                  <input
                    value={form.name}
                    required
                    autoComplete="organization"
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </Field>
                <Field label={t("DIČ", "VAT ID")} error={errors.dic}>
                  <input
                    value={form.dic}
                    autoComplete="off"
                    onChange={(event) => update({ dic: event.target.value })}
                  />
                </Field>
                <Field label={t("Web", "Website")} error={errors.website}>
                  <input
                    value={form.website}
                    inputMode="url"
                    autoComplete="url"
                    onChange={(event) => update({ website: event.target.value })}
                  />
                </Field>
                {ADDRESS_FIELDS.map((field) => (
                  <Field
                    key={field.key}
                    label={t.of(field.label)}
                    error={errors[`address.${field.key}`]}
                  >
                    <input
                      value={form[field.key]}
                      onChange={(event) => update({ [field.key]: event.target.value })}
                    />
                  </Field>
                ))}
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
                    : t("Založit firmu", "Create the company")}
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
                        <span className="num small">{f.money(entry.value.value)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="ds-card">
              <h2>{t("Kontakty", "Contacts")}</h2>
              {contacts.length === 0 ? (
                <p className="muted">{t("Zatím žádný.", "None yet.")}</p>
              ) : (
                <ul className="related">
                  {contacts.map((entry) => (
                    <li key={entry.value.id}>
                      <a href={href({ page: "contact", id: entry.value.id })}>{entry.value.name}</a>
                      <span className="muted small">
                        {[entry.value.role, entry.value.email].filter(Boolean).join(" · ")}
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
