import { describe, it, expect } from "vitest";
import {
  parseExpenseDate, parseAmount, parseExpenseRows,
  splitSheet, guessMapping, parseMappedRows,
} from "../src/lib/parse-expense-rows";

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

/**
 * The mapping is what lets a sheet import in whatever order its columns are
 * already in. A wrong guess is recoverable — the importer shows it and lets it
 * be corrected — but a guess that quietly reads the wrong column as the amount
 * is how the wrong number reaches the accounts, so the common shapes are pinned
 * here.
 */
describe("splitSheet", () => {
  it("detects a header row and keeps it out of the body", () => {
    const sheet = splitSheet("Expense Type,Expense Date,Amount\nRent,5/8/2026,45000");
    expect(sheet.header).toEqual(["Expense Type", "Expense Date", "Amount"]);
    expect(sheet.rows).toHaveLength(1);
  });

  it("keeps a first row of data when it only looks like a header", () => {
    // "Type approval fee" contains both "type" and "date" is absent, but the
    // amount cell settles it: this is data.
    const sheet = splitSheet("Type approval fee,Notes on date,45000\nRent,x,100");
    expect(sheet.header).toBeNull();
    expect(sheet.rows).toHaveLength(2);
  });

  it("pads short rows to the widest, so a trailing empty cell is addressable", () => {
    const sheet = splitSheet("Rent,Hasan,5/8/2026,45000,note\nInternet,Hasan,2/12/2026,7000");
    expect(sheet.width).toBe(5);
    expect(sheet.rows[1].cells).toHaveLength(5);
  });

  it("returns nothing for empty text", () => {
    expect(splitSheet("   ").rows).toHaveLength(0);
  });
});

describe("guessMapping", () => {
  const guess = (text: string) => guessMapping(splitSheet(text));

  it("reads the fields off header names in any order", () => {
    expect(guess("Amount,Notes,Date,Category\n45000,adv,5/8/2026,Rent")).toEqual([
      "amount", "notes", "date", "type",
    ]);
  });

  it("does not let the amount rule claim an Expense By column", () => {
    const mapping = guess("Expense Type,Expense By,Expense Date,Expense Amount,Notes\nRent,Hasan,5/8/2026,45000,x");
    expect(mapping).toEqual(["type", "by", "date", "amount", "notes"]);
  });

  it("falls back to the legacy order for an unlabelled paste", () => {
    const mapping = guess("Rent\tHasan\t5/8/2026\t45000\t2 months advance");
    expect(mapping).toEqual(["type", "by", "date", "amount", "notes"]);
  });

  it("finds the date and amount by their values when the header is unhelpful", () => {
    const mapping = guess(
      ["Col1,Col2,Col3", "Rent,5/8/2026,45000", "Internet,2/12/2026,7000"].join("\n"),
    );
    expect(mapping[1]).toBe("date");
    expect(mapping[2]).toBe("amount");
  });
});

describe("parseMappedRows", () => {
  it("reads each field from the column it is pointed at", () => {
    const sheet = splitSheet("45000,5/8/2026,Rent\n7000,2/12/2026,Internet");
    const rows = parseMappedRows(sheet, ["amount", "date", "type"]);
    expect(rows[0]).toMatchObject({ type: "Rent", amount: 45000, date: "2026-05-08" });
    expect(rows[0].errors).toHaveLength(0);
  });

  it("leaves ignored columns out entirely", () => {
    // Column 0 is a running serial that must not become an amount.
    const sheet = splitSheet("1,Rent,5/8/2026,45000");
    const rows = parseMappedRows(sheet, [null, "type", "date", "amount"]);
    expect(rows[0].amount).toBe(45000);
  });

  it("joins every column mapped to notes", () => {
    const sheet = splitSheet("Rent,5/8/2026,45000,two months,advance");
    const rows = parseMappedRows(sheet, ["type", "date", "amount", "notes", "notes"]);
    expect(rows[0].notes).toBe("two months advance");
  });

  it("reports a required field that no column supplies", () => {
    const sheet = splitSheet("Rent,5/8/2026,45000");
    const rows = parseMappedRows(sheet, ["type", "date", null]);
    expect(rows[0].errors.join(" ")).toMatch(/amount/i);
  });
});

/**
 * Two ways an amount column and a date column could be confused for each other.
 * Both were live: the importer accepted an amount as a date, and the guesser
 * read a date as money. Either one files the wrong number against the wrong
 * month without ever looking like an error.
 */
describe("amounts are not dates", () => {
  it("refuses a bare number as a date", () => {
    // Date() reads this as the first of January in the year 45000.
    expect(parseExpenseDate("45000").date).toBeNull();
    expect(parseExpenseDate("45000").error).toBeTruthy();
  });

  it("refuses a year outside any plausible range", () => {
    expect(parseExpenseDate("1 Jan 1200").date).toBeNull();
  });

  it("does not read a date column as the amount", () => {
    // parseAmount strips the slashes out of 5/8/2026 and returns 582026.
    const mapping = guessMapping(splitSheet("Col1,Col2,Col3\nRent,5/8/2026,45000\nInternet,2/12/2026,7000"));
    expect(mapping).toEqual(["type", "date", "amount"]);
  });

  it("ignores a serial column and finds the type by its values", () => {
    const mapping = guessMapping(
      splitSheet("S.No\tDate\tParticulars\tDebit\n1\t5/8/2026\tRent\t45000\n2\t2/12/2026\tInternet\t7000"),
    );
    expect(mapping).toEqual([null, "date", "type", "amount"]);
  });
});

/**
 * Quoting comes free from parseDelimited, and it is worth pinning: a sheet
 * exports "Rs 45,000" and a note containing a comma as quoted cells, and
 * splitting on every comma would shred both.
 */
describe("quoted cells", () => {
  it("keeps a quoted amount and a quoted note in one cell each", () => {
    const sheet = splitSheet(
      'Expense Type,Expense Date,Expense Amount,Notes\nRent,5/8/2026,"Rs 45,000","Two months, paid early"',
    );
    const [row] = parseMappedRows(sheet, guessMapping(sheet));
    expect(row.amount).toBe(45000);
    expect(row.notes).toBe("Two months, paid early");
    expect(row.errors).toHaveLength(0);
  });
});
