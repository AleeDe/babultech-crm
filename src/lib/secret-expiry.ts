/**
 * When a credential is due attention.
 *
 * Two independent clocks, and conflating them is the mistake worth avoiding:
 *
 *   * expiresAt is the provider's deadline. Miss it and the key stops working.
 *   * rotationDays is our own hygiene policy. Miss it and nothing breaks, but a
 *     key stays valid longer than we said it should.
 *
 * A secret can be fine on one and overdue on the other, so they are reported
 * separately and the screen shows whichever is more urgent.
 *
 * Pure functions on plain dates, kept out of the server module so they can be
 * tested without a database.
 */

export type ExpiryLevel = "EXPIRED" | "CRITICAL" | "WARNING" | "OK" | "NONE";

/** Inside this many days, an expiry is worth showing as a warning. */
export const WARNING_DAYS = 30;
/** Inside this many days it is urgent. */
export const CRITICAL_DAYS = 7;

/** Whole days from `from` to `date`; negative once the date has passed. */
export function daysUntil(date: string | Date, from: Date = new Date()): number {
  const target = typeof date === "string" ? new Date(date) : date;

  // Compared at UTC midnight so a secret expiring "today" reads as 0 days
  // regardless of the time of day, rather than flipping to -1 after lunch.
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const b = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());

  return Math.round((a - b) / 86_400_000);
}

/**
 * How urgent an expiry date is.
 *
 * A missing date is NONE, never EXPIRED — plenty of credentials have no expiry
 * at all, and treating them as overdue would fill the warning list with things
 * nobody can act on, which is how people learn to ignore it.
 */
export function expiryLevel(
  expiresAt: string | Date | null | undefined,
  from: Date = new Date(),
): ExpiryLevel {
  if (!expiresAt) return "NONE";

  const days = daysUntil(expiresAt, from);
  if (days < 0) return "EXPIRED";
  if (days <= CRITICAL_DAYS) return "CRITICAL";
  if (days <= WARNING_DAYS) return "WARNING";
  return "OK";
}

/** The date a secret is next due for rotation, or null if we do not rotate it. */
export function nextRotationDue(
  lastRotatedAt: string | Date | null | undefined,
  rotationDays: number | null | undefined,
  createdAt?: string | Date | null,
): Date | null {
  if (!rotationDays || rotationDays <= 0) return null;

  // Never rotated: the clock runs from when it was added, which is the last
  // point we know the value changed. Without that fallback a key that has never
  // been rotated would show as never due — the exact case the policy is for.
  const base = lastRotatedAt ?? createdAt;
  if (!base) return null;

  const start = typeof base === "string" ? new Date(base) : base;
  const due = new Date(start);
  due.setUTCDate(due.getUTCDate() + rotationDays);
  return due;
}

/** True when rotation is overdue by its own policy. */
export function rotationOverdue(
  lastRotatedAt: string | Date | null | undefined,
  rotationDays: number | null | undefined,
  createdAt?: string | Date | null,
  from: Date = new Date(),
): boolean {
  const due = nextRotationDue(lastRotatedAt, rotationDays, createdAt);
  if (!due) return false;
  return daysUntil(due, from) < 0;
}

/** Short human phrase for an expiry date, e.g. "in 12 days", "3 days ago". */
export function expiryPhrase(
  expiresAt: string | Date | null | undefined,
  from: Date = new Date(),
): string {
  if (!expiresAt) return "No expiry";

  const days = daysUntil(expiresAt, from);
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days === -1) return "Expired yesterday";
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  return `Expires in ${days} days`;
}
