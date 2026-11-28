import { Button, Dialog } from "design-system/react";
import { useId, useState } from "react";
import type { AppData } from "../App.tsx";
import { useLocale, useT } from "../i18n.tsx";
import { type ContactForm, contactFormOf, submitContact } from "../pages/ContactPage.tsx";
import { Field, fieldErrors } from "./common.tsx";

/**
 * A new contact in a dialog over the page it was started from: the list of
 * contacts or a company (which it then belongs to). Saving creates the
 * contact as a draft and closes the dialog; the page under it shows the new
 * contact. The contact's own page stays for everything after.
 */
export function NewContactDialog({
  data,
  company,
  open,
  onClose,
  onCreated,
}: {
  data: AppData;
  /** The company the contact belongs to from the start, when started from its page. */
  company: string | null;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const formId = useId();
  const [form, setForm] = useState<ContactForm>(() => contactFormOf(undefined, company));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = fieldErrors(error);
  const update = (patch: Partial<ContactForm>) => setForm((before) => ({ ...before, ...patch }));
  const touched = Object.entries(form).some(
    ([key, value]) => key !== "companyId" && value.trim() !== "",
  );

  function close() {
    setForm(contactFormOf(undefined, company));
    setError(null);
    onClose();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitContact(undefined, form);
      await onCreated();
      close();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      id={`new-contact-${formId.replace(/:/g, "")}`}
      title={t("Nový kontakt", "New contact")}
      description={t(
        "Uloží se jako koncept. Podrobnosti doplníte v kontaktu.",
        "It is saved as a draft. Add the details on the contact's page.",
      )}
      open={open}
      onClose={close}
      dismissable={!touched}
      locale={locale}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("Zrušit", "Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            busy={busy}
            disabled={!form.name.trim()}
          >
            {t("Založit kontakt", "Create the contact")}
          </Button>
        </>
      }
    >
      <form id={formId} className="dialog-form" onSubmit={save}>
        <Field label={t("Jméno", "Name")} error={errors.name} wide>
          <input
            value={form.name}
            required
            autoComplete="off"
            placeholder={t("Jana Nováková", "Jane Doe")}
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
            placeholder={t("např. nákup", "e.g. purchasing")}
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
      </form>
    </Dialog>
  );
}
