/**
 * CSV as spreadsheets and CRMs export it (RFC 4180): fields split by a
 * delimiter, a field in double quotes may hold the delimiter, a line break
 * and a doubled quote (`""`). The delimiter is a comma, a semicolon (Czech
 * Excel) or a tab, detected from the first line when not given. A byte order
 * mark at the start is dropped, and CRLF, LF and CR all end a line.
 */
export const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export interface CsvTable {
  delimiter: CsvDelimiter;
  /** The first row: the names of the columns, trimmed. */
  headers: string[];
  /** Every other row that is not empty, padded to the number of headers. */
  rows: string[][];
  /**
   * The number of each row as a spreadsheet shows it (a header on the first
   * line is row 1, empty rows count), so a problem names the row the person sees.
   */
  rowNumbers: number[];
}

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * The delimiter of a CSV text: the one of `,` `;` and tab that occurs most
 * often outside quotes in its first line; a comma when none does.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(CSV_DELIMITERS.map((entry) => [entry, 0]));
  let quoted = false;
  for (const char of stripBom(text)) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char as CsvDelimiter)) {
      counts.set(char as CsvDelimiter, (counts.get(char as CsvDelimiter) ?? 0) + 1);
    }
  }
  let best: CsvDelimiter = ",";
  for (const delimiter of CSV_DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/** Every row of a CSV text as its fields, empty lines included as `[""]`. */
export function parseCsvRows(text: string, delimiter: CsvDelimiter): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (index < source.length) {
    const char = source[index] as string;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\r") {
      endRow();
      if (source[index + 1] === "\n") index += 1;
    } else if (char === "\n") {
      endRow();
    } else {
      // A quote inside an unquoted field is kept as it is, as spreadsheets read it.
      field += char;
    }
    index += 1;
  }
  // The last row, unless the text ended with a line break.
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

const isEmptyRow = (row: readonly string[]) => row.every((value) => value.trim() === "");

/**
 * A CSV text as its header row and its data rows. Empty rows are left out;
 * a row shorter than the header is padded with empty fields, a longer one
 * keeps its extra fields (they have no column to map to).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): CsvTable {
  const all = parseCsvRows(text, delimiter);
  const filled = all
    .map((row, index) => ({ row, number: index + 1 }))
    .filter((entry) => !isEmptyRow(entry.row));
  const [first, ...rest] = filled;
  const headers = (first?.row ?? []).map((value) => value.trim());
  return {
    delimiter,
    headers,
    rows: rest.map(({ row }) =>
      row.length >= headers.length
        ? row
        : [...row, ...Array.from({ length: headers.length - row.length }, () => "")],
    ),
    rowNumbers: rest.map((entry) => entry.number),
  };
}
