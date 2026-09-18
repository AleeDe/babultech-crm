import { describe, expect, it } from "vitest";
import { analyzeAccessBaseline, type AccessBaseline } from "@/lib/access-baseline";

function snapshot(): AccessBaseline {
  return {
    users: [
      { id: "pm", status: "ACTIVE", deletedAt: null, jobTitle: "PM", managerUserId: null, roleId: "team" },
      { id: "worker", status: "ACTIVE", deletedAt: null, jobTitle: null, managerUserId: "pm", roleId: "own" },
      { id: "former", status: "INACTIVE", deletedAt: null, jobTitle: null, managerUserId: null, roleId: "own" },
    ],
    roles: [
      { id: "team", name: "PM", dataScope: "TEAM", permissions: ["project:*"] },
      { id: "own", name: "Contributor", dataScope: "OWN", permissions: ["project:read"] },
    ],
    teamMembers: [{ userId: "former", teamId: "delivery" }],
    projectMembers: [{ userId: "former", projectId: "project", active: true }],
    projects: [{ id: "project", projectManagerId: "former", deletedAt: null }],
  };
}

describe("read-only access baseline", () => {
  it("flags ineffective scope, inactive assignments and missing staff details", () => {
    const result = analyzeAccessBaseline(snapshot());
    expect(result.counts.activeUsers).toBe(2);
    expect(result.findings.teamScopeWithoutMembership).toEqual(["pm"]);
    expect(result.findings.missingJobTitle).toEqual(["worker"]);
    expect(result.findings.invalidProjectManager).toEqual(["project"]);
    expect(result.findings.unstaffedProjects).toEqual(["project"]);
    expect(result.findings.inactiveProjectMembership).toHaveLength(1);
  });

  it("does not confuse valid manager ownership with an unstaffed project", () => {
    const data = snapshot();
    data.projects[0].projectManagerId = "pm";
    const before = structuredClone(data);
    expect(analyzeAccessBaseline(data).findings.unstaffedProjects).toEqual([]);
    expect(data).toEqual(before);
  });

  it("handles reporting cycles without hanging and excludes deactivated members", () => {
    const data = snapshot();
    data.users[0].managerUserId = "worker";
    data.projectMembers[0].active = false;
    const result = analyzeAccessBaseline(data);
    expect(result.findings.reportingHierarchyCycle).toEqual(["pm", "worker"]);
    expect(result.findings.inactiveProjectMembership).toEqual([]);
  });

  it("treats soft-deleted people as inactive and ignores deleted projects", () => {
    const data = snapshot();
    data.users[0].deletedAt = "2026-09-18";
    data.projects[0].deletedAt = "2026-09-18";
    const result = analyzeAccessBaseline(data);
    expect(result.findings.invalidReportingManager).toEqual(["worker"]);
    expect(result.findings.unstaffedProjects).toEqual([]);
    expect(result.counts.projects).toBe(0);
  });
});
