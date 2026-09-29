"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requirePermission, PERMISSIONS } from "@/lib/authz";
import { WEB_FORM_FIELDS } from "@/lib/marketing";
import type { ActionResult } from "./partners";

/**
 * Website forms: what each asks for, where it may be posted from, and what
 * has come in. Submissions arrive at /api/forms/<key>.
 */

export interface WebForm {
  id: string;
  name: string;
  campaign: { id: string; name: string } | null;
  ownerUserId: string | null;
  ownerName: string | null;
  formKey: string;
  fields: { key: string; required: boolean }[];
  allowedOrigins: string[];
  thankYouUrl: string | null;
  thankYouMessage: string;
  active: boolean;
  submissionCount: number;
  createdAt: string;
}

const SELECT = `id, name, ownerUserId, formKey, fields, allowedOrigins, thankYouUrl, thankYouMessage, active, submissionCount, createdAt,
  campaign ( id, name ), owner:app_user!web_form_ownerUserId_fkey ( fullName )`;

function toForm(r: Record<string, unknown>): WebForm {
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  return {
    id: r.id as string,
    name: r.name as string,
    campaign: one(r.campaign),
    ownerUserId: (r.ownerUserId as string | null) ?? null,
    ownerName: one<{ fullName: string }>(r.owner)?.fullName ?? null,
    formKey: r.formKey as string,
    fields: (r.fields as WebForm["fields"]) ?? [],
    allowedOrigins: (r.allowedOrigins as string[]) ?? [],
    thankYouUrl: (r.thankYouUrl as string | null) ?? null,
    thankYouMessage: r.thankYouMessage as string,
    active: Boolean(r.active),
    submissionCount: Number(r.submissionCount ?? 0),
    createdAt: r.createdAt as string,
  };
}

export async function listWebForms(campaignId?: string): Promise<WebForm[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  let query = db.from("web_form").select(SELECT).order("createdAt", { ascending: false });
  if (campaignId) query = query.eq("campaignId", campaignId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load web forms: ${error.message}`);
  return (data ?? []).map((r) => toForm(r as Record<string, unknown>));
}

export interface Submission {
  id: string;
  outcome: string;
  summary: string | null;
  createdAt: string;
  leadId: string | null;
  contactId: string | null;
}

export async function getWebForm(id: string): Promise<{ form: WebForm; submissions: Submission[] } | null> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const [{ data: form }, { data: subs }] = await Promise.all([
    db.from("web_form").select(SELECT).eq("id", id).maybeSingle(),
    db.from("web_form_submission").select("id, outcome, summary, createdAt, leadId, contactId").eq("formId", id)
      .order("createdAt", { ascending: false }).limit(50),
  ]);
  if (!form) return null;
  return { form: toForm(form as Record<string, unknown>), submissions: (subs ?? []) as Submission[] };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name.").max(200),
  campaignId: z.string().uuid("Choose the campaign it belongs to."),
});

export async function createWebForm(input: z.infer<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const db = await supabaseServer();
  const { data, error } = await db
    .from("web_form")
    .insert({
      name: parsed.data.name,
      campaignId: parsed.data.campaignId,
      formKey: randomBytes(18).toString("base64url"),
      createdById: auth.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "The form could not be created." };
  revalidatePath(`/campaigns/${parsed.data.campaignId}`);
  revalidatePath("/campaigns/forms");
  return { ok: true, data: { id: data.id as string } };
}

const originSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => /^https?:\/\/[^\s/]+$/.test(v), "Each website is its address alone, such as https://babultech.com.");

const updateSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name.").max(200),
  ownerUserId: z.string().uuid().nullable(),
  fields: z
    .array(z.object({ key: z.enum(WEB_FORM_FIELDS.map((f) => f.key) as [string, ...string[]]), required: z.boolean() }))
    .min(1, "Ask for at least one thing."),
  allowedOrigins: z.array(originSchema).max(20),
  thankYouUrl: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\//.test(v), "The thank-you page is a full web address.").optional(),
  thankYouMessage: z.string().trim().min(1).max(500),
  active: z.boolean(),
});

export async function updateWebForm(id: string, input: z.infer<typeof updateSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  if (!d.fields.some((f) => (f.key === "email" || f.key === "phone"))) {
    return { ok: false, error: "Ask for an email or a phone number, or nobody can be reached." };
  }
  const db = await supabaseServer();
  const { data, error } = await db
    .from("web_form")
    .update({
      name: d.name,
      ownerUserId: d.ownerUserId,
      fields: d.fields,
      allowedOrigins: d.allowedOrigins,
      thankYouUrl: d.thankYouUrl || null,
      thankYouMessage: d.thankYouMessage,
      active: d.active,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select("campaignId");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That form could not be found." };
  revalidatePath(`/campaigns/forms/${id}`);
  revalidatePath(`/campaigns/${data[0].campaignId}`);
  return { ok: true, data: undefined };
}
