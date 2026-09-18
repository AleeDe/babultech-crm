import { describe, expect, it } from "vitest";
import { versionSchema, reviewSchema, publicationSchema, publicationInputToIso } from "@/lib/content-versions";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const version = { id, taskId: id, expected: 0, planRevision: 1, copy: "Caption", assetUrl: null, assetSha: null };
describe("content version inputs", () => {
 it("preserves publication seconds and rejects invalid calendar dates", () => {
 expect(publicationInputToIso("2026-09-18T21:12:37")).toBe("2026-09-18T16:12:37.000Z");
 expect(publicationInputToIso("2026-09-18T21:12")).toBe("2026-09-18T16:12:00.000Z");
 expect(publicationInputToIso("2026-02-30T21:12:37")).toBeNull();
 });
 it("supports copy-only versions and paired asset references", () => {
 expect(versionSchema.safeParse(version).success).toBe(true);
 const result = versionSchema.parse({ ...version, assetUrl: "https://example.com/asset-v1", assetSha: "A".repeat(64) });
 expect(result.assetSha).toBe("a".repeat(64));
 });
 it("rejects incomplete asset evidence", () => {
 expect(versionSchema.safeParse({ ...version, assetUrl: "https://example.com/file" }).success).toBe(false);
 expect(versionSchema.safeParse({ ...version, assetSha: "a".repeat(64) }).success).toBe(false);
 expect(versionSchema.safeParse({ ...version, assetUrl: "https://example.com/file", assetSha: "bad-hash" }).success).toBe(false);
 });
 it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/file"])("rejects unsafe link %s", assetUrl => {
 expect(versionSchema.safeParse({ ...version, assetUrl, assetSha: "a".repeat(64) }).success).toBe(false);
 expect(publicationSchema.safeParse({ id, versionId: id, url: assetUrl, publishedAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
 });
 it("requires real copy and concurrency counters", () => {
 expect(versionSchema.safeParse({ ...version, copy: " " }).success).toBe(false);
 expect(versionSchema.safeParse({ ...version, expected: -1 }).success).toBe(false);
 expect(versionSchema.safeParse({ ...version, planRevision: 0 }).success).toBe(false);
 });
 it("requires named client evidence separately from internal review", () => {
 const review = { id, versionId: id, stage: "CLIENT", decision: "APPROVED", evidence: "Client email, 18 September", client: null };
 expect(reviewSchema.safeParse(review).success).toBe(false);
 expect(reviewSchema.safeParse({ ...review, client: "Client reviewer" }).success).toBe(true);
 expect(reviewSchema.safeParse({ ...review, stage: "INTERNAL" }).success).toBe(true);
 expect(reviewSchema.safeParse({ ...review, client: "Client", evidence: " " }).success).toBe(false);
 });
 it("does not confuse planned publication with actual publication", () => {
 expect(publicationSchema.safeParse({ id, versionId: id, url: "https://example.com/post", publishedAt: new Date(Date.now() + 86400000).toISOString() }).success).toBe(false);
 expect(publicationSchema.safeParse({ id, versionId: id, url: "https://example.com/post", publishedAt: "2020-01-01T00:00:00Z" }).success).toBe(true);
 });
});
