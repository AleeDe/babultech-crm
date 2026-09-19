import { describe, expect, it } from "vitest";
import {
  grants, holdersOfAll, assessPilot, summarise,
  type PilotUser, type PilotCounts,
} from "@/lib/pilot-readiness";

const user = (fullName: string, permissions: string[], overrides: Partial<PilotUser> = {}): PilotUser => ({
  fullName, status: "ACTIVE", deletedAt: null, partnerId: null,
  role: { name: "Role", dataScope: "ALL", permissions, active: true },
  ...overrides,
});

const counts = (overrides: Partial<PilotCounts> = {}): PilotCounts => ({
  leads: 5, customers: 3, contracts: 2, invoices: 4, projects: 2, tasks: 6, contentPlans: 1, ...overrides,
});

const find = (list: ReturnType<typeof assessPilot>, name: string) =>
  list.find((w) => w.workflow === name)!;

describe("wildcard grants", () => {
  it("matches an exact permission", () => {
    expect(grants(["lead:read"], "lead:read")).toBe(true);
  });

  it("matches a group wildcard", () => {
    expect(grants(["lead:*"], "lead:read")).toBe(true);
    expect(grants(["project:*"], "project:manage")).toBe(true);
  });

  it("matches the global wildcard an administrator holds", () => {
    expect(grants(["*"], "invoice:approve")).toBe(true);
  });

  it("matches an action wildcard across groups", () => {
    expect(grants(["*:read"], "lead:read")).toBe(true);
  });

  it("does not match a different group or action", () => {
    expect(grants(["lead:read"], "lead:write")).toBe(false);
    expect(grants(["project:*"], "lead:read")).toBe(false);
    expect(grants([], "lead:read")).toBe(false);
  });
});

describe("who holds what", () => {
  const people = [
    user("Admin", ["*"]),
    user("Finance", ["invoice:*", "payment:*"]),
    user("PM", ["project:*", "opportunity:read"]),
    user("Consultant", ["project:read", "project:write"]),
  ];

  it("requires every permission to be held by the same person", () => {
    expect(holdersOfAll(people, ["lead:read", "lead:write", "opportunity:write"])).toEqual(["Admin"]);
  });

  it("counts a group wildcard as holding its members", () => {
    expect(holdersOfAll(people, ["invoice:write", "invoice:approve"]).sort()).toEqual(["Admin", "Finance"]);
  });

  it("leaves out anyone deactivated, deleted, external, or on a disabled role", () => {
    const edge = [
      user("Left", ["*"], { status: "INACTIVE" }),
      user("Deleted", ["*"], { deletedAt: "2026-01-01" }),
      user("Partner", ["*"], { partnerId: "p1" }),
      user("DisabledRole", ["*"], { role: { name: "Old", dataScope: "ALL", permissions: ["*"], active: false } }),
      user("NoRole", [], { role: null }),
    ];
    expect(holdersOfAll(edge, ["lead:read"])).toEqual([]);
  });
});

describe("what today actually looks like", () => {
  // The live grants as read on 19 September 2026.
  const live = [
    user("Babul Tech", ["*", "expense:approve", "expense:read", "expense:write"]),
    user("Hassan Shamsi", ["account:read", "commission:approve", "commission:read", "expense:approve", "expense:read", "expense:write", "invoice:*", "opportunity:read", "payment:*", "payout:approve"]),
    user("Sami Ullah", ["account:read", "case:*", "contract:read", "expense:read", "expense:write", "invoice:read", "opportunity:read", "project:*", "time:approve"]),
    user("Muhammad Ali", ["case:read", "case:write", "expense:read", "expense:write", "project:read", "project:write"]),
  ];
  const empty = counts({ leads: 0, customers: 0, contracts: 0, invoices: 0, projects: 10, tasks: 6, contentPlans: 0 });

  it("blocks the calling queue on the missing leads, since the administrator's wildcard covers the grant", () => {
    const result = find(assessPilot(live, empty), "Leads: calling queue");
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(["There are no leads to call."]);
    expect(result.people).toEqual(["Babul Tech"]);
  });

  it("blocks on the grant too once the administrator is out of the picture", () => {
    const withoutAdmin = live.filter((u) => u.fullName !== "Babul Tech");
    const result = find(assessPilot(withoutAdmin, empty), "Leads: calling queue");
    expect(result.blockers).toHaveLength(2);
    expect(result.blockers[0]).toContain("lead:read");
  });

  it("says a handoff needs two different people when only the administrator qualifies", () => {
    const result = find(assessPilot(live, counts({ leads: 5 })), "Leads: sales handoff");
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("two different people");
  });

  it("catches the single project manager who cannot review their own work", () => {
    const result = find(assessPilot([live[2], live[3]], counts()), "Content: plan, review, publish");
    expect(result.ready).toBe(false);
    expect(result.blockers[0]).toContain("cannot be reviewed by whoever wrote it");
  });

  it("stops warning about the single manager once there are two", () => {
    const result = find(assessPilot(live, counts()), "Content: plan, review, publish");
    expect(result.ready).toBe(true);
  });

  it("catches one person who would both prepare and issue an invoice", () => {
    const soloFinance = [user("Hassan", ["invoice:*"])];
    const result = find(assessPilot(soloFinance, counts()), "Finance: recurring billing and issuing");
    expect(result.ready).toBe(false);
    expect(result.blockers[0]).toContain("cannot be issued by whoever prepared it");
  });

  it("is satisfied once a second person can issue", () => {
    const result = find(assessPilot(live, counts()), "Finance: recurring billing and issuing");
    expect(result.ready).toBe(true);
    expect(result.people).toContain("Hassan Shamsi");
  });

  it("reports renewals and health as blocked only by missing records", () => {
    const list = assessPilot(live, empty);
    expect(find(list, "Renewals").blockers).toEqual(["There are no contracts, so nothing can come up for renewal."]);
    expect(find(list, "Account health").blockers).toEqual(["There are no customer accounts to assess."]);
  });

  it("names who could run a workflow that is ready", () => {
    const result = find(assessPilot(live, counts()), "Account health");
    expect(result.ready).toBe(true);
    expect(result.people).toContain("Hassan Shamsi");
  });
});

describe("summary", () => {
  it("counts ready against blocked", () => {
    const live = [user("Admin", ["*"]), user("Second", ["*"])];
    const all = summarise(assessPilot(live, counts()));
    expect(all.ready).toBe(all.total);
    expect(all.blocked).toBe(0);
  });

  it("reports everything blocked when nobody holds anything", () => {
    const none = summarise(assessPilot([user("Nobody", [])], counts({ leads: 0, customers: 0, contracts: 0, invoices: 0, projects: 0, tasks: 0, contentPlans: 0 })));
    expect(none.ready).toBe(0);
  });
});
