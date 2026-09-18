import { describe, expect, it } from "vitest";
import {
  daysBetween, addDays, renewalRow, withinWindow, byUrgency, renewalStage,
  accountHealth, healthDisagrees, onboardingAge, unowned, type HealthInput,
} from "@/lib/account-health";

const TODAY = "2026-06-15";

describe("date helpers", () => {
  it("counts days forwards and backwards", () => {
    expect(daysBetween("2026-06-15", "2026-06-20")).toBe(5);
    expect(daysBetween("2026-06-20", "2026-06-15")).toBe(-5);
    expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: "c1", contractNumber: "CTR-1", name: "Retainer", accountId: "a1",
  endDate: "2026-07-15", renewalType: "MANUAL", noticePeriodDays: 30,
  contractValue: 12000, currencyCode: "PKR", ...overrides,
});
const account = { name: "Shop", ownerUserId: "u1", ownerName: "Ayesha" };

describe("renewal rows", () => {
  it("counts the days left and works out the notice deadline", () => {
    const row = renewalRow(contract(), account, TODAY);
    expect(row.daysToEnd).toBe(30);
    expect(row.noticeBy).toBe("2026-06-15");
  });

  it("marks notice as urgent once the deadline is within a week", () => {
    expect(renewalRow(contract(), account, TODAY).noticeUrgent).toBe(true);
    expect(renewalRow(contract({ endDate: "2026-09-15" }), account, TODAY).noticeUrgent).toBe(false);
  });

  it("has no notice deadline when no notice period is agreed", () => {
    const row = renewalRow(contract({ noticePeriodDays: null }), account, TODAY);
    expect(row.noticeBy).toBeNull();
    expect(row.noticeUrgent).toBe(false);
  });

  it("keeps a contract that has already ended, with a negative day count", () => {
    const row = renewalRow(contract({ endDate: "2026-05-01" }), account, TODAY);
    expect(row.daysToEnd).toBeLessThan(0);
    expect(renewalStage(row)).toBe("LAPSED");
  });

  it("carries the account owner through, so the queue says who is answerable", () => {
    const row = renewalRow(contract(), account, TODAY);
    expect(row.ownerName).toBe("Ayesha");
  });

  it("copes with an account that has no owner", () => {
    const row = renewalRow(contract(), { name: "Shop", ownerUserId: null, ownerName: null }, TODAY);
    expect(row.ownerUserId).toBeNull();
  });
});

describe("renewal windows and ordering", () => {
  const rows = [
    renewalRow(contract({ id: "a", endDate: "2026-08-20" }), account, TODAY),
    renewalRow(contract({ id: "b", endDate: "2026-06-20" }), account, TODAY),
    renewalRow(contract({ id: "c", endDate: "2026-05-01" }), account, TODAY),
    renewalRow(contract({ id: "d", endDate: "2026-12-01" }), account, TODAY),
  ];

  it("includes only what falls inside the window", () => {
    expect(withinWindow(rows, 30).map((r) => r.contractId)).toEqual(["b", "c"]);
    expect(withinWindow(rows, 90).map((r) => r.contractId).sort()).toEqual(["a", "b", "c"]);
  });

  it("always keeps a lapsed contract in view, whatever the window", () => {
    expect(withinWindow(rows, 30).some((r) => r.contractId === "c")).toBe(true);
  });

  it("puts the most urgent first", () => {
    expect(byUrgency(rows).map((r) => r.contractId)).toEqual(["c", "b", "a", "d"]);
  });

  it("names each stage", () => {
    expect(renewalStage(rows[2])).toBe("LAPSED");
    expect(renewalStage(rows[3])).toBe("UPCOMING");
  });
});

const health = (overrides: Partial<HealthInput> = {}): HealthInput => ({
  overdueInvoices: [], openCases: [], recentSatisfaction: [],
  lastActivityAt: `${TODAY}T09:00:00Z`, renewalDaysToEnd: [], today: TODAY, ...overrides,
});

describe("account health", () => {
  it("is green when nothing is wrong", () => {
    const result = accountHealth(health());
    expect(result.status).toBe("GREEN");
    expect(result.signals).toEqual([]);
  });

  it("explains every signal it counted", () => {
    const result = accountHealth(health({
      overdueInvoices: [{ dueDate: "2026-01-01", outstandingAmount: 5000 }],
    }));
    expect(result.signals[0].label).toBe("Overdue invoices");
    expect(result.signals[0].detail).toContain("days past due");
  });

  it("weighs a long overdue invoice more heavily than a recent one", () => {
    const recent = accountHealth(health({ overdueInvoices: [{ dueDate: "2026-06-01", outstandingAmount: 100 }] }));
    const old = accountHealth(health({ overdueInvoices: [{ dueDate: "2026-01-01", outstandingAmount: 100 }] }));
    expect(old.score).toBeGreaterThan(recent.score);
  });

  it("ignores an overdue invoice that has actually been paid", () => {
    const result = accountHealth(health({ overdueInvoices: [{ dueDate: "2026-01-01", outstandingAmount: 0 }] }));
    expect(result.status).toBe("GREEN");
  });

  it("counts missed support commitments", () => {
    const result = accountHealth(health({
      openCases: [
        { slaBreached: true, priority: "HIGH", reopenCount: 0 },
        { slaBreached: true, priority: "LOW", reopenCount: 0 },
      ],
    }));
    expect(result.signals.some((s) => s.label === "Missed support commitments")).toBe(true);
    expect(result.status).toBe("AMBER");
  });

  it("does not count a breached case twice as an urgent one", () => {
    const result = accountHealth(health({
      openCases: [{ slaBreached: true, priority: "CRITICAL", reopenCount: 0 }],
    }));
    expect(result.signals.filter((s) => s.label === "Urgent cases open")).toHaveLength(0);
  });

  it("notices work that came back after being closed", () => {
    const result = accountHealth(health({
      openCases: [{ slaBreached: false, priority: "LOW", reopenCount: 2 }],
    }));
    expect(result.signals.some((s) => s.label === "Cases reopened")).toBe(true);
  });

  it("counts low satisfaction but leaves good scores alone", () => {
    expect(accountHealth(health({ recentSatisfaction: [2, 2] })).status).not.toBe("GREEN");
    expect(accountHealth(health({ recentSatisfaction: [5, 4] })).status).toBe("GREEN");
  });

  it("treats a long silence as a signal", () => {
    const result = accountHealth(health({ lastActivityAt: "2026-01-01T09:00:00Z" }));
    expect(result.signals.some((s) => s.label === "No recent contact")).toBe(true);
  });

  it("says so when nothing was ever logged", () => {
    const result = accountHealth(health({ lastActivityAt: null }));
    expect(result.signals[0].detail).toContain("ever been logged");
  });

  it("does not complain about contact from this week", () => {
    const result = accountHealth(health({ lastActivityAt: "2026-06-10T09:00:00Z" }));
    expect(result.signals).toEqual([]);
  });

  it("flags a lapsed contract more heavily than an approaching one", () => {
    const soon = accountHealth(health({ renewalDaysToEnd: [20] }));
    const lapsed = accountHealth(health({ renewalDaysToEnd: [-10] }));
    expect(lapsed.score).toBeGreaterThan(soon.score);
    expect(lapsed.signals[0].label).toBe("Contract lapsed");
  });

  it("turns red once enough is wrong at once", () => {
    const result = accountHealth(health({
      overdueInvoices: [{ dueDate: "2026-01-01", outstandingAmount: 9000 }],
      openCases: [
        { slaBreached: true, priority: "HIGH", reopenCount: 1 },
        { slaBreached: true, priority: "HIGH", reopenCount: 0 },
      ],
      recentSatisfaction: [1],
    }));
    expect(result.status).toBe("RED");
  });

  it("does not turn red on one mild signal", () => {
    expect(accountHealth(health({ renewalDaysToEnd: [45] })).status).toBe("GREEN");
  });
});

describe("stored versus derived health", () => {
  it("disagrees when the records look worse than the stored judgement", () => {
    expect(healthDisagrees("GREEN", "RED")).toBe(true);
  });

  it("agrees when they match", () => {
    expect(healthDisagrees("AMBER", "AMBER")).toBe(false);
  });

  it("treats an unset value as agreeing only while the records look fine", () => {
    expect(healthDisagrees(null, "GREEN")).toBe(false);
    expect(healthDisagrees(null, "AMBER")).toBe(true);
  });
});

describe("onboarding", () => {
  it("reports how long onboarding has been running", () => {
    expect(onboardingAge("ONBOARDING", "2026-06-01T00:00:00Z", TODAY)).toEqual({ days: 14, overdue: false });
  });

  it("marks onboarding that has run past a month", () => {
    expect(onboardingAge("ONBOARDING", "2026-04-01T00:00:00Z", TODAY)?.overdue).toBe(true);
  });

  it("says nothing about a customer who is not onboarding", () => {
    expect(onboardingAge("ACTIVE", "2026-06-01T00:00:00Z", TODAY)).toBeNull();
  });
});

describe("unowned accounts", () => {
  it("finds accounts with nobody named on them", () => {
    const rows = [
      { id: "a", ownerUserId: null },
      { id: "b", ownerUserId: "u1" },
      { id: "c", ownerUserId: "u2", ownerActive: false },
    ];
    expect(unowned(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
});
