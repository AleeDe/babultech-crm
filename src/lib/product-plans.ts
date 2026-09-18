import { z } from "zod";
import { BILLING_OPTIONS, optionKey, priceBasis } from "./product-options";

const amount = z.preprocess((v) => v === "" || v == null ? null : v, z.coerce.number().finite().min(0).nullable());
export const productPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  billingType: z.enum(BILLING_OPTIONS),
  unitOfMeasure: z.string().trim().max(30).nullable(),
  standardPrice: amount,
  standardCost: amount,
}).refine((p) => p.standardPrice == null || p.standardCost == null || p.standardPrice >= p.standardCost,
  "Plan price must not be below its cost.");

export const productPlansSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}, z.array(productPlanSchema).min(1, "Add at least one pricing plan.").max(50)
  .refine((plans) => new Set(plans.map((p) => p.id)).size === plans.length, "Plan IDs must be unique.")
  .refine((plans) => new Set(plans.map((p) => optionKey(p.name))).size === plans.length, "Give each plan a different name."));

export type ProductPlan = z.infer<typeof productPlanSchema>;
export const commercialPlanSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(100),
  billingType: z.enum(BILLING_OPTIONS), unitOfMeasure: z.string().max(30).nullable(),
});
export type CommercialPlan = z.infer<typeof commercialPlanSchema>;

export function planDescription(product: string, plan: CommercialPlan) {
  return `${product} — ${plan.name} (${priceBasis(plan.billingType, plan.unitOfMeasure)})`;
}
