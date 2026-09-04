/**
 * Parses pasted spreadsheet rows into expense drafts.
 *
 * Kept out of the component so the date handling — the part most likely to be
 * wrong — can be tested directly.
 *
 * Splitting text into cells and interpreting those cells are separate steps.
 * The importer needs them apart: it has to show the table and ask which column
 * is which before it can know that column 3 is the date, and a parser that
 * assumed a fixed order could not answer that question.
 *
 * Tab, comma or semicolon separated, quoting included — the splitting itself
 * is parseDelimited's. A header row is detected, not required.
 */

import { parseDelimited } from "./parse-delimited";

/** The fields a sheet column can be pointed at. */
export const IMPORT_FIELDS = [
  {
    key: "type",
    label: "Expense type",
    required: true,
    hint: "Matched against your categories by name.",
  },
  { key: "date", label: "Date", required: true, hint: "Any common format." },
  {
    key: "amount",
    label: "Amount",
    required: true,
    hint: "Symbols and separators are stripped.",
  },
  {
    key: "notes",
    label: "Notes",
    required: false,
    hint: "More than one column can go here; they are joined.",
  },
  {
    key: "by",
    label: "Paid by",
    required: false,
    hint: "Matched to a user by name. Rows that match nobody use the person chosen above.",
  },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** One entry per column of the sheet, null meaning ignore this column. */
export type ColumnMapping = (ImportField | null)[];

export type SplitSheet = {
  /** The header row's cells, if one was detected. */
  header: string[] | null;
  /** Body rows, header excluded, each padded to the full width. */
  rows: { line: number; cells: string[] }[];
  /** Column count, taken from the widest row so nothing is silently dropped. */
  width: number;
};

export type ParsedRow = {
  line: number;
  raw: string;
  type: string;
  by: string;
  date: string | null;
  /** How the date was read, so an ambiguous one can be shown for confirmation. */
  dateNote: string | null;
  amount: number | null;
  notes: string;
  errors: string[];
};

/** Which half of "5/8/2026" is the day, as far as one sheet is concerned. */
export type DateOrder = "day-first" | "month-first" | "unknown";

/**
 * Works out how a sheet writes its dates, from the cells that can only be read
 * one way.
 *
 * "25/05/2026" has to be day-first: there is no 25th month. One such cell says
 * more about the sheet than any number of ambiguous ones, because a person
 * filling a column does not switch convention halfway down.
 *
 * A sheet that contradicts itself — some cells only valid day-first, others
 * only month-first — gets "unknown" rather than a majority verdict. That is
 * not a sheet with a convention, and pretending otherwise would silently
 * mis-file whichever half lost the vote.
 */
export function detectDateOrder(cells: string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;

  for (const cell of cells) {
    const m = cell.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }

  if (dayFirst > 0 && monthFirst === 0) return "day-first";
  if (monthFirst > 0 && dayFirst === 0) return "month-first";
  return "unknown";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Days in a month, so 31 April is rejected rather than rolled into May. */
function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

/**
 * Reads a date cell.
 *
 * When the first number is above 12 it cannot be a month, so that cell is
 * day-first and says so. Anything else depends on `order`: pass the convention
 * detectDateOrder found for the whole sheet and an otherwise ambiguous cell is
 * read that way without being flagged, because it is no longer a guess. With
 * no order to go on it falls back to month-first and flags it.
 *
 * A month-only cell ("Feb 2026", "Mar2026") resolves to the first of the month,
 * which is a guess and is flagged as one.
 */
export function parseExpenseDate(
  input: string,
  order: DateOrder = "unknown",
): { date: string | null; note: string | null; error: string | null } {
  const text = input.trim();
  if (!text) return { date: null, note: null, error: "No date." };

  // "Feb 2026", "Mar2026", "March 2026"
  const monthOnly = text.match(/^([A-Za-z]{3,9})\s*(\d{4})$/);
  if (monthOnly) {
    const month = MONTHS[monthOnly[1].slice(0, 3).toLowerCase()];
    if (!month) return { date: null, note: null, error: `Unrecognised month "${monthOnly[1]}".` };
    return {
      date: iso(Number(monthOnly[2]), month, 1),
      note: "month only - assumed the 1st",
      error: null,
    };
  }

  // 2026-05-25
  const isoLike = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoLike) {
    const [y, m, d] = [Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3])];
    if (!validDay(y, m, d)) return { date: null, note: null, error: `"${text}" is not a real date.` };
    return { date: iso(y, m, d), note: null, error: null };
  }

  // 5/25/2026, 25/05/2026, 6-1-2026
  const numeric = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;

    // First number above 12 cannot be a month, so this cell is day-first.
    if (a > 12) {
      if (!validDay(year, b, a)) return { date: null, note: null, error: `"${text}" is not a real date.` };
      return { date: iso(year, b, a), note: `read as ${a}/${b} day-first`, error: null };
    }

    // Both halves are 12 or under, so the cell could be read either way. When
    // the sheet's other rows have already settled which way it writes dates,
    // that answer is used and there is nothing to flag: the reading is not a
    // guess any more. Only a sheet that never disambiguates itself falls back
    // to month-first and says so.
    const dayFirst = order === "day-first";
    const [month, day] = dayFirst ? [b, a] : [a, b];

    if (!validDay(year, month, day)) {
      return { date: null, note: null, error: `"${text}" is not a real date.` };
    }

    const ambiguous = a <= 12 && b <= 12 && a !== b;
    return {
      date: iso(year, month, day),
      note:
        ambiguous && order === "unknown" ? `read as ${a}/${b} month-first` : null,
      error: null,
    };
  }

  // Anything else: let Date try, but only trust a result it parsed fully.
  //
  // A bare number has to be refused before it gets here. Date reads "45000" as
  // the first of January in the year 45000 quite happily, so an amount column
  // would pass as a date column — and the guesser would then have no way to
  // tell the two apart.
  const parsed = /^\d+$/.test(text) ? new Date(NaN) : new Date(text);
  const year = parsed.getFullYear();
  if (!Number.isNaN(parsed.getTime()) && year >= 1900 && year <= 2200) {
    return {
      date: iso(year, parsed.getMonth() + 1, parsed.getDate()),
      note: "interpreted loosely - check it",
      error: null,
    };
  }

  return { date: null, note: null, error: `Could not read the date "${text}".` };
}

