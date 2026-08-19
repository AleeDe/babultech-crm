/**
 * Parses pasted spreadsheet rows into expense drafts.
 *
 * Kept out of the component so the date handling — the part most likely to be
 * wrong — can be tested directly.
 *
 * Expected columns, tab or comma separated, header row optional:
 *   Expense Type | Expense By | Expense Date | Expense Amount | Notes
 */

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
 * Numeric dates are assumed month-first, matching the sheet these rows come
 * from. When the first number is above 12 it cannot be a month, so the cell is
 * read day-first instead and the reading is reported — that disagreement is
 * exactly what the preview needs to surface.
 *
 * A month-only cell ("Feb 2026", "Mar2026") resolves to the first of the month,
 * which is a guess and is flagged as one.
 */
export function parseExpenseDate(
  input: string,
  defaultYear = new Date().getFullYear(),
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
      note: "month only — assumed the 1st",
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

    if (!validDay(year, a, b)) return { date: null, note: null, error: `"${text}" is not a real date.` };

    // Both halves are 12 or under, so the cell is genuinely ambiguous. Read it
    // month-first and say so when the other reading is also a real date.
    const alsoValid = b <= 12 && a !== b;
    return {
      date: iso(year, a, b),
      note: alsoValid ? `read as ${a}/${b} month-first` : null,
      error: null,
    };
  }

  // Anything else: let Date try, but only trust a result it parsed fully.
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      date: iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()),
      note: "interpreted loosely — check it",
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

const HEADER_HINTS = ["expense type", "expense date", "amount", "expense by", "notes"];

/** Splits pasted text into rows. Tabs win when present, commas otherwise. */
export function parseExpenseRows(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedRow[] = [];

  lines.forEach((line, index) => {
    // Skip a header row rather than reporting it as broken.
    const lower = line.toLowerCase();
    if (index === 0 && HEADER_HINTS.filter((h) => lower.includes(h)).length >= 2) return;

    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const [type = "", by = "", dateCell = "", amountCell = "", ...rest] = cells;

    const errors: string[] = [];
    const { date, note, error } = parseExpenseDate(dateCell);
    if (error) errors.push(error);

    const amount = parseAmount(amountCell);
    if (amount === null) errors.push(`Could not read the amount "${amountCell}".`);
    else if (amount <= 0) errors.push("Amount has to be more than zero.");

    if (!type) errors.push("No expense type.");

    rows.push({
      line: index + 1,
      raw: line,
      type,
      by,
      date,
      dateNote: note,
      amount,
      notes: rest.join(" ").trim(),
      errors,
    });
  });

  return rows;
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
