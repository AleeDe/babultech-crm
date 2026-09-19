import { describe, expect, it } from "vitest";
import {
  subscriptionSchema, quantityChangeSchema, periodAmount, periodsDue,
  nextBillingDate, quantityOn, canTransition, transitionError, renewalDays, describe as describeSub,
} from "@/lib/subscriptions";

const plan = { id: "11111111-1111-4111-8111-111111111111", name: "Pro Monthly", billingType: "MONTHLY", unitOfMeasure: "user" };

const sub = (overrides: Record<string, unknown> = {}) => ({
  startDate: "2026-01-01", endDate: null as string | null, billingFrequency: "MONTHLY",
  status: "ACTIVE", quantity: 10, unitPrice: 500, ...overrides,
});

describe("what a period costs", () => {
  it("multiplies the agreed price by the quantity", () => {
    expect(periodAmount({ quantity: 10, unitPrice: 500 })).toBe(5000);
  });

  it("rounds to two decimals rather than carrying fractions", () => {
    expect(periodAmount({ quantity: 3, unitPrice: 33.333 })).toBe(100);
  });

  it("handles a free plan without producing NaN", () => {
    expect(periodAmount({ quantity: 5, unitPrice: 0 })).toBe(0);
  });
});

describe("periods due", () => {
  it("bills each month that has started", () => {
    expect(periodsDue(sub(), "2026-03-15", null).map((p) => p.start))
      .toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("does not bill a period that has not begun", () => {
    expect(periodsDue(sub(), "2026-01-31", null).map((p) => p.start)).toEqual(["2026-01-01"]);
  });

  it("bills a period on the day it starts", () => {
    expect(periodsDue(sub(), "2026-02-01", null).map((p) => p.start))
      .toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("skips periods already billed", () => {
    expect(periodsDue(sub(), "2026-03-15", "2026-02-01").map((p) => p.start)).toEqual(["2026-03-01"]);
  });

  it("returns nothing once everything is billed", () => {
    expect(periodsDue(sub(), "2026-03-15", "2026-03-01")).toEqual([]);
  });

  it("stops at the agreed end date", () => {
    const due = periodsDue(sub({ endDate: "2026-02-20" }), "2026-12-01", null);
    expect(due.map((p) => p.start)).toEqual(["2026-01-01", "2026-02-01"]);
    expect(due.at(-1)?.end).toBe("2026-02-20");
  });

  it("bills nothing while paused", () => {
    expect(periodsDue(sub({ status: "PAUSED" }), "2026-06-01", null)).toEqual([]);
  });

  it("bills nothing for a draft or cancelled agreement", () => {
    expect(periodsDue(sub({ status: "DRAFT" }), "2026-06-01", null)).toEqual([]);
    expect(periodsDue(sub({ status: "CANCELLED" }), "2026-06-01", null)).toEqual([]);
  });

  it("steps by three months when quarterly", () => {
    expect(periodsDue(sub({ billingFrequency: "QUARTERLY" }), "2026-08-01", null).map((p) => p.start))
      .toEqual(["2026-01-01", "2026-04-01", "2026-07-01"]);
  });

  it("clamps to the end of a shorter month instead of skipping it", () => {
    // A subscription starting on the 31st must still bill in February.
    expect(periodsDue(sub({ startDate: "2026-01-31" }), "2026-03-31", null).map((p) => p.start))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("caps how many periods one run can raise", () => {
    expect(periodsDue(sub({ startDate: "2020-01-01" }), "2026-01-01", null, 5)).toHaveLength(5);
  });
});

describe("next billing date", () => {
  it("is the start date before anything is billed", () => {
    expect(nextBillingDate(sub(), null)).toBe("2026-01-01");
  });

  it("moves on once a period is billed", () => {
    expect(nextBillingDate(sub(), "2026-01-01")).toBe("2026-02-01");
  });

  it("is nothing once the agreement has ended", () => {
    expect(nextBillingDate(sub({ endDate: "2026-02-28" }), "2026-02-01")).toBeNull();
  });

  it("is nothing while paused or cancelled", () => {
    expect(nextBillingDate(sub({ status: "PAUSED" }), null)).toBeNull();
    expect(nextBillingDate(sub({ status: "CANCELLED" }), null)).toBeNull();
  });
});

describe("quantity in force", () => {
  const base = { quantity: 10, startDate: "2026-01-01" };

  it("is the agreed quantity when nothing has changed", () => {
    expect(quantityOn(base, [], "2026-03-01")).toBe(10);
  });

  it("ignores a change that has not taken effect yet", () => {
    expect(quantityOn(base, [{ quantity: 15, effectiveFrom: "2026-04-01" }], "2026-03-01")).toBe(10);
  });

  it("applies a change from its effective date", () => {
    expect(quantityOn(base, [{ quantity: 15, effectiveFrom: "2026-03-01" }], "2026-03-01")).toBe(15);
  });

  it("uses the latest change in force, whatever order they arrive in", () => {
    const changes = [
      { quantity: 20, effectiveFrom: "2026-05-01" },
      { quantity: 15, effectiveFrom: "2026-03-01" },
    ];
    expect(quantityOn(base, changes, "2026-04-01")).toBe(15);
    expect(quantityOn(base, changes, "2026-06-01")).toBe(20);
  });

  it("bills the whole period at the quantity in force when it started", () => {
    // The decision this encodes: adding users mid-period does not change that
    // period's bill. 15 January is inside the January period, which bills 10.
    const changes = [{ quantity: 15, effectiveFrom: "2026-01-15" }];
    expect(quantityOn(base, changes, "2026-01-01")).toBe(10);
    expect(quantityOn(base, changes, "2026-02-01")).toBe(15);
  });
});

describe("status transitions", () => {
  it("lets a draft be activated or abandoned", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
  });

  it("lets an active agreement pause, cancel or end", () => {
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransition("ACTIVE", "ENDED")).toBe(true);
  });

  it("lets a paused agreement resume", () => {
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
  });

  it("never restarts a cancelled or ended agreement", () => {
    expect(canTransition("CANCELLED", "ACTIVE")).toBe(false);
    expect(canTransition("ENDED", "ACTIVE")).toBe(false);
  });

  it("does not let a draft skip straight to paused", () => {
    expect(canTransition("DRAFT", "PAUSED")).toBe(false);
  });

  it("explains a refusal in words that say what to do instead", () => {
    expect(transitionError("CANCELLED", "ACTIVE")).toContain("Create a new one");
    expect(transitionError("ACTIVE", "ACTIVE")).toContain("already active");
  });
});

describe("validation", () => {
  const valid = {
    accountId: "11111111-1111-4111-8111-111111111111",
    productId: "22222222-2222-4222-8222-222222222222",
    plan, quantity: 10, unitPrice: 500, currencyCode: "PKR",
    billingFrequency: "MONTHLY", startDate: "2026-01-01", endDate: null,
    autoRenew: true, notes: null,
  };

  it("accepts a complete agreement", () => {
    expect(subscriptionSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an end date before the start", () => {
    const result = subscriptionSchema.safeParse({ ...valid, startDate: "2026-06-01", endDate: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("refuses a quantity below one", () => {
    expect(subscriptionSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
  });

  it("refuses a one-off billing frequency: that is a sale, not a subscription", () => {
    expect(subscriptionSchema.safeParse({ ...valid, billingFrequency: "ONE_TIME" }).success).toBe(false);
  });

  it("allows a free plan, which is a real commercial arrangement", () => {
    expect(subscriptionSchema.safeParse({ ...valid, unitPrice: 0 }).success).toBe(true);
  });

  it("requires a reason for a quantity change", () => {
    const base = { subscriptionId: valid.accountId, quantity: 12, effectiveFrom: "2026-03-01" };
    expect(quantityChangeSchema.safeParse({ ...base, reason: "  " }).success).toBe(false);
    expect(quantityChangeSchema.safeParse({ ...base, reason: "Added two staff" }).success).toBe(true);
  });
});

describe("renewal and description", () => {
  it("counts the days to the end date", () => {
    expect(renewalDays({ endDate: "2026-07-01" }, "2026-06-01")).toBe(30);
    expect(renewalDays({ endDate: "2026-05-01" }, "2026-06-01")).toBe(-31);
  });

  it("has no renewal date when the agreement is open-ended", () => {
    expect(renewalDays({ endDate: null }, "2026-06-01")).toBeNull();
  });

  it("reads as a quantity and a plan", () => {
    expect(describeSub({ quantity: 10, plan, unitPrice: 500, currencyCode: "PKR" }))
      .toBe("10 users × Pro Monthly");
  });

  it("does not pluralise a single unit", () => {
    expect(describeSub({ quantity: 1, plan, unitPrice: 500, currencyCode: "PKR" }))
      .toBe("1 user × Pro Monthly");
  });
});