/** Strips currency symbols, thousands separators and stray spaces. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Whether a cell is a number rather than a word that happens to contain one.
 *
 * parseAmount is deliberately forgiving because a real amount cell arrives as
 * "Rs 45,000" or "(1,200)". That forgiveness is wrong when the question is
 * "is this a number at all": it reads "Col1" as 1 and "5/8/2026" as 582026,
 * which is how a header row or a date column gets mistaken for money.
 */
function isNumericCell(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  // A currency marker may lead or trail, but it has to be one this list names.
  // Any-three-letters would read the "Col" off "Col1" and call the rest a
  // number, which is how a header row gets mistaken for data.
  const CURRENCY = /(?:Rs\.?|PKR|USD|EUR|GBP|AED|SAR|[$£€¥₨])/i;
  const bare = text
    .replace(new RegExp(`^${CURRENCY.source}\\s*`, "i"), "")
    .replace(new RegExp(`\\s*${CURRENCY.source}$`, "i"), "")
    .trim();
  return /^\(?-?[\d,. ]*\d[\d,. ]*\)?$/.test(bare);
}

/**
 * Splits pasted text into a header and body, interpreting nothing.
 *
 * The splitting itself is parseDelimited's job — it handles quoting, which
 * matters here because "Rs 45,000" and a note containing a comma both arrive
 * quoted out of a spreadsheet and a naive split would shred them.
 *
 * What is added on top is that the header is optional. parseDelimited always
 * takes its first row as headings; an expense paste is very often four bare
 * columns with no headings at all, and calling the first expense a header would
 * silently drop it. So a first row only counts as a header when it carries no
 * date and no plausible amount, and either names two things this importer
 * recognises or simply reads as labels while the row beneath it does not — the
 * latter catching a sheet headed "Col1, Col2, Col3", which names nothing but is
 * still plainly not an expense.
 *
 * The date-and-amount veto is what stops a real row being eaten: "Type approval
 * fee, 5/8/2026, 45000" mentions both "type" and "date" but is data.
 */
