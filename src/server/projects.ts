"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { createRecord, updateRecord } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "./partners";

/** The slice of the Supabase client the roll-up helper needs. */
type Db = Pick<SupabaseClient, "from">;

/**
 * Project delivery (spec §10.4).
 *
 * The shape follows how a professional-services engagement is actually run:
 * a project holds phases, phases hold milestones and tasks, people are booked
 * onto the project as members with an allocation percentage and rates, and
 * time is logged against tasks. Progress rolls **up** — task completion drives
 * phase completion drives project completion — rather than being typed in by
 * hand, so the number on the dashboard cannot drift from the work.
 */

// ---------------------------------------------------------------------------
// Progress roll-up
// ---------------------------------------------------------------------------

/**
 * Recomputes phase and project completion from task data.
 *
 * Tasks are weighted by estimated hours where they have them, so a 40-hour
 * task counts for more than a 2-hour one. Tasks with no estimate fall back to
 * equal weighting, which is the honest default when nobody has estimated yet.
 * Cancelled tasks drop out of the calculation entirely.
 */
async function rollUpProgress(db: Db, projectId: string): Promise<void> {
  const { data: taskRows } = await db
    .from("project_task")
    .select("id, phaseId, estimatedHours, completionPercent, status")
    .eq("projectId", projectId)
    .neq("status", "CANCELLED");

  const tasks = (taskRows ?? []) as Array<{
    id: string;
    phaseId: string | null;
    estimatedHours: unknown;
    completionPercent: unknown;
    status: string;
  }>;

  const weightOf = (t: (typeof tasks)[number]) => {
    const hours = Number(t.estimatedHours ?? 0);
    return hours > 0 ? hours : 1;
  };
  const progressOf = (t: (typeof tasks)[number]) =>
    t.status === "COMPLETED" ? 100 : Number(t.completionPercent);

  const weighted = (subset: typeof tasks) => {
    if (subset.length === 0) return null;
    const totalWeight = subset.reduce((s, t) => s + weightOf(t), 0);
    if (totalWeight === 0) return null;
    const done = subset.reduce((s, t) => s + weightOf(t) * progressOf(t), 0);
    return Math.round((done / totalWeight) * 100) / 100;
  };

  const { data: phases } = await db
    .from("project_phase")
    .select("id")
    .eq("projectId", projectId);

  for (const phase of phases ?? []) {
    const pct = weighted(tasks.filter((t) => t.phaseId === phase.id));
    if (pct === null) continue;
    await db
      .from("project_phase")
      .update({
        completionPercent: pct,
        status: pct >= 100 ? "COMPLETED" : pct > 0 ? "ACTIVE" : "NOT_STARTED",
        updatedAt: new Date().toISOString(),
      })
      .eq("id", phase.id);
  }

  const overall = weighted(tasks);
  if (overall !== null) {
    await db
      .from("project")
      .update({ completionPercent: overall, updatedAt: new Date().toISOString() })
      .eq("id", projectId);
  }
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

const projectSchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional().nullable(),
  contractId: z.string().uuid().optional().nullable(),
  projectManagerId: z.string().uuid(),
  status: z
    .enum(["DRAFT", "PLANNING", "ACTIVE", "ON_HOLD", "AT_RISK", "COMPLETED", "CANCELLED"])
    .default("DRAFT"),
  health: z.enum(["GREEN", "AMBER", "RED"]).default("GREEN"),
  billingType: z.enum(["FIXED", "HOURLY", "RETAINER", "MILESTONE", "ANNUAL"]),
  startDate: z.coerce.date().optional().nullable(),
  plannedEndDate: z.coerce.date().optional().nullable(),
  actualEndDate: z.coerce.date().optional().nullable(),
  contractValue: z.coerce.number().min(0).optional().nullable(),
  currencyCode: z.string().length(3).default("PKR"),
  approvedHours: z.coerce.number().min(0).optional().nullable(),
  scope: z.string().optional().nullable(),
});

