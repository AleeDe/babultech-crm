import { beforeEach, describe, expect, it, vi } from "vitest";
import { holds } from "@/lib/nav-permissions";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), server: vi.fn(), admin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server, supabaseAdmin: mocks.admin }));
vi.mock("@/lib/authz", () => ({
  authorize: mocks.authorize, requirePermission: vi.fn(),
  PERMISSIONS: { PROJECT_READ: "project:read", PROJECT_WRITE: "project:write", PROJECT_MANAGE: "project:manage" },
}));
vi.mock("@/lib/rich-text", () => ({ sanitizeRichText: (s: string) => s }));

import * as projects from "@/server/projects";

describe("contributor versus project administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Current deployed Consultant permissions. A legacy write grant must not
    // authorize administration even before role migration is deployed.
    mocks.authorize.mockImplementation(async (permission) => holds(["project:read", "project:write"], permission)
      ? { ok: true, user: { id: "contributor" } }
      : { ok: false, error: "Not permitted" });
  });

  const managementActions = [
    "createProject", "updateProject", "createPhase", "deletePhase",
    "createMilestone", "completeMilestone", "createTask", "updateTask",
    "changeTaskStatus", "addProjectMember", "updateProjectMember",
    "removeProjectMember", "createRisk", "createIssue",
  ] as const;

  it.each(managementActions)("denies %s before querying or mutating records", async (name) => {
    const action = projects[name] as (...args: unknown[]) => Promise<unknown>;
    await expect(action("untrusted-id", {})).resolves.toEqual({ ok: false, error: "Not permitted" });
    expect(mocks.authorize).toHaveBeenCalledWith("project:manage");
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("retains manager/admin authority without granting it to read-only or legacy write roles", () => {
    expect(holds(["project:*"], "project:manage")).toBe(true);
    expect(holds(["*"], "project:manage")).toBe(true);
    expect(holds(["project:manage"], "project:manage")).toBe(true);
    expect(holds(["project:read", "project:write"], "project:manage")).toBe(false);
  });
});
