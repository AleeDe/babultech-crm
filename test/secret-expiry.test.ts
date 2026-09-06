/**
 * Expiry and rotation arithmetic.
 *
 * The cases worth pinning are the boundaries and the absences: "no expiry set"
 * must never read as "expired", and a key that has never been rotated must
 * still come due — that is the one the policy exists for.
 */
import { describe, it, expect } from "vitest";
import {
  daysUntil,
  expiryLevel,
  expiryPhrase,
  nextRotationDue,
  rotationOverdue,
} from "@/lib/secret-expiry";

// A fixed "now" so these never drift with the calendar.
const NOW = new Date("2026-09-06T12:00:00Z");

describe("daysUntil", () => {
  it("counts forward", () => {
    expect(daysUntil("2026-09-20", NOW)).toBe(14);
  });

  it("goes negative once passed", () => {
    expect(daysUntil("2026-09-01", NOW)).toBe(-5);
  });

  it("calls today zero regardless of the time of day", () => {
    // The clock is at midday; a date-only value parses to midnight. Comparing
    // raw timestamps would give -1 here and mark today's expiry as passed.
    expect(daysUntil("2026-09-06", NOW)).toBe(0);
  });
});

describe("expiryLevel", () => {
  it("treats a missing date as no expiry, not as expired", () => {
    expect(expiryLevel(null, NOW)).toBe("NONE");
    expect(expiryLevel(undefined, NOW)).toBe("NONE");
    expect(expiryLevel("", NOW)).toBe("NONE");
  });

  it("flags a date in the past", () => {
    expect(expiryLevel("2026-09-05", NOW)).toBe("EXPIRED");
  });

  it("counts today as critical, not expired", () => {
    expect(expiryLevel("2026-09-06", NOW)).toBe("CRITICAL");
  });

  it("escalates as the date approaches", () => {
    expect(expiryLevel("2026-09-13", NOW)).toBe("CRITICAL"); // 7 days
    expect(expiryLevel("2026-09-14", NOW)).toBe("WARNING"); // 8 days
    expect(expiryLevel("2026-10-06", NOW)).toBe("WARNING"); // 30 days
    expect(expiryLevel("2026-10-07", NOW)).toBe("OK"); // 31 days
  });
});

describe("rotation", () => {
  it("is not due when no policy is set", () => {
    expect(nextRotationDue("2026-01-01", null)).toBeNull();
    expect(rotationOverdue("2026-01-01", null, null, NOW)).toBe(false);
  });

  it("counts from the last rotation", () => {
    const due = nextRotationDue("2026-08-01", 90);
    expect(due?.toISOString().slice(0, 10)).toBe("2026-10-30");
  });

  it("falls back to when it was added if never rotated", () => {
    // The case the policy is actually for: a key nobody has ever touched.
    const due = nextRotationDue(null, 30, "2026-07-01");
    expect(due?.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(rotationOverdue(null, 30, "2026-07-01", NOW)).toBe(true);
  });

  it("is not overdue before the due date", () => {
    expect(rotationOverdue("2026-09-01", 90, null, NOW)).toBe(false);
  });

  it("has nothing to measure with neither date", () => {
    expect(nextRotationDue(null, 90, null)).toBeNull();
  });
});

describe("expiryPhrase", () => {
  it("says so when there is no expiry", () => {
    expect(expiryPhrase(null, NOW)).toBe("No expiry");
  });

  it("reads naturally around today", () => {
    expect(expiryPhrase("2026-09-06", NOW)).toBe("Expires today");
    expect(expiryPhrase("2026-09-07", NOW)).toBe("Expires tomorrow");
    expect(expiryPhrase("2026-09-05", NOW)).toBe("Expired yesterday");
    expect(expiryPhrase("2026-09-01", NOW)).toBe("Expired 5 days ago");
    expect(expiryPhrase("2026-09-20", NOW)).toBe("Expires in 14 days");
  });
});
