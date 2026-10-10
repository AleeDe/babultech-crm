import { describe, expect, it } from "vitest";
import {
  termEndDate, dayAfter, daysUntil, karachiToday, tenureLabel, payLabel, hourlyCost, fillContract, benefitLines, contractDate,
} from "@/lib/people";
import { ALL_PERMISSIONS } from "@/lib/permission-catalogue";
import { PERMISSIONS } from "@/lib/authz";

describe("a contract's end date", () => {
  it("is the day before the same date, the tenure later", () => {
    expect(termEndDate("2026-10-05", 3)).toBe("2027-01-04");
    expect(termEndDate("2026-10-05", 6)).toBe("2027-04-04");
    expect(termEndDate("2026-10-05", 12)).toBe("2027-10-04");
    expect(termEndDate("2026-10-01", 1)).toBe("2026-10-31");
  });

  it("does not spill into the next month from a long month", () => {
    // 31 January plus a month is the end of February, not 3 March.
    expect(termEndDate("2027-01-31", 1)).toBe("2027-02-28");
    expect(termEndDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(termEndDate("2027-01-30", 1)).toBe("2027-02-28");
    expect(termEndDate("2026-08-31", 3)).toBe("2026-11-30");
  });

  it("puts a renewal straight after it", () => {
    expect(dayAfter("2027-01-04")).toBe("2027-01-05");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayAfter(termEndDate("2026-10-05", 12))).toBe("2027-10-05");
  });
});

describe("days left", () => {
  it("counts whole days in Karachi", () => {
    expect(daysUntil("2026-10-15", "2026-10-05")).toBe(10);
    expect(daysUntil("2026-10-05", "2026-10-05")).toBe(0);
    expect(daysUntil("2026-10-01", "2026-10-05")).toBe(-4);
  });

  it("is a Karachi date, five hours ahead of UTC", () => {
    expect(karachiToday(new Date("2026-10-04T19:30:00Z"))).toBe("2026-10-05");
    expect(karachiToday(new Date("2026-10-04T18:30:00Z"))).toBe("2026-10-04");
  });
});

describe("pay", () => {
  it("reads as it is printed", () => {
    expect(payLabel("MONTHLY", "40000", "PKR")).toBe("PKR 40,000 per month");
    expect(payLabel("HOURLY", 12.5, "USD")).toBe("USD 12.5 per hour");
    expect(payLabel("NONE", null, null)).toBe("None");
    expect(tenureLabel(3)).toBe("3 months");
    expect(tenureLabel(12)).toBe("one year");
  });

  it("gives an hourly cost for project costing when it can", () => {
    expect(hourlyCost({ payBasis: "HOURLY", payAmount: 500, hoursPerWeek: null, tenureMonths: 3 })).toBe(500);
    expect(hourlyCost({ payBasis: "DAILY", payAmount: 4000, hoursPerWeek: null, tenureMonths: 3 })).toBe(500);
    // 52,000 a month at 40 hours a week: 624,000 / 2,080 hours.
    expect(hourlyCost({ payBasis: "MONTHLY", payAmount: 52000, hoursPerWeek: 40, tenureMonths: 12 })).toBe(300);
    expect(hourlyCost({ payBasis: "MONTHLY", payAmount: 52000, hoursPerWeek: null, tenureMonths: 12 })).toBeNull();
    expect(hourlyCost({ payBasis: "NONE", payAmount: null, hoursPerWeek: 40, tenureMonths: 3 })).toBeNull();
  });
});

describe("the contract text", () => {
  it("fills placeholders and leaves a line for what is missing", () => {
    const text = fillContract("Between {{companyName}} and {{fullName}}, CNIC {{nationalId}}. {{unknown}}", {
      companyName: "BabulTech", fullName: "Ayesha Khan", nationalId: "",
    });
    expect(text).toBe("Between BabulTech and Ayesha Khan, CNIC ____________. {{unknown}}");
  });

  it("lists benefits one per line", () => {
    expect(benefitLines(["Training", "Weekly lunch"])).toBe("- Training\n- Weekly lunch");
    expect(benefitLines([])).toBe("- None");
  });

  it("writes dates in full", () => {
    expect(contractDate("2026-10-05")).toBe("5 October 2026");
  });
});

describe("the People permissions", () => {
  it("can be granted from Settings", () => {
    expect(ALL_PERMISSIONS).toContain(PERMISSIONS.PEOPLE_READ);
    expect(ALL_PERMISSIONS).toContain(PERMISSIONS.PEOPLE_WRITE);
  });
});

describe("co-founder agreements", () => {
  it("are a kind of contract with no end date", async () => {
    const { CONTRACT_TYPES, isCofounder, tenureLabel, daysUntil } = await import("@/lib/people");
    expect(CONTRACT_TYPES).toContain("COFOUNDER");
    expect(isCofounder("COFOUNDER")).toBe(true);
    expect(isCofounder("PERMANENT")).toBe(false);
    expect(tenureLabel(null)).toBe("no fixed end");
    expect(daysUntil(null, "2026-10-05")).toBe(Number.POSITIVE_INFINITY);
  });

  it("word equity, vesting and capital as the agreement prints them", async () => {
    const { percentLabel, vestingLabel, capitalLabel } = await import("@/lib/people");
    expect(percentLabel("40.000")).toBe("40%");
    expect(percentLabel(12.5)).toBe("12.5%");
    expect(percentLabel(null, "in proportion to equity")).toBe("in proportion to equity");
    expect(vestingLabel(48, 12)).toBe("vests in equal monthly parts over 4 years, with a 12-month cliff");
    expect(vestingLabel(12, null)).toBe("vests in equal monthly parts over 1 year");
    expect(vestingLabel(30, 6)).toBe("vests in equal monthly parts over 30 months, with a 6-month cliff");
    expect(vestingLabel(null, null)).toBe("fully vested from the start date");
    expect(capitalLabel("500000", "PKR")).toBe("PKR 500,000");
    expect(capitalLabel(null, null)).toBe("None");
  });

  it("fill the co-founder placeholders", () => {
    const text = fillContract("{{equity}} · {{responsibilities}}", { equity: "40%", responsibilities: benefitLines(["Development", "Research"]) });
    expect(text).toBe("40% · - Development\n- Research");
  });
});

describe("Super Admin and CRM Admin", () => {
  it("lets a CRM Admin do everything except delete and manage roles", async () => {
    const { holds, ALL_BUT_DELETE } = await import("@/lib/nav-permissions");
    const crm = [ALL_BUT_DELETE];
    expect(holds(crm, "admin:*")).toBe(true);
    expect(holds(crm, "invoice:approve")).toBe(true);
    expect(holds(crm, "people:write")).toBe(true);
    expect(holds(crm, "some:future-permission")).toBe(true);
    expect(holds(crm, "record:delete")).toBe(false);
    expect(holds(crm, "role:manage")).toBe(false);
  });

  it("keeps deleting with the Super Admin alone", async () => {
    const { holds } = await import("@/lib/nav-permissions");
    const { RECYCLE_TYPES } = await import("@/lib/recycle-types");
    expect(holds(["*"], "record:delete")).toBe(true);
    // A Manager's wide grants no longer reach a delete.
    expect(holds(["lead:*", "account:*", "opportunity:*", "case:*", "project:*"], "record:delete")).toBe(false);
    for (const config of Object.values(RECYCLE_TYPES)) expect(config.permission).toBe("record:delete");
  });
});
