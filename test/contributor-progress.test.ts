import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), server: vi.fn(), update: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
vi.mock("@/lib/db", () => ({ updateRecord: mocks.update }));
import { updateMyTaskProgress } from "@/server/my-work";

describe("contributor task progress remains available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "me", permissions: ["project:read", "project:write"] });
    mocks.update.mockResolvedValue({});
  });

  function task(assignedUserId: string) {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "task", projectId: "project", assignedUserId } }) };
    mocks.server.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
  }

  it("can complete their assigned task without project administration permission", async () => {
    task("me");
    await expect(updateMyTaskProgress("task", { status: "COMPLETED", completionPercent: 80 })).resolves.toEqual({ ok: true, data: { id: "task" } });
    expect(mocks.update).toHaveBeenCalledWith("project_task", "task", expect.objectContaining({ status: "COMPLETED", completionPercent: 100 }), "ProjectTask", "me");
  });

  it("cannot use personal progress to update a colleague's task", async () => {
    task("colleague");
    const result = await updateMyTaskProgress("task", { status: "COMPLETED", completionPercent: 100 });
    expect(result.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
