/**
 * Dashboard date ranges.
 *
 * One place that turns a URL into a pair of dates, so every dashboard agrees
 * what "last quarter" means and a range can be shared as a link.
 *
 * Everything here works in date-only space (`yyyy-mm-dd`) rather than
 * timestamps. The rows being filtered — `workDate` on a time log, `dueDate` on
 * a task — are DATE columns, so comparing them as strings is both correct and
 * timezone-proof: a log dated 2026-09-14 belongs to 14 September whatever the
 * reader's clock says, and nobody in Karachi sees a different Monday from
 * someone in London.
 *
 * Weeks start on Monday, matching weekBounds() in src/server/timesheets.ts.
 * Using a different boundary here would make the dashboard disagree with the
 * timesheet screens about which week a figure belongs to.
 */

export type RangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "last_n_days"
  | "custom"
  | "all";

export interface DateRange {
  preset: RangePreset;
  /** Inclusive `yyyy-mm-dd`. Null only when the preset is "all". */
  from: string | null;
  /** Inclusive `yyyy-mm-dd`. Null only when the preset is "all". */
  to: string | null;
  /** How many days the "Last N days" box holds. Null for every other preset. */
  days: number | null;
  /** What to print above the figures — "1–30 Sept 2026", "Last 14 days". */
  label: string;
}

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "last_n_days", label: "Last N days" },
  { value: "custom", label: "Custom range" },
  { value: "all", label: "All time" },
];

/** The default when the URL says nothing. */
export const DEFAULT_PRESET: RangePreset = "this_month";

/** The most days "Last N days" will accept — five years of daily buckets. */
export const MAX_N_DAYS = 1825;

const MS_PER_DAY = 86_400_000;

/** `yyyy-mm-dd` for a Date, read in UTC so the day never shifts. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A UTC midnight Date for a `yyyy-mm-dd`. */
function parse(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Monday of the week containing `day`. */
function startOfWeek(day: string): string {
  const d = parse(day);
  // getUTCDay is 0 for Sunday, so shift it to a Monday-first index.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return iso(d);
}

function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function endOfMonth(day: string): string {
  const d = parse(startOfMonth(day));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}

function startOfQuarter(day: string): string {
  const d = parse(day);
  const q = Math.floor(d.getUTCMonth() / 3);
  return `${d.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

function endOfQuarter(day: string): string {
  const start = parse(startOfQuarter(day));
  start.setUTCMonth(start.getUTCMonth() + 3);
  start.setUTCDate(0);
  return iso(start);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "14 Sep 2026" — short, unambiguous, and not locale-dependent. */
function pretty(day: string): string {
  const d = parse(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1–30 Sep 2026", collapsing the parts the two ends share. */
function prettyRange(from: string, to: string): string {
  if (from === to) return pretty(from);
  const a = parse(from);
  const b = parse(to);
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    if (a.getUTCMonth() === b.getUTCMonth()) {
      return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
    }
    return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${a.getUTCFullYear()}`;
  }
  return `${pretty(from)} – ${pretty(to)}`;
}

/** True for a well-formed `yyyy-mm-dd` that names a real calendar day. */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && iso(d) === value;
}