export function splitSheet(text: string): SplitSheet {
  const { headers, rows } = parseDelimited(text);
  return sheetFromRows(headers, rows);
}

/**
 * Builds a SplitSheet from rows already split into cells.
 *
 * The shared tail of both routes: a CSV arrives through parseDelimited, an
 * .xlsx through readExpenseWorkbook, and from here on neither can be told from
 * the other. `first` is the sheet's first row, which may or may not be a
 * header — deciding that is this function's job.
 */
function sheetFromRows(first: string[], body: string[][]): SplitSheet {
  if (first.length === 0) return { header: null, rows: [], width: 0 };

  const carriesData = (cells: string[]) =>
    cells.some((c) => c !== "" && (parseExpenseDate(c).date !== null || isNumericCell(c)));

  const filled = first.filter((c) => c !== "");
  const lower = first.join(" ").toLowerCase();

  const looksLikeHeader =
    !carriesData(first) &&
    filled.length > 1 &&
    // Every cell has to read as a label rather than a stray number.
    filled.every((c) => /[a-z]/i.test(c)) &&
    (HEADER_HINTS.filter((h) => lower.includes(h)).length >= 2 ||
      // Nothing recognisable by name, so lean on the contrast with the row
      // below: a body row normally carries a date or an amount, a header does not.
      (body.length > 0 && carriesData(body[0])));

  // The first row's length is the width: parseDelimited pads its body rows to
  // the header and no further, and the workbook reader pads every row alike.
  const width = first.length;
  const all = looksLikeHeader ? body : [first, ...body];

  return {
    header: looksLikeHeader ? first : null,
    rows: all.map((cells, index) => ({
      line: index + 1,
      cells: pad(cells, width),
    })),
    width,
  };
}

/**
 * Renders one .xlsx cell as the text the rest of this file expects.
 *
 * A workbook hands back typed cells, and a Date among them is a gift: it is
 * already unambiguous, so writing it as ISO sidesteps the whole "is 5/8 May or
 * August" problem that a CSV of the same sheet would have carried. Doing
 * anything else here — toLocaleDateString, say — would manufacture the
 * ambiguity the typed value had spared us.
 *
 * Numbers are written plainly rather than formatted: a thousands separator
 * would only have to be stripped again by parseAmount, and a locale that uses
 * "," for the decimal point would make 45,5 unreadable.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
}

/**
 * Turns a workbook's rows into a SplitSheet.
 *
 * Takes the rows rather than the file so this stays testable and free of the
 * reader: the caller does the reading, which in the browser means the library's
 * own File-based entry point.
 *
 * Trailing empty rows and columns are dropped first. A spreadsheet someone has
 * scrolled through is routinely 1000 rows of nothing below the last real one,
 * and every one of those would otherwise arrive as a row missing its date, its
 * amount and its type.
 */
export function sheetFromWorkbookRows(rows: unknown[][]): SplitSheet {
  const text = rows.map((r) => r.map(cellToText));

  const used = text.filter((r) => r.some((c) => c !== ""));
  if (used.length === 0) return { header: null, rows: [], width: 0 };

  // Width from the widest row that actually holds something, so a stray format
  // applied to column ZZ does not widen the mapping table by twenty columns.
  const width = Math.max(...used.map((r) => r.reduce((last, c, i) => (c !== "" ? i + 1 : last), 0)));
  const trimmed = used.map((r) => pad(r, width));

  return sheetFromRows(trimmed[0], trimmed.slice(1));
}

const HEADER_HINTS = [
  "expense type", "expense date", "expense by",
  "type", "date", "amount", "notes", "category", "description",
];

const pad = (cells: string[], width: number) =>
  cells.length >= width ? cells.slice(0, width) : [...cells, ...Array(width - cells.length).fill("")];

