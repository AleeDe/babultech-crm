import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What commission is paid on: the amount the customer pays, tax included.
 *
 * The deal amount at Close Won already includes tax - it is the sum of the
 * line totals. The invoice and payment triggers used to take the tax back out,
 * so the same deal earned a partner less on a plan that pays on invoice or on
 * payment than on one that pays at Close Won. All three now pay on the same,
 * tax-inclusive amount.
 */

const mocks = vi.hoisted(() => ({ server: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

import {
  accrueForInvoice,
  accrueForPayment,
  accrueForWonOpportunity,
} from "@/server/commission-engine";

// A deal of 100,000 plus 15% tax: the customer pays 115,000.
const TOTAL = "115000.00";
const TAX = "15000.00";

/** One partner on the deal, 100% share, paid their own 10% rate. */
const dealWithPartner = (trigger: string) => ({
  id: "opp-1",
  partners: [
    {
      id: "link-1",
      partnerId: "partner-1",
      revenueSharePercent: 100,
      commissionPercentOverride: null,
      registeredAt: null,
      registrationExpiresAt: null,
      commissionPlanId: "plan-1",
      partner: {
        displayName: "Test Partner",
        status: "ACTIVE",
        defaultCommissionPercent: 10,
        withholdingTaxPercent: null,
        commissionPlan: null,
      },
      commissionPlan: {
        id: "plan-1",
        name: "Standard",
        basis: "OPPORTUNITY_AMOUNT",
        trigger,
        rateType: "FLAT_PERCENT",
        flatPercent: null,
        fixedAmount: null,
        minimumDealAmount: null,
        maximumPayout: null,
        payoutDelayDays: 0,
        active: true,
        tiers: [],
      },
    },
  ],
});

const invoice = {
  id: "inv-1",
  totalAmount: TOTAL,
  taxAmount: TAX,
  currencyCode: "PKR",
  invoiceDate: "2026-09-26",
  project: { opportunityId: "opp-1" },
  contract: null,
};

/**
 * Just enough of the Supabase client for the engine: each table answers
 * .select().eq().single() / .maybeSingle(), and rpc() records what the engine
 * asked the database to store.
 */
function fakeDb(rows: { single: Record<string, unknown>; maybeSingle: Record<string, unknown> }) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: rows.single[table] ?? null, error: null }),
          maybeSingle: async () => ({ data: rows.maybeSingle[table] ?? null, error: null }),
        }),
      }),
    }),
    rpc: mocks.rpc,
  };
}

const stored = () => mocks.rpc.mock.calls[0][1] as Record<string, string>;

describe("commission is paid on the amount including tax", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: { id: "c-1", commissionNumber: "COM-1" }, error: null });
  });

  it("at Close Won, on the deal amount", async () => {
    mocks.server.mockResolvedValue(
      fakeDb({
        single: { opportunity: { amount: TOTAL, currencyCode: "PKR", actualCloseDate: "2026-09-26" } },
        maybeSingle: { opportunity: dealWithPartner("ON_CLOSE_WON") },
      }),
    );
    await accrueForWonOpportunity("opp-1", "user-1");
    expect(stored().p_basis_amount).toBe(TOTAL);
    expect(stored().p_commission_amount).toBe("11500.00");
  });

  it("when an invoice is sent, on the invoice total", async () => {
    mocks.server.mockResolvedValue(
      fakeDb({
        single: { invoice },
        maybeSingle: { opportunity: dealWithPartner("ON_INVOICE_SENT") },
      }),
    );
    await accrueForInvoice("inv-1", "user-1");
    expect(stored().p_basis_amount).toBe(TOTAL);
    expect(stored().p_commission_amount).toBe("11500.00");
  });

  it("when a payment clears, on everything it paid", async () => {
    // Half the invoice paid: 57,500 of the 115,000, tax and all.
    mocks.server.mockResolvedValue(
      fakeDb({
        single: {
          payment: {
            id: "pay-1",
            status: "CLEARED",
            currencyCode: "PKR",
            paymentDate: "2026-09-26",
            allocations: [{ allocatedAmount: "57500.00", invoice }],
          },
        },
        maybeSingle: { opportunity: dealWithPartner("ON_PAYMENT_RECEIVED") },
      }),
    );
    await accrueForPayment("pay-1", "user-1");
    expect(stored().p_basis_amount).toBe("57500.00");
    expect(stored().p_commission_amount).toBe("5750.00");
  });
});
