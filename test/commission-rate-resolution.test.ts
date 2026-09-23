import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateCommission } from "@/server/commission-engine";

/**
 * What rate a partner is actually paid.
 *
 * The order is: a per-deal override beats the plan, the plan beats the
 * partner's default, and the partner's default is what applies when nothing
 * else says otherwise.
 *
 * The case worth the most care is a plan that sets WHEN commission is earned
 * but carries no rate of its own. Every partner here negotiates their own
 * percentage, so that is the useful shape of plan - and it used to pay nothing
 * at all, because a null rate was read as 0%. A commission of zero looks very
 * like a commission not yet earned, so nobody would have noticed until a
 * partner asked where their money was.
 */

const plan = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Standard - on payment received",
  basis: "OPPORTUNITY_AMOUNT",
  trigger: "ON_PAYMENT_RECEIVED",
  rateType: "FLAT_PERCENT",
  flatPercent: null,
  fixedAmount: null,
  minimumDealAmount: null,
  maximumPayout: null,
  payoutDelayDays: 0,
  active: true,
  tiers: [],
  ...over,
}) as never;

const base = {
  grossAmount: 800_000,
  revenueSharePercent: 100,
  basis: "OPPORTUNITY_AMOUNT" as never,
  partnerDefaultPercent: 25,
};

const amount = (r: { commissionAmount: Decimal }) => r.commissionAmount.toNumber();

describe("a plan with no rate of its own", () => {
  it("pays the partner's agreed rate, not zero", () => {
    const r = calculateCommission({ ...base, plan: plan() });
    expect(amount(r)).toBe(200_000);
    expect(r.ratePercent?.toNumber()).toBe(25);
  });

  it("says in the notes why that rate was used", () => {
    const r = calculateCommission({ ...base, plan: plan() });
    expect(r.notes).toMatch(/no rate, so the partner default/i);
  });

  it("does the same when the plan is tiered but has no tiers", () => {
    const r = calculateCommission({
      ...base,
      plan: plan({ rateType: "TIERED_PERCENT", tiers: [] }),
    });
    expect(amount(r)).toBe(200_000);
  });

  it("does the same when the plan is fixed-amount but names no amount", () => {
    const r = calculateCommission({
      ...base,
      plan: plan({ rateType: "FIXED_AMOUNT", fixedAmount: null }),
    });
    expect(amount(r)).toBe(200_000);
  });
});

describe("a plan that does carry a rate", () => {
  it("overrules the partner default", () => {
    const r = calculateCommission({ ...base, plan: plan({ flatPercent: 10 }) });
    expect(amount(r)).toBe(80_000);
  });

  it("still pays zero when the rate really is zero", () => {
    const r = calculateCommission({ ...base, plan: plan({ flatPercent: 0 }) });
    expect(amount(r)).toBe(0);
  });
});

describe("the rest of the order", () => {
  it("lets a per-deal override beat the plan", () => {
    const r = calculateCommission({
      ...base,
      plan: plan({ flatPercent: 10 }),
      overridePercent: 30,
    });
    expect(amount(r)).toBe(240_000);
  });

  it("uses the partner default when there is no plan at all", () => {
    const r = calculateCommission({ ...base, plan: null });
    expect(amount(r)).toBe(200_000);
    expect(r.notes).toMatch(/no plan assigned/i);
  });

  it("applies withholding to whatever rate won", () => {
    const r = calculateCommission({
      ...base,
      plan: plan(),
      withholdingTaxPercent: 10,
    });
    expect(amount(r)).toBe(200_000);
    expect(r.withholdingTaxAmount.toNumber()).toBe(20_000);
    expect(r.netPayableAmount.toNumber()).toBe(180_000);
  });
});
