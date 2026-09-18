"use server";
import { revalidatePath } from "next/cache";
import { requireUser, requirePermission, can, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { deliverySubmitSchema, deliveryDecisionSchema, type DeliveryHandoff, type DeliveryOptions } from "@/lib/delivery-handoffs";
import type { ActionResult } from "./partners";

export async function getDeliveryOptions(opportunityId: string): Promise<DeliveryOptions> {
 await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);
 const db = await supabaseServer();
 const { data, error } = await db.rpc("delivery_handoff_options", { p_opportunity: opportunityId });
 if (error) throw new Error("Only the owner of a won opportunity can prepare its delivery handoff.");
 return data;
}
export async function getDeliveryHandoffs(page = 1) {
 const user = await requireUser();
 if (!can(user, PERMISSIONS.OPPORTUNITY_READ) && !can(user, PERMISSIONS.PROJECT_MANAGE)) throw new Error("Delivery handoff access required.");
 const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
 const db = await supabaseServer();
 const { data, error, count } = await db.from("delivery_handoff").select("*", { count: "exact" }).order("createdAt", { ascending: false }).order("id").range((safePage - 1) * 40, safePage * 40 - 1);
 if (error) throw new Error("Could not load delivery handoffs.");
 return { rows: (data ?? []) as DeliveryHandoff[], count: count ?? 0, page: safePage };
}
function refresh(projectId: string) {
 for (const path of ["/projects/handoffs", "/projects", `/projects/${projectId}`]) revalidatePath(path);
}
export async function submitDeliveryHandoff(input: unknown): Promise<ActionResult<{ id: string }>> {
 const user = await requireUser();
 if (!can(user, PERMISSIONS.OPPORTUNITY_WRITE)) return { ok: false, error: "Sales write permission required." };
 const parsed = deliverySubmitSchema.safeParse(input);
 if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
 const v = parsed.data; const db = await supabaseServer();
 const { data, error } = await db.rpc("submit_delivery_handoff", { p_id: v.id, p_project: v.projectId, p_quote: v.quotationId, p_checklist: v.checklist, p_payment: v.paymentState });
 if (error) return { ok: false, error: "Could not submit. Check the linked planning project, accepted quote, owner/PM access and any pending handoff." };
 refresh(v.projectId); return { ok: true, data: { id: String(data) } };
}
export async function decideDeliveryHandoff(input: unknown): Promise<ActionResult<{ id: string }>> {
 const user = await requireUser();
 const parsed = deliveryDecisionSchema.safeParse(input);
 if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
 const v = parsed.data;
 if (!can(user, v.decision === "CANCELLED" ? PERMISSIONS.OPPORTUNITY_WRITE : PERMISSIONS.PROJECT_MANAGE)) return { ok: false, error: "Your role cannot make this decision." };
 const db = await supabaseServer();
 const { data, error } = await db.rpc("decide_delivery_handoff", { p_id: v.id, p_decision: v.decision, p_reason: v.reason, p_kickoff: v.kickoffAt });
 if (error) return { ok: false, error: "Could not decide. Check the assigned PM, payment prerequisite, unchanged accepted quote, won deal and future kickoff date. Return changed details for resubmission." };
 refresh(String(data)); return { ok: true, data: { id: String(data) } };
}
