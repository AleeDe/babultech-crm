import { z } from "zod";

// Which contract frequencies actually recur. ONE_TIME and MILESTONE are billed
// by the existing runs, not on a calendar.
export const RECURRING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const MONTHS: Record<RecurringFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

export function isRecurring(frequency: string | null | undefined): frequency is RecurringFrequency {
  return (RECURRING_FREQUENCIES as readonly string[]).includes(frequency ?? "");
}

/** A billing period is named by the day it starts, so it is stable to compare. */
export type Period = { start: string; end: string };

function toUtc(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Add whole months, clamping to the end of the target month. Adding a month to
 * 31 January lands on 28 February, not on 3 March - a billing run that skips a
 * month because of day-of-month arithmetic is worse than one that repeats.
 */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
}

/**
 * The periods of a contract that have started on or before `asOf`, counted from
 * its start date. A period is only due once it has begun: billing a month that
 * has not started yet is an invoice the customer has no way to check.
 */
export function periodsDue(
  contract: { startDate: string; endDate: string; billingFrequency: string | null },
  asOf: string,
  limit = 24,
): Period[] {
  if (!isRecurring(contract.billingFrequency)) return [];
  const step = MONTHS[contract.billingFrequency];
  const endMs = toUtc(contract.endDate);
  const asOfMs = toUtc(asOf);
  const periods: Period[] = [];

  for (let index = 0; periods.length < limit; index += 1) {
    const start = addMonths(contract.startDate, index * step);
    const startMs = toUtc(start);
    // Not begun yet, or the contract has already run out.
    if (startMs > asOfMs || startMs > endMs) break;
    // A period ends the day before the next one starts, never past the contract.
    const nextStart = toUtc(addMonths(contract.startDate, (index + 1) * step));
    const end = iso(Math.min(nextStart - 86_400_000, endMs));
    periods.push({ start, end });
  }
  return periods;
}

/**
 * What one period costs. contractValue is the whole term, so it is divided by
 * the number of periods the term contains rather than charged in full each time.
 */
export function periodAmount(
  contract: { startDate: string; endDate: string; billingFrequency: string | null; contractValue: number },
  round = 2,
): number | null {
  if (!isRecurring(contract.billingFrequency)) return null;
  const step = MONTHS[contract.billingFrequency];
  const endMs = toUtc(contract.endDate);
  let count = 0;
  for (let index = 0; count < 600; index += 1) {
    if (toUtc(addMonths(contract.startDate, index * step)) > endMs) break;
    count += 1;
  }
  if (count === 0) return null;
  const factor = 10 ** round;
  return Math.round((contract.contractValue / count) * factor) / factor;
}

export function periodLabel(period: Period) {
  const format = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${format(period.start)} to ${format(period.end)}`;
}

// ------------------------------------------------------------ period locking

export const periodLockSchema = z.object({
  // The month being closed, as its first day.
  periodStart: z.string().regex(/^\d{4}-\d{2}-01$/, "Choose a month to close."),
  note: z.string().trim().min(1, "Say why this period is being closed.").max(2000),
});

/** The first day of the month a date falls in. */
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month a date falls in. */
export function monthEnd(date: string) {
  const [y, m] = date.split("-").map(Number);
  return iso(Date.UTC(y, m, 0));
}

/**
 * Whether a financial date falls inside a closed period. Locks are held as the
 * first day of each closed month.
 */
export function isLocked(date: string, lockedMonths: readonly string[]) {
  return lockedMonths.includes(monthStart(date));
}

/**
 * Months that may still be closed: every month from the earliest financial
 * activity up to the month before `asOf`, minus the ones already closed. The
 * current month is deliberately excluded - closing a month you are still
 * trading in blocks ordinary same-day corrections.
 */
export function closableMonths(
  earliest: string | null,
  asOf: string,
  lockedMonths: readonly string[],
  limit = 36,
): string[] {
  if (!earliest) return [];
  const months: string[] = [];
  const currentMonth = monthStart(asOf);
  let cursor = monthStart(earliest);
  while (cursor < currentMonth && months.length < limit) {
    if (!lockedMonths.includes(cursor)) months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

export function monthLabel(periodStart: string) {
  return new Date(`${periodStart}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
