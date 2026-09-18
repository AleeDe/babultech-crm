export interface DeliveryFilters {
  resource?: string;
  project?: string;
  projectStatus?: string;
  health?: string;
}

/** Narrow already-authorized rows before calculating any dashboard totals. */
export function filterDeliveryData<
  P extends Record<string, any>, T extends Record<string, any>,
  L extends Record<string, any>, M extends Record<string, any>, U extends Record<string, any>,
>(
  data: { projects: P[]; tasks: T[]; logs: L[]; prevLogs: L[]; members: M[]; users: U[] },
  filters: DeliveryFilters,
) {
  const { resource, project, projectStatus, health } = filters;
  const resourceProjects = new Set([
    ...data.members.filter((m) => m.userId === resource).map((m) => m.projectId),
    ...data.tasks.filter((t) => t.assignedUserId === resource).map((t) => t.projectId),
    ...[...data.logs, ...data.prevLogs].filter((l) => l.userId === resource).map((l) => l.projectId),
  ]);
  const projects = data.projects.filter((p) =>
    (!project || p.id === project) && (!projectStatus || p.status === projectStatus) &&
    (!health || (p.health ?? "GREEN") === health) && (!resource || resourceProjects.has(p.id)),
  );
  const projectIds = new Set(projects.map((p) => p.id));
  const narrowProjects = Boolean(project || projectStatus || health || resource);
  const inProject = (id: string) => !narrowProjects || projectIds.has(id);
  const tasks = data.tasks.filter((t) => inProject(t.projectId) && (!resource || t.assignedUserId === resource));
  const logs = data.logs.filter((l) => inProject(l.projectId) && (!resource || l.userId === resource));
  const prevLogs = data.prevLogs.filter((l) => inProject(l.projectId) && (!resource || l.userId === resource));
  const members = data.members.filter((m) => inProject(m.projectId) && (!resource || m.userId === resource));
  const relevantUsers = new Set([
    ...members.map((m) => m.userId), ...tasks.map((t) => t.assignedUserId),
    ...logs.map((l) => l.userId), ...prevLogs.map((l) => l.userId),
  ]);
  const users = data.users.filter((u) => resource ? u.id === resource : !narrowProjects || relevantUsers.has(u.id));
  return { projects, tasks, logs, prevLogs, members, users, projectIds, narrowProjects };
}
