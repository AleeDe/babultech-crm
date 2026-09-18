import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  server: vi.fn(),
  maybeSingle: vi.fn(),
  updateRecord: vi.fn(),
  accrue: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  authorize: mocks.authorize,
  requirePermission: vi.fn(),
  can: vi.fn(() => true),
  PERMISSIONS: { INVOICE_WRITE: "invoice:write", INVOICE_APPROVE: "invoice:approve" },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
vi.mock("@/lib/db", () => ({
  updateRecord: mocks.updateRecord,
  createRecord: vi.fn(),
  LIST_LIMIT: 100,
  applySearch: vi.fn((query: unknown) => query),
}));
vi.mock("@/server/commission-engine", () => ({
  accrueForInvoice: mocks.accrue,
  accrueForPayment: vi.fn(),
}));

import { sendInvoice } from "@/server/billing";

const invoice = (overrides: Record<string, unknown> = {}) => ({
  status: "DRAFT",
  invoiceNumber: "INV-0001",
  milestoneId: null,
  preparedById: "preparer",
  lines: [{ id: "line-1" }],
  milestone: null,
  ...overrides,
});

describe("issuing an invoice needs a second person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "approver" } });
    mocks.updateRecord.mockResolvedValue(undefined);
    mocks.accrue.mockResolvedValue([]);
    mocks.maybeSingle.mockResolvedValue({ data: invoice() });
    mocks.server.mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    });
  });

  it("refuses to let the preparer issue their own invoice", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: invoice({ preparedById: "approver" }) });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(false);
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("names the invoice so the reader knows which one to hand over", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: invoice({ preparedById: "approver", invoiceNumber: "INV-0042" }),
    });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("INV-0042");
  });

  it("lets a different person issue it", async () => {
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(true);
    expect(mocks.updateRecord).toHaveBeenCalled();
  });

  it("still issues an older invoice whose preparer was never recorded", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: invoice({ preparedById: null }) });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(true);
  });

  it("checks the issuing permission before reading anything", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Not allowed." });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("refuses an invoice that has already been issued", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: invoice({ status: "SENT" }) });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(false);
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("refuses an invoice with no lines", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: invoice({ lines: [] }) });
    const result = await sendInvoice("inv-1");
    expect(result.ok).toBe(false);
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });
});
