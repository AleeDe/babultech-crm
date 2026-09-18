import { describe, expect, it } from "vitest";
import { requestHandoffSchema, decisionSchema } from "@/lib/lead-handoffs";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const future = () => new Date(Date.now() + 86400000).toISOString();
const qualification = { serviceInterest: "Software", need: "Inventory control", authority: "Unknown", budget: "Unknown", timing: "Next month", nextAction: "Discovery call" };
describe("lead handoff validation", () => {
  it("accepts explicitly unknown qualification details", () => {
    expect(requestHandoffSchema.safeParse({ id, leadId: id, recipientId: id, qualification, followUpAt: future() }).success).toBe(true);
  });
  it.each(Object.keys(qualification))("requires %s", key => {
    expect(requestHandoffSchema.safeParse({ id, leadId: id, recipientId: id, qualification: { ...qualification, [key]: " " }, followUpAt: future() }).success).toBe(false);
  });
  it("requires a dated future next action on request", () => {
    expect(requestHandoffSchema.safeParse({ id, leadId: id, recipientId: id, qualification, followUpAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
  });
  it("requires a reason for every decision", () => {
    for (const decision of ["ACCEPTED", "REJECTED", "CANCELLED"]) expect(decisionSchema.safeParse({ id, decision, reason: " ", followUpAt: future() }).success).toBe(false);
  });
  it("requires a future acceptance date but allows return/cancellation without one", () => {
    expect(decisionSchema.safeParse({ id, decision: "ACCEPTED", reason: "Discovery", followUpAt: null }).success).toBe(false);
    expect(decisionSchema.safeParse({ id, decision: "ACCEPTED", reason: "Discovery", followUpAt: future() }).success).toBe(true);
    for (const decision of ["REJECTED", "CANCELLED"]) expect(decisionSchema.safeParse({ id, decision, reason: "Needs clarification", followUpAt: null }).success).toBe(true);
  });
});
