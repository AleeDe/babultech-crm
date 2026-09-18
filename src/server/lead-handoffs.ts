"use server";
import { revalidatePath } from "next/cache";
import { requirePermission, authorize, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { requestHandoffSchema, decisionSchema, type Handoff } from "@/lib/lead-handoffs";
import type { ActionResult } from "./partners";

export async function getHandoffRecipients(): Promise<{ id: string; fullName: string }[]> {
  await requirePermission(PERMISSIONS.LEAD_WRITE);
  const db = await supabaseServer();
  const { data, error } = await db.rpc("lead_handoff_recipients");
  if (error) throw new Error("Could not load eligible sales recipients.");
  return data ?? [];
}
export async function getHandoffs(page = 1, leadId?: string) {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
  let query = db.from("lead_handoff").select("*", { count: "exact" });
  if (leadId) query = query.eq("leadId", leadId);
  const { data, error, count } = await query.order("createdAt", { ascending: false }).order("id").range((safePage - 1) * 40, safePage * 40 - 1);
  if (error) throw new Error("Could not load sales handoffs.");
  return { handoffs: (data ?? []) as Handoff[], count: count ?? 0, page: safePage };
}
function refresh(leadId: string) {
  for (const path of ["/leads", "/leads/calling", "/leads/handoffs", `/leads/${leadId}`]) revalidatePath(path);
}
export async function requestHandoff(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = requestHandoffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const value = parsed.data;
  const db = await supabaseServer();
  const { data, error } = await db.rpc("request_lead_handoff", { p_id: value.id, p_lead: value.leadId, p_recipient: value.recipientId, p_qualification: value.qualification, p_follow_up: value.followUpAt });
  if (error) return { ok: false, error: "Could not submit. Check lead ownership, an existing pending handoff, recipient access and the next-action date." };
  refresh(value.leadId);
  return { ok: true, data: { id: String(data) } };
}
export async function decideHandoff(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const value = parsed.data;
  const db = await supabaseServer();
  const { data, error } = await db.rpc("decide_lead_handoff", { p_id: value.id, p_decision: value.decision, p_reason: value.reason, p_follow_up: value.followUpAt });
  if (error) return { ok: false, error: "Could not record this decision. Refresh and check your access, handoff status and next-action date." };
  refresh(String(data));
  return { ok: true, data: { id: String(data) } };
}
