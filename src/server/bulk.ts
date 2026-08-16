"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Acting on many records at once.
 *
 * Reassigning twenty leads or closing thirty stale opportunities one screen at
 * a time is the sort of work people stop doing, and the data goes stale
 * instead.
 *
 * Two rules hold throughout:
 *
 * Every write goes through the caller's own client, so RLS decides which of the
 * submitted ids they may actually touch. A bulk endpoint that used the service
 * role would be the easiest way to edit another team's pipeline — the ids come
 * from the browser and cannot be trusted.
 *
 * The result reports what was changed, not what was asked for. If RLS silently
 * dropped half the rows, saying "20 updated" would be a lie the reader has no
 * way to check.
 */

const MAX_BATCH = 200;

const idsSchema = z
  .array(z.string().uuid())
  .min(1, "Select at least one row.")
  .max(MAX_BATCH, `That is more than ${MAX_BATCH} rows. Narrow the filter first.`);

/** What a bulk action reports back. */
interface BulkOutcome {
  requested: number;
  updated: number;
  /** Set when fewer rows changed than were asked for. */
  note?: string;
}

function outcome(requested: number, updated: number): BulkOutcome {
  if (updated === requested) return { requested, updated };
  return {
    requested,
    updated,
    note:
      updated === 0
        ? "Nothing was changed — none of those rows are yours to edit."
        : `${requested - updated} row(s) were left alone, either because they are outside your access or no longer in a state that allows it.`,
  };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function bulkAssignLeads(
  ids: string[],
  ownerUserId: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) {
    return { ok: false, error: "You do not have permission to reassign leads." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  if (!z.string().uuid().safeParse(ownerUserId).success) {
    return { ok: false, error: "Choose who to assign them to." };
  }

  const db = await supabaseServer();

  const { data, error } = await db
    .from("lead")
    .update({ ownerUserId, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .is("convertedAt", null)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

export async function bulkSetLeadStatus(
  ids: string[],
  status: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) {
    return { ok: false, error: "You do not have permission to change leads." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const allowed = ["NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING"];
  if (!allowed.includes(status)) {
    // Conversion and disqualification are single-record decisions with their
    // own consequences — converting writes an account, a contact and a deal.
    return { ok: false, error: "That status has to be set on each lead individually." };
  }

  const db = await supabaseServer();

  const { data, error } = await db
    .from("lead")
    .update({ status, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .is("convertedAt", null)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export async function bulkAssignOpportunities(
  ids: string[],
  ownerUserId: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return { ok: false, error: "You do not have permission to reassign deals." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const db = await supabaseServer();

  const { data, error } = await db
    .from("opportunity")
    .update({ ownerUserId, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .not("stage", "in", '("CLOSED_WON","CLOSED_LOST")')
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/opportunities");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

export async function bulkSetOpportunityStage(
  ids: string[],
  stage: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return { ok: false, error: "You do not have permission to change deals." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const allowed = [
    "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
    "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION", "ON_HOLD",
  ];

  if (!allowed.includes(stage)) {
    // Closing a deal sets the close date, drives commission accrual and needs a
    // loss reason. That belongs on the record, not on a batch.
    return { ok: false, error: "Closing a deal has to be done on the deal itself." };
  }

  const db = await supabaseServer();

  const { data, error } = await db
    .from("opportunity")
    .update({ stage, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .not("stage", "in", '("CLOSED_WON","CLOSED_LOST")')
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/opportunities");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export async function bulkAssignCases(
  ids: string[],
  ownerUserId: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_WRITE)) {
    return { ok: false, error: "You do not have permission to reassign cases." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const db = await supabaseServer();

  const { data, error } = await db
    .from("support_case")
    .update({ ownerUserId, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .not("status", "in", '("CLOSED","CANCELLED")')
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/cases");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

export async function bulkSetCasePriority(
  ids: string[],
  priority: string,
): Promise<ActionResult<BulkOutcome>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_WRITE)) {
    return { ok: false, error: "You do not have permission to change cases." };
  }

  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)) {
    return { ok: false, error: "That is not a valid priority." };
  }

  const db = await supabaseServer();

  // The SLA clock is set from the priority at creation and is not recalculated
  // here: a case raised under a four-hour promise keeps that promise even if it
  // is later downgraded. Changing the deadline retroactively would rewrite what
  // was committed to the customer.
  const { data, error } = await db
    .from("support_case")
    .update({ priority, updatedAt: new Date().toISOString() })
    .in("id", parsed.data)
    .not("status", "in", '("CLOSED","CANCELLED")')
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/cases");
  return { ok: true, data: outcome(parsed.data.length, data?.length ?? 0) };
}

/** Assignable users, for the bulk assign dropdown. */
export async function getAssignableUsers() {
  await requireUser();
  const db = await supabaseServer();

  const { data } = await db
    .from("app_user")
    .select("id, fullName")
    .eq("status", "ACTIVE")
    .is("deletedAt", null)
    .is("partnerId", null)
    .order("fullName");

  return data ?? [];
}
