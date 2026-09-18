"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, authorize, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { callSchema, pakistanDayEnd, type CallQueueFilter } from "@/lib/calling";
import type { ActionResult } from "./partners";

export async function getCallingQueue(filter: CallQueueFilter, page = 1) {
  const user = await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const now = new Date();
  const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
  let query = db.from("lead")
    .select("id,leadNumber,firstName,lastName,companyName,phone,status,rating,nextFollowUpAt", { count: "exact" })
    .eq("ownerUserId", user.id).is("deletedAt", null).is("convertedAt", null)
    .not("status", "in", "(CONVERTED,DISQUALIFIED)");
  if (filter === "due") query = query.lte("nextFollowUpAt", now.toISOString());
  if (filter === "today") query = query.gt("nextFollowUpAt", now.toISOString()).lte("nextFollowUpAt", pakistanDayEnd(now));
  if (filter === "unscheduled") query = query.is("nextFollowUpAt", null);
  if (filter === "upcoming") query = query.gt("nextFollowUpAt", pakistanDayEnd(now));
  const { data, error, count } = await query.order("nextFollowUpAt", { ascending: true, nullsFirst: false })
    .order("id").range((safePage - 1) * 40, safePage * 40 - 1);
  if (error) throw new Error("Could not load your calling queue.");
  return { leads: data ?? [], count: count ?? 0, page: safePage, now: now.toISOString() };
}

export async function logLeadCall(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the call details." };
  const db = await supabaseServer();
  const { data, error } = await db.rpc("log_lead_call", {
    p_request_id: parsed.data.requestId, p_lead_id: parsed.data.leadId,
    p_outcome: parsed.data.outcome, p_notes: parsed.data.notes, p_follow_up: parsed.data.followUpAt,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "This lead is not assigned to you, or your access has changed." : "Could not save the call. Check that the lead is open and the follow-up is in the future, then retry." };
  revalidatePath("/leads/calling"); revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.data.leadId}`); revalidatePath("/activities");
  return { ok: true, data: { id: String(data.id) } };
}
