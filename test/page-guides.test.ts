/**
 * Matching a path to its guide.
 *
 * The prefix rule is the part worth pinning: a detail page has to inherit its
 * list's guide, and the dashboard's "/" must not swallow every other path.
 */
import { describe, it, expect } from "vitest";
import { guideFor, PAGE_GUIDES } from "@/lib/page-guides";

describe("guideFor", () => {
  it("matches a list page exactly", () => {
    expect(guideFor("/leads")?.purpose).toContain("Unqualified prospects");
  });

  it("gives a detail page its list's guide", () => {
    // /leads/abc123 is still the leads screen as far as the chain goes.
    expect(guideFor("/leads/abc-123")).toBe(PAGE_GUIDES["/leads"]);
  });

  it("gives a nested page the same", () => {
    expect(guideFor("/projects/abc/tasks/def")).toBe(PAGE_GUIDES["/projects"]);
  });

  it("does not let the dashboard swallow everything", () => {
    // "/" is a prefix of every path; it must only ever match itself.
    expect(guideFor("/leads")).not.toBe(PAGE_GUIDES["/"]);
    expect(guideFor("/")).toBe(PAGE_GUIDES["/"]);
  });

  it("prefers the longest matching prefix", () => {
    // /vendor-bills must not lose to a shorter key that also matches.
    expect(guideFor("/vendor-bills/xyz")).toBe(PAGE_GUIDES["/vendor-bills"]);
  });

  it("returns null for a screen with no guide written yet", () => {
    expect(guideFor("/nowhere")).toBeNull();
  });
});

describe("the guides themselves", () => {
  it("gives every screen a purpose", () => {
    for (const [path, guide] of Object.entries(PAGE_GUIDES)) {
      expect(guide.purpose, `${path} has no purpose`).toBeTruthy();
    }
  });

  it("writes purposes as sentences, not labels", () => {
    // A purpose that just repeats the page title teaches nobody anything.
    for (const [path, guide] of Object.entries(PAGE_GUIDES)) {
      expect(guide.purpose.length, `${path} purpose is too short to be useful`)
        .toBeGreaterThan(30);
    }
  });

  it("covers the pages in the money chain", () => {
    // These are the screens whose connections people actually get wrong.
    for (const path of [
      "/leads", "/opportunities", "/quotations", "/contracts",
      "/projects", "/invoices", "/payments", "/commissions",
    ]) {
      expect(PAGE_GUIDES[path], `${path} is missing a guide`).toBeDefined();
    }
  });

  it("explains what the chain pages lead to", () => {
    // The whole point of the strip: a screen in the middle of a chain has to
    // say what it produces, or the reader cannot find the next step.
    for (const path of ["/leads", "/opportunities", "/quotations", "/contracts"]) {
      expect(PAGE_GUIDES[path].feeds?.length, `${path} does not say what it feeds`)
        .toBeGreaterThan(0);
    }
  });
});
