import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), requirePermission: vi.fn(), server: vi.fn(), rpc: vi.fn(), select: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  authorize: mocks.authorize,
  requirePermission: mocks.requirePermission,
  can: vi.fn(() => true),
  PERMISSIONS: {
    ACCOUNT_READ: "account:read", OPPORTUNITY_WRITE: "opportunity:write",
    INVOICE_WRITE: "invoice:write",
  },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));

import { saveSubscription, changeQuantity, changeStatus, runSubscriptionBilling } from "@/server/subscriptions";

const plan = { id: "11111111-1111-4111-8111-111111111111", name: "Pro Monthly", billingType: "MONTHLY", unitOfMeasure: "user" };
const uuid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;

const agreement = (overrides: Record<string, unknown> = {}) => ({
  accountId: uuid("a"), productId: uuid("b"), plan, quantity: 10, unitPrice: 500,
  currencyCode: "PKR", billingFrequency: "MONTHLY", startDate: "2026-01-01",
  endDate: null, autoRenew: true, notes: null, ...overrides,
});

/** A query builder that resolves to the rows it is given. */
function returning(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

const subscriptionRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuid("c"), subscriptionNumber: "SUB-2026-00001", accountId: uuid("a"), productId: uuid("b"),
  plan, quantity: 10, unitPrice: 500, currencyCode: "PKR", billingFrequency: "MONTHLY",
  startDate: "2026-01-01", endDate: null, status: "ACTIVE", billedThrough: null,
  product: { name: "BabulPOS" }, changes: [], ...overrides,
});

describe("saving an agreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "sales" } });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("checks commercial authority before touching the database", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Not allowed." });
    const result = await saveSubscription(null, agreement());
    expect(result.ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("validates before sending anything", async () => {
    const result = await saveSubscription(null, agreement({ quantity: 0 }));
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends the agreed plan as a snapshot, not a reference", async () => {
    await saveSubscription(null, agreement());
    expect(mocks.rpc.mock.calls[0][1].p_plan).toEqual(plan);
  });

  it("explains that a live agreement cannot be edited", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "22023", message: "Only a draft subscription can be edited" } });
    const result = await saveSubscription(uuid("c"), agreement());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("quantity change");
  });

  it("does not leak the database's wording on an unexpected failure", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "XX000", message: "internal constraint detail" } });
    const result = await saveSubscription(null, agreement());
    expect(JSON.stringify(result)).not.toContain("internal constraint detail");
  });
});

describe("changing quantity and status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "sales" } });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("requires a reason for a quantity change", async () => {
    const result = await changeQuantity({ subscriptionId: uuid("c"), quantity: 15, effectiveFrom: "2026-03-01", reason: "  " });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("says plainly when the period is already invoiced", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "22023", message: "That period has already been invoiced" } });
    const result = await changeQuantity({ subscriptionId: uuid("c"), quantity: 15, effectiveFrom: "2026-01-01", reason: "More users" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("later date");
  });

  it("requires a reason for a status change", async () => {
    const result = await changeStatus({ subscriptionId: uuid("c"), status: "PAUSED", reason: "" });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a status that is not one of ours", async () => {
    const result = await changeStatus({ subscriptionId: uuid("c"), status: "ARCHIVED", reason: "Tidying up" });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("the subscription billing run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:00:00Z"));
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "finance" } });
    mocks.rpc.mockResolvedValue({ data: { id: "inv" }, error: null });
    mocks.select.mockReturnValue(returning([subscriptionRow()]));
    mocks.server.mockResolvedValue({ from: () => mocks.select(), rpc: mocks.rpc });
  });

  it("checks drafting authority before reading anything", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Not allowed." });
    const result = await runSubscriptionBilling();
    expect(result.ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("raises one draft per period that has started", async () => {
    const result = await runSubscriptionBilling();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.created).toBe(3);
  });

  it("raises drafts, never issued invoices", async () => {
    await runSubscriptionBilling();
    const creates = mocks.rpc.mock.calls.filter((c) => c[0] === "create_with_lines");
    expect(creates).toHaveLength(3);
    for (const call of creates) expect(call[1].p_payload.status).toBe("DRAFT");
  });

  it("bills the quantity in force when the period started, not today's", async () => {
    // Ten users until March, fifteen from March. January and February must
    // still bill ten - that is the whole-period decision.
    mocks.select.mockReturnValue(returning([
      subscriptionRow({ changes: [{ quantity: 15, effectiveFrom: "2026-03-01" }] }),
    ]));
    await runSubscriptionBilling();
    const lines = mocks.rpc.mock.calls
      .filter((c) => c[0] === "create_with_lines")
      .map((c) => c[1].p_lines[0].quantity);
    expect(lines).toEqual([10, 10, 15]);
  });

  it("skips periods already billed", async () => {
    mocks.select.mockReturnValue(returning([subscriptionRow({ billedThrough: "2026-02-01" })]));
    const result = await runSubscriptionBilling();
    if (result.ok) expect(result.data.created).toBe(1);
  });

  it("marks each period billed only after its invoice exists", async () => {
    await runSubscriptionBilling();
    const order = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(order[0]).toBe("create_with_lines");
    expect(order[1]).toBe("mark_subscription_billed");
  });

  it("does not claim a period was billed when marking fails", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === "mark_subscription_billed"
        ? { error: { message: "no live invoice" } }
        : { data: { id: "inv" }, error: null }));
    const result = await runSubscriptionBilling();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(0);
      expect(result.data.skipped[0]).toContain("not marked billed");
    }
  });

  it("reports a period another run already billed without failing the rest", async () => {
    let first = true;
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "create_with_lines" && first) {
        first = false;
        return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "invoice_subscription_period"' } });
      }
      return Promise.resolve({ data: { id: "inv" }, error: null });
    });
    const result = await runSubscriptionBilling();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(2);
      expect(result.data.skipped[0]).toContain("already billed");
    }
  });

  it("says so plainly when a period falls in a closed month", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === "create_with_lines"
        ? { error: { message: "That month is closed. Raise this invoice in an open month." } }
        : { data: null, error: null }));
    const result = await runSubscriptionBilling();
    if (result.ok) expect(result.data.skipped[0]).toContain("that month is closed");
  });

  it("bills nothing for a paused agreement", async () => {
    mocks.select.mockReturnValue(returning([subscriptionRow({ status: "PAUSED" })]));
    const result = await runSubscriptionBilling();
    if (result.ok) expect(result.data.created).toBe(0);
  });

  it("carries the plan snapshot onto the invoice line", async () => {
    await runSubscriptionBilling();
    const line = mocks.rpc.mock.calls.find((c) => c[0] === "create_with_lines")![1].p_lines[0];
    expect(line.productPlan).toEqual(plan);
  });
});
