"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { createRecord, updateRecord } from "@/lib/db";
import { PERMISSIONS, authorize, requirePermission, requireUser } from "@/lib/authz";
import { hoursBetween, normaliseClock } from "@/lib/work-hours";
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

/**
 * Clock times are optional and hours are not.
 *
 * `hours` is what approval, invoicing, cost and utilisation all read, so it is
 * always stored. Start and end record *when* the work happened, which is what a
 * customer asks when they query a bill — but demanding them would push people to
 * invent times they never wrote down, and invented precision is worse than an
 * honest total.
 *
 * `hours` is therefore optional in the schema and resolved afterwards: derived
 * from the times when both are given, taken as typed when they are not. One of
 * the two has to be present, which the refinement below enforces.
 */
const timeLogSchema = z
  .object({
    projectId: z.string().uuid().optional().nullable(),
    projectTaskId: z.string().uuid().optional().nullable(),
    caseId: z.string().uuid().optional().nullable(),
    workDate: z.coerce.date(),
    hours: z.coerce.number().positive().max(HOURS_PER_DAY_CEILING).optional().nullable(),
    startTime: z.string().optional().nullable(),
    endTime: z.string().optional().nullable(),
    description: z.string().min(1, "Say what you worked on."),
    billable: z.boolean().default(true),
  })
  .refine(
    (v) => Boolean(v.hours) || hoursBetween(v.startTime, v.endTime) !== null,
    {
      message: "Give either a start and end time, or a number of hours.",
      path: ["hours"],
    },
  );

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

    // Derived, never trusted from the form: if both clock times are present
    // they decide the duration, so the stored hours can never contradict the
    // times shown beside them.
    const derived = hoursBetween(data.startTime, data.endTime);
    const hours = derived ?? data.hours;

    if (!hours) {
      return {
        ok: false,
        error: "Give either a start and end time, or a number of hours.",
        fieldErrors: { hours: ["Required unless you enter start and end times."] },
      };
    }

    if (hours > HOURS_PER_DAY_CEILING) {
      return {
        ok: false,
        error: `That works out at ${hours} hours. Check the times - the most that can be logged against one date is ${HOURS_PER_DAY_CEILING}.`,
        fieldErrors: { endTime: ["Longer than a day."] },
      };
    }

    const base = {
      userId: user.id,
      caseId: data.caseId ?? null,
      workDate: data.workDate.toISOString().slice(0, 10),
      hours,
      // Padded to match what a TIME column returns, so a value read back
      // compares equal to the one that was written.
      startTime: normaliseClock(data.startTime),
      endTime: normaliseClock(data.endTime),
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
      //
      // Read through the service role rather than the caller's client. These
      // two columns are salary data and are revoked from the authenticated role
      // (see 20260902000000_hide_rate_columns.sql), so a user client asking for
      // them now errors. Using the admin client here is not a widening: the
      // query is pinned to the caller's own id, so it returns their rates and
      // nobody else's.
      const { data: person } = await supabaseAdmin()
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

/**
 * Logs one day's work across several tasks in a single submission, and
 * optionally marks those tasks complete.
 *
 * A day rarely belongs to one task. The single-task form made someone submit
 * the same date four times to record four pieces of work, and the natural
 * shortcut - putting it all on one row with a description listing what was
 * touched - loses the attribution that task-level cost and invoicing depend on.
 *
 * So the shape is one time_log row per task, created together. time_log holds a
 * single projectTaskId by design (see time_log_context_check), and that is the
 * right design: hours have to land on the task they were spent on. What was
 * missing was a way to enter them together, not a looser table.
 *
 * Rows are validated as a set before any of them is written. A partial save
 * here is worse than a rejected one - half a day recorded, with no indication
 * of which half, is a timesheet nobody can reconcile.
 */
const workLogLineSchema = z.object({
  projectTaskId: z.string().uuid().optional().nullable(),
  hours: z.coerce.number().positive().max(HOURS_PER_DAY_CEILING),
  description: z.string().min(1, "Say what you worked on."),
  billable: z.boolean().default(true),
  /** Move the task to COMPLETED once the time is recorded. */
  completeTask: z.boolean().default(false),
});

const workLogDaySchema = z.object({
  projectId: z.string().uuid(),
  workDate: z.coerce.date(),
  lines: z.array(workLogLineSchema).min(1, "Add at least one line."),
});

export async function logProjectDay(
  input: z.infer<typeof workLogDaySchema>,
): Promise<ActionResult<{ created: number; completed: number }>> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = workLogDaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // The ceiling applies to the day, not to each line. Four three-hour lines is
  // twelve hours in one day however it is split up, and the check exists to
  // catch a slipped decimal point rather than to police any single entry.
  const dayTotal = data.lines.reduce((sum, l) => sum + l.hours, 0);
  if (dayTotal > HOURS_PER_DAY_CEILING) {
    return {
      ok: false,
      error: `That is ${dayTotal} hours in one day. Check the numbers - the most that can be logged against a single date is ${HOURS_PER_DAY_CEILING}.`,
    };
  }

  // A task appearing twice is almost always a mistake in the form rather than
  // an intention, and it would show as two entries nobody can tell apart.
  const taskIds = data.lines.map((l) => l.projectTaskId).filter(Boolean);
  if (new Set(taskIds).size !== taskIds.length) {
    return {
      ok: false,
      error: "The same task is on more than one line. Combine them into one entry.",
    };
  }

  const workDate = data.workDate.toISOString().slice(0, 10);
  const db = await supabaseServer();

  // Same membership rule as logTime: time is booked at the rate agreed for this
  // person on this project, and someone not on the project cannot book to it at
  // all. Skipping this check here would have made the multi-task form a way
  // around a restriction the single-entry form enforces.
  const { data: member } = await db
    .from("project_member")
    .select("active, billingRate, costRate")
    .eq("projectId", data.projectId)
    .eq("userId", user.id)
    .maybeSingle();

  if (!member || !member.active) {
    return {
      ok: false,
      error:
        "You are not an active member of this project, so you cannot book time to it. Ask the project manager to add you to the team.",
    };
  }

  const rows = data.lines.map((l) => ({
    userId: user.id,
    projectId: data.projectId,
    projectTaskId: l.projectTaskId || null,
    caseId: null,
    workDate,
    hours: l.hours,
    description: l.description,
    billable: l.billable,
    // Snapshotted per row, so a later rate change never rewrites what
    // already-logged work was worth.
    billingRate: l.billable ? member.billingRate : null,
    costRate: member.costRate,
    approvalStatus: "DRAFT",
    updatedAt: new Date().toISOString(),
  }));

  const { data: inserted, error } = await db
    .from("time_log")
    .insert(rows)
    .select("id");

  if (error) {
    return { ok: false, error: `Could not save the entries: ${error.message}` };
  }

  // Completing the tasks is deliberately a second step rather than part of the
  // insert. The time is the record that matters and it is already safely
  // written; if a status update fails - a task deleted underneath, a permission
  // the person does not hold - the hours must not be rolled back with it. The
  // count comes back so the caller can say what actually happened.
  let completed = 0;
  const toComplete = data.lines
    .filter((l) => l.completeTask && l.projectTaskId)
    .map((l) => l.projectTaskId as string);

  if (toComplete.length > 0) {
    const { data: done } = await db
      .from("project_task")
      .update({ status: "COMPLETED", updatedAt: new Date().toISOString() })
      .in("id", toComplete)
      .eq("projectId", data.projectId)
      .select("id");
    completed = (done ?? []).length;
  }

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/timesheets");

  return {
    ok: true,
    data: { created: (inserted ?? []).length, completed },
  };
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
        // Same derivation as logTime: clock times win when both are given, so
        // an edit cannot leave the hours disagreeing with the times beside them.
        hours: hoursBetween(parsed.data.startTime, parsed.data.endTime) ?? parsed.data.hours,
        startTime: normaliseClock(parsed.data.startTime),
        endTime: normaliseClock(parsed.data.endTime),
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
      return { ok: false, error: "Approved time cannot be deleted - it is part of the project's cost record." };
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
    const stampedAt = new Date().toISOString();
    await db.from("time_log").upsert(
      logs.map((log) => ({
        id: log.id,
        description: `${log.description}\n\n[Rejected by ${user.fullName}: ${reason.trim()}]`,
        updatedAt: stampedAt,
      })),
      { onConflict: "id" },
    );

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
  // time:approve, not project:read. This report lists every colleague's cost
  // rate and utilisation, which is a staffing and margin view for whoever books
  // the work — and the page that renders it already required time:approve, so
  // the weaker check here was a way around its own screen's gate.
  await requirePermission(PERMISSIONS.TIME_APPROVE);

  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - weeks * 7);

  const STANDARD_WEEKLY_HOURS = 40;
  const capacityHours = toDecimal(STANDARD_WEEKLY_HOURS * weeks);

  const db = await supabaseServer();

  const [usersRes, membershipsRes, logsRes] = await Promise.all([
    // Service role, because costRate and defaultBillingRate are revoked from
    // the authenticated role. The permission check above is what limits who
    // reaches this line — the client choice only decides whether the columns
    // come back at all.
    supabaseAdmin()
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
