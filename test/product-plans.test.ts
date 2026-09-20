import { describe, expect, it } from "vitest";
import { commercialPlanSchema, planDescription } from "@/lib/product-plans";

/**
 * A line keeps a snapshot of the priced offer it was sold on.
 *
 * Price books replaced the product's pricing plans, but rows sold under the old
 * scheme still carry a plan snapshot with a billing type and a unit, so both
 * shapes have to survive a round trip and read sensibly.
 */

const book = { id: "11111111-1111-4111-8111-111111111111", name: "Standard" };
const legacyPlan = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Basic",
  billingType: "MONTHLY",
  unitOfMeasure: "Licence",
};

describe("the offer a line was sold on", () => {
  it("accepts a price book, which has no billing period of its own", () => {
    const snapshot = commercialPlanSchema.parse(book);
    expect(snapshot.name).toBe("Standard");
    expect(planDescription("BabulPOS", snapshot)).toBe("BabulPOS — Standard");
  });

  it("still reads a plan snapshotted before price books existed", () => {
    const snapshot = commercialPlanSchema.parse(legacyPlan);
    expect(planDescription("BabulPOS", snapshot)).toBe("BabulPOS — Basic (per licence, per month)");
  });

  it("never carries internal cost or price onto a line", () => {
    const snapshot = commercialPlanSchema.parse({ ...legacyPlan, standardPrice: "3000", standardCost: "800" });
    expect(snapshot).not.toHaveProperty("standardPrice");
    expect(snapshot).not.toHaveProperty("standardCost");
  });

  it("rejects a snapshot with no identity or no name", () => {
    expect(commercialPlanSchema.safeParse({ id: "not-a-uuid", name: "Standard" }).success).toBe(false);
    expect(commercialPlanSchema.safeParse({ id: book.id, name: "" }).success).toBe(false);
  });
});
