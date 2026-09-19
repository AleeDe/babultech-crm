import { describe, expect, it } from "vitest";
import {
  isWorkingDay, addDays, workingDaysBetween, taskHoursInWindow,
  capacityForWindow, byLoad, weekStart, windowFor, summarise,
  type PlannedTask,
} from "@/lib/capacity";

// 2026-06-01 is a Monday.
const MONDAY = "2026-06-01";
const FRIDAY = "2026-06-05";
const week = { from: MONDAY, to: "2026-06-07" };

const task = (overrides: Partial<PlannedTask> = {}): PlannedTask => ({
  id: "t1", name: "Write copy", projectId: "p1", projectName: "Launch",
  assignedUserId: "u1", startDate: MONDAY, dueDate: FRIDAY,
  estimatedHours: 10, completionPercent: 0, status: "IN_PROGRESS", ...overrides,
});

describe("working days", () => {
  it("counts weekdays and skips weekends", () => {
    expect(isWorkingDay(MONDAY)).toBe(true);
    expect(isWorkingDay("2026-06-06")).toBe(false);
    expect(isWorkingDay("2026-06-07")).toBe(false);
  });

  it("counts a full week as five days", () => {
    expect(workingDaysBetween(MONDAY, "2026-06-07")).toBe(5);
  });

  it("counts a single weekday as one", () => {
    expect(workingDaysBetween(MONDAY, MONDAY)).toBe(1);
  });

  it("counts a weekend-only span as zero", () => {
    expect(workingDaysBetween("2026-06-06", "2026-06-07")).toBe(0);
  });

  it("returns zero when the range is backwards", () => {
    expect(workingDaysBetween(FRIDAY, MONDAY)).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
  });
});

describe("hours landing in a window", () => {
  it("spreads a task evenly across its working days", () => {
    // 10 hours over Mon-Fri, all inside the window.
    expect(taskHoursInWindow(task(), week)).toBeCloseTo(10);
  });

  it("counts only the part that falls inside the window", () => {
    // Mon-Fri, but the window is Mon-Tue: two of five days.
    const hours = taskHoursInWindow(task(), { from: MONDAY, to: "2026-06-02" });
    expect(hours).toBeCloseTo(4);
  });

  it("excludes work already done", () => {
    expect(taskHoursInWindow(task({ completionPercent: 60 }), week)).toBeCloseTo(4);
  });

  it("counts nothing for a finished or cancelled task", () => {
    expect(taskHoursInWindow(task({ status: "COMPLETED" }), week)).toBe(0);
    expect(taskHoursInWindow(task({ status: "CANCELLED" }), week)).toBe(0);
  });

  it("counts nothing for a task with no estimate", () => {
    expect(taskHoursInWindow(task({ estimatedHours: null }), week)).toBe(0);
    expect(taskHoursInWindow(task({ estimatedHours: 0 }), week)).toBe(0);
  });

  it("counts nothing for a task with no due date, which cannot be placed", () => {
    expect(taskHoursInWindow(task({ dueDate: null }), week)).toBe(0);
  });

  it("puts an undated start on the due date", () => {
    const hours = taskHoursInWindow(task({ startDate: null }), { from: FRIDAY, to: FRIDAY });
    expect(hours).toBeCloseTo(10);
  });

  it("ignores a start date after the due date rather than producing nonsense", () => {
    const hours = taskHoursInWindow(task({ startDate: "2026-06-20", dueDate: FRIDAY }), week);
    expect(hours).toBeCloseTo(10);
  });

  it("does not lose work whose whole span is a weekend", () => {
    const hours = taskHoursInWindow(
      task({ startDate: "2026-06-06", dueDate: "2026-06-07" }),
      { from: MONDAY, to: "2026-06-07" },
    );
    expect(hours).toBeCloseTo(10);
  });

  it("counts nothing for a task entirely outside the window", () => {
    expect(taskHoursInWindow(task({ startDate: "2026-07-01", dueDate: "2026-07-03" }), week)).toBe(0);
  });

  it("counts a task that finishes 100 per cent as nothing, whatever its status", () => {
    expect(taskHoursInWindow(task({ completionPercent: 100 }), week)).toBe(0);
  });
});

