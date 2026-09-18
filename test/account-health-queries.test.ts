import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), server: vi.fn(), from: vi.fn() }));

vi.mock("@/lib/authz", () => ({
  requirePermission: mocks.requirePermission,
  can: vi.fn(() => true),
  PERMISSIONS: { ACCOUNT_READ: "account:read", OPPORTUNITY_READ: "opportunity:read" },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));

import { getRenewalQueue, getAccountHealth } from "@/server/account-health";

/** A PostgREST-shaped query builder that resolves to the rows it was given. */
function builder(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit", "lt", "gt", "not"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return chain;
}

const TODAY = "2026-06-15";

const contractRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c1", contractNumber: "CTR-1", name: "Retainer", accountId: "a1",
  endDate: "2026-07-01", renewalType: "MANUAL", noticePeriodDays: 30,
  contractValue: 12000, currencyCode: "PKR",
  account: { name: "Shop", ownerUserId: "u1", owner: { fullName: "Ayesha", status: "ACTIVE" } },
  ...overrides,
});

describe("renewal queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
    mocks.requirePermission.mockResolvedValue({ id: "me" });
  });

  it("checks the caller may read contracts before querying", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));
    mocks.server.mockResolvedValue({ from: () => builder([]) });
    await expect(getRenewalQueue()).rejects.toThrow();
  });

  it("names the account manager on each row", async () => {
    mocks.server.mockResolvedValue({ from: () => builder([contractRow()]) });
    const { rows } = await getRenewalQueue(90);
    expect(rows[0].ownerName).toBe("Ayesha");
  });

  it("treats a deactivated owner as nobody, so the gap is visible", async () => {
    mocks.server.mockResolvedValue({
      from: () => builder([contractRow({
        account: { name: "Shop", ownerUserId: "u1", owner: { fullName: "Ayesha", status: "INACTIVE" } },
      })]),
    });
    const { rows } = await getRenewalQueue(90);
    expect(rows[0].ownerName).toBeNull();
    expect(rows[0].ownerUserId).toBe("u1");
  });

  it("keeps a contract that already lapsed, and puts it first", async () => {
    mocks.server.mockResolvedValue({
      from: () => builder([
        contractRow({ id: "soon", endDate: "2026-07-01" }),
        contractRow({ id: "lapsed", endDate: "2026-05-01" }),
      ]),
    });
    const { rows } = await getRenewalQueue(90);
    expect(rows[0].contractId).toBe("lapsed");
  });

  it("leaves out contracts beyond the chosen window", async () => {
    mocks.server.mockResolvedValue({
      from: () => builder([
        contractRow({ id: "near", endDate: "2026-07-01" }),
        contractRow({ id: "far", endDate: "2026-12-01" }),
      ]),
    });
    const { rows } = await getRenewalQueue(30);
    expect(rows.map((r) => r.contractId)).toEqual(["near"]);
  });

  it("survives a contract whose account embed is missing", async () => {
    mocks.server.mockResolvedValue({ from: () => builder([contractRow({ account: null })]) });
    const { rows } = await getRenewalQueue(90);
    expect(rows[0].accountName).toBe("Unknown account");
  });

  it("does not leak the database's wording when the query fails", async () => {
    const failing = builder([]);
    failing.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: null, error: { message: "relation does not exist" } });
    mocks.server.mockResolvedValue({ from: () => failing });
    await expect(getRenewalQueue()).rejects.toThrow(/Could not load the renewal queue/);
  });
});

