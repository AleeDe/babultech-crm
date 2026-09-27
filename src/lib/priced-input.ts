import { z } from "zod";

/**
 * What a deal's lines, and a quote, look like when they are saved - one
 * definition for our team's screens and the partner portal alike, so a line
 * our side accepts is a line the portal accepts. The database checks again,
 * and works every total out itself.
 */

const amount = z.preprocess(
  (v) => (v === "" || v == null ? 0 : v),
  z.coerce.number().finite().min(0, "Amounts cannot be negative."),
);

export const pricedLineSchema = z.object({
  /** The saved deal line this edits. Quotes replace their lines, so they send none. */
  id: z.string().uuid().optional().nullable(),
  productId: z.string().uuid("Choose a product or service on every line."),
  priceBookEntryId: z.string().uuid().optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  quantity: amount,
  unitPrice: amount,
  licenseCost: amount,
  maintenanceCost: amount,
  cloudCost: amount,
  aiCost: amount,
  discountPercent: z.preprocess(
    (v) => (v === "" || v == null ? 0 : v),
    z.coerce.number().min(0).max(100, "A discount cannot be more than 100%."),
  ),
  taxRateId: z.string().uuid().optional().nullable().or(z.literal("")),
});

export type PricedLineInput = z.infer<typeof pricedLineSchema>;

export const dealLinesSchema = z.object({
  opportunityId: z.string().uuid(),
  priceBookId: z.string().uuid().optional().nullable().or(z.literal("")),
  lines: z.array(pricedLineSchema),
});

export type DealLinesInput = z.infer<typeof dealLinesSchema>;

export const quoteInputSchema = z.object({
  opportunityId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  quoteDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  currencyCode: z.string().length(3).default("PKR"),
  priceBookId: z.string().uuid().optional().nullable().or(z.literal("")),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  lines: z.array(pricedLineSchema).min(1, "A quote needs at least one line."),
});

export type QuoteInput = z.infer<typeof quoteInputSchema>;

/** A line as the database functions take it: blanks as nulls, no deal-line id on a quote. */
export function lineForSave(l: PricedLineInput, keepId: boolean) {
  return {
    ...(keepId ? { id: l.id ?? null } : {}),
    productId: l.productId,
    priceBookEntryId: l.priceBookEntryId ?? null,
    description: l.description?.trim() || null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    licenseCost: l.licenseCost,
    maintenanceCost: l.maintenanceCost,
    cloudCost: l.cloudCost,
    aiCost: l.aiCost,
    discountPercent: l.discountPercent,
    taxRateId: l.taxRateId || null,
  };
}
