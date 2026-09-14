import { describe, it, expect } from "vitest";
import {
  resolveRange, previousRange, rangeDays, workingDays, withinRange,
  isValidDay, rangeToParams, MAX_N_DAYS,
} from "@/lib/date-range";

/**
 * A fixed "today" so these assertions never depend on the clock.
 *
 * 2026-09-14 is a Monday, which is the awkward case for week maths: an
 * off-by-one in the Monday-first shift would still look right on a Wednesday.
 */
const TODAY = "2026-09-14";

describe("resolveRange presets", () => {
  it("today and yesterday are single days", () => {
    expect(resolveRange({ range: "today" }, TODAY)).toMatchObject({
      from: "2026-09-14", to: "2026-09-14",
    });
    expect(resolveRange({ range: "yesterday" }, TODAY)).toMatchObject({
      from: "2026-09-13", to: "2026-09-13",
    });
  });

  it("this week starts on Monday and ends today, not on Sunday", () => {
    // TODAY is itself a Monday, so the week starts on it.
    expect(resolveRange({ range: "this_week" }, TODAY)).toMatchObject({
      from: "2026-09-14", to: "2026-09-14",
    });
    // Midweek the start must still be that Monday.
    expect(resolveRange({ range: "this_week" }, "2026-09-17")).toMatchObject({
      from: "2026-09-14", to: "2026-09-17",
    });
    // Sunday belongs to the week that began the previous Monday.
    expect(resolveRange({ range: "this_week" }, "2026-09-20")).toMatchObject({
      from: "2026-09-14", to: "2026-09-20",
    });
  });

  it("last week is the full Monday-to-Sunday before this one", () => {
    expect(resolveRange({ range: "last_week" }, TODAY)).toMatchObject({
      from: "2026-09-07", to: "2026-09-13",
    });
  });

  it("this month runs from the 1st to today", () => {
    expect(resolveRange({ range: "this_month" }, TODAY)).toMatchObject({
      from: "2026-09-01", to: "2026-09-14",
    });
  });

  it("last month covers the whole previous month", () => {
    expect(resolveRange({ range: "last_month" }, TODAY)).toMatchObject({
      from: "2026-08-01", to: "2026-08-31",
    });
    // Crossing a year boundary.
    expect(resolveRange({ range: "last_month" }, "2026-01-09")).toMatchObject({
      from: "2025-12-01", to: "2025-12-31",
    });
    // A 28-day February.
    expect(resolveRange({ range: "last_month" }, "2026-03-15")).toMatchObject({
      from: "2026-02-01", to: "2026-02-28",
    });
    // A leap February.
    expect(resolveRange({ range: "last_month" }, "2024-03-15")).toMatchObject({
      from: "2024-02-01", to: "2024-02-29",
    });
  });

  it("quarters align to Jan/Apr/Jul/Oct", () => {
    expect(resolveRange({ range: "this_quarter" }, TODAY)).toMatchObject({
      from: "2026-07-01", to: "2026-09-14",
    });
    expect(resolveRange({ range: "last_quarter" }, TODAY)).toMatchObject({
      from: "2026-04-01", to: "2026-06-30",
    });
    // Q1 falls back into the previous year.
    expect(resolveRange({ range: "last_quarter" }, "2026-02-10")).toMatchObject({
      from: "2025-10-01", to: "2025-12-31",
    });
  });

  it("years run from 1 January", () => {
    expect(resolveRange({ range: "this_year" }, TODAY)).toMatchObject({
      from: "2026-01-01", to: "2026-09-14",
    });
    expect(resolveRange({ range: "last_year" }, TODAY)).toMatchObject({
      from: "2025-01-01", to: "2025-12-31",
    });
  });

  it("all time has no bounds", () => {
    expect(resolveRange({ range: "all" }, TODAY)).toMatchObject({ from: null, to: null });
  });
});

describe("last N days", () => {
  it("is inclusive of today, so 7 days is a week ending now", () => {
    expect(resolveRange({ range: "last_n_days", days: "7" }, TODAY)).toMatchObject({
      from: "2026-09-08", to: "2026-09-14", days: 7,
    });
    expect(resolveRange({ range: "last_n_days", days: "1" }, TODAY)).toMatchObject({
      from: "2026-09-14", to: "2026-09-14", days: 1,
    });
  });

  it("clamps nonsense rather than widening the range", () => {
    // 0 and negatives are a typo, not "show me everything".
    expect(resolveRange({ range: "last_n_days", days: "0" }, TODAY).days).toBe(1);
    expect(resolveRange({ range: "last_n_days", days: "-5" }, TODAY).days).toBe(1);
    expect(resolveRange({ range: "last_n_days", days: "99999" }, TODAY).days).toBe(MAX_N_DAYS);
    // Non-numeric falls back to a sensible default instead of NaN.
    expect(resolveRange({ range: "last_n_days", days: "abc" }, TODAY).days).toBe(30);
    expect(resolveRange({ range: "last_n_days" }, TODAY).days).toBe(30);
    // Fractions truncate rather than producing a half-day boundary.
    expect(resolveRange({ range: "last_n_days", days: "7.9" }, TODAY).days).toBe(7);
  });
});