export async function createProject(
  input: z.infer<typeof projectSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.plannedEndDate && data.plannedEndDate < data.startDate) {
    return {
      ok: false,
      error: "The planned end date cannot fall before the start date.",
      fieldErrors: { plannedEndDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const db = await supabaseServer();

    // The project and its manager's membership are created together: without
    // that membership the manager cannot log time to their own project, and
    // the rate snapshot on it is what stops their time booking at zero cost
    // and quietly overstating the margin.
    const { data: project, error } = await db.rpc("create_project", {
      p_payload: {
        ...data,
        startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
        plannedEndDate: data.plannedEndDate
          ? data.plannedEndDate.toISOString().slice(0, 10)
          : null,
        actualEndDate: data.actualEndDate
          ? data.actualEndDate.toISOString().slice(0, 10)
          : null,
      },
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/projects");
    return { ok: true, data: { id: project.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the project." };
  }
}

export async function updateProject(
  id: string,
  input: z.infer<typeof projectSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.plannedEndDate && data.plannedEndDate < data.startDate) {
    return {
      ok: false,
      error: "The planned end date cannot fall before the start date.",
      fieldErrors: { plannedEndDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const db = await supabaseServer();

    // Closing a project with work still open would leave those tasks stranded
    // on a completed project, so the check comes before the write.
    if (data.status === "COMPLETED") {
      const { count: openTasks } = await db
        .from("project_task")
        .select("id", { count: "exact", head: true })
        .eq("projectId", id)
        .not("status", "in", '("COMPLETED","CANCELLED")');

      if ((openTasks ?? 0) > 0) {
        return {
          ok: false,
          error: `${openTasks} task(s) are still open. Complete or cancel them before closing the project.`,
        };
      }
    }

    const actualEndDate =
      data.status === "COMPLETED"
        ? (data.actualEndDate ?? new Date())
        : data.actualEndDate;

    await updateRecord(
      "project",
      id,
      {
        ...data,
        startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
        plannedEndDate: data.plannedEndDate
          ? data.plannedEndDate.toISOString().slice(0, 10)
          : null,
        actualEndDate: actualEndDate ? actualEndDate.toISOString().slice(0, 10) : null,
      },
      "Project",
      user.id,
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the project." };
  }
}

export async function listProjects(filters?: { status?: string; search?: string; managerId?: string }) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const db = await supabaseServer();

  let query = db
    .from("project")
    .select(
      `*,
       account ( id, name ),
       projectManager:app_user!project_projectManagerId_fkey ( id, fullName ),
       members:project_member ( count ),
       tasks:project_task ( count ),
       milestones:milestone ( count ),
       issues:project_issue ( count ),
       risks:project_risk ( count )`,
    )
    .is("deletedAt", null)
    .order("startDate", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.managerId) query = query.eq("projectManagerId", filters.managerId);
  if (filters?.search) {
    // Prisma's OR also matched the related account's name. PostgREST cannot OR
    // across an embedded table, so the matching account ids are resolved first
    // and folded into the same clause — dropping it would narrow the search.
    const s = filters.search.replace(/[,()]/g, "");

    const { data: matchingAccounts } = await db
      .from("account")
      .select("id")
      .ilike("name", `%${s}%`)
      .is("deletedAt", null);

    const accountIds = (matchingAccounts ?? []).map((a) => a.id);
    const clauses = [`name.ilike.%${s}%`, `projectNumber.ilike.%${s}%`];
    if (accountIds.length) clauses.push(`accountId.in.(${accountIds.join(",")})`);

    query = query.or(clauses.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load projects: ${error.message}`);

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  return (data ?? []).map((p) => ({
    ...p,
    account: one(p.account as never),
    projectManager: one(p.projectManager as never),
    _count: {
      members: countOf(p.members),
      tasks: countOf(p.tasks),
      milestones: countOf(p.milestones),
      issues: countOf(p.issues),
      risks: countOf(p.risks),
    },
  }));
}

export async function getProject(id: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("project")
    .select(
      `*,
       account ( id, name, accountNumber ),
       opportunity ( id, opportunityNumber, name ),
       contract ( id, contractNumber ),
       projectManager:app_user!project_projectManagerId_fkey ( id, fullName, email ),
       phases:project_phase ( * ),
       milestones:milestone (
         *,
         owner:app_user!milestone_ownerUserId_fkey ( id, fullName ),
         phase:project_phase ( id, name )
       ),
       tasks:project_task (
         *,
         assignedUser:app_user!project_task_assignedUserId_fkey ( id, fullName ),
         phase:project_phase ( id, name ),
         milestone ( id, name )
       ),
       members:project_member (
         *,
         user:app_user!project_member_userId_fkey ( id, fullName, jobTitle, email )
       ),
       risks:project_risk ( *, owner:app_user!project_risk_ownerUserId_fkey ( id, fullName ) ),
       issues:project_issue ( *, owner:app_user!project_issue_ownerUserId_fkey ( id, fullName ) ),
       changeRequests:change_request ( * ),
       cases:support_case ( id, caseNumber, subject, status, priority )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load project: ${error.message}`);
  if (!data) return null;

  // PostgREST returns embedded collections unordered, so the per-relation
  // orderBy from the Prisma query is applied here.
  type Row = Record<string, unknown>;
  const rows = (v: unknown) => ((v as Row[] | null) ?? []);
  const num = (v: unknown) => Number(v ?? 0);
  const asc = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));
  const desc = (a: unknown, b: unknown) => String(b ?? "").localeCompare(String(a ?? ""));

  // Subtask counts are not available as an embedded aggregate alongside the
  // task's own columns, so they are derived from the task list itself.
  const taskRows = rows(data.tasks);
  const subtaskCount = new Map<string, number>();
  for (const t of taskRows) {
    const parent = t.parentTaskId as string | null;
    if (parent) subtaskCount.set(parent, (subtaskCount.get(parent) ?? 0) + 1);
  }

  return {
    ...data,
    account: one(data.account as never),
    opportunity: one(data.opportunity as never),
    contract: one(data.contract as never),
    projectManager: one(data.projectManager as never),
    phases: rows(data.phases).sort((a, b) => num(a.sequenceNumber) - num(b.sequenceNumber)),
    milestones: rows(data.milestones)
      .map((m): Row => ({ ...m, owner: one(m.owner as never), phase: one(m.phase as never) }))
      .sort((a, b) => asc(a.dueDate, b.dueDate)),
    tasks: taskRows
      .map((t): Row => ({
        ...t,
        assignedUser: one(t.assignedUser as never),
        phase: one(t.phase as never),
        milestone: one(t.milestone as never),
        _count: { subtasks: subtaskCount.get(t.id as string) ?? 0 },
      }))
      .sort((a, b) => num(a.sortOrder) - num(b.sortOrder) || asc(a.createdAt, b.createdAt)),
    members: rows(data.members)
      .map((m): Row => ({ ...m, user: one(m.user as never) }))
      .sort((a, b) => asc(a.createdAt, b.createdAt)),
    risks: rows(data.risks)
      .map((r): Row => ({ ...r, owner: one(r.owner as never) }))
      .sort((a, b) => num(b.riskScore) - num(a.riskScore)),
    issues: rows(data.issues)
      .map((i): Row => ({ ...i, owner: one(i.owner as never) }))
      .sort((a, b) => desc(a.createdAt, b.createdAt)),
    changeRequests: rows(data.changeRequests).sort((a, b) => desc(a.createdAt, b.createdAt)),
    cases: rows(data.cases),
  };
}

/** Hours and money actually consumed, for the workspace tiles. */
export async function getProjectBurn(projectId: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const db = await supabaseServer();

  // PostgREST has no aggregate, so the hours are fetched and summed here.
  const [loggedRes, approvedRes] = await Promise.all([
    db
      .from("time_log")
      .select("hours")
      .eq("projectId", projectId)
      .neq("approvalStatus", "REJECTED"),
    db
      .from("time_log")
      .select("hours, billable, billingRate, costRate")
      .eq("projectId", projectId)
      .eq("approvalStatus", "APPROVED"),
  ]);

  const loggedHours = (loggedRes.data ?? []).reduce(
    (sum, l) => sum.plus(toDecimal(l.hours)),
    toDecimal(0),
  );

  let billableValue = toDecimal(0);
  let cost = toDecimal(0);
  for (const log of approvedRes.data ?? []) {
    const hours = toDecimal(log.hours);
    if (log.billable && log.billingRate) {
      billableValue = billableValue.plus(hours.times(toDecimal(log.billingRate)));
    }
    if (log.costRate) cost = cost.plus(hours.times(toDecimal(log.costRate)));
  }

  return {
    loggedHours,
    billableValue,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const phaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  ownerUserId: z.string().uuid().optional().nullable(),
  plannedStart: z.coerce.date().optional().nullable(),
  plannedEnd: z.coerce.date().optional().nullable(),
  budgetedHours: z.coerce.number().min(0).optional().nullable(),
});

export async function createPhase(
  input: z.infer<typeof phaseSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    // Sequence number allocated under a lock on the project — reading the
    // current maximum and inserting separately lets two concurrent creates
    // collide on the same number.
    const { data: phase, error } = await db.rpc("create_ordered_child", {
      p_table: "project_phase",
      p_payload: {
        ...data,
        plannedStart: data.plannedStart
          ? data.plannedStart.toISOString().slice(0, 10)
          : null,
        plannedEnd: data.plannedEnd ? data.plannedEnd.toISOString().slice(0, 10) : null,
      },
      p_parent_field: "projectId",
      p_parent_id: data.projectId,
      p_seq_field: "sequenceNumber",
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: phase.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the phase." };
  }
}

export async function deletePhase(id: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  try {
    const db = await supabaseServer();

    const { data: phase } = await db
      .from("project_phase")
      .select("projectId, tasks:project_task ( id ), milestones:milestone ( id )")
      .eq("id", id)
      .maybeSingle();

    if (!phase) return { ok: false, error: "That phase no longer exists." };

    const taskCount = ((phase.tasks ?? []) as unknown[]).length;
    const milestoneCount = ((phase.milestones ?? []) as unknown[]).length;

    if (taskCount > 0 || milestoneCount > 0) {
      return {
        ok: false,
        error: "Move its tasks and milestones to another phase before deleting this one.",
      };
    }

    const { error } = await db.from("project_phase").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(`/projects/${phase.projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the phase." };
  }
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

const milestoneSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).default("PLANNED"),
  customerApprovalRequired: z.boolean().default(false),
  billingTrigger: z.boolean().default(false),
  billingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  billingAmount: z.coerce.number().min(0).optional().nullable(),
});

export async function createMilestone(
  input: z.infer<typeof milestoneSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // §13 milestone billing: a billing milestone must say what it bills.
  if (data.billingTrigger && !data.billingAmount && !data.billingPercent) {
    return {
      ok: false,
      error: "A billing milestone needs either an amount or a percentage of the contract value.",
      fieldErrors: { billingAmount: ["Set an amount or a percentage."] },
    };
  }

  try {
    const milestone = await createRecord<{ id: string }>("milestone", {
      ...data,
      dueDate: data.dueDate.toISOString().slice(0, 10),
    });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: milestone.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the milestone." };
  }
}

export async function completeMilestone(
  id: string,
  customerApproved: boolean,
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("milestone")
      .select("projectId, customerApprovalRequired, customerApprovalDate")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "That milestone no longer exists." };

    if (before.customerApprovalRequired && !customerApproved && !before.customerApprovalDate) {
      return {
        ok: false,
        error: "This milestone needs customer sign-off before it can be marked complete.",
      };
    }

    const { count: openTasks } = await db
      .from("project_task")
      .select("id", { count: "exact", head: true })
      .eq("milestoneId", id)
      .not("status", "in", '("COMPLETED","CANCELLED")');

    if ((openTasks ?? 0) > 0) {
      return { ok: false, error: `${openTasks} task(s) under this milestone are still open.` };
    }

    const now = new Date();

    await updateRecord(
      "milestone",
      id,
      {
        status: "COMPLETED",
        completedDate: now.toISOString().slice(0, 10),
        customerApprovalDate:
          before.customerApprovalRequired && customerApproved
            ? (before.customerApprovalDate ?? now.toISOString().slice(0, 10))
            : before.customerApprovalDate,
      },
      "Milestone",
      user.id,
    );

    const milestone = { projectId: before.projectId };

    revalidatePath(`/projects/${milestone.projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not complete the milestone." };
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid().optional().nullable(),
  milestoneId: z.string().uuid().optional().nullable(),
  parentTaskId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  status: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED", "CANCELLED"])
    .default("NOT_STARTED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedHours: z.coerce.number().min(0).optional().nullable(),
  completionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  billable: z.boolean().default(true),
  acceptanceCriteria: z.string().optional().nullable(),
});

async function assertAssigneeIsOnProject(
  db: Db,
  projectId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;

  const { data: member } = await db
    .from("project_member")
    .select("active")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .maybeSingle();

  if (!member || !member.active) {
    const { data: person } = await db
      .from("app_user")
      .select("fullName")
      .eq("id", userId)
      .maybeSingle();

    throw new Error(
      `${person?.fullName ?? "That user"} is not an active member of this project. Add them to the team first.`,
    );
  }
}

export async function createTask(
  input: z.infer<typeof taskSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    return {
      ok: false,
      error: "The due date cannot fall before the start date.",
      fieldErrors: { dueDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const db = await supabaseServer();

    await assertAssigneeIsOnProject(db, data.projectId, data.assignedUserId);

    // sortOrder allocated under a lock on the project.
    const { data: task, error } = await db.rpc("create_ordered_child", {
      p_table: "project_task",
      p_payload: {
        ...data,
        completionPercent: data.completionPercent ?? 0,
        startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
        dueDate: data.dueDate ? data.dueDate.toISOString().slice(0, 10) : null,
      },
      p_parent_field: "projectId",
      p_parent_id: data.projectId,
      p_seq_field: "sortOrder",
    });

    if (error) return { ok: false, error: error.message };

    // Roll-up runs after the insert: a failure here leaves the task created
    // and only the derived percentages stale, which the next write corrects.
    await rollUpProgress(db, data.projectId);

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: task.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the task." };
  }
}

export async function updateTask(
  id: string,
  input: z.infer<typeof taskSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    return {
      ok: false,
      error: "The due date cannot fall before the start date.",
      fieldErrors: { dueDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("project_task")
      .select("completionPercent, completedDate")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "That task no longer exists." };

    await assertAssigneeIsOnProject(db, data.projectId, data.assignedUserId);

    if (data.status === "COMPLETED") {
      const { count: openSubtasks } = await db
        .from("project_task")
        .select("id", { count: "exact", head: true })
        .eq("parentTaskId", id)
        .not("status", "in", '("COMPLETED","CANCELLED")');

      if ((openSubtasks ?? 0) > 0) {
        return { ok: false, error: `${openSubtasks} subtask(s) are still open.` };
      }
    }

    const completing = data.status === "COMPLETED";

    await updateRecord(
      "project_task",
      id,
      {
        ...data,
        startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
        dueDate: data.dueDate ? data.dueDate.toISOString().slice(0, 10) : null,
        completionPercent: completing ? 100 : (data.completionPercent ?? before.completionPercent),
        completedDate: completing
          ? (before.completedDate ?? new Date().toISOString().slice(0, 10))
          : null,
      },
      "ProjectTask",
      user.id,
    );

    await rollUpProgress(db, data.projectId);

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the task." };
  }
}

/** Board drag / quick status change — the one-field version of updateTask. */
export async function changeTaskStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = z
    .enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED", "CANCELLED"])
    .safeParse(status);
  if (!parsed.success) return { ok: false, error: "Unknown task status." };

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("project_task")
      .select("projectId, completionPercent, completedDate")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "That task no longer exists." };

    if (parsed.data === "COMPLETED") {
      const { count: openSubtasks } = await db
        .from("project_task")
        .select("id", { count: "exact", head: true })
        .eq("parentTaskId", id)
        .not("status", "in", '("COMPLETED","CANCELLED")');

      if ((openSubtasks ?? 0) > 0) {
        return { ok: false, error: `${openSubtasks} subtask(s) are still open.` };
      }
    }

    const completing = parsed.data === "COMPLETED";

    await updateRecord(
      "project_task",
      id,
      {
        status: parsed.data,
        completionPercent: completing ? 100 : before.completionPercent,
        completedDate: completing
          ? (before.completedDate ?? new Date().toISOString().slice(0, 10))
          : null,
      },
      "ProjectTask",
      user.id,
    );

    await rollUpProgress(db, before.projectId);
    const projectId = before.projectId;

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change the task." };
  }
}

export async function getTask(id: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("project_task")
    .select(
      `*,
       project ( id, name, projectNumber ),
       phase:project_phase ( id, name ),
       milestone ( id, name ),
       parentTask:parentTaskId ( id, name ),
       assignedUser:app_user!project_task_assignedUserId_fkey ( id, fullName ),
       timeLogs:time_log ( *, user:app_user!time_log_userId_fkey ( id, fullName ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load task: ${error.message}`);
  if (!data) return null;

  // PostgREST cannot embed the reverse side of a self-referencing FK
  // (project_task.parentTaskId -> project_task.id), so subtasks are a second
  // query, as childAccounts and reports already are elsewhere.
  const { data: subtasks } = await db
    .from("project_task")
    .select("id, name, status, completionPercent, sortOrder")
    .eq("parentTaskId", id)
    .order("sortOrder");

  type Row = Record<string, unknown>;

  return {
    ...data,
    project: one(data.project as never),
    phase: one(data.phase as never),
    milestone: one(data.milestone as never),
    parentTask: one(data.parentTask as never),
    assignedUser: one(data.assignedUser as never),
    subtasks: subtasks ?? [],
    timeLogs: ((data.timeLogs ?? []) as Row[])
      .map((l): Row => ({ ...l, user: one(l.user as never) }))
      .sort((a, b) => String(b.workDate ?? "").localeCompare(String(a.workDate ?? ""))),
  };
}

// ---------------------------------------------------------------------------
// Resources — people booked onto the project
// ---------------------------------------------------------------------------

const memberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  projectRole: z.string().min(1).max(100),
  allocationPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  billingRate: z.coerce.number().min(0).optional().nullable(),
  costRate: z.coerce.number().min(0).optional().nullable(),
});

/**
 * Books a person onto a project. Rates default to the person's standing rates
 * from their user record, so a project only carries an override when someone
 * has actually negotiated one.
 */
export async function addProjectMember(
  input: z.infer<typeof memberSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    const { data: existing } = await db
      .from("project_member")
      .select("id")
      .eq("projectId", data.projectId)
      .eq("userId", data.userId)
      .maybeSingle();

    if (existing) {
      return { ok: false, error: "That person is already on this project." };
    }

    const { data: person } = await db
      .from("app_user")
      .select("costRate, defaultBillingRate")
      .eq("id", data.userId)
      .maybeSingle();

    if (!person) return { ok: false, error: "That user no longer exists." };

    // Rates are snapshotted onto the membership, so re-rating someone later
    // cannot rewrite what their past time on this project cost.
    const member = await createRecord<{ id: string }>("project_member", {
      ...data,
      startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
      endDate: data.endDate ? data.endDate.toISOString().slice(0, 10) : null,
      billingRate: data.billingRate ?? person.defaultBillingRate,
      costRate: data.costRate ?? person.costRate,
    });

    revalidatePath(`/projects/${data.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: { id: member.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the team member." };
  }
}

export async function updateProjectMember(
  id: string,
  input: Omit<z.infer<typeof memberSchema>, "projectId" | "userId"> & { active: boolean },
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const schema = memberSchema
    .omit({ projectId: true, userId: true })
    .extend({ active: z.boolean() });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const db = await supabaseServer();

    const { data: member, error } = await db
      .from("project_member")
      .update({
        ...parsed.data,
        startDate: parsed.data.startDate
          ? parsed.data.startDate.toISOString().slice(0, 10)
          : parsed.data.startDate,
        endDate: parsed.data.endDate
          ? parsed.data.endDate.toISOString().slice(0, 10)
          : parsed.data.endDate,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select("projectId")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath(`/projects/${member.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the team member." };
  }
}

/**
 * Removes someone from a project. If they have logged time we deactivate
 * instead of deleting — their hours are part of the project's cost record and
 * must not lose their owner.
 */
export async function removeProjectMember(id: string): Promise<ActionResult<{ deactivated: boolean }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  try {
    const db = await supabaseServer();

    const { data: member } = await db
      .from("project_member")
      .select("id, projectId, userId")
      .eq("id", id)
      .maybeSingle();

    if (!member) return { ok: false, error: "That team member is not on this project." };

    const { count: logged } = await db
      .from("time_log")
      .select("id", { count: "exact", head: true })
      .eq("projectId", member.projectId)
      .eq("userId", member.userId);

    const hasTime = (logged ?? 0) > 0;

    if (hasTime) {
      // Their hours are part of the project's cost record and must not lose
      // their owner, so deactivate rather than delete.
      await db
        .from("project_member")
        .update({
          active: false,
          endDate: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", id);
    } else {
      await db.from("project_member").delete().eq("id", id);
    }

    revalidatePath(`/projects/${member.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: { deactivated: hasTime } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not remove the team member." };
  }
}

// ---------------------------------------------------------------------------
// Risks and issues (RAID)
// ---------------------------------------------------------------------------

const riskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  probability: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  impact: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  mitigationPlan: z.string().optional().nullable(),
  ownerUserId: z.string().uuid(),
  targetDate: z.coerce.date().optional().nullable(),
  status: z.enum(["OPEN", "MONITORING", "MITIGATED", "CLOSED"]).default("OPEN"),
});

/** Standard probability x impact matrix, 1–16. */
const LEVEL_SCORE: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export async function createRisk(
  input: z.infer<typeof riskSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = riskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const risk = await createRecord<{ id: string }>("project_risk", {
      ...data,
      targetDate: data.targetDate ? data.targetDate.toISOString().slice(0, 10) : null,
      riskScore: LEVEL_SCORE[data.probability] * LEVEL_SCORE[data.impact],
    });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: risk.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the risk." };
  }
}

const issueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  ownerUserId: z.string().uuid(),
  resolutionPlan: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).default("OPEN"),
});

export async function createIssue(
  input: z.infer<typeof issueSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const issue = await createRecord<{ id: string }>("project_issue", {
      ...data,
      dueDate: data.dueDate ? data.dueDate.toISOString().slice(0, 10) : null,
    });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: issue.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the issue." };
  }
}

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export async function getProjectFormOptions() {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const db = await supabaseServer();

  const [accountsRes, usersRes, opportunitiesRes, contractsRes, currenciesRes] =
    await Promise.all([
      db.from("account").select("id, name").is("deletedAt", null).order("name"),
      db
        .from("app_user")
        .select("id, fullName, jobTitle, costRate, defaultBillingRate")
        .eq("status", "ACTIVE")
        .is("deletedAt", null)
        .order("fullName"),
      db
        .from("opportunity")
        .select("id, opportunityNumber, name, accountId")
        .is("deletedAt", null)
        .eq("stage", "CLOSED_WON")
        .order("name"),
      db
        .from("contract")
        .select("id, contractNumber, accountId")
        .is("deletedAt", null)
        .order("contractNumber"),
      db.from("currency").select("*").eq("active", true).order("code"),
    ]);

  const accounts = accountsRes.data ?? [];
  const users = usersRes.data ?? [];
  const opportunities = opportunitiesRes.data ?? [];
  const contracts = contractsRes.data ?? [];
  const currencies = currenciesRes.data ?? [];

  return { accounts, users, opportunities, contracts, currencies };
}
