"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser, PERMISSIONS } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Deliverables: what a project hands to the customer for approval. Our team
 * plans them and hands them over; the customer's portal Admin approves or
 * asks for changes in the support portal (customer_decide_deliverable).
 */

export interface Deliverable {
  id: string;
  projectId: string;
  milestoneId: string | null;
  milestoneName: string | null;
  name: string;
  description: string | null;
  link: string | null;
  dueDate: string | null;
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  customerComment: string | null;
  decidedByName: string | null;
}

const SELECT = `id, projectId, milestoneId, name, description, link, dueDate, status, submittedAt, decidedAt, customerComment,
  milestone ( name ), decidedBy:app_user!deliverable_decidedByUserId_fkey ( fullName )`;

function toDeliverable(r: Record<string, unknown>): Deliverable {
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  return {
    id: r.id as string,
    projectId: r.projectId as string,
    milestoneId: (r.milestoneId as string | null) ?? null,
    milestoneName: one<{ name: string }>(r.milestone)?.name ?? null,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    dueDate: (r.dueDate as string | null) ?? null,
    status: r.status as string,
    submittedAt: (r.submittedAt as string | null) ?? null,
    decidedAt: (r.decidedAt as string | null) ?? null,
    customerComment: (r.customerComment as string | null) ?? null,
    decidedByName: one<{ fullName: string }>(r.decidedBy)?.fullName ?? null,
  };
}

/** A project's deliverables, for our team or the customer - row security decides which. */
export async function listDeliverables(projectId: string): Promise<Deliverable[]> {
  await requireUser();
  const db = await supabaseServer();
  const { data } = await db.from("deliverable").select(SELECT).eq("projectId", projectId).order("dueDate", { nullsFirst: false }).order("createdAt");
  return (data ?? []).map((r) => toDeliverable(r as Record<string, unknown>));
}

const deliverableSchema = z.object({
  id: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Name the deliverable.").max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  link: z.string().trim().max(1000).refine((v) => v === "" || /^https?:\/\//.test(v), "A link is a full web address.").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function saveDeliverable(input: z.infer<typeof deliverableSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.PROJECT_MANAGE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = deliverableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the deliverable." };
  const { id, ...d } = parsed.data;
  const row = { ...d, description: d.description || null, link: d.link || null, updatedAt: new Date().toISOString() };
  const db = await supabaseServer();
  const { error } = id
    ? await db.from("deliverable").update(row).eq("id", id)
    : await db.from("deliverable").insert({ ...row, createdById: auth.user.id });
  if (error) return { ok: false, error: /row-level security/i.test(error.message) ? "You cannot change this project's deliverables." : error.message };
  revalidatePath(`/projects/${d.projectId}`);
  return { ok: true, data: undefined };
}

/** Hands a deliverable to the customer for approval (again, after changes). */
export async function submitDeliverable(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.PROJECT_MANAGE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { data, error } = await db
    .from("deliverable")
    .update({ status: "SUBMITTED", submittedAt: new Date().toISOString(), submittedById: auth.user.id, decidedAt: null, decidedByUserId: null, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["PLANNED", "CHANGES_REQUESTED"])
    .select("projectId");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a planned deliverable, or one sent back for changes, can be handed over." };
  revalidatePath(`/projects/${data[0].projectId}`);
  return { ok: true, data: undefined };
}

export async function deleteDeliverable(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.PROJECT_MANAGE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { data, error } = await db.from("deliverable").delete().eq("id", id).eq("status", "PLANNED").select("projectId");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a deliverable not yet handed over can be removed." };
  revalidatePath(`/projects/${data[0].projectId}`);
  return { ok: true, data: undefined };
}

/** The customer's Admin approves or asks for changes, from the support portal. */
export async function decideDeliverable(id: string, approve: boolean, comment: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { error } = await db.rpc("customer_decide_deliverable", { p_id: id, p_approve: approve, p_comment: comment });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