describe("custom ranges", () => {
  it("accepts a well-formed pair", () => {
    expect(resolveRange({ range: "custom", from: "2026-03-01", to: "2026-03-31" }, TODAY))
      .toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("swaps reversed dates instead of showing nothing", () => {
    expect(resolveRange({ range: "custom", from: "2026-03-31", to: "2026-03-01" }, TODAY))
      .toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("falls back while the pair is incomplete or malformed", () => {
    // This is what the URL looks like mid-typing; it must not break the page.
    for (const params of [
      { range: "custom", from: "2026-03-01" },
      { range: "custom", to: "2026-03-31" },
      { range: "custom" },
      { range: "custom", from: "not-a-date", to: "2026-03-31" },
      { range: "custom", from: "2026-02-30", to: "2026-03-31" },
    ]) {
      const r = resolveRange(params, TODAY);
      expect(r.from).toBe("2026-09-01");
      expect(r.to).toBe("2026-09-14");
    }
  });
});

describe("bad input never breaks the page", () => {
  it("an unknown preset falls back to the default", () => {
    expect(resolveRange({ range: "nonsense" }, TODAY)).toMatchObject({
      from: "2026-09-01", to: "2026-09-14",
    });
    expect(resolveRange({}, TODAY)).toMatchObject({ from: "2026-09-01" });
  });
});

describe("isValidDay", () => {
  it("accepts real calendar days only", () => {
    expect(isValidDay("2026-09-14")).toBe(true);
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2026-02-30")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("14-09-2026")).toBe(false);
    expect(isValidDay("")).toBe(false);
    expect(isValidDay(null)).toBe(false);
    expect(isValidDay(20260914)).toBe(false);
  });
});

describe("derived helpers", () => {
  it("rangeDays counts inclusively", () => {
    expect(rangeDays(resolveRange({ range: "today" }, TODAY))).toBe(1);
    expect(rangeDays(resolveRange({ range: "last_week" }, TODAY))).toBe(7);
    expect(rangeDays(resolveRange({ range: "last_month" }, TODAY))).toBe(31);
    expect(rangeDays(resolveRange({ range: "all" }, TODAY))).toBeNull();
  });

  it("workingDays excludes weekends", () => {
    // A full Mon-Sun week has five.
    expect(workingDays(resolveRange({ range: "last_week" }, TODAY))).toBe(5);
    // A single Saturday has none.
    expect(workingDays(resolveRange({ range: "custom", from: "2026-09-12", to: "2026-09-12" }, TODAY)))
      .toBe(0);
  });

  it("previousRange is the same span immediately before", () => {
    expect(previousRange(resolveRange({ range: "last_week" }, TODAY)))
      .toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(previousRange(resolveRange({ range: "today" }, TODAY)))
      .toEqual({ from: "2026-09-13", to: "2026-09-13" });
    expect(previousRange(resolveRange({ range: "all" }, TODAY))).toBeNull();
  });

  it("withinRange compares by day and accepts timestamps", () => {
    const r = resolveRange({ range: "last_week" }, TODAY); // 07–13 Sept
    expect(withinRange(r, "2026-09-07")).toBe(true);
    expect(withinRange(r, "2026-09-13")).toBe(true);
    expect(withinRange(r, "2026-09-06")).toBe(false);
    expect(withinRange(r, "2026-09-14")).toBe(false);
    // A timestamp is truncated to its day rather than failing to compare.
    expect(withinRange(r, "2026-09-10T23:59:59.000Z")).toBe(true);
    expect(withinRange(r, null)).toBe(false);
    // Everything is inside an unbounded range.
    expect(withinRange(resolveRange({ range: "all" }, TODAY), "1999-01-01")).toBe(true);
  });
});

describe("rangeToParams", () => {
  it("keeps the default out of the URL", () => {
    expect(rangeToParams(resolveRange({ range: "this_month" }, TODAY)).toString()).toBe("");
  });

  it("round-trips every preset back to the same range", () => {
    for (const preset of [
      "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
      "this_quarter", "last_quarter", "this_year", "last_year", "all",
    ]) {
      const original = resolveRange({ range: preset }, TODAY);
      const params = Object.fromEntries(rangeToParams(original));
      const round = resolveRange(params as Record<string, string>, TODAY);
      expect(round.from).toBe(original.from);
      expect(round.to).toBe(original.to);
    }
  });

  it("round-trips custom and last-N ranges", () => {
    const custom = resolveRange({ range: "custom", from: "2026-01-05", to: "2026-02-09" }, TODAY);
    const roundCustom = resolveRange(
      Object.fromEntries(rangeToParams(custom)) as Record<string, string>, TODAY,
    );
    expect(roundCustom).toMatchObject({ from: "2026-01-05", to: "2026-02-09" });

    const lastN = resolveRange({ range: "last_n_days", days: "14" }, TODAY);
    const roundN = resolveRange(
      Object.fromEntries(rangeToParams(lastN)) as Record<string, string>, TODAY,
    );
    expect(roundN).toMatchObject({ days: 14, from: "2026-09-01", to: "2026-09-14" });
  });
});
