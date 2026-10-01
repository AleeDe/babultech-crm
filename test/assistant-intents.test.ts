import { describe, it, expect } from "vitest";
import { customerIntent, partnerIntent, searchTerms } from "@/lib/assistant-intents";

describe("what a customer is asking the assistant", () => {
  it("raises a case when asked, or when a problem is described", () => {
    expect(customerIntent("Create a case")).toEqual({ kind: "raise_case", problem: null });
    expect(customerIntent("My application is not loading")).toEqual({ kind: "raise_case", problem: "My application is not loading" });
    expect(customerIntent("I get an error when I save")).toMatchObject({ kind: "raise_case" });
  });

  it("finds a ticket by its number", () => {
    expect(customerIntent("what about case-2026-00012?")).toEqual({ kind: "case_status", caseNumber: "CASE-2026-00012" });
    expect(customerIntent("What's the status of my ticket?")).toEqual({ kind: "case_status", caseNumber: null });
  });

  it("knows the other questions", () => {
    expect(customerIntent("Show my open cases").kind).toBe("open_cases");
    expect(customerIntent("Has someone replied to my case?").kind).toBe("replies");
    expect(customerIntent("Show my active projects").kind).toBe("projects");
    expect(customerIntent("What's the next milestone?").kind).toBe("milestone");
    expect(customerIntent("Where can I find this deliverable?").kind).toBe("deliverable");
    expect(customerIntent("hello").kind).toBe("greeting");
  });

  it("searches help articles for anything else", () => {
    expect(customerIntent("How do I reset my password?")).toEqual({ kind: "search", query: "How do I reset my password?" });
    expect(customerIntent("What services do you provide?").kind).toBe("search");
  });
});

describe("what a partner is asking the assistant", () => {
  it("knows the partner questions", () => {
    expect(partnerIntent("Create a deal registration").kind).toBe("register_deal");
    expect(partnerIntent("Show my opportunities").kind).toBe("my_deals");
    expect(partnerIntent("What's the status of OPP-2026-00042?")).toEqual({ kind: "deal_status", reference: "OPP-2026-00042" });
    expect(partnerIntent('status of the deal "Acme rollout"')).toEqual({ kind: "deal_status", reference: "Acme rollout" });
    expect(partnerIntent("What commission is pending?").kind).toBe("commission_pending");
    expect(partnerIntent("How does our commission agreement work?").kind).toBe("commission_terms");
    expect(partnerIntent("Show my open support cases").kind).toBe("support");
  });
});

describe("search terms", () => {
  it("keeps the words that matter", () => {
    expect(searchTerms("How do I reset my password?")).toBe("reset password");
  });
});
