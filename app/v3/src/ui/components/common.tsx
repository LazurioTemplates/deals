import { cx, fieldIds, type Tone } from "design-system";
import { Alert, Badge, Icon } from "design-system/react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from "react";
import type { Stage } from "../../domain/settings.ts";
import { ApiError } from "../api.ts";
import { useLocale, useT } from "../i18n.tsx";
import { usePagePlace } from "./Layout.tsx";

/**
 * The colour of a stage: an open stage warms up as a deal comes closer to a
 * decision (gray, blue, accent, amber by its probability), a won one is
 * green and a lost one red.
 */
export function stageTone(stage: Pick<Stage, "kind" | "probability">): Tone {
  if (stage.kind === "won") return "success";
  if (stage.kind === "lost") return "danger";
  if (stage.probability < 20) return "neutral";
  if (stage.probability < 40) return "info";
  if (stage.probability < 65) return "accent";
  return "warning";
}

/** The stage of a deal as a chip: its label, coloured by where it stands. */
export function StageChip({ stage }: { stage: Stage | undefined }) {
  const t = useT();
  if (!stage) return <Badge tone="warning">{t("neznámá fáze", "unknown stage")}</Badge>;
  return <Badge tone={stageTone(stage)}>{stage.label}</Badge>;
}

const CONTROL_CLASS: Record<string, string> = {
  input: "ds-input",
  select: "ds-select",
  textarea: "ds-textarea",
};

/**
 * A field of a form in the design system's markup (`ds-field`): its label,
 * hint and error point at the control. The control is the child element, an
 * `<input>`, `<select>` or `<textarea>` the page controls itself; the field
 * gives it the design system's class and the ids.
 */
export function Field({
  label,
  hint,
  error,
  children,
  wide,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ids = fieldIds(id, hint, error);
  const control = isValidElement(children)
    ? (children as ReactElement<Record<string, unknown>>)
    : null;
  const kind =
    control && typeof control.type === "string" ? CONTROL_CLASS[control.type] : undefined;
  const rendered =
    control && kind
      ? cloneElement(control, {
          id,
          className: cx(kind, control.props.className as string | undefined),
          "aria-invalid": error ? "true" : undefined,
          "aria-describedby": ids.describedBy,
        })
      : children;
  return (
    <div className={cx("ds-field", wide && "field-wide")}>
      {kind ? (
        <label className="ds-field__label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="ds-field__label">{label}</span>
      )}
      {hint ? (
        <p className="ds-field__hint" id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      {kind === "ds-select" ? (
        <div className="ds-select-wrap">
          {rendered}
          <Icon name="nav-arrow-down" className="ds-select__chevron" />
        </div>
      ) : (
        rendered
      )}
      {error ? (
        <p className="ds-field__error" id={ids.errorId}>
          <Icon name="warning-circle" size="sm" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A refusal of the API in words, with the fields it names. */
export function ErrorNotice({ error, title }: { error: unknown; title?: string | undefined }) {
  const t = useT();
  const locale = useLocale();
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const issues = error instanceof ApiError ? error.issues : [];
  return (
    <Alert
      tone="danger"
      title={title ?? t("Neuloženo.", "Not saved.")}
      live="assertive"
      locale={locale}
    >
      <p>{message}</p>
      {issues.length > 0 ? (
        <ul className="issues">
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path}</code> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/** Errors of an API refusal by field path, for the form that sent it. */
export function fieldErrors(error: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (error instanceof ApiError) {
    for (const issue of error.issues) errors[issue.path] ??= issue.message;
  }
  return errors;
}

/**
 * The top of a page. One quiet row: where the page sits (the section, then the
 * page) and its actions on the right. A list or a dashboard is named by that
 * row alone; a record's page (one with an `eyebrow`, e.g. "Deal D-0004") adds
 * its name as a large title under it.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const place = usePagePlace();
  const record = eyebrow !== undefined && eyebrow !== null && eyebrow !== false;
  return (
    <header className={cx("page-header", record && "page-header--record")}>
      <div className="page-bar">
        <div className="page-path">
          {place ? (
            <>
              <a className="page-path-parent" href={place.sectionHref}>
                {place.section}
              </a>
              <span className="page-path-separator" aria-hidden="true">
                /
              </span>
            </>
          ) : null}
          {record ? (
            <span className="page-path-current">{eyebrow}</span>
          ) : (
            <h1 className="page-path-current page-title">{title}</h1>
          )}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      {record ? <h1 className="page-title page-title--record">{title}</h1> : null}
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
    </header>
  );
}
