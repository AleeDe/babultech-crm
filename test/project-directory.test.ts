import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  server: vi.fn(),
  admin: vi.fn(() => { throw new Error("Directory must not bypass database privileges"); }),
}));
vi.mock("@/lib/authz", () => ({
  requirePermission: mocks.permission,
  PERMISSIONS: { PROJECT_READ: "project:read" },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server, supabaseAdmin: mocks.admin }));

import { getProjectPeople } from "@/server/project-directory";

describe("project assignment directory", () => {
  beforeEach(() => vi.clearAllMocks());

  function database(result: { data: unknown; error: unknown }) {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue(result),
    };
    mocks.server.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
    return query;
  }

  it("returns only active staff identity, even if a provider returns extra fields", async () => {
    const query = database({ data: [{ id: "person", fullName: "Person", jobTitle: "Designer", costRate: 999, defaultBillingRate: 1000, email: "private@example.com" }], error: null });
    await expect(getProjectPeople()).resolves.toEqual([{ id: "person", fullName: "Person", jobTitle: "Designer" }]);
    expect(mocks.permission).toHaveBeenCalledWith("project:read");
    expect(query.select).toHaveBeenCalledWith("id, fullName, jobTitle");
    expect(query.eq).toHaveBeenCalledWith("status", "ACTIVE");
    expect(query.is).toHaveBeenCalledWith("deletedAt", null);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("does not query staff when authorization fails", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(getProjectPeople()).rejects.toThrow("Forbidden");
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("reports query failure instead of pretending the directory is empty", async () => {
    database({ data: null, error: { message: "permission denied" } });
    await expect(getProjectPeople()).rejects.toThrow("Could not load project people");
  });
});
