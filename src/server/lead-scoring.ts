"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, PERMISSIONS } from "@/lib/authz";
import { INTERACTION_TYPES } from "@/lib/marketing";
import type { ActionResult } from "./partners";

/**
 * Lead scoring rules and the threshold. The arithmetic is in the database
 * (lead_compute_score, in the lead scoring migration); this reads and changes
 * the rules, and re-scores everyone after a change.
 */

export interface ScoreRule {
  id: string;
  name: string;
  ruleType: "TOUCH" | "FIELD" | "INACTIVE";
  interactionType: string | null;
  field: string | null;
  matchText: string | null;
  days: number | null;
  points: number;
  active: boolean;
}

export async function getScoring(): Promise<{ rules: ScoreRule[]; threshold: number; autoQualify: boolean }> {
  await requireUser();
  const db = await supabaseServer();
  const [{ data: rules }, { data: setting }] = await Promise.all([
    db.from("lead_score_rule").select("id, name, ruleType, interactionType, field, matchText, days, points, active").order("sortOrder").order("createdAt"),
    db.from("lead_score_setting").select("threshold, autoQualify").maybeSingle(),
  ]);
  return {
    rules: (rules ?? []) as ScoreRule[],
    threshold: Number(setting?.threshold ?? 50),
    autoQualify: Boolean(setting?.autoQualify),
  };
}

const ruleSchema = z
  .object({
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1, "Give the rule a name.").max(150),
    ruleType: z.enum(["TOUCH", "FIELD", "INACTIVE"]),
    interactionType: z.enum(INTERACTION_TYPES.map((t) => t.value) as [string, ...string[]]).nullable(),
    field: z.enum(["jobTitle", "companySize", "industry", "businessType", "country", "city", "leadSource", "email"]).nullable(),
    matchText: z.string().trim().max(100).nullable(),
    days: z.number().int().min(1).max(3650).nullable(),
    points: z.number().int().min(-100).max(100),
    active: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (r.ruleType === "TOUCH" && !r.interactionType) ctx.addIssue({ code: "custom", message: "Choose which kind of touch." });
    if (r.ruleType === "FIELD" && (!r.field || !r.matchText)) ctx.addIssue({ code: "custom", message: "Choose the field and the words it must contain." });
    if (r.ruleType === "INACTIVE" && !r.days) ctx.addIssue({ code: "custom", message: "Say after how many days." });
  });

async function rescoreAll() {
  // Quietly in the background of this request's response: every open lead.
  await supabaseAdmin().rpc("lead_rescore_all");
}

export async function saveScoreRule(input: z.infer<typeof ruleSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the rule." };
  const r = parsed.data;
  const row = {
    name: r.name,
    ruleType: r.ruleType,
    interactionType: r.ruleType === "TOUCH" ? r.interactionType : null,
    field: r.ruleType === "FIELD" ? r.field : null,
    matchText: r.ruleType === "FIELD" ? r.matchText : null,
    days: r.ruleType === "INACTIVE" ? r.days : null,
    points: r.points,
    active: r.active,
    updatedAt: new Date().toISOString(),
  };
  const db = await supabaseServer();
  const { error } = r.id
    ? await db.from("lead_score_rule").update(row).eq("id", r.id)
    : await db.from("lead_score_rule").insert({ ...row, sortOrder: 1000 });
  if (error) return { ok: false, error: error.message };
  await rescoreAll();
  revalidatePath("/campaigns/scoring");
  return { ok: true, data: undefined };
}

export async function deleteScoreRule(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { error } = await db.from("lead_score_rule").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await rescoreAll();
  revalidatePath("/campaigns/scoring");
  return { ok: true, data: undefined };
}

const settingSchema = z.object({ threshold: z.number().int().min(1).max(1000), autoQualify: z.boolean() });

export async function saveScoreSetting(input: z.infer<typeof settingSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The threshold is a whole number from 1 to 1000." };
  const db = await supabaseServer();
  const { error } = await db
    .from("lead_score_setting")
    .update({ ...parsed.data, updatedAt: new Date().toISOString() })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns/scoring");
  return { ok: true, data: undefined };
}
