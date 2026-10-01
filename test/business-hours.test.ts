/**
 * Working time for SLA deadlines: Monday to Thursday 09:00-18:00, Friday
 * 09:00-13:00, weekends off, in Karachi (UTC+5).
 */
import { describe, expect, it } from "vitest";
import { addWorkingMinutes, workingMinutesBetween, type WorkingCalendar } from "@/lib/business-hours";

const cal: WorkingCalendar = {
  timezone: "Asia/Karachi",
  weeklySchedule: {
    monday: { start: "09:00", end: "18:00" },
    tuesday: { start: "09:00", end: "18:00" },
    wednesday: { start: "09:00", end: "18:00" },
    thursday: { start: "09:00", end: "18:00" },
    friday: { start: "09:00", end: "13:00" },
    saturday: null,
    sunday: null,
  },
  holidays: [],
};

/** A Karachi local time as a moment. */
const pk = (local: string) => new Date(`${local}+05:00`);

describe("adding working minutes", () => {
  it("stays inside the same day when there is room", () => {
    // Thursday 1 October 2026, 10:00 + 4 hours = 14:00.
    expect(addWorkingMinutes(pk("2026-10-01T10:00:00"), 240, cal)).toEqual(pk("2026-10-01T14:00:00"));
  });

  it("carries over the evening into the next morning", () => {
    // Thursday 16:00 + 4 hours: 2 hours Thursday, 2 Friday morning = Friday 11:00.
    expect(addWorkingMinutes(pk("2026-10-01T16:00:00"), 240, cal)).toEqual(pk("2026-10-02T11:00:00"));
  });

  it("skips the weekend", () => {
    // Friday 12:00 + 4 hours: 1 hour Friday, 3 on Monday = Monday 12:00.
    expect(addWorkingMinutes(pk("2026-10-02T12:00:00"), 240, cal)).toEqual(pk("2026-10-05T12:00:00"));
  });

  it("starts the clock at opening time for something raised overnight", () => {
    // Saturday 22:00 + 1 hour = Monday 10:00.
    expect(addWorkingMinutes(pk("2026-10-03T22:00:00"), 60, cal)).toEqual(pk("2026-10-05T10:00:00"));
  });

  it("skips a holiday", () => {
    const withHoliday = { ...cal, holidays: [{ date: "2026-10-05", name: "Office closed" }] };
    expect(addWorkingMinutes(pk("2026-10-02T12:00:00"), 240, withHoliday)).toEqual(pk("2026-10-06T12:00:00"));
  });

  it("counts around the clock when there is no working time", () => {
    const none = { ...cal, weeklySchedule: {} };
    expect(addWorkingMinutes(pk("2026-10-02T12:00:00"), 240, none)).toEqual(pk("2026-10-02T16:00:00"));
    expect(addWorkingMinutes(pk("2026-10-02T12:00:00"), 240, null)).toEqual(pk("2026-10-02T16:00:00"));
  });
});

describe("working minutes between", () => {
  it("counts only open hours", () => {
    // Friday 12:00 to Monday 12:00: 1 hour Friday + 3 Monday.
    expect(workingMinutesBetween(pk("2026-10-02T12:00:00"), pk("2026-10-05T12:00:00"), cal)).toBe(240);
  });

  it("is zero over a weekend", () => {
    expect(workingMinutesBetween(pk("2026-10-03T08:00:00"), pk("2026-10-04T20:00:00"), cal)).toBe(0);
  });

  it("is the inverse of adding", () => {
    const from = pk("2026-10-01T15:30:00");
    const due = addWorkingMinutes(from, 600, cal);
    expect(workingMinutesBetween(from, due, cal)).toBe(600);
  });
});
