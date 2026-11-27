import { Alert, Badge, Button, Checkbox, EmptyState, Icon } from "design-system/react";
import { useMemo, useState } from "react";
import { localToday } from "../../domain/common.ts";
import { type CsvTable, parseCsv } from "../../domain/csv.ts";
import type { Locale } from "../../i18n/locale.ts";
import {
  guessMapping,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  type ImportField,
  type ImportInput,
  type ImportKind,
  type ImportReport,
  type ImportRowPlan,
  planImport,
} from "../../service/import.ts";
import { type AppData, dataSetOf } from "../App.tsx";
import { api } from "../api.ts";
import { ChipChoice } from "../components/Board.tsx";
import { ErrorNotice, Field, PageHeader } from "../components/common.tsx";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { type CountWords, useLocale, useT } from "../i18n.tsx";
import { href } from "../routes.ts";
import { useCanWrite } from "../write.tsx";

/** The most rows one import sends; the API refuses more. */
export const MAX_IMPORT_ROWS = 5_000;

/**
 * A file's text: UTF-8 (with or without a BOM), else windows-1250, in which
 * a Czech Excel saves CSV.
 */
export async function readCsvFile(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

/** The mapped rows of a table: each field the value of the column mapped to it. */
export function mappedRows(
  table: CsvTable,
  mapping: readonly (ImportField | null)[],
): ImportInput["rows"] {
  return table.rows.map((row, index) => ({
    row: table.rowNumbers[index] ?? index + 2,
    values: Object.fromEntries(
      mapping.flatMap((field, column) => {
        const value = row[column]?.trim();
        return field && value ? [[field, value]] : [];
      }),
    ) as Partial<Record<ImportField, string>>,
  }));
}

/** What a kind needs mapped before anything can be imported. */
function missingFields(kind: ImportKind, mapped: ReadonlySet<ImportField>): ImportField[] {
  if (kind === "companies") return mapped.has("name") ? [] : ["name"];
  if (kind === "contacts") {
    return mapped.has("name") || mapped.has("firstName") || mapped.has("lastName") ? [] : ["name"];
  }
  return (["title", "company"] as const).filter((field) => !mapped.has(field));
}

const ROWS: CountWords = {
  cs: { one: "řádek", few: "řádky", many: "řádků" },
  en: { one: "row", other: "rows" },
};
const COLUMNS: CountWords = {
  cs: { one: "sloupec", few: "sloupce", many: "sloupců" },
  en: { one: "column", other: "columns" },
};
const NEW_RECORDS: CountWords = {
  cs: { one: "nový záznam", few: "nové záznamy", many: "nových záznamů" },
  en: { one: "new record", other: "new records" },
};

const DELIMITER_NAMES: Record<string, { cs: string; en: string }> = {
  ",": { cs: "čárka", en: "comma" },
  ";": { cs: "středník", en: "semicolon" },
  "\t": { cs: "tabulátor", en: "tab" },
};

/**
 * Imports companies, contacts or deals from a CSV export: the file is read
 * in the browser, its columns mapped to fields with guesses from Czech,
 * English and HubSpot headers, every row previewed with its problems, and
 * the new records written by the server in one draft.
 */
export function ImportPage({ data, onChanged }: { data: AppData; onChanged: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const canWrite = useCanWrite();
  const [kind, setKind] = useState<ImportKind>("deals");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [held, setHeld] = useState<{ key: string; mapping: (ImportField | null)[] } | null>(null);
  const [createCompanies, setCreateCompanies] = useState(false);
  const [numberLocale, setNumberLocale] = useState<Locale>(locale);
  const [defaultOwnerId, setDefaultOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const table = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);
  const key = table ? `${kind}\n${table.headers.join("\u0001")}` : "";
  // The guesses follow a new file or a new kind; the person's choices stay otherwise.
  const mapping = useMemo(
    () =>
      table && held?.key === key ? held.mapping : table ? guessMapping(kind, table.headers) : [],
    [table, held, key, kind],
  );
  const setMapping = (column: number, field: ImportField | null) => {
    const next = mapping.map((value, at) =>
      at === column ? field : value === field && field !== null ? null : value,
    );
    setHeld({ key, mapping: next });
  };
  const mapped = new Set(mapping.filter((field): field is ImportField => field !== null));
  const missing = missingFields(kind, mapped);
  const tooMany = (table?.rows.length ?? 0) > MAX_IMPORT_ROWS;

  const input = useMemo<ImportInput | null>(() => {
    if (!table || table.rows.length === 0 || missing.length > 0 || tooMany) return null;
    return {
      kind,
      rows: mappedRows(table, mapping),
      createCompanies,
      numberLocale,
      ...(defaultOwnerId ? { defaultOwnerId } : {}),
    };
  }, [
    table,
    mapping,
    kind,
    createCompanies,
    numberLocale,
    defaultOwnerId,
    missing.length,
    tooMany,
  ]);
  const plan = useMemo(
    () => (input ? planImport(dataSetOf(data), data.settings.value, input, localToday()) : null),
    [data, input],
  );
  const willCreate = plan?.changes.length ?? 0;
  const skipped = plan?.rows.filter((row) => row.skipped).length ?? 0;

  async function choose(file: File | undefined) {
    setFileError(null);
    setReport(null);
    if (!file) return;
    try {
      setText(await readCsvFile(file));
      setFileName(file.name);
    } catch {
      setFileError(t("Soubor se nepodařilo přečíst.", "The file could not be read."));
    }
  }

  async function run() {
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.importRecords(input);
      setReport(answer);
      setText("");
      setFileName(null);
      await onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel = (field: ImportField) => t.of(IMPORT_FIELD_LABELS[field]);
  const kinds: { value: ImportKind; label: string }[] = [
    { value: "companies", label: t("Firmy", "Companies") },
    { value: "contacts", label: t("Kontakty", "Contacts") },
    { value: "deals", label: t("Obchodní případy", "Deals") },
  ];

  const previewColumns: Column<ImportRowPlan>[] = [
    {
      id: "row",
      label: t("Řádek", "Row"),
      render: (row) => row.row,
      sortValue: (row) => row.row,
      width: 96,
      align: "end",
    },
    {
      id: "label",
      label: t("Záznam", "Record"),
      render: (row) => row.label || "—",
      sortValue: (row) => row.label,
      width: 220,
    },
    {
      id: "result",
      label: t("Výsledek", "Result"),
      render: (row) =>
        row.skipped ? (
          <Badge tone="danger">{t("Přeskočí se", "Skipped")}</Badge>
        ) : (
          <Badge tone={row.warnings.length > 0 ? "warning" : "success"}>
            {t("Založí se", "Created")}
          </Badge>
        ),
      sortValue: (row) => (row.skipped ? 2 : row.warnings.length > 0 ? 1 : 0),
      width: 140,
    },
    {
      id: "details",
      label: t("Co se stane", "What happens"),
      render: (row) => (
        <ul className="import-notes">
          {row.errors.map((message) => (
            <li key={`e:${message.en}`} className="danger">
              {t.of(message)}
            </li>
          ))}
          {row.warnings.map((message) => (
            <li key={`w:${message.en}`} className="warning">
              {t.of(message)}
            </li>
          ))}
          {row.skipped
            ? null
            : row.creates.map((record) => (
                <li key={`${record.collection}/${record.id}`}>
                  {t("Nový záznam", "New record")} {record.id}: {record.name}
                </li>
              ))}
        </ul>
      ),
      width: 420,
    },
  ];

  return (
    <section>
      <PageHeader
        title={t("Import", "Import")}
        subtitle={t(
          "CSV z tabulky nebo jiného CRM. Nové záznamy se uloží jako koncept.",
          "CSV from a spreadsheet or another CRM. New records are saved as a draft.",
        )}
      />
      <div className="import-steps">
        {report ? <ImportResult report={report} /> : null}
        <ErrorNotice error={error} title={t("Neimportováno.", "Not imported.")} />

        <article className="ds-card">
          <h2>{t("1. Co importujete", "1. What you import")}</h2>
          <ChipChoice
            label={t("Co importujete", "What you import")}
            value={kind}
            options={kinds}
            onChange={(next) => {
              setKind(next);
              setReport(null);
            }}
          />
        </article>

        <article className="ds-card">
          <h2>{t("2. Soubor", "2. The file")}</h2>
          <div className="form-grid">
            <Field
              label={t("Soubor CSV", "A CSV file")}
              hint={t(
                "Oddělovač (čárka, středník, tabulátor) a kódování se poznají samy.",
                "The delimiter (comma, semicolon, tab) and the encoding are detected.",
              )}
              error={fileError ?? undefined}
              wide
            >
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={(event) => void choose(event.target.files?.[0])}
              />
            </Field>
            <Field
              label={t("Nebo vložte text", "Or paste the text")}
              hint={t("První řádek jsou názvy sloupců.", "The first line names the columns.")}
              wide
            >
              <textarea
                rows={5}
                value={text}
                spellCheck={false}
                className="import-text"
                onChange={(event) => {
                  setText(event.target.value);
                  setFileName(null);
                  setReport(null);
                }}
              />
            </Field>
          </div>
          {table ? (
            <p className="muted small">
              {[
                fileName,
                `${t.count(table.rows.length, ROWS)}, ${t.count(table.headers.length, COLUMNS)}`,
                t(
                  `oddělovač: ${DELIMITER_NAMES[table.delimiter]?.cs}`,
                  `delimiter: ${DELIMITER_NAMES[table.delimiter]?.en}`,
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {tooMany ? (
            <Alert tone="warning" locale={locale}>
              {t(
                `Najednou jde importovat nejvýš ${MAX_IMPORT_ROWS} řádků. Rozdělte soubor.`,
                `One import takes at most ${MAX_IMPORT_ROWS} rows. Split the file.`,
              )}
            </Alert>
          ) : null}
        </article>

        {table && table.headers.length > 0 ? (
          <article className="ds-card">
            <h2>{t("3. Sloupce", "3. The columns")}</h2>
            <p className="muted small">
              {t(
                "Ke každému sloupci vyberte pole. Odhad podle názvů sloupců (česky, anglicky, export z HubSpotu) můžete změnit.",
                "Choose a field for each column. The guess from the column names (Czech, English, a HubSpot export) can be changed.",
              )}
            </p>
            <ul className="import-mapping">
              {table.headers.map((header, column) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position in the file; names may repeat
                <li key={`${column}:${header}`} className="import-mapping-row">
                  <span className="import-mapping-source">
                    <strong>{header || t(`Sloupec ${column + 1}`, `Column ${column + 1}`)}</strong>
                    <span className="muted small">{table.rows[0]?.[column] ?? ""}</span>
                  </span>
                  <div className="ds-select-wrap">
                    <select
                      className="ds-select"
                      aria-label={t(`Pole pro sloupec ${header}`, `Field for the column ${header}`)}
                      value={mapping[column] ?? ""}
                      onChange={(event) =>
                        setMapping(column, (event.target.value || null) as ImportField | null)
                      }
                    >
                      <option value="">{t("Nepoužít", "Do not use")}</option>
                      {(IMPORT_FIELDS[kind] as readonly ImportField[]).map((field) => (
                        <option key={field} value={field}>
                          {fieldLabel(field)}
                        </option>
                      ))}
                    </select>
                    <Icon name="nav-arrow-down" className="ds-select__chevron" />
                  </div>
                </li>
              ))}
            </ul>
            {missing.length > 0 ? (
              <Alert tone="info" locale={locale}>
                {t("Ještě vyberte sloupec pro: ", "Still choose a column for: ")}
                {missing.map(fieldLabel).join(", ")}.
              </Alert>
            ) : null}
            {kind !== "companies" ? (
              <div className="import-options">
                <Checkbox
                  id="import-create-companies"
                  label={t(
                    "Založit firmu, kterou řádek uvádí a která tu ještě není",
                    "Create a company a row names that is not here yet",
                  )}
                  checked={createCompanies}
                  onChange={(event) => setCreateCompanies(event.target.checked)}
                />
                {kind === "deals" ? (
                  <>
                    <Field label={t("Částky jsou zapsané", "The amounts are written")}>
                      <ChipChoice
                        label={t("Zápis částek", "How amounts are written")}
                        value={numberLocale}
                        options={[
                          { value: "cs", label: t("česky: 1 234,50", "Czech: 1 234,50") },
                          { value: "en", label: t("anglicky: 1,234.50", "English: 1,234.50") },
                        ]}
                        onChange={setNumberLocale}
                      />
                    </Field>
                    <Field
                      label={t(
                        "Obchodník pro řádky bez obchodníka",
                        "Salesperson of rows without one",
                      )}
                      hint={t(
                        "Obchodníka, kterého řádek uvádí a který tu není, import založí.",
                        "A salesperson a row names who is not here yet is created.",
                      )}
                    >
                      <select
                        value={defaultOwnerId}
                        onChange={(event) => setDefaultOwnerId(event.target.value)}
                      >
                        <option value="">
                          {t("Žádný: takový řádek se přeskočí", "None: such a row is skipped")}
                        </option>
                        {data.salespeople
                          .filter((entry) => entry.value.active)
                          .map((entry) => (
                            <option key={entry.value.id} value={entry.value.id}>
                              {entry.value.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}
          </article>
        ) : null}

        {plan ? (
          <article className="ds-card">
            <h2>{t("4. Náhled", "4. Preview")}</h2>
            <p>
              {t(
                `Založí se: ${t.count(willCreate, NEW_RECORDS)}. Přeskočí se: ${t.count(skipped, ROWS)}.`,
                `To be created: ${t.count(willCreate, NEW_RECORDS)}. Skipped: ${t.count(skipped, ROWS)}.`,
              )}{" "}
              <span className="muted small">{createdSummary(plan.created, t)}</span>
            </p>
            <DataTable
              id="import-preview"
              caption={t("Náhled importu", "Import preview")}
              columns={previewColumns}
              rows={plan.rows}
              rowKey={(row) => String(row.row)}
              defaultSort="result"
              defaultDirection="desc"
              pageSize={50}
            />
            {canWrite ? (
              <div className="form-actions">
                <Button
                  variant="primary"
                  icon="upload"
                  busy={busy}
                  disabled={willCreate === 0}
                  onClick={() => void run()}
                >
                  {t("Importovat do konceptu", "Import to the draft")}
                </Button>
                <span className="muted small">
                  {t(
                    "Nic se nepublikuje: změny uvidíte a zveřejníte v konceptu.",
                    "Nothing is published: you review and publish the changes in the draft.",
                  )}
                </span>
              </div>
            ) : null}
          </article>
        ) : null}

        {!table && !report ? (
          <EmptyState
            icon="upload"
            title={t("Vyberte soubor nebo vložte text.", "Choose a file or paste the text.")}
            headingLevel={2}
          >
            <p className="muted small">
              {t(
                "Firmy se párují podle IČO nebo názvu, kontakty podle e-mailu; existující záznam import přeskočí.",
                "Companies are matched by their company ID or name, contacts by e-mail; the import skips a record that exists.",
              )}
            </p>
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}

function createdSummary(created: ImportReport["created"], t: ReturnType<typeof useT>): string {
  const parts = [
    created.companies > 0
      ? t(`firmy: ${created.companies}`, `companies: ${created.companies}`)
      : "",
    created.contacts > 0 ? t(`kontakty: ${created.contacts}`, `contacts: ${created.contacts}`) : "",
    created.deals > 0 ? t(`případy: ${created.deals}`, `deals: ${created.deals}`) : "",
    created.salespeople > 0
      ? t(`obchodníci: ${created.salespeople}`, `salespeople: ${created.salespeople}`)
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

/** What the server created and which rows it skipped, as it said it. */
function ImportResult({ report }: { report: ImportReport }) {
  const t = useT();
  const locale = useLocale();
  const total = report.records.length;
  return (
    <Alert
      tone={report.skipped.length > 0 ? "warning" : "success"}
      title={t(
        `Importováno do konceptu: ${t.count(total, NEW_RECORDS)}.`,
        `Imported to the draft: ${t.count(total, NEW_RECORDS)}.`,
      )}
      live="polite"
      locale={locale}
      actions={
        total > 0 ? (
          <Button variant="secondary" size="sm" href={href({ page: "draft" })}>
            {t("Otevřít koncept", "Open the draft")}
          </Button>
        ) : null
      }
    >
      <p>{createdSummary(report.created, t)}</p>
      {report.skipped.length > 0 ? (
        <>
          <p>
            {t(
              `Přeskočeno: ${t.count(report.skipped.length, ROWS)}`,
              `Skipped: ${t.count(report.skipped.length, ROWS)}`,
            )}
          </p>
          <ul className="issues">
            {report.skipped.slice(0, 50).map((row) => (
              <li key={row.row}>
                {t(`Řádek ${row.row}`, `Row ${row.row}`)}
                {row.label ? ` (${row.label})` : ""}: {row.reasons.join(" ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Alert>
  );
}
