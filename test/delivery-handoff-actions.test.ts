import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), can: vi.fn(), server: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireUser: mocks.user, requirePermission: vi.fn(), can: mocks.can, PERMISSIONS: { OPPORTUNITY_WRITE: "opportunity:write", PROJECT_MANAGE: "project:manage" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { submitDeliveryHandoff, decideDeliveryHandoff } from "@/server/delivery-handoffs";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
describe("delivery handoff actions", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "me" }); mocks.can.mockReturnValue(true); mocks.server.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: id, error: null }); });
 it("checks sales authority before submission", async () => {
 mocks.can.mockReturnValue(false); expect((await submitDeliveryHandoff({})).ok).toBe(false); expect(mocks.server).not.toHaveBeenCalled();
 });
 it("checks project administration authority for review", async () => {
 mocks.can.mockReturnValue(false); expect((await decideDeliveryHandoff({ id, decision: "RETURNED", reason: "Missing scope", kickoffAt: null })).ok).toBe(false);
 expect(mocks.can).toHaveBeenCalledWith({ id: "me" }, "project:manage"); expect(mocks.server).not.toHaveBeenCalled();
 });
 it("does not pass a client-supplied reviewer identity to SQL", async () => {
 await decideDeliveryHandoff({ id, decision: "RETURNED", reason: " Missing scope ", kickoffAt: null, actorId: "fake" });
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("decide_delivery_handoff", { p_id: id, p_decision: "RETURNED", p_reason: "Missing scope", p_kickoff: null });
 });
 it("reports a failed database review without exposing internal details", async () => {
 mocks.rpc.mockResolvedValue({ error: { message: "private details" } });
 const result = await decideDeliveryHandoff({ id, decision: "RETURNED", reason: "Missing scope", kickoffAt: null });
 expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("private details");
 });
});
