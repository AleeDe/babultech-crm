"use server";

import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import {
  capacityForWindow, byLoad, windowFor, summarise,
  CAPACITY_WEEKS, type CapacityWeeks, type PlannedTask,
} from "@/lib/capacity";

const SCAN_LIMIT = 2000;

/**
 * Planned load per person for the weeks ahead.
 *
 * Reads through the caller's own client, so RLS decides which projects and
 * tasks they can see. Somebody who can only see their own projects gets a
 * forecast of their own projects - which is honest, if narrow, and the page
 * says how many tasks it looked at.
 */
export async function getCapacityForecast(weeks: CapacityWeeks = 4) {
  await requirePermission(PERMISSIONS.PROJECT_MANAGE);
  await requirePermission(PERMISSIONS.PROJECT_READ);
  if (!CAPACITY_WEEKS.includes(weeks)) weeks = 4;
  const db = await supabaseServer();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const window = { ...windowFor(today, weeks), from: today };

  const [people, tasks] = await Promise.all([
    db.from("app_user")
      .select("id, fullName, status, deletedAt, partnerId", { count: "exact" })
      .eq("status", "ACTIVE")
      .is("deletedAt", null)
      .is("partnerId", null)
      .order("fullName")
      .limit(500),
    // Include overdue work and missing dates: unfinished work must not vanish
    // merely because its original deadline has passed.
    db.from("project_task")
      .select(`id, name, projectId, assignedUserId, startDate, dueDate,
               estimatedHours, completionPercent, status,
               project ( name, deletedAt )`, { count: "exact" })
      .not("assignedUserId", "is", null)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .or(`startDate.lte.${window.to},startDate.is.null,dueDate.lte.${window.to},dueDate.is.null`)
      .order("dueDate", { nullsFirst: false })
      .limit(SCAN_LIMIT),
  ]);

  if (people.error) throw new Error("Could not load people.");
  if (tasks.error) throw new Error("Could not load planned work.");

  const planned: PlannedTask[] = (tasks.data ?? [])
    .map((row) => {
      const project = one(row.project as never) as { name: string; deletedAt: string | null } | null;
      return { row, project };
    })
    // A task on a deleted project is not work anybody will do.
    .filter(({ project }) => project && !project.deletedAt)
    .map(({ row, project }) => ({
      id: row.id as string,
      name: row.name as string,
      projectId: row.projectId as string,
      projectName: project?.name ?? "Project",
      assignedUserId: (row.assignedUserId as string | null) ?? null,
      startDate: (row.startDate as string | null) ?? null,
      dueDate: (row.dueDate as string | null) ?? null,
      estimatedHours: row.estimatedHours == null ? null : Number(row.estimatedHours),
      completionPercent: Number(row.completionPercent ?? 0),
      status: row.status as string,
    }));

  const rows = byLoad(capacityForWindow(
    (people.data ?? []).map((p) => ({ id: p.id as string, fullName: p.fullName as string })),
    planned,
    window,
    today,
  ));

  return {
    rows,
    totals: summarise(rows),
    window,
    weeks,
    scannedTasks: planned.length,
    truncated: (tasks.count ?? 0) > (tasks.data ?? []).length || (people.count ?? 0) > (people.data ?? []).length,
    today,
  };
}
