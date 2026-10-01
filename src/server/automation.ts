"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser, PERMISSIONS } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Approval rules and the switchable automatic rules. What each rule does is in
 * the productivity migration; this reads and changes their settings.
 */

export interface ApprovalRule {
  id: string;
  name: string;
  minTotal: number | null;
  maxLineDiscountPercent: number | null;
  active: boolean;
}

export async function listApprovalRules(): Promise<ApprovalRule[]> {
  await requireUser();
  const db = await supabaseServer();
  const { data } = await db.from("approval_rule").select("id, name, minTotal, maxLineDiscountPercent, active").order("createdAt");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    minTotal: r.minTotal == null ? null : Number(r.minTotal),
    maxLineDiscountPercent: r.maxLineDiscountPercent == null ? null : Number(r.maxLineDiscountPercent),
    active: Boolean(r.active),
  }));
}

const ruleSchema = z
  .object({
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1, "Give the rule a name.").max(150),
    minTotal: z.number().nonnegative().nullable(),
    maxLineDiscountPercent: z.number().min(0).max(100).nullable(),
    active: z.boolean(),
  })
  .refine((r) => r.minTotal !== null || r.maxLineDiscountPercent !== null, "Set a total, a discount, or both.");

export async function saveApprovalRule(input: z.infer<typeof ruleSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the rule." };
  const { id, ...row } = parsed.data;
  const db = await supabaseServer();
  const values = { ...row, entity: "Quotation", updatedAt: new Date().toISOString() };
  const { error } = id ? await db.from("approval_rule").update(values).eq("id", id) : await db.from("approval_rule").insert(values);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/automation");
  return { ok: true, data: undefined };
}

export async function deleteApprovalRule(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { error } = await db.from("approval_rule").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/automation");
  return { ok: true, data: undefined };
}

export interface AutomationRule {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  await requireUser();
  const db = await supabaseServer();
  const { data } = await db.from("automation_rule").select("key, enabled, config").order("key");
  return (data ?? []) as AutomationRule[];
}

const automationSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("LEAD_ROUND_ROBIN"), enabled: z.boolean(), config: z.object({ userIds: z.array(z.string().uuid()).max(100) }) }),
  z.object({ key: z.literal("LEAD_NO_FOLLOW_UP"), enabled: z.boolean(), config: z.object({ days: z.number().int().min(1).max(365) }) }),
  z.object({ key: z.literal("DEAL_STALE"), enabled: z.boolean(), config: z.object({ days: z.number().int().min(1).max(365) }) }),
  z.object({ key: z.literal("CASE_RESPONSE_WARNING"), enabled: z.boolean(), config: z.object({ minutes: z.number().int().min(5).max(1440) }) }),
]);

export async function saveAutomationRule(input: z.infer<typeof automationSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the rule." };
  const d = parsed.data;
  if (d.key === "LEAD_ROUND_ROBIN" && d.enabled && d.config.userIds.length === 0) {
    return { ok: false, error: "Choose at least one person to share leads between." };
  }
  const db = await supabaseServer();
  const { data: current } = await db.from("automation_rule").select("config").eq("key", d.key).maybeSingle();
  const { error } = await db
    .from("automation_rule")
    .update({
      enabled: d.enabled,
      // Keeps the round robin's place in the queue across edits.
      config: { ...((current?.config as Record<string, unknown>) ?? {}), ...d.config },
      updatedAt: new Date().toISOString(),
      updatedById: auth.user.id,
    })
    .eq("key", d.key);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/automation");
  return { ok: true, data: undefined };
}

export interface AutomationLogRow {
  id: string;
  ruleKey: string;
  entityType: string | null;
  entityId: string | null;
  action: string;
  createdAt: string;
}

export async function listAutomationLog(limit = 50): Promise<AutomationLogRow[]> {
  await requireUser();
  const db = await supabaseServer();
  const { data } = await db
    .from("automation_log")
    .select("id, ruleKey, entityType, entityId, action, createdAt")
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []) as AutomationLogRow[];
}
