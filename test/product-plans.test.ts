import { describe, expect, it } from "vitest";
import { productPlansSchema, commercialPlanSchema, planDescription } from "@/lib/product-plans";

const fixed = { id: "11111111-1111-4111-8111-111111111111", name: "Lifetime", billingType: "FIXED", unitOfMeasure: "Licence", standardPrice: "100000", standardCost: "20000" };
const monthly = { ...fixed, id: "22222222-2222-4222-8222-222222222222", name: "Basic", billingType: "MONTHLY", standardPrice: "3000", standardCost: "800" };
describe("multiple plans on one product", () => {
  it("accepts one-time and two monthly plans together from form JSON", () => {
    const plans = productPlansSchema.parse(JSON.stringify([fixed, monthly, { ...monthly, id: "33333333-3333-4333-8333-333333333333", name: "Pro", standardPrice: "5000" }]));
    expect(plans.map((p) => p.standardPrice)).toEqual([100000, 3000, 5000]);
    expect(plans.map((p) => p.billingType)).toEqual(["FIXED", "MONTHLY", "MONTHLY"]);
  });
  it("keeps unknown costs and prices distinct from zero", () => {
    const [plan] = productPlansSchema.parse([{ ...fixed, standardPrice: "", standardCost: "" }]);
    expect(plan.standardPrice).toBeNull(); expect(plan.standardCost).toBeNull();
    expect(productPlansSchema.parse([{ ...fixed, standardPrice: 0, standardCost: 0 }])[0].standardPrice).toBe(0);
  });
  it("rejects missing plans, broken JSON, duplicate identities and duplicate names", () => {
    for (const input of [[], "invalid", [fixed, fixed], [fixed, { ...monthly, name: " lifetime " }]]) expect(productPlansSchema.safeParse(input).success).toBe(false);
  });
  it("validates prices and costs for every plan", () => {
    expect(productPlansSchema.safeParse([fixed, { ...monthly, standardPrice: -1 }]).success).toBe(false);
    expect(productPlansSchema.safeParse([fixed, { ...monthly, standardCost: 5000 }]).success).toBe(false);
  });
  it("snapshots the offer without putting internal cost on invoice lines", () => {
    const snapshot = commercialPlanSchema.parse(monthly);
    expect(snapshot).not.toHaveProperty("standardCost");
    expect(snapshot).not.toHaveProperty("standardPrice");
    expect(planDescription("BabulPOS", snapshot)).toBe("BabulPOS — Basic (per licence, per month)");
  });
});
