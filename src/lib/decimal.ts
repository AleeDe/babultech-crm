import Decimal from "decimal.js";

/**
 * Money arithmetic, decoupled from Prisma.
 *
 * `Prisma.Decimal` is decimal.js re-exported, so this is the same
 * implementation and the same behaviour — it simply does not drag in
 * `@prisma/client`.
 *
 * Two rules this keeps intact from the previous code:
 *
 *   - Never do money maths in JS numbers. Every amount that came out of a
 *     Decimal(18,2) column stays a Decimal until it is formatted.
 *   - PostgREST returns numeric columns as STRINGS (unlike Prisma, which
 *     hydrated them into Decimal objects). `toDecimal()` normalises both, so
 *     call sites do not have to care which client produced the value.
 */
export { Decimal };

/**
 * Unwrap a PostgREST embedded to-one relation.
 *
 * Prisma returned a nested object for a to-one relation; PostgREST types the
 * same thing as an array (and returns one at runtime for some join shapes).
 * Every read of an embedded parent goes through this so pages keep the object
 * shape they were written against.
 */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Coerce anything a query might return into a Decimal. Null/undefined -> 0. */
export function toDecimal(value: unknown): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(String(value));
}

/** Sum one numeric field across rows, safely. */
export function sumBy<T>(rows: readonly T[], key: keyof T): Decimal {
  return rows.reduce((total, row) => total.plus(toDecimal(row[key])), new Decimal(0));
}

/**
 * Serialise a Decimal for a write through PostgREST.
 *
 * Prisma accepted Decimal objects directly; PostgREST needs a JSON-safe value,
 * and a string preserves precision where a JS number would not.
 */
export function forDb(value: Decimal | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toDecimal(value).toFixed(2);
}
