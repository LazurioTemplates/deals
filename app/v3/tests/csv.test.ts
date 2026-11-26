import { describe, expect, test } from "bun:test";
import { detectDelimiter, parseCsv, parseCsvRows } from "../src/domain/csv.ts";

describe("CSV", () => {
  test("detects a comma, a semicolon and a tab from the first line", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("Název;Hodnota;Firma\nA;1,5;B")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    // A delimiter inside quotes does not count.
    expect(detectDelimiter('"a;b;c",d,e\n1,2,3')).toBe(",");
    expect(detectDelimiter("one column\nvalue")).toBe(",");
  });

  test("reads quotes, doubled quotes, line breaks inside quotes, a BOM and CRLF", () => {
    const text = '\uFEFFName,Note\r\n"Ukázka, s.r.o.","Řekl ""ano""\r\nna schůzce"\r\nDruhá,\r\n';
    const table = parseCsv(text);
    expect(table.delimiter).toBe(",");
    expect(table.headers).toEqual(["Name", "Note"]);
    expect(table.rows).toEqual([
      ["Ukázka, s.r.o.", 'Řekl "ano"\r\nna schůzce'],
      ["Druhá", ""],
    ]);
    // A record over two lines is still one row of the spreadsheet.
    expect(table.rowNumbers).toEqual([2, 3]);
  });

  test("leaves out empty rows, pads short ones and counts rows as a spreadsheet does", () => {
    const table = parseCsv("a;b;c\n\n1;2\n;;\n4;5;6;7\n");
    expect(table.rows).toEqual([
      ["1", "2", ""],
      ["4", "5", "6", "7"],
    ]);
    expect(table.rowNumbers).toEqual([3, 5]);
  });

  test("ends a line on a lone CR and keeps the last row without a line break", () => {
    expect(parseCsvRows("a,b\r1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("an empty text has no headers and no rows", () => {
    expect(parseCsv("")).toEqual({ delimiter: ",", headers: [], rows: [], rowNumbers: [] });
    expect(parseCsv("\uFEFF")).toEqual({ delimiter: ",", headers: [], rows: [], rowNumbers: [] });
  });

  test("a tab-separated export with trimmed headers", () => {
    const table = parseCsv(" Deal Name \tAmount\nRecepce\t1 234,50\n");
    expect(table.delimiter).toBe("\t");
    expect(table.headers).toEqual(["Deal Name", "Amount"]);
    expect(table.rows).toEqual([["Recepce", "1 234,50"]]);
  });
});
