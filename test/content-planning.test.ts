import { describe, expect, it } from "vitest";
import { contentMonth, contentPlanSchema } from "@/lib/content-planning";
describe("content planning dates and validation", () => {
 it("uses Pakistan midnight with an exclusive next-month boundary", () => {
 expect(contentMonth("2026-12")).toEqual({ month: "2026-12", previous: "2026-11", next: "2027-01", start: "2026-11-30T19:00:00.000Z", end: "2026-12-31T19:00:00.000Z" });
 });
 it("defaults invalid months to the current Pakistan month", () => {
 expect(contentMonth("2026-13", new Date("2026-09-30T20:00:00Z")).month).toBe("2026-10");
 });
 it("handles leap-year month boundaries", () => { expect(contentMonth("2028-02").end).toBe("2028-02-29T19:00:00.000Z"); });
 it("requires a structured brief and revision", () => {
 const input = { taskId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", expectedRevision: 0, plan: { channel: "INSTAGRAM", format: "POST", objective: "Awareness", audience: "Retailers", brief: "Product intro", plannedPublishAt: "2026-10-01T10:00:00Z", clientApprovalRequired: true } };
 expect(contentPlanSchema.safeParse(input).success).toBe(true);
 for (const patch of [{ channel: "invented" }, { brief: " " }, { plannedPublishAt: "tomorrow" }, { clientApprovalRequired: "yes" }]) expect(contentPlanSchema.safeParse({ ...input, plan: { ...input.plan, ...patch } }).success).toBe(false);
 expect(contentPlanSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
 });
});
