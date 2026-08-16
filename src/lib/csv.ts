/**
 * CSV generation for list exports.
 *
 * Values are written raw rather than formatted: "Rs 1,234.56" is a string a
 * spreadsheet cannot sum, and a formatted date cannot be sorted. The display
 * helpers in utils.ts are for screens; this is for the file.
 */

export interface CsvColumn<T> {
  header: string;
  /** Pulled from the row. Return a number for money, a Date or ISO string for dates. */
  value: (row: T) => unknown;
}

/**
 * Escapes one field.
 *
 * A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula, so
 * a customer named "=cmd|..." becomes an execution vector when the file is
 * opened. Prefixing with a tab neutralises it while still reading as the
 * original text.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";

  let text = String(value);

  // Dates arrive from PostgREST as ISO strings; keep the date part only, which
  // is what every one of these columns actually holds.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(text)) text = text.slice(0, 10);

  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;

  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;

  return text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeField(c.value(row))).join(","),
  );

  // A BOM so Excel opens UTF-8 correctly — without it, names with accents or
  // Urdu characters arrive mangled. CRLF for the same reason.
  return `﻿${[header, ...body].join("\r\n")}\r\n`;
}

/** A filename with the date in it, so successive exports do not overwrite. */
export function csvFilename(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The file reflects the data at the moment of the request.
      "Cache-Control": "no-store",
    },
  });
}