// Ordered: the first pattern to match a header name wins. "Expense By" has to
// be tested before the amount rule, whose "paid" would otherwise claim it.
const HEADER_PATTERNS: [RegExp, ImportField][] = [
  [/\b(who|employee|person|staff|spent by|paid by|expense by)\b/i, "by"],
  [/\b(type|category|head|particular)\b/i, "type"],
  [/\b(date|month|day)\b/i, "date"],
  [/\b(amount|cost|price|value|total|paid|debit|expense)\b/i, "amount"],
  [/\b(note|remark|comment|detail|description|purpose)/i, "notes"],
];

/**
 * Guesses which field each column holds.
 *
 * Header names first, since a sheet that labels its columns has already
 * answered the question. Where there is no header — or a name nobody
 * recognises — the column's own values are sampled: a column that parses as a
 * date nearly everywhere is the date, and the same for amounts. Whatever is
 * still unclaimed falls back to the order this importer used to assume, so an
 * unlabelled paste in the old shape maps itself without anyone touching a
 * dropdown.
 *
 * It is a guess either way, which is why the importer shows it and lets it be
 * corrected rather than importing on the strength of it.
 */
export function guessMapping(sheet: SplitSheet): ColumnMapping {
  const mapping: ColumnMapping = Array(sheet.width).fill(null);
  const taken = new Set<ImportField>();

  const claim = (index: number, field: ImportField) => {
    // Notes is the one field several columns may share.
    if (field !== "notes" && taken.has(field)) return;
    mapping[index] = field;
    taken.add(field);
  };

  if (sheet.header) {
    sheet.header.forEach((name, index) => {
      if (!name) return;
      const hit = HEADER_PATTERNS.find(([pattern]) => pattern.test(name));
      if (hit) claim(index, hit[1]);
    });
  }

  // Sample the values for anything a header did not settle.
  const sample = sheet.rows.slice(0, 20);
  const ratio = (index: number, test: (cell: string) => boolean) => {
    const filled = sample.map((r) => r.cells[index]).filter((c) => c !== "");
    if (filled.length === 0) return 0;
    return filled.filter(test).length / filled.length;
  };

  // A date must be ruled out before a column can be an amount: parseAmount
  // strips the separators out of "5/8/2026" and reports 582026 quite happily,
  // so sampling for amounts first would file a date column as the money.
  const looksLikeDate = (index: number) =>
    ratio(index, (c) => parseExpenseDate(c).date !== null) >= 0.8;

  for (let i = 0; i < sheet.width; i++) {
    if (mapping[i]) continue;
    if (!taken.has("date") && looksLikeDate(i)) claim(i, "date");
  }

  for (let i = 0; i < sheet.width; i++) {
    if (mapping[i] || looksLikeDate(i)) continue;
    if (!taken.has("amount") && ratio(i, (c) => isNumericCell(c) && (parseAmount(c) ?? 0) > 0) >= 0.8) {
      claim(i, "amount");
    }
  }

  // Last resort: the shape this importer used to assume. Only for a sheet with
  // no header — where there are names, position is the weaker evidence, and
  // guessing by it would put "S.No" under Expense type while leaving the column
  // actually called "Particulars" unmapped.
  if (!sheet.header) {
    const LEGACY: ImportField[] = ["type", "by", "date", "amount", "notes"];
    for (let i = 0; i < sheet.width; i++) {
      if (mapping[i]) continue;
      const field = LEGACY[i];
      if (field && !taken.has(field)) claim(i, field);
    }
  }

  // A leftover text column is almost always the type when nothing else claimed
  // it — "Particulars", "Head of account", whatever the sheet calls it.
  if (!taken.has("type")) {
    const textual = mapping.findIndex(
      (m, i) =>
        m === null &&
        ratio(i, (c) => !isNumericCell(c) && parseExpenseDate(c).date === null) >= 0.8,
    );
    if (textual !== -1) claim(textual, "type");
  }

  return mapping;
}

/**
 * Interprets a split sheet through a column mapping.
 *
 * Every field is read from the column the mapping points at, so a sheet in any
 * order imports correctly once the mapping is right. Columns mapped to nothing
 * are left alone — a sheet usually carries a serial number or a running total
 * that has no business becoming part of an expense.
 */
