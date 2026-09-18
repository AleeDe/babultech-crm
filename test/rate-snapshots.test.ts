import { beforeEach, describe, expect, it, vi } from "vitest";
import { holds } from "@/lib/nav-permissions";
const mocks = vi.hoisted(() => ({ user: vi.fn(), server: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireUser: mocks.user,
  can: (user: { permissions: string[] }, permission: string) => holds(user.permissions, permission),
  PERMISSIONS: { PROJECT_RATES_READ: "project:rates", INVOICE_WRITE: "invoice:write" },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server, supabaseAdmin: mocks.admin }));
import { withRateSnapshots } from "@/lib/rate-snapshots";

describe("rate snapshot boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  function client(data: unknown, error: unknown = null) {
    const query = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data, error }) };
    return { from: vi.fn().mockReturnValue(query), query };
  }
  it("never reads privileged data for a contributor and removes injected rates", async () => {
    mocks.user.mockResolvedValue({ permissions: ["project:read", "project:write"], partnerId: null });
    await expect(withRateSnapshots("time_log", [{ id: "own", costRate: "123" }])).resolves.toEqual([{ id: "own", costRate: null, billingRate: null }]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rechecks row access before reading any financial columns", async () => {
    mocks.user.mockResolvedValue({ permissions: ["project:rates"], partnerId: null });
    const visible = client([{ id: "visible" }]);
    const privileged = client([{ id: "visible", costRate: 5, billingRate: 8 }]);
    mocks.server.mockResolvedValue(visible); mocks.admin.mockReturnValue(privileged);
    const result = await withRateSnapshots("project_member", [{ id: "visible" }, { id: "guessed" }]);
    expect(privileged.query.in).toHaveBeenCalledWith("id", ["visible"]);
    expect(result).toEqual([{ id: "visible", costRate: "5", billingRate: "8" }, { id: "guessed", costRate: null, billingRate: null }]);
  });
  it("billing authority does not expose employee costs", async () => {
    mocks.user.mockResolvedValue({ permissions: ["invoice:write"], partnerId: null });
    mocks.server.mockResolvedValue(client([{ id: "visible" }]));
    mocks.admin.mockReturnValue(client([{ id: "visible", costRate: 5, billingRate: 8 }]));
    await expect(withRateSnapshots("time_log", [{ id: "visible" }], "billing")).resolves.toEqual([{ id: "visible", costRate: null, billingRate: "8" }]);
  });
  it("fails closed on a scope query failure", async () => {
    mocks.user.mockResolvedValue({ permissions: ["*"], partnerId: null });
    mocks.server.mockResolvedValue(client(null, { message: "unavailable" }));
    await expect(withRateSnapshots("time_log", [{ id: "id" }])).rejects.toThrow("verify financial record access");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("denies external identities even if a role accidentally carries a wildcard", async () => {
    mocks.user.mockResolvedValue({ permissions: ["*"], partnerId: "external" });
    await expect(withRateSnapshots("time_log", [{ id: "id" }])).resolves.toEqual([{ id: "id", costRate: null, billingRate: null }]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
