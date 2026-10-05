import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), server: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requirePermission: mocks.permission, PERMISSIONS: { ADMIN: "admin" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { changeUserTeam, createUserTeam, getUserTeams } from "@/server/user-teams";
it("requires admin before reading or changing any teams", async () => {
  mocks.permission.mockRejectedValue(new Error("Forbidden"));
  await expect(getUserTeams("bad")).rejects.toThrow("Forbidden");
  await expect(changeUserTeam({ userId: "bad", teamId: "bad", operation: "add" })).rejects.toThrow("Forbidden");
  await expect(createUserTeam({ name: "Team", teamType: "PROJECT" })).rejects.toThrow("Forbidden");
  expect(mocks.server).not.toHaveBeenCalled();
});
it("rejects invalid identifiers and malformed team types before database access", async () => {
  mocks.permission.mockResolvedValue({});
  expect((await changeUserTeam({ userId: "bad", teamId: "bad", operation: "add" })).error).toBeTruthy();
  // Team types are an editable list (Settings › Team type), so only the shape
  // of a code is checked here; the list itself is checked in the database.
  expect((await createUserTeam({ name: "Team", teamType: "not a type!" })).error).toBeTruthy();
  expect(mocks.server).not.toHaveBeenCalled();
});
it("refuses a team type that is not on the list", async () => {
  mocks.permission.mockResolvedValue({});
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) };
  mocks.server.mockResolvedValue({ from: () => chain });
  expect((await createUserTeam({ name: "Team", teamType: "ADMIN" })).error).toMatch(/team type from the list/);
});
