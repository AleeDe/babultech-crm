"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { createRecord, updateRecord } from "@/lib/db";
import { PERMISSIONS, authorize, requirePermission, requireUser } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Timesheets (spec §10.4 Time Log).
 *
 * The workflow is the standard PSA one: DRAFT → SUBMITTED → APPROVED (or
 * REJECTED, which returns it to the author as a draft). Rates are captured on
 * the entry at submission time from the project membership, so re-rating
 * someone next year cannot rewrite what last year's work cost.
 *
 * Approval is deliberately someone else's job — `approveTimeLogs` requires the
 * `time:approve` permission and refuses your own entries.
 */

const HOURS_PER_DAY_CEILING = 24;

const timeLogSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  projectTaskId: z.string().uuid().optional().nullable(),
  caseId: z.string().uuid().optional().nullable(),
  workDate: z.coerce.date(),
  hours: z.coerce.number().positive().max(HOURS_PER_DAY_CEILING),
  description: z.string().min(1, "Say what you worked on."),
  billable: z.boolean().default(true),
});

/** Monday of the week containing `date`. Timesheets are Monday–Sunday. */
export async function startOfWeek(date: Date): Promise<Date> {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function weekBounds(weekStart: Date): { from: Date; to: Date } {
  const from = new Date(weekStart);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export async function logTime(
  input: z.infer<typeof timeLogSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = timeLogSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // Mirrors the database's time_log_context_check.
  if (!data.projectId && !data.projectTaskId && !data.caseId) {
    return {
      ok: false,
      error: "Time has to be logged against a project, a task or a support case.",
      fieldErrors: { projectId: ["Pick something to book this against."] },
    };
  }

  try {
    const db = await supabaseServer();

    // A task implies its project, even if the form only sent the task.
    let projectId = data.projectId ?? null;
    if (data.projectTaskId) {
      const { data: task } = await db
        .from("project_task")
        .select("projectId, billable")
        .eq("id", data.projectTaskId)
        .maybeSingle();

      if (!task) return { ok: false, error: "That task no longer exists." };
      projectId = task.projectId;
    }

    const base = {
      userId: user.id,
      caseId: data.caseId ?? null,
      workDate: data.workDate.toISOString().slice(0, 10),
      hours: data.hours,
      description: data.description,
      billable: data.billable,
      approvalStatus: "DRAFT",
    };

    let created: { id: string; projectId?: string | null };

    if (projectId) {
      // The rate snapshot comes from the project membership, so a later rate
      // change cannot rewrite what already-logged time was worth.
      const { data: member } = await db
        .from("project_member")
        .select("active, billingRate, costRate")
        .eq("projectId", projectId)
        .eq("userId", user.id)
        .maybeSingle();

      if (!member || !member.active) {
        return {
          ok: false,
          error:
            "You are not an active member of that project, so you cannot book time to it.",
        };
      }

      created = await createRecord<{ id: string; projectId: string | null }>("time_log", {
        ...base,
        projectId,
        projectTaskId: data.projectTaskId ?? null,
        billingRate: member.billingRate,
        costRate: member.costRate,
      });
    } else {
      // Support-case time: no project membership, so fall back to standing rates.
      const { data: person } = await db
        .from("app_user")
        .select("costRate, defaultBillingRate")
        .eq("id", user.id)
        .maybeSingle();

      created = await createRecord<{ id: string; projectId: string | null }>("time_log", {
        ...base,
        billingRate: person?.defaultBillingRate ?? null,
        costRate: person?.costRate ?? null,
      });
    }

    revalidatePath("/timesheets");
    if (created.projectId) revalidatePath(`/projects/${created.projectId}`);
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the time." };
  }
}

export async function updateTimeLog(
  id: string,
  input: z.infer<typeof timeLogSchema>,
): Promise<ActionResult> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = timeLogSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const db = await supabaseServer();

    const { data: existing } = await db
      .from("time_log")
      .select("userId, approvalStatus")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return { ok: false, error: "That entry no longer exists." };
    if (existing.userId !== user.id) {
      return { ok: false, error: "You can only edit your own time entries." };
    }
    if (existing.approvalStatus === "APPROVED") {
      return { ok: false, error: "Approved time is locked. Ask your approver to reject it first." };
    }

    // Editing resets the entry to DRAFT, so a changed entry cannot keep a
    // stale approval.
    const { error } = await db
      .from("time_log")
      .update({
        workDate: parsed.data.workDate.toISOString().slice(0, 10),
        hours: parsed.data.hours,
        description: parsed.data.description,
        billable: parsed.data.billable,
        approvalStatus: "DRAFT",
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(error.message);

    revalidatePath("/timesheets");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the entry." };
  }
}

export async function deleteTimeLog(id: string): Promise<ActionResult> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    const { data: existing } = await db
      .from("time_log")
      .select("userId, approvalStatus, invoiceLineId")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return { ok: false, error: "That entry no longer exists." };
    if (existing.userId !== user.id) {
      return { ok: false, error: "You can only delete your own time entries." };
    }
    if (existing.approvalStatus === "APPROVED") {
      return { ok: false, error: "Approved time cannot be deleted — it is part of the project's cost record." };
    }
    if (existing.invoiceLineId) {
      return { ok: false, error: "This time has already been invoiced." };
    }

    const { error } = await db.from("time_log").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/timesheets");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the entry." };
  }
}