describe("account health", () => {
  const account = {
    id: "a1", name: "Shop", ownerUserId: "u1", customerStatus: "ACTIVE",
    customerHealth: "GREEN", createdAt: "2026-01-01T00:00:00Z",
    owner: { fullName: "Ayesha", status: "ACTIVE" },
  };

  function tables(overrides: Record<string, unknown[]> = {}) {
    const data: Record<string, unknown[]> = {
      account: [account], invoice: [], support_case: [], activity: [], contract: [], ...overrides,
    };
    return { from: (table: string) => builder(data[table] ?? []) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
    mocks.requirePermission.mockResolvedValue({ id: "me" });
  });

  it("checks the caller may read accounts", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));
    mocks.server.mockResolvedValue(tables());
    await expect(getAccountHealth()).rejects.toThrow();
  });

  it("returns nothing without querying further when there are no customers", async () => {
    mocks.server.mockResolvedValue(tables({ account: [] }));
    const { rows, scanned } = await getAccountHealth();
    expect(rows).toEqual([]);
    expect(scanned).toBe(0);
  });

  it("derives health from the records rather than the stored field", async () => {
    mocks.server.mockResolvedValue(tables({
      invoice: [{ accountId: "a1", dueDate: "2026-01-01", outstandingAmount: 5000 }],
      support_case: [{ accountId: "a1", status: "OPEN", slaBreached: true, priority: "HIGH", reopenCount: 0, satisfactionScore: null, closedAt: null }],
      activity: [{ relatedEntityId: "a1", completedAt: `${TODAY}T09:00:00Z`, createdAt: `${TODAY}T09:00:00Z` }],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].derived.status).toBe("RED");
    expect(rows[0].storedHealth).toBe("GREEN");
    expect(rows[0].disagrees).toBe(true);
  });

  it("leaves the stored health untouched", async () => {
    mocks.server.mockResolvedValue(tables({
      invoice: [{ accountId: "a1", dueDate: "2026-01-01", outstandingAmount: 5000 }],
    }));
    const { rows } = await getAccountHealth();
    // Reporting a disagreement, not correcting it.
    expect(rows[0].storedHealth).toBe("GREEN");
  });

  it("ignores cases that are already resolved or closed", async () => {
    mocks.server.mockResolvedValue(tables({
      support_case: [
        { accountId: "a1", status: "CLOSED", slaBreached: true, priority: "HIGH", reopenCount: 0, satisfactionScore: null, closedAt: null },
        { accountId: "a1", status: "RESOLVED", slaBreached: true, priority: "HIGH", reopenCount: 0, satisfactionScore: null, closedAt: null },
      ],
      activity: [{ relatedEntityId: "a1", completedAt: `${TODAY}T09:00:00Z`, createdAt: `${TODAY}T09:00:00Z` }],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].derived.signals.some((s) => s.label === "Missed support commitments")).toBe(false);
  });

  it("uses the most recent activity, whatever order they arrive in", async () => {
    mocks.server.mockResolvedValue(tables({
      activity: [
        { relatedEntityId: "a1", completedAt: null, createdAt: "2026-01-01T09:00:00Z" },
        { relatedEntityId: "a1", completedAt: null, createdAt: `${TODAY}T09:00:00Z` },
      ],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].derived.signals.some((s) => s.label === "No recent contact")).toBe(false);
  });

  it("does not attribute another account's records", async () => {
    mocks.server.mockResolvedValue(tables({
      invoice: [{ accountId: "someone-else", dueDate: "2026-01-01", outstandingAmount: 9000 }],
      activity: [{ relatedEntityId: "a1", completedAt: `${TODAY}T09:00:00Z`, createdAt: `${TODAY}T09:00:00Z` }],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].derived.status).toBe("GREEN");
  });

  it("reports a deactivated account manager as nobody named", async () => {
    mocks.server.mockResolvedValue(tables({
      account: [{ ...account, owner: { fullName: "Ayesha", status: "INACTIVE" } }],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].ownerName).toBeNull();
  });

  it("puts the worst accounts first", async () => {
    mocks.server.mockResolvedValue(tables({
      account: [
        { ...account, id: "fine", name: "Fine" },
        { ...account, id: "bad", name: "Bad" },
      ],
      invoice: [{ accountId: "bad", dueDate: "2026-01-01", outstandingAmount: 9000 }],
      activity: [
        { relatedEntityId: "fine", completedAt: `${TODAY}T09:00:00Z`, createdAt: `${TODAY}T09:00:00Z` },
        { relatedEntityId: "bad", completedAt: `${TODAY}T09:00:00Z`, createdAt: `${TODAY}T09:00:00Z` },
      ],
    }));
    const { rows } = await getAccountHealth();
    expect(rows[0].accountId).toBe("bad");
  });

  it("does not leak the database's wording when the query fails", async () => {
    const failing = builder([]);
    failing.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: null, error: { message: "permission denied for relation account" } });
    mocks.server.mockResolvedValue({ from: () => failing });
    await expect(getAccountHealth()).rejects.toThrow(/Could not load accounts/);
  });
});
