import { describe, expect, it } from "vitest";
import { filterDeliveryData } from "@/lib/delivery-filters";

const data = {
  projects: [{ id: "p1", status: "ACTIVE", health: "GREEN" }, { id: "p2", status: "AT_RISK", health: "RED" }],
  users: [{ id: "a" }, { id: "b" }, { id: "idle" }],
  members: [{ projectId: "p1", userId: "a" }, { projectId: "p2", userId: "b" }],
  tasks: [{ id: "t1", projectId: "p1", assignedUserId: "b" }, { id: "t2", projectId: "p2", assignedUserId: null }],
  logs: [{ projectId: "p1", userId: "a", hours: 2 }, { projectId: "p1", userId: "b", hours: 3 }],
  prevLogs: [{ projectId: "p2", userId: "a", hours: 4 }],
};

describe("delivery filter scope", () => {
  it("keeps idle people and unassigned work when no filters are selected", () => {
    const result = filterDeliveryData(data, {});
    expect(result.users).toEqual(data.users);
    expect(result.tasks).toEqual(data.tasks);
    expect(result.logs).toEqual(data.logs);
  });

  it("intersects resource and project across logs, tasks, membership and comparison", () => {
    const result = filterDeliveryData(data, { resource: "b", project: "p1" });
    expect(result.users).toEqual([{ id: "b" }]);
    expect(result.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(result.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(result.logs.map((l) => l.hours)).toEqual([3]);
    expect(result.members).toEqual([]);
    expect(result.prevLogs).toEqual([]);
  });

  it("includes contributors without membership and excludes unrelated capacity", () => {
    const result = filterDeliveryData(data, { project: "p1" });
    expect(result.users.map((u) => u.id)).toEqual(["a", "b"]);
    expect(result.prevLogs).toEqual([]);
  });

  it("preserves previous-period contributions to a resource's project scope", () => {
    const result = filterDeliveryData(data, { resource: "a" });
    expect(result.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.prevLogs.map((l) => l.hours)).toEqual([4]);
    expect(result.logs.map((l) => l.hours)).toEqual([2]);
    expect(result.tasks).toEqual([]);
  });

  it("combines status and health, preserving unassigned tasks", () => {
    const result = filterDeliveryData(data, { projectStatus: "AT_RISK", health: "RED" });
    expect(result.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(result.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(result.logs).toEqual([]);
  });

  it("does not fall back to all data for invalid or conflicting selections", () => {
    for (const filters of [{ project: "hidden" }, { project: "p1", health: "RED" }, { resource: "unknown" }]) {
      const result = filterDeliveryData(data, filters);
      expect(result.projects).toEqual([]);
      expect(result.users).toEqual([]);
      expect(result.logs).toEqual([]);
      expect(result.prevLogs).toEqual([]);
      expect(result.tasks).toEqual([]);
    }
  });
});
