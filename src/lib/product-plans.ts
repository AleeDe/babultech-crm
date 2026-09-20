import { z } from "zod";
import { priceBasis } from "./product-options";

/**
 * The priced offer a line or a subscription was sold on.
 *
 * Products no longer carry prices: a product's price books do, and a quote
 * line, invoice line or subscription snapshots the one it was sold on. The
 * snapshot is kept rather than referenced so that repricing a book never
 * rewrites what a customer already agreed to.
 *
 * `billingType` and `unitOfMeasure` are optional because a price book has
 * neither; they are still read on rows snapshotted from the pricing plans this
 * replaced, which is why they are kept rather than dropped.
 */
export const commercialPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  billingType: z.string().max(30).nullable().optional(),
  unitOfMeasure: z.string().max(30).nullable().optional(),
});
export type CommercialPlan = z.infer<typeof commercialPlanSchema>;

export function planDescription(product: string, plan: CommercialPlan) {
  const basis = plan.billingType ? ` (${priceBasis(plan.billingType, plan.unitOfMeasure)})` : "";
  return `${product} — ${plan.name}${basis}`;
}