/**
 * Turn URL parameters into a resolved range.
 *
 * Never throws and never returns something unusable: an unknown preset, a
 * malformed date or an out-of-order custom range all fall back rather than
 * breaking the page. These values come from the address bar, so they are
 * user-editable by definition.
 *
 * `today` is injectable so this can be tested without mocking the clock.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string; days?: string },
  today: string = iso(new Date()),
): DateRange {
  const requested = params.range as RangePreset | undefined;
  const preset: RangePreset =
    requested && RANGE_PRESETS.some((p) => p.value === requested)
      ? requested
      : DEFAULT_PRESET;

  const build = (from: string, to: string, label: string, days: number | null = null): DateRange =>
    ({ preset, from, to, days, label });

  switch (preset) {
    case "today":
      return build(today, today, `Today, ${pretty(today)}`);

    case "yesterday": {
      const d = addDays(today, -1);
      return build(d, d, `Yesterday, ${pretty(d)}`);
    }

    case "this_week": {
      const from = startOfWeek(today);
      // Ends today rather than on Sunday: a week that has not finished should
      // not show four empty days as though nothing was done in them.
      return build(from, today, `This week · ${prettyRange(from, today)}`);
    }

    case "last_week": {
      const from = addDays(startOfWeek(today), -7);
      const to = addDays(from, 6);
      return build(from, to, `Last week · ${prettyRange(from, to)}`);
    }

    case "this_month": {
      const from = startOfMonth(today);
      return build(from, today, `This month · ${prettyRange(from, today)}`);
    }

    case "last_month": {
      const from = startOfMonth(addDays(startOfMonth(today), -1));
      const to = endOfMonth(from);
      return build(from, to, `Last month · ${prettyRange(from, to)}`);
    }

    case "this_quarter": {
      const from = startOfQuarter(today);
      return build(from, today, `This quarter · ${prettyRange(from, today)}`);
    }

    case "last_quarter": {
      const from = startOfQuarter(addDays(startOfQuarter(today), -1));
      const to = endOfQuarter(from);
      return build(from, to, `Last quarter · ${prettyRange(from, to)}`);
    }

    case "this_year": {
      const from = `${today.slice(0, 4)}-01-01`;
      return build(from, today, `This year · ${prettyRange(from, today)}`);
    }

    case "last_year": {
      const year = Number(today.slice(0, 4)) - 1;
      return build(`${year}-01-01`, `${year}-12-31`, `${year}`);
    }

    case "last_n_days": {
      const raw = Number(params.days);
      // 0 and negatives are not "no filter" — they are a typo, so they clamp to
      // one day rather than silently widening the range to everything.
      const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), MAX_N_DAYS) : 30;
      // Inclusive of today, so "last 7 days" is a week ending now, not 8 days.
      const from = addDays(today, -(days - 1));
      return build(from, today, `Last ${days} day${days === 1 ? "" : "s"} · ${prettyRange(from, today)}`, days);
    }

    case "custom": {
      const from = isValidDay(params.from) ? params.from : null;
      const to = isValidDay(params.to) ? params.to : null;

      // A half-finished custom range is what the screen looks like while
      // someone is still typing into it, so it falls back to the default
      // rather than showing an error or an empty dashboard.
      if (!from || !to) {
        return resolveRange({ range: DEFAULT_PRESET }, today);
      }
      // Reversed dates are a slip, not an empty range: swap them.
      const [a, b] = from <= to ? [from, to] : [to, from];
      return build(a, b, prettyRange(a, b));
    }

    case "all":
    default:
      return { preset: "all", from: null, to: null, days: null, label: "All time" };
  }
}

/**
 * The same span immediately before this one, for period-on-period comparison.
 *
 * Returns null for "all time", which has nothing before it.
 */
export function previousRange(range: DateRange): { from: string; to: string } | null {
  if (!range.from || !range.to) return null;
  const span = Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / MS_PER_DAY) + 1;
  return { from: addDays(range.from, -span), to: addDays(range.to, -span) };
}

/** Inclusive day count, for turning a total into a daily average. */
export function rangeDays(range: DateRange): number | null {
  if (!range.from || !range.to) return null;
  return Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / MS_PER_DAY) + 1;
}

/** Mon–Fri days in the range, for capacity. Public holidays are not modelled. */
export function workingDays(range: DateRange): number | null {
  if (!range.from || !range.to) return null;
  let count = 0;
  const d = parse(range.from);
  const end = parse(range.to);
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/** Whether a `yyyy-mm-dd` (or a timestamp) falls inside the range. */
export function withinRange(range: DateRange, value: string | null | undefined): boolean {
  if (!value) return false;
  if (!range.from || !range.to) return true;
  const day = String(value).slice(0, 10);
  return day >= range.from && day <= range.to;
}

/** The query string for a range, so links and the filter agree on one shape. */
export function rangeToParams(range: DateRange): URLSearchParams {
  const p = new URLSearchParams();
  if (range.preset !== DEFAULT_PRESET) p.set("range", range.preset);
  if (range.preset === "custom" && range.from && range.to) {
    p.set("from", range.from);
    p.set("to", range.to);
  }
  if (range.preset === "last_n_days" && range.days) p.set("days", String(range.days));
  return p;
}
