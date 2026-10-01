"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";
import { isPrivateAddress } from "@/lib/webhook-delivery";
import { startRunnerSoon } from "@/lib/jobs";
import type { ActionResult } from "./partners";

/**
 * Webhooks and the integration log, for administrators. Both tables have no
 * row policies, so they are read with the service role after the check here.
 */

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
  lastDelivery: { status: string; at: string } | null;
}

export interface IntegrationLogRow {
  id: string;
  integration: string;
  direction: string;
  event: string;
  endpoint: string | null;
  webhookName: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  status: string;
  httpStatus: number | null;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  requestAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

async function isAdmin(): Promise<boolean> {
  const me = await requireUser();
  return can(me, PERMISSIONS.ADMIN);
}

export async function listWebhooks(): Promise<Webhook[]> {
  if (!(await isAdmin())) return [];
  const db = supabaseAdmin();
  const { data, error } = await db.from("webhook").select("id, name, url, secret, events, active, createdAt").order("createdAt");
  if (error) throw new Error(`Could not load webhooks: ${error.message}`);
  const hooks = (data ?? []) as Omit<Webhook, "lastDelivery">[];
  const last = new Map<string, { status: string; at: string }>();
  if (hooks.length) {
    const { data: logs } = await db
      .from("integration_log")
      .select("webhookId, status, createdAt")
      .in("webhookId", hooks.map((h) => h.id))
      .order("createdAt", { ascending: false })
      .limit(200);
    for (const l of logs ?? []) if (!last.has(l.webhookId as string)) last.set(l.webhookId as string, { status: l.status as string, at: l.createdAt as string });
  }
  return hooks.map((h) => ({ ...h, events: h.events ?? [], lastDelivery: last.get(h.id) ?? null }));
}

export async function listIntegrationLog(filters: { status?: string; webhookId?: string } = {}): Promise<IntegrationLogRow[]> {
  if (!(await isAdmin())) return [];
  let query = supabaseAdmin()
    .from("integration_log")
    .select("id, integration, direction, event, endpoint, relatedEntityType, relatedEntityId, status, httpStatus, errorMessage, attempts, nextAttemptAt, requestAt, durationMs, createdAt, webhook ( name )")
    .order("createdAt", { ascending: false })
    .limit(200);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.webhookId) query = query.eq("webhookId", filters.webhookId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the integration log: ${error.message}`);
  return (data ?? []).map((r) => {
    const hook = (Array.isArray(r.webhook) ? r.webhook[0] : r.webhook) as { name?: string } | null;
    const { webhook: _hook, ...rest } = r as Record<string, unknown>;
    return { ...(rest as unknown as IntegrationLogRow), webhookName: hook?.name ?? null };
  });
}

const EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.key) as [string, ...string[]];

const schema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(2, "Give the webhook a name.").max(120),
  url: z.string().trim().url("Enter the full address, starting with https://.").max(1000)
    .refine((u) => /^https?:\/\//i.test(u), "The address must start with http:// or https://."),
  events: z.array(z.enum(EVENT_KEYS)).min(1, "Choose at least one event."),
  active: z.boolean(),
});

export async function saveWebhook(input: z.infer<typeof schema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the webhook." };
  const d = parsed.data;
  if (isPrivateAddress(d.url)) return { ok: false, error: "That address is inside a private network, which webhooks may not call." };

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  if (d.id) {
    const { error } = await db.from("webhook").update({ name: d.name, url: d.url, events: d.events, active: d.active, updatedAt: now }).eq("id", d.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/integrations");
    return { ok: true, data: { id: d.id } };
  }
  const { data, error } = await db
    .from("webhook")
    .insert({ name: d.name, url: d.url, events: d.events, active: d.active, secret: newSecret(), createdById: auth.user.id, updatedAt: now })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true, data: { id: data.id as string } };
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export async function rotateWebhookSecret(id: string): Promise<ActionResult<null>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await supabaseAdmin().from("webhook").update({ secret: newSecret(), updatedAt: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true, data: null };
}

export async function deleteWebhook(id: string): Promise<ActionResult<null>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await supabaseAdmin().from("webhook").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true, data: null };
}

/** Queues a "webhook.test" delivery to one webhook, and wakes the runner. */
export async function sendTestWebhook(id: string): Promise<ActionResult<null>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = supabaseAdmin();
  const { data: hook } = await db.from("webhook").select("id, url").eq("id", id).maybeSingle();
  if (!hook) return { ok: false, error: "That webhook no longer exists." };
  const { error } = await db.from("integration_log").insert({
    integration: "WEBHOOK",
    direction: "OUT",
    webhookId: hook.id,
    event: "webhook.test",
    endpoint: hook.url,
    payload: { event: "webhook.test", occurredAt: new Date().toISOString(), data: { message: "A test from BabulTech CRM.", sentBy: auth.user.fullName } },
  });
  if (error) return { ok: false, error: error.message };
  startRunnerSoon();
  revalidatePath("/settings/integrations");
  return { ok: true, data: null };
}

/** Tries a failed or abandoned delivery again, now. */
export async function retryDelivery(id: string): Promise<ActionResult<null>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await supabaseAdmin()
    .from("integration_log")
    .update({ status: "PENDING", attempts: 0, nextAttemptAt: new Date().toISOString(), errorMessage: null })
    .eq("id", id)
    .in("status", ["FAILED", "GAVE_UP"]);
  if (error) return { ok: false, error: error.message };
  startRunnerSoon();
  revalidatePath("/settings/integrations");
  return { ok: true, data: null };
}
