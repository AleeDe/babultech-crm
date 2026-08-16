"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * The conversation on a support case, and the SLA clock that runs alongside it.
 *
 * A case with no thread is a title and a status — what was actually said, what
 * was tried, and what the customer came back with all lived nowhere. This is
 * the record of the work.
 *
 * The two are one module because they move together: the first agent response
 * is what stops the first-response clock, and a reply that puts the case back
 * on the customer is what pauses the resolution clock. Splitting them would
 * mean remembering to call both, which is how a timer quietly keeps running.
 */

const WAITING_STATUSES = [
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_THIRD_PARTY",
] as const;

const CLOSED_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"] as const;

export interface CaseComment {
  id: string;
  commentType: string;
  body: string;
  isPublic: boolean;
  timeSpentMinutes: number | null;
  createdAt: string;
  author: { id: string; fullName: string } | null;
  authorContact: { id: string; firstName: string; lastName: string } | null;
  isMine: boolean;
}

export interface SlaEvent {
  id: string;
  eventType: string;
  eventAt: string;
  reason: string | null;
  businessMinutesDelta: number | null;
  createdBy: { fullName: string } | null;
}

export async function getCaseThread(caseId: string): Promise<{
  comments: CaseComment[];
  events: SlaEvent[];
  /** Minutes the clock has been paused, so a deadline can be read honestly. */
  pausedMinutes: number;
}> {
  const me = await requireUser();
  const db = await supabaseServer();

  const [comments, events] = await Promise.all([
    db
      .from("case_comment")
      .select(
        `*,
         author:app_user!case_comment_authorUserId_fkey ( id, fullName ),
         authorContact:contact ( id, firstName, lastName )`,
      )
      .eq("caseId", caseId)
      .order("createdAt")
      .limit(200),
    db
      .from("sla_timer_event")
      .select("*, createdBy:app_user ( fullName )")
      .eq("caseId", caseId)
      .order("eventAt")
      .limit(100),
  ]);

  type Row = Record<string, any>;

  const eventRows = (events.data ?? []) as Row[];

  // Total paused time, walking the pause/resume pairs. A pause with no resume
  // is still running, so it counts up to now.
  let pausedMinutes = 0;
  let pausedAt: number | null = null;
  for (const e of eventRows) {
    if (e.eventType === "PAUSED") pausedAt = new Date(e.eventAt).getTime();
    else if (e.eventType === "RESUMED" && pausedAt !== null) {
      pausedMinutes += Math.round((new Date(e.eventAt).getTime() - pausedAt) / 60_000);
      pausedAt = null;
    }
  }
  if (pausedAt !== null) pausedMinutes += Math.round((Date.now() - pausedAt) / 60_000);

  return {
    comments: ((comments.data ?? []) as Row[]).map((c) => ({
      ...c,
      author: one(c.author as never),
      authorContact: one(c.authorContact as never),
      isMine: c.authorUserId === me.id,
    })) as CaseComment[],
    events: eventRows.map((e) => ({ ...e, createdBy: one(e.createdBy as never) })) as SlaEvent[],
    pausedMinutes,
  };
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "Write something before posting."),
  commentType: z.enum(["CUSTOMER_COMMENT", "AGENT_RESPONSE", "INTERNAL_NOTE"]),
  timeSpentMinutes: z.coerce.number().int().min(0).optional().nullable(),
  /** Move the case at the same time — replying usually changes its state. */
  newStatus: z.string().optional().nullable(),
});

/**
 * Posts to the thread, and moves the clock if the reply warrants it.
 *
 * Three things happen together and must not drift apart:
 *   - the first agent response stamps firstRespondedAt
 *   - a reply that puts the case on the customer pauses the resolution clock
 *   - a reply that brings it back to us resumes it
 */
