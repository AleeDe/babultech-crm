import { describe, it, expect } from "vitest";
import { parseExpenseDate, parseAmount, parseExpenseRows } from "../src/lib/parse-expense-rows";

/**
 * The date handling is the risky part of the importer: the same eight
 * characters can mean two different days, and picking wrong files an expense in
 * the wrong month without ever looking like an error.
 */
describe("parseExpenseDate", () => {
  it("reads an unambiguous numeric date month-first", () => {
    expect(parseExpenseDate("2/7/2026").date).toBe("2026-02-07");
    expect(parseExpenseDate("5/8/2026").date).toBe("2026-05-08");
  });

  it("switches to day-first when the first number cannot be a month", () => {
    expect(parseExpenseDate("25/05/2026").date).toBe("2026-05-25");
    expect(parseExpenseDate("30/04/2026").date).toBe("2026-04-30");
  });

  it("flags a date that reads either way", () => {
    const result = parseExpenseDate("06/11/2026");
    expect(result.date).toBe("2026-06-11");
    expect(result.note).toMatch(/month-first/);
  });

  it("does not flag a date whose halves are equal", () => {
    expect(parseExpenseDate("06/06/2026").note).toBeNull();
  });

  it("resolves a month-only cell to the first, and says so", () => {
    expect(parseExpenseDate("Feb 2026").date).toBe("2026-02-01");
    expect(parseExpenseDate("Mar2026").date).toBe("2026-03-01");
    expect(parseExpenseDate("Feb 2026").note).toMatch(/month only/);
  });

  it("accepts an ISO date unchanged", () => {
    expect(parseExpenseDate("2026-05-25").date).toBe("2026-05-25");
  });

  it("rejects a day the month does not have", () => {
    expect(parseExpenseDate("2/30/2026").date).toBeNull();
    expect(parseExpenseDate("13/45/2026").date).toBeNull();
  });

  it("reports an empty cell rather than guessing", () => {
    expect(parseExpenseDate("").error).toBeTruthy();
  });
});

describe("parseAmount", () => {
  it("strips separators and symbols", () => {
    expect(parseAmount("45000")).toBe(45000);
    expect(parseAmount("PKR 15,000")).toBe(15000);
    expect(parseAmount("2,745.50")).toBe(2745.5);
  });

  it("returns null for a cell with no number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });
});

describe("parseExpenseRows", () => {
  const sheet = [
    "Expense Type\tExpense By\tExpense Date\tExpense Amount\tNotes",
    "Rent\tHasan\t5/8/2026\t45000\t2 months advance",
    "Maintenance\tHasan\t25/05/2026\t2500\t",
  ].join("\n");

  it("skips the header row", () => {
    expect(parseExpenseRows(sheet)).toHaveLength(2);
  });

  it("reads the cells into fields", () => {
    const [rent] = parseExpenseRows(sheet);
    expect(rent.type).toBe("Rent");
    expect(rent.amount).toBe(45000);
    expect(rent.date).toBe("2026-05-08");
    expect(rent.notes).toBe("2 months advance");
    expect(rent.errors).toHaveLength(0);
  });

  it("collects errors per row instead of throwing", () => {
    const rows = parseExpenseRows("Rent\tHasan\tnot-a-date\tabc\t");
    expect(rows[0].errors.length).toBeGreaterThan(0);
  });
});
