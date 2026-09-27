/**
 * Lists narrowed by owner, widened to every partner's records.
 *
 * A lead, account or deal credited to a partner is every salesperson's to see
 * and work, whoever owns it (20260928000008). Row-level security applies that
 * rule in the database; applyScopeWithPartners keeps the app's own owner
 * filter from narrowing the list below it - and must never widen anything else.
 */
import { describe, it, expect, vi } from "vitest";
import { applyScopeWithPartners } from "@/lib/db";

function query() {
  const q = {
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    or: vi.fn(() => q),
  };
  return q;
}

describe("applyScopeWithPartners", () => {
  it("leaves an all-seeing reader's list alone", () => {
    const q = query();
    applyScopeWithPartners(q, {}, "sourcePartnerId");
    expect(q.or).not.toHaveBeenCalled();
    expect(q.eq).not.toHaveBeenCalled();
    expect(q.in).not.toHaveBeenCalled();
  });

  it("shows one's own and every partner's, for someone who sees only their own", () => {
    const q = query();
    applyScopeWithPartners(q, { ownerUserId: "me" }, "referredByPartnerId");
    expect(q.or).toHaveBeenCalledWith("ownerUserId.eq.me,referredByPartnerId.not.is.null");
    expect(q.eq).not.toHaveBeenCalled();
  });

  it("shows the team's and every partner's, for someone who sees a team", () => {
    const q = query();
    applyScopeWithPartners(q, { ownerUserId: { in: ["a", "b"] } }, "sourcePartnerId");
    expect(q.or).toHaveBeenCalledWith("ownerUserId.in.(a,b),sourcePartnerId.not.is.null");
  });

  it("shows only partners' records when the scope names nobody", () => {
    const q = query();
    applyScopeWithPartners(q, { ownerUserId: { in: [] } }, "sourcePartnerId");
    expect(q.or).toHaveBeenCalledWith("sourcePartnerId.not.is.null");
  });

  it("does not widen a scope it does not recognise", () => {
    const q = query();
    applyScopeWithPartners(q, { ownerUserId: "me", teamId: "t" }, "sourcePartnerId");
    expect(q.or).not.toHaveBeenCalled();
    expect(q.eq).toHaveBeenCalledWith("ownerUserId", "me");
    expect(q.eq).toHaveBeenCalledWith("teamId", "t");
  });
});