export function parseMappedRows(sheet: SplitSheet, mapping: ColumnMapping): ParsedRow[] {
  const indexesFor = (field: ImportField) =>
    mapping.flatMap((m, i) => (m === field ? [i] : []));

  const [typeAt] = indexesFor("type");
  const [dateAt] = indexesFor("date");
  const [amountAt] = indexesFor("amount");
  const [byAt] = indexesFor("by");
  const notesAt = indexesFor("notes");

  const cellAt = (cells: string[], index: number | undefined) =>
    index === undefined ? "" : (cells[index] ?? "");

  // One sheet keeps one convention, so the rows that can only be read one way
  // settle the rows that could be read either. Without this a sheet holding
  // "25/05" and "2/7" flags the second as ambiguous and reads it the opposite
  // way to the first — half the year quietly filed in the wrong month.
  const order = detectDateOrder(sheet.rows.map((r) => cellAt(r.cells, dateAt)));

  return sheet.rows.map(({ line, cells }) => {
    const type = cellAt(cells, typeAt);
    const dateCell = cellAt(cells, dateAt);
    const amountCell = cellAt(cells, amountAt);

    const errors: string[] = [];
    const { date, note, error } = parseExpenseDate(dateCell, order);
    if (error) errors.push(error);

    const amount = parseAmount(amountCell);
    if (amount === null) errors.push(`Could not read the amount "${amountCell}".`);
    else if (amount <= 0) errors.push("Amount has to be more than zero.");

    if (!type) errors.push("No expense type.");

    return {
      line,
      raw: cells.join("\t"),
      type,
      by: cellAt(cells, byAt),
      date,
      dateNote: note,
      amount,
      notes: notesAt.map((i) => cells[i] ?? "").filter(Boolean).join(" ").trim(),
      errors,
    };
  });
}

/** Splits and interprets in one call, on a guessed mapping. */
export function parseExpenseRows(text: string): ParsedRow[] {
  const sheet = splitSheet(text);
  return parseMappedRows(sheet, guessMapping(sheet));
}

/**
 * Matches a sheet's type column to a category id.
 *
 * Exact name first, then a prefix match so "Software" finds "Software &
 * Licences" without needing the full name typed out. Ambiguous prefixes (more
 * than one category starting with the same word) are left unmatched rather than
 * guessed at, so the fallback category is used and the choice stays visible.
 */
export function matchCategoryId(
  type: string,
  categories: { id: string; name: string }[],
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(type);
  if (!target) return null;

  const exact = categories.find((c) => norm(c.name) === target);
  if (exact) return exact.id;

  const prefixed = categories.filter((c) => norm(c.name).startsWith(target));
  return prefixed.length === 1 ? prefixed[0].id : null;
}

/**
 * Matches a sheet's "paid by" column to a user.
 *
 * A sheet writes what people call each other, not what the system does:
 * "Hasan" for "Hassan Shamsi", one 's' short and no surname. So a full-name
 * match is tried first, then the first name, then a spelling close enough to
 * be the same person — one character out over a name of five or more, which
 * covers a dropped double letter without pairing "Ali" with "Adi".
 *
 * Ambiguity is never resolved by guessing. Two people called Hassan means no
 * match, and the row falls back to whoever the form has selected — being told
 * the column was ignored beats reimbursing the wrong person.
 */
export function matchUserId(
  name: string,
  users: { id: string; fullName: string }[],
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(name);
  if (!target) return null;

  const only = (matches: { id: string }[]) =>
    matches.length === 1 ? matches[0].id : null;

  const full = users.filter((u) => norm(u.fullName) === target);
  if (full.length > 0) return only(full);

  const first = users.filter((u) => norm(u.fullName.split(/\s+/)[0] ?? "") === target);
  if (first.length > 0) return only(first);

  // A near miss on the first name, for the doubled letter a sheet drops.
  if (target.length >= 5) {
    const close = users.filter(
      (u) => editDistanceWithin1(norm(u.fullName.split(/\s+/)[0] ?? ""), target),
    );
    if (close.length > 0) return only(close);
  }

  return null;
}

/** True when two strings are one insertion, deletion or substitution apart. */
function editDistanceWithin1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0, j = 0, edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}