describe("capacity per person", () => {
  const people = [
    { id: "u1", fullName: "Sami" },
    { id: "u2", fullName: "Ali" },
  ];

  it("adds up each person's planned hours", () => {
    const rows = capacityForWindow(people, [task(), task({ id: "t2", estimatedHours: 5 })], week);
    expect(rows[0].plannedHours).toBeCloseTo(15);
  });

  it("works out available hours from working days", () => {
    // Five working days at eight hours.
    expect(capacityForWindow(people, [], week)[0].availableHours).toBe(40);
  });

  it("flags somebody over their available hours", () => {
    const rows = capacityForWindow(people, [task({ estimatedHours: 50 })], week);
    expect(rows[0].overloaded).toBe(true);
    expect(rows[0].loadPercent).toBe(125);
  });

  it("does not flag somebody exactly at capacity", () => {
    const rows = capacityForWindow(people, [task({ estimatedHours: 40 })], week);
    expect(rows[0].overloaded).toBe(false);
    expect(rows[0].loadPercent).toBe(100);
  });

  it("includes people with nothing booked, because that is who can take work", () => {
    const rows = capacityForWindow(people, [task()], week);
    const ali = rows.find((r) => r.userId === "u2")!;
    expect(ali.plannedHours).toBe(0);
    expect(ali.loadPercent).toBe(0);
  });

  it("does not attribute one person's work to another", () => {
    const rows = capacityForWindow(people, [task({ assignedUserId: "u2" })], week);
    expect(rows.find((r) => r.userId === "u1")!.plannedHours).toBe(0);
    expect(rows.find((r) => r.userId === "u2")!.plannedHours).toBeCloseTo(10);
  });

  it("ignores work assigned to nobody", () => {
    const rows = capacityForWindow(people, [task({ assignedUserId: null })], week);
    expect(rows.every((r) => r.plannedHours === 0)).toBe(true);
  });

  it("counts unestimated open tasks separately, since they are invisible to the forecast", () => {
    const rows = capacityForWindow(people, [task({ estimatedHours: null })], week);
    expect(rows[0].plannedHours).toBe(0);
    expect(rows[0].unestimatedTasks).toBe(1);
  });

  it("does not count a finished task as unestimated", () => {
    const rows = capacityForWindow(people, [task({ estimatedHours: null, status: "COMPLETED" })], week);
    expect(rows[0].unestimatedTasks).toBe(0);
  });

  it("counts open tasks with no due date, which cannot be scheduled", () => {
    const rows = capacityForWindow(people, [task({ dueDate: null })], week);
    expect(rows[0].undatedTasks).toBe(1);
  });

  it("lists the tasks making up the load, heaviest first", () => {
    const rows = capacityForWindow(people, [
      task({ id: "small", estimatedHours: 2 }),
      task({ id: "big", estimatedHours: 20 }),
    ], week);
    expect(rows[0].tasks.map((t) => t.id)).toEqual(["big", "small"]);
  });

  it("leaves out tasks contributing no hours to the window", () => {
    const rows = capacityForWindow(people, [task({ status: "COMPLETED" })], week);
    expect(rows[0].tasks).toEqual([]);
  });
});

describe("ordering and summary", () => {
  const people = [
    { id: "u1", fullName: "Sami" },
    { id: "u2", fullName: "Ali" },
    { id: "u3", fullName: "Hassan" },
  ];

  it("puts the most loaded first", () => {
    const rows = capacityForWindow(people, [
      task({ assignedUserId: "u2", estimatedHours: 50 }),
      task({ id: "t2", assignedUserId: "u1", estimatedHours: 10 }),
    ], week);
    expect(byLoad(rows).map((r) => r.fullName)).toEqual(["Ali", "Sami", "Hassan"]);
  });

  it("counts who is overloaded and who has room", () => {
    const rows = capacityForWindow(people, [
      task({ assignedUserId: "u1", estimatedHours: 50 }),
      task({ id: "t2", assignedUserId: "u2", estimatedHours: 38 }),
      task({ id: "t3", assignedUserId: "u3", estimatedHours: null }),
    ], week);
    const totals = summarise(rows);
    expect(totals.people).toBe(3);
    expect(totals.overloaded).toBe(1);
    // Hassan has nothing forecast, so he counts as having room.
    expect(totals.free).toBe(1);
    expect(totals.unestimated).toBe(1);
  });
});

describe("windows", () => {
  it("starts a window on the Monday of the current week", () => {
    expect(weekStart("2026-06-03")).toBe(MONDAY);
    expect(weekStart(MONDAY)).toBe(MONDAY);
    expect(weekStart("2026-06-07")).toBe(MONDAY);
  });

  it("covers whole weeks from that Monday", () => {
    expect(windowFor("2026-06-03", 1)).toEqual({ from: MONDAY, to: "2026-06-07" });
    expect(windowFor("2026-06-03", 4)).toEqual({ from: MONDAY, to: "2026-06-28" });
  });
});
