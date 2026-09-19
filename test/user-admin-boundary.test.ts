import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn(), server: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize: mocks.authorize, requirePermission: vi.fn(), requireUser: vi.fn(), PERMISSIONS: { ADMIN: "admin" } }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: mocks.admin, supabaseServer: mocks.server, supabaseAnon: vi.fn() }));
import { createUser, updateUser } from "@/server/users";
beforeEach(() => vi.clearAllMocks());
it("rejects non-admin creation before privileged database access", async () => {
  mocks.authorize.mockResolvedValue({ ok: false, error: "Forbidden" });
  expect(await createUser({} as never)).toEqual({ ok: false, error: "Forbidden" });
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.server).not.toHaveBeenCalled();
});
it("rejects non-admin edits before privileged database access", async () => {
  mocks.authorize.mockResolvedValue({ ok: false, error: "Forbidden" });
  expect(await updateUser("target", {} as never)).toEqual({ ok: false, error: "Forbidden" });
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.server).not.toHaveBeenCalled();
});
it("rejects malformed admin submissions before any write", async () => {
  mocks.authorize.mockResolvedValue({ ok: true, user: { id: "actor" } });
  expect((await createUser({} as never)).ok).toBe(false);
  expect((await updateUser("target", {} as never)).ok).toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.server).not.toHaveBeenCalled();
});

const roleId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const targetId = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const managerId = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const input = { fullName: "Test User", email: "test@example.com", roleId, status: "ACTIVE" as const, password: "ExamplePassword123" };
function queries(results: unknown[]) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn() };
  results.forEach(data => query.maybeSingle.mockResolvedValueOnce({ data, error: null }));
  mocks.server.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
  mocks.authorize.mockResolvedValue({ ok: true, user: { id: "actor" } });
}
it("rejects inactive roles before creating an Auth account", async () => {
  queries([{ name: "Consultant", active: false }]);
  expect((await createUser(input)).ok).toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("rejects inactive or missing departments", async () => {
  queries([{ name: "Consultant", active: true }, null]);
  expect((await createUser({ ...input, departmentId: targetId })).ok).toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("rejects a manager whose reporting line reaches the edited user", async () => {
  queries([{ name: "Consultant", active: true }, { id: managerId, managerUserId: targetId, status: "ACTIVE", deletedAt: null, partnerId: null }]);
  const result = await updateUser(targetId, { ...input, managerUserId: managerId });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("cycle");
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("rejects external managers", async () => {
  queries([{ name: "Consultant", active: true }, { id: managerId, status: "ACTIVE", partnerId: targetId }]);
  expect((await createUser({ ...input, managerUserId: managerId })).ok).toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
});
