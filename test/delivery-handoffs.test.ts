import { describe, expect, it } from "vitest";
import { deliveryFields, deliverySubmitSchema, deliveryDecisionSchema } from "@/lib/delivery-handoffs";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const checklist = Object.fromEntries(Object.keys(deliveryFields).map(key => [key, "Agreed details"]));
describe("delivery handoff validation", () => {
 it.each(Object.keys(deliveryFields))("requires %s", key => {
 expect(deliverySubmitSchema.safeParse({ id, projectId: id, quotationId: id, paymentState: "VERIFIED", checklist: { ...checklist, [key]: " " } }).success).toBe(false);
 });
 it("allows a pending prerequisite to be submitted for review", () => {
 expect(deliverySubmitSchema.safeParse({ id, projectId: id, quotationId: id, paymentState: "PENDING", checklist }).success).toBe(true);
 });
 it("does not accept an invented payment state", () => {
 expect(deliverySubmitSchema.safeParse({ id, projectId: id, quotationId: id, paymentState: "PAID", checklist }).success).toBe(false);
 });
 it("requires a future kickoff to accept", () => {
 for (const kickoffAt of [null, "2020-01-01T00:00:00Z"]) expect(deliveryDecisionSchema.safeParse({ id, decision: "ACCEPTED", reason: "Ready", kickoffAt }).success).toBe(false);
 expect(deliveryDecisionSchema.safeParse({ id, decision: "ACCEPTED", reason: "Capacity checked", kickoffAt: new Date(Date.now() + 86400000).toISOString() }).success).toBe(true);
 });
 it("requires a reason when returning or cancelling", () => {
 for (const decision of ["RETURNED", "CANCELLED"]) {
 expect(deliveryDecisionSchema.safeParse({ id, decision, reason: " ", kickoffAt: null }).success).toBe(false);
 expect(deliveryDecisionSchema.safeParse({ id, decision, reason: "Correct billing schedule", kickoffAt: null }).success).toBe(true);
 }
 });
});
