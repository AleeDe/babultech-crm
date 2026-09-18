import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), server: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requirePermission: mocks.permission, PERMISSIONS: { PROJECT_READ: "project:read" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { mutateContentVersion } from "@/server/content-versions";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
describe("content version action boundary", () => {
 beforeEach(() => {
 vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: "me" });
 const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { projectId: "project" }, error: null }) };
 mocks.server.mockResolvedValue({ from: vi.fn().mockReturnValue(query), rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: id, error: null });
 });
 it("checks project access before any database use", async () => {
 mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
 await expect(mutateContentVersion("version", {})).rejects.toThrow("Forbidden"); expect(mocks.server).not.toHaveBeenCalled();
 });
 it("rejects arbitrary RPC names and malformed versions", async () => {
 expect((await mutateContentVersion("delete_record" as never, {})).ok).toBe(false);
 expect((await mutateContentVersion("version", {})).ok).toBe(false); expect(mocks.server).not.toHaveBeenCalled();
 });
 it("never takes author identity from submitted data", async () => {
 await mutateContentVersion("version", { id, taskId: id, expected: 0, planRevision: 1, copy: " Caption ", assetUrl: null, assetSha: null, createdById: "fake" });
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("add_content_version", { p_id: id, p_task: id, p_expected: 0, p_plan_revision: 1, p_copy: "Caption", p_asset_url: null, p_asset_sha: null });
 });
 it("returns a refresh instruction for optimistic conflicts", async () => {
 mocks.rpc.mockResolvedValue({ error: { code: "40001", message: "internal detail" } });
 const result = await mutateContentVersion("version", { id, taskId: id, expected: 0, planRevision: 1, copy: "Caption", assetUrl: null, assetSha: null });
 expect(result).toEqual({ ok: false, error: "Content or plan changed. Refresh and use a new version." });
 });
});