export async function addCaseComment(
  caseId: string,
  input: z.infer<typeof commentSchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_WRITE)) {
    return { ok: false, error: "You do not have permission to work this case." };
  }

  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the comment.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();

  const { data: supportCase } = await db
    .from("support_case")
    .select("id, status, firstRespondedAt, slaPolicyId, resolutionDueAt")
    .eq("id", caseId)
    .maybeSingle();

  if (!supportCase) return { ok: false, error: "That case is not available to you." };

  if (CLOSED_STATUSES.includes(supportCase.status as never) && !d.newStatus) {
    return {
      ok: false,
      error: "That case is closed. Reopen it before adding to the thread.",
    };
  }

  const now = new Date().toISOString();

  const { data: comment, error } = await db
    .from("case_comment")
    .insert({
      id: randomUUID(),
      updatedAt: now,
      caseId,
      authorUserId: me.id,
      authorContactId: null,
      commentType: d.commentType,
      body: d.body,
      // An internal note is never shown to the customer; the other two are.
      isPublic: d.commentType !== "INTERNAL_NOTE",
      timeSpentMinutes: d.timeSpentMinutes ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  const caseUpdates: Record<string, unknown> = { updatedAt: now };

  // The first agent response stops the first-response clock. Only an actual
  // response counts — an internal note is not a reply to the customer.
  if (d.commentType === "AGENT_RESPONSE" && !supportCase.firstRespondedAt) {
    caseUpdates.firstRespondedAt = now;
  }

  const wasWaiting = WAITING_STATUSES.includes(supportCase.status as never);
  const nowWaiting = d.newStatus
    ? WAITING_STATUSES.includes(d.newStatus as never)
    : wasWaiting;

  if (d.newStatus && d.newStatus !== supportCase.status) {
    caseUpdates.status = d.newStatus;
    if (CLOSED_STATUSES.includes(d.newStatus as never)) {
      caseUpdates.resolvedAt = now;
    }
  }

  await db.from("support_case").update(caseUpdates).eq("id", caseId);

  // The clock only pauses if the policy says it should. A policy with
  // pauseOnCustomerWait off keeps running regardless of who we are waiting on.
  if (supportCase.slaPolicyId) {
    const { data: policy } = await db
      .from("sla_policy")
      .select("pauseOnCustomerWait")
      .eq("id", supportCase.slaPolicyId)
      .maybeSingle();

    if (policy?.pauseOnCustomerWait) {
      if (!wasWaiting && nowWaiting) await recordSlaEvent(caseId, "PAUSED", "Waiting on the customer");
      else if (wasWaiting && !nowWaiting) await recordSlaEvent(caseId, "RESUMED", "Customer replied");
    }
  }

  if (d.newStatus && CLOSED_STATUSES.includes(d.newStatus as never)) {
    await recordSlaEvent(caseId, "STOPPED", "Case resolved");
  }

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return { ok: true, data: { id: comment.id } };
}

/**
 * Writes one SLA timer event.
 *
 * Kept internal: events are a consequence of what happened to the case, not
 * something anyone should be able to write directly. A hand-written PAUSED with
 * no matching state change would silently extend a deadline.
 */
async function recordSlaEvent(
  caseId: string,
  eventType: "STARTED" | "PAUSED" | "RESUMED" | "STOPPED" | "BREACHED",
  reason: string,
): Promise<void> {
  const me = await requireUser();
  const db = await supabaseServer();

  await db.from("sla_timer_event").insert({
    id: randomUUID(),
    caseId,
    eventType,
    eventAt: new Date().toISOString(),
    reason,
    createdById: me.id,
  });
}

/**
 * Extends the resolution deadline by however long the case sat paused.
 *
 * Called when a case comes back to us. Without it the pause is recorded but the
 * deadline never moves, so the clock effectively never stopped — which is worse
 * than not pausing at all, because the events say otherwise.
 */
export async function applyPauseToDeadline(caseId: string): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_WRITE)) {
    return { ok: false, error: "You do not have permission to work this case." };
  }

  const db = await supabaseServer();
  const { pausedMinutes } = await getCaseThread(caseId);

  if (pausedMinutes <= 0) {
    return { ok: false, error: "This case has not been paused." };
  }

  const { data: supportCase } = await db
    .from("support_case")
    .select("id, resolutionDueAt, slaBreached")
    .eq("id", caseId)
    .maybeSingle();

  if (!supportCase?.resolutionDueAt) {
    return { ok: false, error: "That case has no resolution deadline to extend." };
  }

  const extended = new Date(
    new Date(supportCase.resolutionDueAt).getTime() + pausedMinutes * 60_000,
  );

  const { error } = await db
    .from("support_case")
    .update({
      resolutionDueAt: extended.toISOString(),
      // The extension may clear a breach that only happened while paused.
      slaBreached: extended.getTime() < Date.now(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/cases/${caseId}`);
  return { ok: true, data: { id: caseId } };
}
