import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), server: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requirePermission: mocks.permission, PERMISSIONS: { PROJECT_READ: "project:read" } }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server }));
import { getContentVersions } from "@/server/content-versions";

describe("version history API shapes and boundaries", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: "writer" }); });
 function database(publications: unknown, taskVisible = true, reviewAllowed = false) {
  const chain = (result: unknown) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result), range: vi.fn().mockResolvedValue(result) });
  const task = chain({ data: taskVisible ? { id: "task", projectId: "project", assignedUserId: "writer" } : null, error: null });
  const plan = chain({ data: { revision: 1 }, error: null });
  const history = chain({ data: [{ id: "v1", author: [{ fullName: "Writer" }], reviews: [{ id: "r1", reviewer: [{ fullName: "Reviewer" }] }], publications }], count: 41, error: null });
  const latest = chain({ data: { versionNumber: 41 }, error: null });
  // Client review links are fetched alongside the history; the token hash they
  // carry is of no use to anyone, so the panel can list them.
  const links = chain({ data: [], error: null });
  const from = vi.fn().mockReturnValueOnce(task).mockReturnValueOnce(plan).mockReturnValueOnce(history).mockReturnValueOnce(latest).mockReturnValueOnce(links);
  mocks.server.mockResolvedValue({ from, rpc: vi.fn().mockImplementation(async (name: string) => ({ data: name === "app_content_review_access" && reviewAllowed, error: null })) });
  return { task, history, from };
 }
 it("normalizes the unique publication object for rendering", async () => {
  database({ id: "publication", liveUrl: "https://example.com/post" });
  const result = await getContentVersions("project", "task");
  expect(result?.versions[0].publications).toEqual([{ id: "publication", liveUrl: "https://example.com/post" }]);
  expect(result?.versions[0].author).toEqual({ fullName: "Writer" });
  expect(result?.versions[0].reviews[0].reviewer).toEqual({ fullName: "Reviewer" });
  expect(result?.canWrite).toBe(true); expect(result?.canManage).toBe(false);
 });
 it("keeps internal review authority separate from project management", async () => {
  database(null, true, true);
  const result = await getContentVersions("project", "task");
  expect(result?.canReview).toBe(true);
  expect(result?.canManage).toBe(false);
 });
 it.each([null, []])("handles versions without publication evidence (%j)", async value => {
  database(value); expect((await getContentVersions("project", "task"))?.versions[0].publications).toEqual([]);
 });
 it("checks both project and task IDs before reading history", async () => {
  const { task, from } = database(null, false);
  expect(await getContentVersions("wrong-project", "task")).toBeNull();
  expect(task.eq.mock.calls).toEqual([["id", "task"], ["projectId", "wrong-project"]]);
  expect(from).toHaveBeenCalledTimes(1);
 });
 it("retains the actual latest version when viewing an older page", async () => {
  const { history } = database(null);
  const result = await getContentVersions("project", "task", 3);
  expect(history.range).toHaveBeenCalledWith(40, 59); expect(result?.latest).toBe(41);
 });
 it("surfaces a failed history fetch rather than claiming no versions", async () => {
  const { history } = database(null); history.range.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(getContentVersions("project", "task")).rejects.toThrow("Could not load content versions");
 });
});
