/**
 * Clock-time arithmetic behind the timesheet's start/end fields.
 *
 * `hours` stays the billable figure everything downstream reads, so where a
 * person gives clock times the duration is derived rather than trusted. Getting
 * that derivation wrong would mis-bill a customer, which is why it is tested
 * directly rather than through the form.
 */
import { describe, it, expect } from "vitest";
import { parseClock, hoursBetween, normaliseClock, findOverlaps } from "@/lib/work-hours";

describe("parseClock", () => {
  it("reads a padded and an unpadded time", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("9:00")).toBe(540);
  });

  it("accepts the seconds a TIME column returns", () => {
    expect(parseClock("09:30:00")).toBe(570);
  });

  it("rejects impossible clock values", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("09:60")).toBeNull();
    expect(parseClock("half nine")).toBeNull();
  });

  it("treats blank as absent rather than midnight", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock(undefined)).toBeNull();
  });
});

describe("hoursBetween", () => {
  it("computes a normal working day", () => {
    expect(hoursBetween("09:00", "17:30")).toBe(8.5);
  });

  it("handles quarter hours exactly", () => {
    expect(hoursBetween("09:00", "09:15")).toBe(0.25);
    expect(hoursBetween("13:45", "17:00")).toBe(3.25);
  });

  it("reads an end before the start as crossing midnight", () => {
    // A late shift is four hours, not minus twenty.
    expect(hoursBetween("22:00", "02:00")).toBe(4);
  });

  it("refuses a zero-length entry", () => {
    expect(hoursBetween("09:00", "09:00")).toBeNull();
  });

  it("returns null when either end is missing", () => {
    expect(hoursBetween("09:00", null)).toBeNull();
    expect(hoursBetween(null, "17:00")).toBeNull();
  });

  it("rounds to the two decimals the column stores", () => {
    // 20 minutes is 0.333… hours; the column is DECIMAL(8,2).
    expect(hoursBetween("09:00", "09:20")).toBe(0.33);
  });
});

describe("normaliseClock", () => {
  it("pads so stored text matches what the database returns", () => {
    expect(normaliseClock("9:05")).toBe("09:05");
  });

  it("passes through an already-padded value", () => {
    expect(normaliseClock("17:30")).toBe("17:30");
  });

  it("returns null for unusable input rather than a wrong time", () => {
    expect(normaliseClock("nonsense")).toBeNull();
  });
});

describe("findOverlaps", () => {
  const span = (startTime: string | null, endTime: string | null) => ({ startTime, endTime });

  it("finds nothing in a day of back-to-back work", () => {
    // Touching ends are not an overlap — that is the normal shape of a day.
    expect(findOverlaps([
      span("09:00", "11:00"),
      span("11:00", "12:30"),
      span("13:00", "17:00"),
    ])).toEqual([]);
  });

  it("names both entries that clash", () => {
    expect(findOverlaps([
      span("09:00", "11:00"),
      span("10:00", "12:00"),
    ])).toEqual([0, 1]);
  });

  it("leaves untimed entries out of it", () => {
    // A duration with no clock times cannot conflict with anything.
    expect(findOverlaps([
      span("09:00", "11:00"),
      span(null, null),
    ])).toEqual([]);
  });

  it("catches an overnight span overlapping an early start", () => {
    // 22:00–02:00 genuinely covers 01:00–03:00's first hour.
    expect(findOverlaps([
      span("22:00", "02:00"),
      span("01:00", "03:00"),
    ])).toEqual([0, 1]);
  });

  it("reports every entry involved when three collide", () => {
    expect(findOverlaps([
      span("09:00", "12:00"),
      span("10:00", "11:00"),
      span("11:30", "13:00"),
    ])).toEqual([0, 1, 2]);
  });

  it("leaves a clean entry out of the list", () => {
    expect(findOverlaps([
      span("09:00", "11:00"),
      span("10:00", "12:00"),
      span("14:00", "15:00"),
    ])).toEqual([0, 1]);
  });
});
