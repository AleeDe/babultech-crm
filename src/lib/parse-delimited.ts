/**
 * Splits pasted or uploaded spreadsheet text into a header row and data rows.
 *
 * Deliberately generic: unlike parse-expense-rows.ts, which knows its five
 * columns by position, this returns whatever columns the file has and lets the
 * caller map them. That is what an import from someone else's Google Sheet
 * needs — the column order is theirs, not ours.
 *
 * Kept out of the component so the quoting rules, which are the part most
 * likely to be wrong, can be tested directly.
 */

export interface Delimited {
  headers: string[];
  /** Rows aligned to `headers`; short rows are padded so indexes stay valid. */
  rows: string[][];
  delimiter: "," | "\t" | ";";
}

/**
 * Picks the separator by counting candidates in the header line.
 *
 * Counting only outside quotes matters: a single header like
 * `"Company, Inc",Email` has more commas inside the quoted cell than between
 * cells, and a naive count would pick the wrong character and shred the file.
 */
function detectDelimiter(line: string): "," | "\t" | ";" {
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted cell is an escaped quote, not a close.
      if (quoted && line[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  // Tab first: a spreadsheet paste is tab separated and may legitimately carry
  // commas inside cells.
  if (counts["\t"] > 0) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

/**
 * Full-text CSV reader, rather than a split on newlines.
 *
 * A quoted cell may contain the line separator — a postal address pasted from a
 * sheet routinely does — so rows can only be found by tracking quote state
 * across the whole text.
 */
function parse(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }

    if (ch === delimiter) { row.push(cell); cell = ""; continue; }

    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  // Whatever is in hand when the text ends is the final cell, unless the file
  // ended on a clean newline and both are empty.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function parseDelimited(text: string): Delimited {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { headers: [], rows: [], delimiter: "," };

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  const all = parse(trimmed, delimiter).filter(
    (r) => r.some((c) => c.trim() !== ""),
  );
  if (all.length === 0) return { headers: [], rows: [], delimiter };

  const headers = all[0].map((h) => h.trim());
  const width = headers.length;

  const rows = all.slice(1).map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push("");
    return padded.slice(0, width).map((c) => c.trim());
  });

  return { headers, rows, delimiter };
}

/**
 * Guesses which incoming column feeds each of our fields.
 *
 * Matching is on letters and digits only, so "First Name", "first_name" and
 * "FIRSTNAME" all land together. Aliases carry the names other CRMs and the
 * usual hand-made sheets actually use.
 *
 * A guess is a starting point, never a decision: every mapping is shown in the
 * UI and can be changed before anything is imported.
 */
export function guessMapping(
  headers: string[],
  fields: { key: string; aliases: string[] }[],
): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const taken = new Set<string>();
  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const wanted = [field.key, ...field.aliases].map(norm);
    const hit = headers.find(
      (h) => !taken.has(h) && wanted.includes(norm(h)),
    );
    if (hit) {
      mapping[field.key] = hit;
      taken.add(hit);
    }
  }

  return mapping;
}
