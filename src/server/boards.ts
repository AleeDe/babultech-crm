"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, requirePermission, scopeFilter, PERMISSIONS } from "@/lib/authz";
import { applyScope } from "@/lib/db";
import { listLeads } from "./crm";
import { listOpportunities, changeStage } from "./opportunities";
import { bulkSetLeadStatus } from "./bulk";
import { updateCase } from "./cases";
import { updateMyTaskProgress } from "./my-work";
import type { ActionResult } from "./partners";

/**
 * The boards: leads by status, deals by stage, cases by status, and your
 * project tasks by status. Moving a card goes through the same action the
 * record's own page uses, so every rule still applies - a deal cannot be won
 * without its products and accepted quote, a case cannot be resolved without
 * saying what fixed it.
 */

export interface BoardCard {
  id: string;
  column: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  href: string;
  amount?: number | null;
}

const name = (first?: string | null, last?: string | null) => `${first ?? ""} ${last && last !== "-" ? last : ""}`.trim();

export async function getLeadBoard(): Promise<BoardCard[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const [open, prospects] = await Promise.all([listLeads({}), listLeads({ status: "PROSPECT" })]);
  return [...prospects, ...open]
    .filter((l) => !["CONVERTED", "DISQUALIFIED"].includes(l.status as string))
    .map((l) => ({
      id: l.id as string,
      column: l.status as string,
      title: name(l.firstName as string, l.lastName as string),
      subtitle: (l.companyName as string | null) ?? null,
      meta: (l.owner as { fullName?: string } | null)?.fullName ?? null,
      href: `/leads/${l.id}`,
      amount: l.estimatedValue == null ? null : Number(l.estimatedValue),
    }));
}

export async function moveLead(id: string, status: string): Promise<ActionResult> {
  const result = await bulkSetLeadStatus([id], status);
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
}

export async function getDealBoard(): Promise<BoardCard[]> {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  const deals = await listOpportunities({});
  const monthAgo = Date.now() - 30 * 86_400_000;
  return (deals as Record<string, any>[])
    // Closed deals only from the last month, so the closed columns stay readable.
    .filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage) || new Date(d.actualCloseDate ?? d.updatedAt).getTime() > monthAgo)
    .map((d) => ({
      id: d.id as string,
      column: d.stage as string,
      title: d.name as string,
      subtitle: d.account?.name ?? null,
      meta: d.owner?.fullName ?? null,
      href: `/opportunities/${d.id}`,
      amount: d.amount == null ? null : Number(d.amount),
    }));
}

export async function moveDeal(id: string, stage: string, lossReason?: string | null): Promise<ActionResult> {
  const result = await changeStage({ id, stage: stage as never, lossReason: lossReason ?? null });
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
}

export async function getCaseBoard(): Promise<BoardCard[]> {
  const me = await requirePermission(PERMISSIONS.CASE_READ);
  const db = await supabaseServer();
  let query = db
    .from("support_case")
    .select("id, caseNumber, subject, status, priority, account ( name ), owner:app_user!support_case_ownerUserId_fkey ( fullName )")
    .is("deletedAt", null)
    .not("status", "in", "(CLOSED,CANCELLED)")
    .order("priority", { ascending: false })
    .limit(500);
  query = applyScope(query, await scopeFilter(me, "ownerUserId"));
  const { data } = await query;
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    column: c.status as string,
    title: `${c.caseNumber} ${c.subject}`,
    subtitle: one<{ name: string }>(c.account)?.name ?? null,
    meta: [c.priority, one<{ fullName: string }>(c.owner)?.fullName].filter(Boolean).join(" · ") || null,
    href: `/cases/${c.id}`,
  }));
}

/** Moves a case, keeping everything else on it as it is. */
export async function moveCase(id: string, status: string, resolution?: string | null): Promise<ActionResult> {
  await requirePermission(PERMISSIONS.CASE_WRITE);
  const db = await supabaseServer();
  const { data: c } = await db.from("support_case").select("*").eq("id", id).maybeSingle();
  if (!c) return { ok: false, error: "That case could not be found." };
  const result = await updateCase(id, {
    subject: c.subject,
    description: c.description,
    accountId: c.accountId,
    contactId: c.contactId,
    categoryId: c.categoryId,
    ownerUserId: c.ownerUserId,
    teamId: c.teamId,
    slaPolicyId: c.slaPolicyId,
    projectId: c.projectId,
    contractId: c.contractId,
    caseType: c.caseType,
    priority: c.priority,
    source: c.source,
    status: status as never,
    rootCause: c.rootCause,
    resolution: resolution ?? c.resolution,
    satisfactionScore: c.satisfactionScore,
  });
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
}

export async function getTaskBoard(): Promise<BoardCard[]> {
  const me = await requireUser();
  const db = await supabaseServer();
  const { data } = await db
    .from("project_task")
    .select("id, name, status, dueDate, completionPercent, projectId, project ( name )")
    .eq("assignedUserId", me.id)
    .not("status", "eq", "CANCELLED")
    .order("dueDate", { nullsFirst: false })
    .limit(300);
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  return (data ?? []).map((t) => ({
    id: t.id as string,
    column: t.status as string,
    title: t.name as string,
    subtitle: one<{ name: string }>(t.project)?.name ?? null,
    meta: t.dueDate ? `Due ${t.dueDate}` : null,
    href: `/projects/${t.projectId}/tasks/${t.id}`,
  }));
}

export async function moveTask(id: string, status: string): Promise<ActionResult> {
  const db = await supabaseServer();
  const { data: t } = await db.from("project_task").select("completionPercent").eq("id", id).maybeSingle();
  const percent = status === "COMPLETED" ? 100 : status === "NOT_STARTED" ? 0 : Number(t?.completionPercent ?? 0);
  const result = await updateMyTaskProgress(id, { status: status as never, completionPercent: percent });
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
}
