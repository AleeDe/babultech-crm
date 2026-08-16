"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { updateRecord } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * Everything assigned to the person reading it.
 *
 * The delivery screens are organised by project — right for a manager, wrong
 * for someone booked across three of them who just wants to know what is on
 * their plate today. This gathers the same rows by assignee instead.
 *
 * No permission gate beyond being signed in: it only ever returns rows already
 * attached to the caller.
 */

const OPEN_TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW"];

const today = () => new Date().toISOString().slice(0, 10);

export async function getMyWork() {
  const me = await requireUser();
  const db = await supabaseServer();
  const now = today();

  const [tasks, projects, cases, activities, weekLogs, pendingLogs] = await Promise.all([
    db
      .from("project_task")
      .select(
        `*,
         project ( id, name, projectNumber, status, health ),
         phase:project_phase ( id, name ),
         milestone ( id, name, dueDate )`,
      )
      .eq("assignedUserId", me.id)
      .in("status", OPEN_TASK_STATUSES)
      .order("dueDate", { nullsFirst: false })
      .limit(100),

    db
      .from("project_member")
      .select(
        `*,
         project ( id, name, projectNumber, status, health, completionPercent,
                   plannedEndDate, account ( id, name ) )`,
      )
      .eq("userId", me.id)
      .eq("active", true)
      .limit(50),

    db
      .from("support_case")
      .select("*, account ( id, name )")
      .eq("ownerUserId", me.id)
      .is("deletedAt", null)
      .not("status", "in", '("CLOSED","CANCELLED","RESOLVED")')
      .order("priority")
      .order("resolutionDueAt", { nullsFirst: false })
      .limit(50),

    db
      .from("activity")
      .select("*, contact ( id, firstName, lastName )")
      .eq("ownerUserId", me.id)
      .eq("status", "OPEN")
      .is("deletedAt", null)
      .order("dueAt", { nullsFirst: false })
      .limit(50),

    // This week's logged hours, for the "have I filled my timesheet" question.
    db
      .from("time_log")
      .select("hours, workDate, approvalStatus")
      .eq("userId", me.id)
      .gte("workDate", startOfThisWeek())
      .limit(100),

    db
      .from("time_log")
      .select("hours")
      .eq("userId", me.id)
      .in("approvalStatus", ["DRAFT", "SUBMITTED"])
      .limit(200),
  ]);

  const first = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

  type Row = Record<string, unknown>;

  // Rows come back from PostgREST untyped; keeping the index signature means
  // the page can read task columns without each one being declared here.
  const myTasks: Row[] = (tasks.data ?? []).map((t: Row) => ({
    ...t,
    project: first<Row>(t.project),
    phase: first<Row>(t.phase),
    milestone: first<Row>(t.milestone),
    overdue: Boolean(t.dueDate && String(t.dueDate) < now),
  }));

  const myProjects: Row[] = (projects.data ?? [])
    .map((m: Row): Row | null => {
      const project = first<Row>(m.project);
      return project
        ? {
            membership: m,
            ...project,
            account: first<Row>(project.account),
            openTasks: myTasks.filter((t) => (t.project as Row | null)?.id === project.id).length,
          }
        : null;
    })
    .filter((p): p is Row => p !== null);

  const hoursThisWeek = ((weekLogs.data ?? []) as Row[])
    .reduce((total, row) => total.plus(toDecimal(row.hours)), toDecimal(0))
    .toFixed(2);

  const hoursUnsubmitted = ((pendingLogs.data ?? []) as Row[])
    .reduce((total, row) => total.plus(toDecimal(row.hours)), toDecimal(0))
    .toFixed(2);

  return {
    me,
    tasks: myTasks,
    projects: myProjects,
    cases: (cases.data ?? []).map((c: Row) => ({ ...c, account: first<Row>(c.account) })),
    activities: (activities.data ?? []).map((a: Row) => ({
      ...a,
      contact: first<Row>(a.contact),
      overdue: Boolean(a.dueAt && String(a.dueAt) < new Date().toISOString()),
    })),
    summary: {
      openTasks: myTasks.length,
      overdueTasks: myTasks.filter((t) => t.overdue).length,
      blockedTasks: myTasks.filter((t) => t.status === "BLOCKED").length,
      activeProjects: myProjects.filter((p) => p.status === "ACTIVE").length,
      openCases: (cases.data ?? []).length,
      openActivities: (activities.data ?? []).length,
      hoursThisWeek,
      hoursUnsubmitted,
    },
  };
}

function startOfThisWeek(): string {
  const d = new Date();
  // Monday-based, matching weekBounds() in timesheets.ts.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

const progressSchema = z.object({
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED"]),
  completionPercent: z.coerce.number().min(0).max(100),
});

/**
 * Move a task along from the My Work screen.
 *
 * Restricted to the assignee: reassignment and scope changes belong on the
 * project screen, where the manager works. The ownership check is a real read
 * rather than a trust of the submitted id.
 */
export async function updateMyTaskProgress(
  taskId: string,
  input: z.infer<typeof progressSchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();

  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That status or percentage is not valid." };
  }

  const db = await supabaseServer();

  const { data: task } = await db
    .from("project_task")
    .select("id, assignedUserId, projectId")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.assignedUserId !== me.id) {
    return { ok: false, error: "That task is not assigned to you." };
  }

  const { status, completionPercent } = parsed.data;

  try {
    await updateRecord(
      "project_task",
      taskId,
      {
        status,
        // Completing a task means 100%: leaving the percentage behind is how a
        // project reads 80% done with every task closed.
        completionPercent: status === "COMPLETED" ? 100 : completionPercent,
        completedDate: status === "COMPLETED" ? today() : null,
      },
      "ProjectTask",
      me.id,
    );

    revalidatePath("/my-work");
    revalidatePath(`/projects/${task.projectId}`);
    return { ok: true, data: { id: taskId } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update the task.",
    };
  }
}
