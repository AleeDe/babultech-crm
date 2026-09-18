import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), server: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize: mocks.authorize, requirePermission: vi.fn(), PERMISSIONS: { LEAD_WRITE: "lead:write" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { requestHandoff, decideHandoff } from "@/server/lead-handoffs";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
describe("handoff action boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ ok: true }); mocks.server.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: id, error: null }); });
  it("denies unauthorized requests and decisions before opening the database", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Denied" });
    expect((await requestHandoff({})).ok).toBe(false);
    expect((await decideHandoff({})).ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it("rejects incomplete qualification before RPC", async () => {
    expect((await requestHandoff({ id })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("never passes client-provided actor or ownership to a decision", async () => {
    const result = await decideHandoff({ id, decision: "REJECTED", reason: " Missing context ", followUpAt: null, actorId: "fake", ownerUserId: "fake" });
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("decide_lead_handoff", { p_id: id, p_decision: "REJECTED", p_reason: "Missing context", p_follow_up: null });
  });
  it("does not expose internal database errors", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "private database detail" } });
    const result = await decideHandoff({ id, decision: "CANCELLED", reason: "Correcting brief", followUpAt: null });
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("private database detail");
  });
});
