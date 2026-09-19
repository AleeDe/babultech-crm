import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizeAny: vi.fn(), server: vi.fn(), rpc: vi.fn(), select: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  authorize: mocks.authorize,
  authorizeAny: mocks.authorizeAny,
  canAny: vi.fn(() => true),
  requirePermission: vi.fn(),
  can: vi.fn(() => true),
  PERMISSIONS: {
    INVOICE_READ: "invoice:read", INVOICE_WRITE: "invoice:write",
    INVOICE_APPROVE: "invoice:approve", PERIOD_CLOSE: "period:close",
  },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));

import { runRecurringBilling, closePeriod, reopenPeriod } from "@/server/recurring-billing";

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: "c1", contractNumber: "CTR-1", name: "Retainer", accountId: "a1",
  startDate: "2026-01-01", endDate: "2026-12-31", contractValue: 1200,
  currencyCode: "PKR", billingFrequency: "MONTHLY", invoices: [], ...overrides,
});

function contractsReturning(rows: unknown[]) {
  // The query chain ends in a thenable, so the builder resolves to the rows.
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

describe("recurring billing run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:00:00Z"));
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "finance" } });
    mocks.rpc.mockResolvedValue({ data: { id: "inv" }, error: null });
    mocks.select.mockReturnValue(contractsReturning([contract()]));
    mocks.server.mockResolvedValue({ from: () => mocks.select(), rpc: mocks.rpc });
  });

  it("checks the drafting permission before reading anything", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Not allowed." });
    const result = await runRecurringBilling();
    expect(result.ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("raises one draft per period that has started", async () => {
    const result = await runRecurringBilling();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.created).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it("raises drafts, never issued invoices", async () => {
    await runRecurringBilling();
    for (const call of mocks.rpc.mock.calls) {
      expect(call[1].p_payload.status).toBe("DRAFT");
    }
  });

  it("records the period each invoice covers", async () => {
    await runRecurringBilling();
    const periods = mocks.rpc.mock.calls.map((c) => c[1].p_payload.periodStart);
    expect(periods).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("does not bill a period that already has a live invoice", async () => {
    mocks.select.mockReturnValue(contractsReturning([
      contract({ invoices: [{ periodStart: "2026-01-01", status: "SENT", deletedAt: null }] }),
    ]));
    const result = await runRecurringBilling();
    if (result.ok) expect(result.data.created).toBe(2);
  });

  it("bills a period again once its invoice is cancelled", async () => {
    mocks.select.mockReturnValue(contractsReturning([
      contract({ invoices: [{ periodStart: "2026-01-01", status: "CANCELLED", deletedAt: null }] }),
    ]));
    const result = await runRecurringBilling();
    if (result.ok) expect(result.data.created).toBe(3);
  });

  it("ignores a soft-deleted invoice when deciding what is billed", async () => {
    mocks.select.mockReturnValue(contractsReturning([
      contract({ invoices: [{ periodStart: "2026-01-01", status: "SENT", deletedAt: "2026-02-01" }] }),
    ]));
    const result = await runRecurringBilling();
    if (result.ok) expect(result.data.created).toBe(3);
  });

  it("splits the contract value across its periods", async () => {
    await runRecurringBilling();
    expect(mocks.rpc.mock.calls[0][1].p_payload.totalAmount).toBe("100.00");
  });

  it("skips a contract with no workable amount instead of raising a zero invoice", async () => {
    mocks.select.mockReturnValue(contractsReturning([contract({ contractValue: 0 })]));
    const result = await runRecurringBilling();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(0);
      expect(result.data.skipped[0]).toContain("CTR-1");
    }
  });

  it("reports a period another run already billed without failing the rest", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ error: { message: 'duplicate key value violates unique constraint "invoice_contract_period"' } })
      .mockResolvedValue({ data: { id: "inv" }, error: null });
    const result = await runRecurringBilling();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(2);
      expect(result.data.skipped[0]).toContain("already billed");
    }
  });

  it("says so plainly when a period falls in a closed month", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "That month is closed. Raise this invoice in an open month." } });
    const result = await runRecurringBilling();
    if (result.ok) expect(result.data.skipped[0]).toContain("that month is closed");
  });
});

describe("closing and reopening a period", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "approver" } });
    mocks.authorizeAny.mockResolvedValue({ ok: true, user: { id: "approver" } });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("needs period-closing authority to close", async () => {
    mocks.authorizeAny.mockResolvedValue({ ok: false, error: "Not allowed." });
    expect((await closePeriod({ periodStart: "2026-01-01", note: "Closed" })).ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("needs period-closing authority to reopen", async () => {
    mocks.authorizeAny.mockResolvedValue({ ok: false, error: "Not allowed." });
    expect((await reopenPeriod({ periodStart: "2026-01-01", note: "Reopened" })).ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("refuses a period that is not the first of a month", async () => {
    const result = await closePeriod({ periodStart: "2026-01-17", note: "Half a month" });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const result = await closePeriod({ periodStart: "2026-01-01", note: "   " });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts either period:close or the coarse invoice:approve", async () => {
    await closePeriod({ periodStart: "2026-01-01", note: "Books signed off" });
    expect(mocks.authorizeAny).toHaveBeenCalledWith("period:close", "invoice:approve");
  });

  it("passes the month and note through to the database", async () => {
    await closePeriod({ periodStart: "2026-01-01", note: "Books signed off" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("close_accounting_period", {
      p_period: "2026-01-01", p_note: "Books signed off",
    });
  });

  it("explains a refusal from the database without leaking its wording", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "internal detail" } });
    const result = await closePeriod({ periodStart: "2026-01-01", note: "Books signed off" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("internal detail");
  });
});
