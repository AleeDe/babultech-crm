/**
 * Domain types.
 *
 * These replace the types Prisma used to generate. They describe the shapes the
 * application actually reads, which is a subset of each table — supabase-js
 * returns plain JSON, so nothing generates them for us.
 *
 * Numeric columns arrive from PostgREST as `number | string` (never a Decimal
 * object), which is why money fields are typed that way. Always put them
 * through `toDecimal()` from lib/decimal before doing arithmetic.
 */

/**
 * A money value as it comes back from PostgREST.
 *
 * Nullable columns widen this to `Numeric | null` at the field. Arithmetic must
 * go through `toDecimal()`, which maps null/undefined to zero - passing a raw
 * null into `new Decimal()` throws.
 */
export type Numeric = number | string;

/**
 * The mediums a MESSAGE_SENT touch can go out on.
 *
 * Here rather than in server/crm.ts because that file is "use server", where
 * every export must be an async function — a plain array there is a build
 * error. Both the Zod schema and the form's select read it from this module.
 */
export const MESSAGE_CHANNELS = ["WHATSAPP", "SMS", "LINKEDIN", "OTHER"] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
