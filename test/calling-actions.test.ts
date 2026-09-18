import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), server: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize: mocks.authorize, requirePermission: vi.fn(), PERMISSIONS: { LEAD_WRITE: "lead:write" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { logLeadCall } from "@/server/calling";
describe("call saving boundary", () => {
  const input = () => ({ requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", leadId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", outcome: "CONNECTED", notes: "  Discuss scope  ", followUpAt: new Date(Date.now() + 86400000).toISOString() });
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ ok: true }); mocks.server.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: { id: "saved" }, error: null }); });
  it("denies access before opening a database client", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Denied" });
    expect((await logLeadCall(input())).ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it("rejects incomplete data before RPC", async () => {
    expect((await logLeadCall({ ...input(), notes: " " })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses one atomic RPC with a stable retry ID and no caller-provided owner", async () => {
    const data = input();
    expect((await logLeadCall({ ...data, ownerUserId: "another-user" })).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("log_lead_call", { p_request_id: data.requestId, p_lead_id: data.leadId, p_outcome: "CONNECTED", p_notes: "Discuss scope", p_follow_up: data.followUpAt });
  });
  it("reports ownership changes without exposing database errors", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "private details" } });
    const result = await logLeadCall(input());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private details");
  });
});
