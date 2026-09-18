import { describe, expect, it } from "vitest";
import {
  addMonths, periodsDue, periodAmount, isRecurring,
  monthStart, monthEnd, isLocked, closableMonths, periodLabel,
} from "@/lib/recurring-billing";

describe("month arithmetic", () => {
  it("clamps to the end of a shorter month instead of overflowing", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("handles February in a leap year", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("crosses a year boundary", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("does not drift when the same start is stepped repeatedly", () => {
    // Stepping from the original date each time is what keeps 31 January
    // billing on the 31st again in March, rather than sliding to the 28th.
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
  });
});

describe("which contracts recur", () => {
  it("counts only calendar frequencies", () => {
    expect(isRecurring("MONTHLY")).toBe(true);
    expect(isRecurring("QUARTERLY")).toBe(true);
    expect(isRecurring("ANNUAL")).toBe(true);
    expect(isRecurring("ONE_TIME")).toBe(false);
    expect(isRecurring("MILESTONE")).toBe(false);
    expect(isRecurring(null)).toBe(false);
  });
});

const contract = (overrides: Record<string, unknown> = {}) => ({
  startDate: "2026-01-01", endDate: "2026-12-31", billingFrequency: "MONTHLY", contractValue: 1200, ...overrides,
});

describe("periods due", () => {
  it("returns nothing for a contract that does not recur", () => {
    expect(periodsDue(contract({ billingFrequency: "ONE_TIME" }), "2026-06-15")).toEqual([]);
  });

  it("does not bill a period that has not started yet", () => {
    const due = periodsDue(contract(), "2026-03-15");
    expect(due.map((p) => p.start)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("bills a period on the day it starts, not a day later", () => {
    expect(periodsDue(contract(), "2026-02-01").map((p) => p.start)).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("ends each period the day before the next one starts", () => {
    const [first] = periodsDue(contract(), "2026-01-15");
    expect(first).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  it("never runs a period past the end of the contract", () => {
    const due = periodsDue(contract({ endDate: "2026-03-15" }), "2026-12-31");
    expect(due.at(-1)).toEqual({ start: "2026-03-01", end: "2026-03-15" });
  });

  it("steps by three months for a quarterly contract", () => {
    const due = periodsDue(contract({ billingFrequency: "QUARTERLY" }), "2026-08-01");
    expect(due.map((p) => p.start)).toEqual(["2026-01-01", "2026-04-01", "2026-07-01"]);
  });

  it("steps by a year for an annual contract", () => {
    const due = periodsDue(contract({ billingFrequency: "ANNUAL", endDate: "2028-12-31" }), "2027-06-01");
    expect(due.map((p) => p.start)).toEqual(["2026-01-01", "2027-01-01"]);
  });

  it("returns nothing before the contract has begun", () => {
    expect(periodsDue(contract({ startDate: "2026-06-01" }), "2026-03-01")).toEqual([]);
  });

  it("caps how many periods one run can raise", () => {
    const due = periodsDue(contract({ startDate: "2000-01-01", endDate: "2030-01-01" }), "2026-01-01", 5);
    expect(due).toHaveLength(5);
  });
});

describe("what a period costs", () => {
  it("divides the contract value across its periods", () => {
    expect(periodAmount(contract())).toBe(100);
  });

  it("divides a quarterly contract into four", () => {
    expect(periodAmount(contract({ billingFrequency: "QUARTERLY" }))).toBe(300);
  });

  it("rounds to two decimals rather than carrying fractions of a rupee", () => {
    expect(periodAmount(contract({ contractValue: 1000 }))).toBe(83.33);
  });

  it("returns nothing for a non-recurring contract", () => {
    expect(periodAmount(contract({ billingFrequency: "MILESTONE" }))).toBeNull();
  });
});

describe("period labels", () => {
  it("reads as a date range", () => {
    expect(periodLabel({ start: "2026-01-01", end: "2026-01-31" })).toBe("1 Jan 2026 to 31 Jan 2026");
  });
});

describe("month boundaries", () => {
  it("finds the first and last day of a month", () => {
    expect(monthStart("2026-02-17")).toBe("2026-02-01");
    expect(monthEnd("2026-02-17")).toBe("2026-02-28");
    expect(monthEnd("2024-02-05")).toBe("2024-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });
});

describe("closed periods", () => {
  it("treats any date in a closed month as locked", () => {
    expect(isLocked("2026-01-15", ["2026-01-01"])).toBe(true);
    expect(isLocked("2026-01-01", ["2026-01-01"])).toBe(true);
    expect(isLocked("2026-01-31", ["2026-01-01"])).toBe(true);
  });

  it("leaves other months open", () => {
    expect(isLocked("2026-02-01", ["2026-01-01"])).toBe(false);
    expect(isLocked("2026-01-15", [])).toBe(false);
  });

  it("offers every month from the first activity up to last month", () => {
    expect(closableMonths("2026-01-10", "2026-04-15", [])).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("never offers the month currently being traded in", () => {
    expect(closableMonths("2026-04-01", "2026-04-15", [])).toEqual([]);
  });

  it("leaves out months that are already closed", () => {
    expect(closableMonths("2026-01-10", "2026-04-15", ["2026-02-01"])).toEqual(["2026-01-01", "2026-03-01"]);
  });

  it("offers nothing when there has been no financial activity", () => {
    expect(closableMonths(null, "2026-04-15", [])).toEqual([]);
  });

  it("caps a long history rather than listing every month since the start", () => {
    expect(closableMonths("2000-01-01", "2026-04-15", [], 6)).toHaveLength(6);
  });
});