/** Submits a whole week for approval. */
export async function submitWeek(weekStartISO: string): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  const { from, to } = weekBounds(new Date(weekStartISO));

  try {
    const db = await supabaseServer();

    const { data: rows, error } = await db
      .from("time_log")
      .update({ approvalStatus: "SUBMITTED", updatedAt: new Date().toISOString() })
      .eq("userId", user.id)
      .gte("workDate", from.toISOString().slice(0, 10))
      .lt("workDate", to.toISOString().slice(0, 10))
      .in("approvalStatus", ["DRAFT", "REJECTED"])
      .select("id");

    if (error) throw new Error(error.message);

    const result = { count: (rows ?? []).length };

    if (result.count === 0) {
      return { ok: false, error: "There is nothing to submit for that week." };
    }

    revalidatePath("/timesheets");
    revalidatePath("/timesheets/approvals");
    return { ok: true, data: { count: result.count } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit the week." };
  }
}

export async function approveTimeLogs(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.TIME_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };

  try {
    const db = await supabaseServer();

    const { data: logs } = await db
      .from("time_log")
      .select("id, userId, approvalStatus, projectId")
      .in("id", ids);

    const entries = logs ?? [];

    if (entries.some((l) => l.userId === user.id)) {
      return { ok: false, error: "You cannot approve your own time." };
    }
    if (entries.some((l) => l.approvalStatus !== "SUBMITTED")) {
      return { ok: false, error: "Only submitted entries can be approved." };
    }

    // Status change, approver stamp and one audit row per entry, atomically.
    // The status filter is inside the function, so a retry cannot overwrite the
    // original approver.
    const { error } = await db.rpc("transition_time_logs", {
      p_ids: ids,
      p_from_statuses: ["SUBMITTED"],
      p_to_status: "APPROVED",
      p_actor_id: user.id,
      p_set_approver: true,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/timesheets/approvals");
    revalidatePath("/timesheets");
    for (const p of new Set(entries.map((l) => l.projectId).filter(Boolean))) {
      revalidatePath(`/projects/${p}`);
    }
    return { ok: true, data: { count: entries.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not approve the time." };
  }
}

export async function rejectTimeLogs(ids: string[], reason: string): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.TIME_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  if (!reason.trim()) return { ok: false, error: "Give a reason so the person knows what to fix." };

  try {
    const db = await supabaseServer();

    const { data: fetched } = await db
      .from("time_log")
      .select("id, description, approvalStatus")
      .in("id", ids);

    const logs = fetched ?? [];

    if (logs.some((l) => l.approvalStatus !== "SUBMITTED")) {
      return { ok: false, error: "Only submitted entries can be rejected." };
    }

    // Status + approver stamp + audit, atomically.
    const { error } = await db.rpc("transition_time_logs", {
      p_ids: ids,
      p_from_statuses: ["SUBMITTED"],
      p_to_status: "REJECTED",
      p_actor_id: user.id,
      p_set_approver: true,
    });

    if (error) throw new Error(error.message);

    // The reason is appended per entry, so each description differs — done
    // after the transition rather than inside it, since a failure here leaves
    // the rejection itself intact and only loses the appended note.
    for (const log of logs) {
      await db
        .from("time_log")
        .update({
          description: `${log.description}\n\n[Rejected by ${user.fullName}: ${reason.trim()}]`,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", log.id);
    }

    revalidatePath("/timesheets/approvals");
    revalidatePath("/timesheets");
    return { ok: true, data: { count: logs.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reject the time." };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMyWeek(weekStartISO: string) {
  const user = await requireUser();
  const { from, to } = weekBounds(new Date(weekStartISO));

  const db = await supabaseServer();

  const { data, error } = await db
    .from("time_log")
    .select(
      `*,
       project ( id, name, projectNumber ),
       projectTask:project_task ( id, name ),
       case:support_case ( id, caseNumber, subject )`,
    )
    .eq("userId", user.id)
    .gte("workDate", from.toISOString().slice(0, 10))
    .lt("workDate", to.toISOString().slice(0, 10))
    .order("workDate")
    .order("createdAt");

  if (error) throw new Error(`Could not load the week: ${error.message}`);

  const entries = (data ?? []).map((e) => ({
    ...e,
    project: one(e.project as never),
    projectTask: one(e.projectTask as never),
    case: one(e.case as never),
  }));

  return { entries, from, to };
}

/** What the current user can book time against. */
export async function getTimeEntryOptions() {
  const user = await requireUser();

  const db = await supabaseServer();

  const [membershipsRes, casesRes] = await Promise.all([
    db
      .from("project_member")
      .select(
        `project!inner (
           id, name, projectNumber, status, deletedAt,
           tasks:project_task ( id, name, billable, assignedUserId, status, sortOrder )
         )`,
      )
      .eq("userId", user.id)
      .eq("active", true)
      .is("project.deletedAt", null)
      .in("project.status", ["PLANNING", "ACTIVE", "AT_RISK"])
      .order("createdAt", { ascending: false }),
    db
      .from("support_case")
      .select("id, caseNumber, subject")
      .is("deletedAt", null)
      .eq("ownerUserId", user.id)
      .not("status", "in", '("CLOSED","CANCELLED")')
      .order("createdAt", { ascending: false }),
  ]);

  // PostgREST returns embedded tasks unfiltered and unordered, so the
  // open-task filter and sort order are applied here.
  const projects = (membershipsRes.data ?? []).map((m) => {
    const project = one(m.project as never) as unknown as Record<string, unknown>;
    const tasks = ((project?.tasks ?? []) as Record<string, unknown>[])
      .filter((t) => !["COMPLETED", "CANCELLED"].includes(String(t.status)))
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
    return { ...project, tasks };
  });

  return { projects, cases: casesRes.data ?? [] };
}

export async function getPendingApprovals() {
  const user = await requirePermission(PERMISSIONS.TIME_APPROVE);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("time_log")
    .select(
      `*,
       user:app_user!time_log_userId_fkey ( id, fullName ),
       project ( id, name, projectNumber ),
       projectTask:project_task ( id, name ),
       case:support_case ( id, caseNumber )`,
    )
    .eq("approvalStatus", "SUBMITTED")
    .neq("userId", user.id)
    .order("workDate");

  if (error) throw new Error(`Could not load approvals: ${error.message}`);

  return (data ?? []).map((e) => ({
    ...e,
    user: one(e.user as never),
    project: one(e.project as never),
    projectTask: one(e.projectTask as never),
    case: one(e.case as never),
  }));
}

/**
 * Resource utilisation: what each person is booked for versus what they have
 * actually logged, over a window. `allocationPercent` on a project membership
 * is a claim on their week; logged hours are the reality. The gap between the
 * two is the number a delivery manager actually needs.
 */
export async function getUtilisation(weeks = 4) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - weeks * 7);

  const STANDARD_WEEKLY_HOURS = 40;
  const capacityHours = toDecimal(STANDARD_WEEKLY_HOURS * weeks);

  const db = await supabaseServer();

  const [usersRes, membershipsRes, logsRes] = await Promise.all([
    db
      .from("app_user")
      .select(
        `id, fullName, jobTitle, costRate, defaultBillingRate,
         department:app_user_departmentId_fkey ( id, name )`,
      )
      .eq("status", "ACTIVE")
      .is("deletedAt", null)
      .order("fullName"),
    db
      .from("project_member")
      .select(
        `userId, allocationPercent,
         project!inner ( id, name, projectNumber, status, deletedAt )`,
      )
      .eq("active", true)
      .is("project.deletedAt", null)
      .in("project.status", ["PLANNING", "ACTIVE", "AT_RISK"]),
    // PostgREST has no groupBy, so the raw hours are fetched and summed below.
    db
      .from("time_log")
      .select("userId, billable, hours")
      .gte("workDate", from.toISOString().slice(0, 10))
      .lte("workDate", to.toISOString().slice(0, 10))
      .neq("approvalStatus", "REJECTED"),
  ]);

  const users = (usersRes.data ?? []).map((u) => ({
    ...u,
    department: one(u.department as never) as unknown as { id: string; name: string } | null,
  }));

  const memberships = (membershipsRes.data ?? []).map((m) => ({
    ...m,
    project: one(m.project as never),
  }));

  // Bucket by (userId, billable), matching the shape the report below reads.
  const grouped = new Map<string, { userId: string; billable: boolean; _sum: { hours: Decimal } }>();
  for (const l of logsRes.data ?? []) {
    const key = `${l.userId}|${l.billable}`;
    const acc =
      grouped.get(key) ??
      { userId: l.userId as string, billable: Boolean(l.billable), _sum: { hours: toDecimal(0) } };
    acc._sum.hours = acc._sum.hours.plus(toDecimal(l.hours));
    grouped.set(key, acc);
  }
  const logs = [...grouped.values()];

  return {
    from,
    to,
    weeks,
    capacityHours,
    rows: users.map((u) => {
      const theirProjects = memberships.filter((m) => m.userId === u.id);
      const allocatedPercent = theirProjects.reduce(
        (s, m) => s + Number(m.allocationPercent ?? 0),
        0,
      );
      const billable = logs.find((l) => l.userId === u.id && l.billable)?._sum.hours ?? toDecimal(0);
      const nonBillable = logs.find((l) => l.userId === u.id && !l.billable)?._sum.hours ?? toDecimal(0);
      const logged = toDecimal(billable).plus(nonBillable);

      return {
        user: u,
        projects: theirProjects.map((m) => {
          const proj = (m.project ?? {}) as { id?: string; name?: string; projectNumber?: string };
          return {
            id: proj.id ?? '',
            name: proj.name ?? '',
            projectNumber: proj.projectNumber ?? '',
            allocationPercent: m.allocationPercent,
          };
        }),
        allocatedPercent,
        loggedHours: logged,
        billableHours: toDecimal(billable),
        nonBillableHours: toDecimal(nonBillable),
        /** Logged against a 40h week — the standard utilisation ratio. */
        utilisationPercent: capacityHours.isZero()
          ? 0
          : Number(logged.dividedBy(capacityHours).times(100).toDecimalPlaces(1)),
        billableUtilisationPercent: capacityHours.isZero()
          ? 0
          : Number(toDecimal(billable).dividedBy(capacityHours).times(100).toDecimalPlaces(1)),
      };
    }),
  };
}
