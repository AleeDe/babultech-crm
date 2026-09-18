/** Read-only staffing checks. These findings never imply automatic reassignment. */
export interface AccessStaff {
  id: string;
  status: string;
  deletedAt: string | null;
  jobTitle: string | null;
  managerUserId: string | null;
  roleId: string;
}
export interface AccessRole {
  id: string;
  name: string;
  dataScope: string;
  permissions: string[];
}
export interface AccessBaseline {
  users: AccessStaff[];
  roles: AccessRole[];
  teamMembers: { userId: string; teamId: string }[];
  projectMembers: { userId: string; projectId: string; active: boolean }[];
  projects: { id: string; projectManagerId: string | null; deletedAt: string | null }[];
}

export function analyzeAccessBaseline(snapshot: AccessBaseline) {
  const active = snapshot.users.filter((u) => u.status === "ACTIVE" && !u.deletedAt);
  const activeIds = new Set(active.map((u) => u.id));
  const users = new Map(snapshot.users.map((u) => [u.id, u]));
  const roles = new Map(snapshot.roles.map((r) => [r.id, r]));
  const teamed = new Set(snapshot.teamMembers.map((m) => m.userId));
  const reports = new Set(active.map((u) => u.managerUserId).filter(Boolean));
  const projects = snapshot.projects.filter((p) => !p.deletedAt);

  const hierarchyCycles = active.filter((user) => {
    const seen = new Set<string>();
    let current: AccessStaff | undefined = user;
    while (current) {
      if (seen.has(current.id)) return true;
      seen.add(current.id);
      current = current.managerUserId ? users.get(current.managerUserId) : undefined;
    }
    return false;
  }).map((u) => u.id);

  return {
    counts: { activeUsers: active.length, roles: snapshot.roles.length, projects: projects.length },
    findings: {
      missingJobTitle: active.filter((u) => !u.jobTitle?.trim()).map((u) => u.id),
      // A root manager may legitimately be blank; report rather than "repair".
      missingReportingManager: active.filter((u) => !u.managerUserId).map((u) => u.id),
      invalidReportingManager: active.filter((u) => u.managerUserId && !activeIds.has(u.managerUserId)).map((u) => u.id),
      reportingHierarchyCycle: hierarchyCycles,
      missingRole: active.filter((u) => !roles.has(u.roleId)).map((u) => u.id),
      teamScopeWithoutMembership: active.filter((u) => roles.get(u.roleId)?.dataScope === "TEAM" && !teamed.has(u.id)).map((u) => u.id),
      reportingScopeWithoutReports: active.filter((u) => roles.get(u.roleId)?.dataScope === "DEPARTMENT" && !reports.has(u.id)).map((u) => u.id),
      inactiveTeamMembership: snapshot.teamMembers.filter((m) => !activeIds.has(m.userId)).map((m) => ({ userId: m.userId, teamId: m.teamId })),
      inactiveProjectMembership: snapshot.projectMembers.filter((m) => m.active && !activeIds.has(m.userId)).map((m) => ({ userId: m.userId, projectId: m.projectId })),
      unstaffedProjects: projects.filter((p) => !snapshot.projectMembers.some((m) => m.projectId === p.id && m.active && activeIds.has(m.userId)) && (!p.projectManagerId || !activeIds.has(p.projectManagerId))).map((p) => p.id),
      invalidProjectManager: projects.filter((p) => p.projectManagerId && !activeIds.has(p.projectManagerId)).map((p) => p.id),
    },
  };
}
