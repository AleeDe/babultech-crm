import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), scope: vi.fn(), server: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requirePermission: mocks.permission, scopeFilter: mocks.scope, PERMISSIONS: { LEAD_READ: "lead:read" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { getLeadQuality } from "@/server/lead-quality";
describe("research queue access and scan completeness", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: "me" }); mocks.scope.mockResolvedValue({ ownerUserId: "me" }); });
  function database() {
    const query = { select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }) };
    mocks.server.mockResolvedValue({ from: vi.fn().mockReturnValue(query) }); return query;
  }
  it("enforces lead permission before fetching data", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(getLeadQuality()).rejects.toThrow("Forbidden"); expect(mocks.server).not.toHaveBeenCalled();
  });
  it("applies owner scope and excludes closed/deleted records", async () => {
    const query = database(); await getLeadQuality();
    expect(query.eq).toHaveBeenCalledWith("ownerUserId", "me");
    expect(query.is).toHaveBeenCalledWith("deletedAt", null);
    expect(query.is).toHaveBeenCalledWith("convertedAt", null);
    expect(query.not).toHaveBeenCalledWith("status", "in", "(CONVERTED,DISQUALIFIED)");
  });
  it("fetches beyond the first list page", async () => {
    const query = database(); query.range.mockResolvedValue({ data: [], count: 501, error: null });
    await getLeadQuality(); expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });
  it("reports a bounded scan as partial instead of a clean audit", async () => {
    const query = database(); query.range.mockResolvedValue({ data: [], count: 6000, error: null });
    const result = await getLeadQuality(); expect(result.truncated).toBe(true); expect(query.range).toHaveBeenCalledTimes(10);
  });
  it("surfaces database errors rather than an empty result", async () => {
    const query = database(); query.range.mockResolvedValue({ data: null, count: 0, error: { message: "denied" } } as never);
    await expect(getLeadQuality()).rejects.toThrow("Could not load");
  });
});
