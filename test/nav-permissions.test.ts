/**
 * The navigation is built from the same permission strings the server enforces,
 * so these pin the matcher both sides share.
 *
 * The case that motivated them: Consultants were granted invoice:read purely so
 * they could file an expense claim, and invoice:read is also what gates the
 * invoice, payment and vendor-bill screens. Every consultant therefore had a
 * Finance heading in their sidebar and the company's receivables behind it.
 * Expenses now have their own permission, and the assertions below say so.
 */
import { describe, it, expect } from "vitest";
import { holds, holdsAny } from "@/lib/nav-permissions";

describe("holds", () => {
  it("matches an exact grant", () => {
    expect(holds(["case:read"], "case:read")).toBe(true);
  });

  it("refuses a permission that was never granted", () => {
    expect(holds(["case:read"], "invoice:read")).toBe(false);
  });

  it("treats a bare * as everything", () => {
    expect(holds(["*"], "anything:at:all")).toBe(true);
  });

  it("expands an entity wildcard across its actions", () => {
    expect(holds(["project:*"], "project:write")).toBe(true);
    expect(holds(["project:*"], "project:read")).toBe(true);
  });

  it("does not let an entity wildcard reach another entity", () => {
    expect(holds(["project:*"], "invoice:read")).toBe(false);
  });

  it("expands an action wildcard across entities", () => {
    expect(holds(["*:read"], "invoice:read")).toBe(true);
    expect(holds(["*:read"], "invoice:write")).toBe(false);
  });
});

describe("holdsAny", () => {
  it("passes anything through when nothing is required", () => {
    expect(holdsAny([], undefined)).toBe(true);
    expect(holdsAny([], [])).toBe(true);
  });

  it("needs only one of several", () => {
    expect(holdsAny(["case:write"], ["case:read", "case:write"])).toBe(true);
  });

  it("refuses when none are held", () => {
    expect(holdsAny(["case:read"], ["invoice:read", "payment:write"])).toBe(false);
  });
});

/**
 * The permission sets each seeded role holds after
 * 20260830000000_expense_permissions_split.sql. Kept as literals rather than
 * read from the database so this stays a unit test — the database-backed
 * equivalents live in authz-scope.test.ts.
 */
const CONSULTANT = [
  "project:read", "project:write", "case:read", "case:write",
  "expense:read", "expense:write",
];
const FINANCE = [
  "invoice:*", "payment:*", "expense:*", "commission:read",
  "commission:approve", "payout:approve", "account:read", "opportunity:read",
];

describe("what a Consultant's sidebar shows", () => {
  it("opens the screens their work actually runs on", () => {
    expect(holdsAny(CONSULTANT, ["project:read"])).toBe(true);
    expect(holdsAny(CONSULTANT, ["case:read"])).toBe(true);
    expect(holdsAny(CONSULTANT, ["expense:read"])).toBe(true);
  });

  it("hides the finance ledger that filing an expense used to unlock", () => {
    expect(holdsAny(CONSULTANT, ["invoice:read"])).toBe(false);
  });

  it("hides the customer book, the pipeline and the partner ledger", () => {
    expect(holdsAny(CONSULTANT, ["account:read"])).toBe(false);
    expect(holdsAny(CONSULTANT, ["opportunity:read"])).toBe(false);
    expect(holdsAny(CONSULTANT, ["partner:read"])).toBe(false);
    expect(holdsAny(CONSULTANT, ["commission:read"])).toBe(false);
    expect(holdsAny(CONSULTANT, ["lead:read"])).toBe(false);
  });

  it("cannot decide a claim, only file one", () => {
    expect(holds(CONSULTANT, "expense:write")).toBe(true);
    expect(holds(CONSULTANT, "expense:approve")).toBe(false);
  });
});

describe("what Finance keeps", () => {
  it("still runs the whole expense module", () => {
    expect(holds(FINANCE, "expense:read")).toBe(true);
    expect(holds(FINANCE, "expense:approve")).toBe(true);
  });

  it("still runs receivables and payables", () => {
    expect(holds(FINANCE, "invoice:read")).toBe(true);
    expect(holds(FINANCE, "payment:write")).toBe(true);
  });
});

/**
 * The vault.
 *
 * secret:read is deliberately not implied by any existing grant. The risk being
 * pinned here is a quiet one: if the vault were gated on a permission people
 * already hold for unrelated reasons — or if admin:* reached it the way a bare
 * "*" does — then everyone with that grant would silently gain the ability to
 * read production credentials the day the feature shipped.
 */
describe("who can open the vault", () => {
  it("is closed to the roles that hold no vault grant", () => {
    expect(holdsAny(CONSULTANT, ["secret:read"])).toBe(false);
    expect(holdsAny(FINANCE, ["secret:read"])).toBe(false);
  });

  it("is not reached by admin:*, which is an entity wildcard like any other", () => {
    // admin:* expands to admin:<action>, never to secret:read. Someone who
    // configures the system does not thereby hold its production keys.
    expect(holds(["admin:*"], "secret:read")).toBe(false);
  });

  it("is reached by a bare *, which is total access by definition", () => {
    expect(holds(["*"], "secret:read")).toBe(true);
    expect(holds(["*"], "secret:write")).toBe(true);
  });

  it("separates reading a secret from changing one", () => {
    expect(holds(["secret:read"], "secret:write")).toBe(false);
    expect(holds(["secret:write"], "secret:read")).toBe(false);
    expect(holds(["secret:*"], "secret:read")).toBe(true);
    expect(holds(["secret:*"], "secret:write")).toBe(true);
  });

  it("does not let the vault grant reach anything else", () => {
    expect(holds(["secret:*"], "invoice:read")).toBe(false);
    expect(holds(["secret:*"], "account:read")).toBe(false);
  });
});
