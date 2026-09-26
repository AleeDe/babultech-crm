"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Resend } from "resend";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { one } from "@/lib/decimal";
import { ACTIVITY_ENTITIES, type ActivityEntity } from "@/lib/activity-entities";
import type { ActionResult } from "./partners";

/**
 * Activities: what we did, against whatever we did it to.
 *
 * One table for leads, customers and partners. They differ only in what they
 * point at - ("relatedEntityType", "relatedEntityId") - and three tables would
 * mean three schemas, three sets of policies and three places to fix every bug,
 * while making "everything we did with this partner" and "every email this
 * month" two unrelated queries instead of one.
 *
 * Three kinds matter here:
 *
 *   EMAIL  something we sent, with what the provider told us happened to it
 *   EVENT  a webinar, a meeting, a visit - something with a time and a place
 *   LOG    a record of contact after the fact: a call made, a message sent
 *
 * TASK, CALL, MEETING and REMINDER are still in use by My Work, the account
 * health panel and the dashboard stream, so they remain valid.
 *
 * Not to be confused with partner MESSAGES. An activity is our internal record
 * of what we did; a partner message is a conversation the partner can read and
 * reply to. Merging them would publish internal notes to partners.
 */



export interface ActivityRow {
  id: string;
  activityType: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  outcome: string | null;
  location: string | null;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  /** Email only. */
  toAddress: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
  openCount: number;
  clickCount: number;
  failReason: string | null;
  batchId: string | null;
  owner?: { id: string; fullName: string } | null;
}

const SELECT = `
  id, activityType, subject, description, status, priority, outcome, location,
  startAt, dueAt, completedAt, relatedEntityType, relatedEntityId, createdAt,
  toAddress, sentAt, deliveredAt, openedAt, clickedAt, bouncedAt,
  unsubscribedAt, openCount, clickCount, failReason, batchId,
  owner:app_user!activity_ownerUserId_fkey ( id, fullName )
`;

/**
 * Everything done against one record, newest first.
 *
 * Ordered by when it happened rather than when it was entered: somebody logging
 * yesterday's call today wants it to appear where yesterday was.
 */
export async function listActivitiesFor(
  entityType: ActivityEntity,
  entityId: string,
): Promise<ActivityRow[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("activity")
    .select(SELECT)
    .eq("relatedEntityType", entityType)
    .eq("relatedEntityId", entityId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Could not load activities: ${error.message}`);

  return (data ?? []).map((a) => ({
    ...a,
    owner: one(a.owner as never),
  })) as unknown as ActivityRow[];
}

const activitySchema = z.object({
  id: z.string().uuid().optional().nullable(),
  activityType: z.enum(["EMAIL", "EVENT", "LOG", "TASK", "CALL", "MEETING", "REMINDER"]),
  subject: z.string().trim().min(1, "An activity needs a subject.").max(255),
  description: z.string().trim().max(8000).optional().or(z.literal("")),
  relatedEntityType: z.enum(ACTIVITY_ENTITIES),
  relatedEntityId: z.string().uuid(),
  status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).default("COMPLETED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  outcome: z.string().trim().max(4000).optional().or(z.literal("")),
  location: z.string().trim().max(255).optional().or(z.literal("")),
  startAt: z.string().optional().or(z.literal("")),
  dueAt: z.string().optional().or(z.literal("")),
});

const nullable = (v: string | undefined | null) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Log or schedule an activity by hand.
 *
 * Defaults to COMPLETED rather than OPEN, because most of what goes in here is
 * recorded after the fact - a call that has already happened. An activity with
 * a due date in the future is the exception, and the form sets OPEN for it.
 */
export async function saveActivity(
  input: z.infer<typeof activitySchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const row = {
    activityType: d.activityType,
    subject: d.subject,
    description: nullable(d.description),
    relatedEntityType: d.relatedEntityType,
    relatedEntityId: d.relatedEntityId,
    status: d.status,
    priority: d.priority,
    outcome: nullable(d.outcome),
    location: nullable(d.location),
    startAt: nullable(d.startAt),
    dueAt: nullable(d.dueAt),
    completedAt: d.status === "COMPLETED" ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };

  const db = await supabaseServer();

  const { data, error } = d.id
    ? await db.from("activity").update(row).eq("id", d.id).select("id").maybeSingle()
    : await db
        .from("activity")
        .insert({ id: randomUUID(), ownerUserId: auth.user.id, ...row })
        .select("id")
        .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That activity no longer exists." };

  revalidatePath("/activities");
  return { ok: true, data: { id: data.id as string } };
}

export async function deleteActivity(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { error } = await db
    .from("activity")
    .update({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/activities");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Mass email, from the leads list
// ---------------------------------------------------------------------------

/**
 * Stops before trailing punctuation, so "see https://example.com." links the
 * address and leaves the full stop as a full stop. Applied after escaping, so
 * it matches &amp; in a query string rather than a raw ampersand.
 */
const BARE_URL = /\bhttps?:\/\/[^\s<]+[^\s<.,:;!?"')\]]/g;

/** Plain text to simple HTML: paragraphs, and nothing a sender did not type. */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const linked = escaped.replace(
    BARE_URL,
    (url) => `<a href="${url}" style="color:#0b6bcb">${url}</a>`,
  );

  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">${paragraphs}</div>`;
}

/** Substitutes the few placeholders a sender may use. */
function fill(
  template: string,
  person: { firstName: string; lastName: string | null; companyName: string | null },
): string {
  return template
    .replace(/\{\{\s*firstName\s*\}\}/g, person.firstName)
    .replace(/\{\{\s*lastName\s*\}\}/g, person.lastName ?? "")
    .replace(/\{\{\s*companyName\s*\}\}/g, person.companyName ?? "there");
}

export interface SendResult {
  batchId: string;
  sent: number;
  failed: number;
  skipped: number;
  skippedReasons: string[];
}

const massEmailSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, "Choose at least one lead to email."),
  subject: z.string().trim().min(1, "The email needs a subject.").max(300),
  bodyText: z.string().trim().min(1, "The email needs a message.").max(20000),
  fromName: z.string().trim().max(120).optional().or(z.literal("")),
  replyTo: z.string().trim().max(255).optional().or(z.literal("")),
});

/**
 * Email a set of leads.
 *
 * Three things a naive loop would not do.
 *
 * It checks the suppression list, which is keyed on the ADDRESS rather than the
 * lead. Duplicate leads are expected here - the same person may exist twice
 * because they came from two campaigns - so consent has to follow the address or
 * unsubscribing one copy would leave the other mailable.
 *
 * Every message carries an unsubscribe link built from its own activity id,
 * plus a List-Unsubscribe header so the mail client offers its own button.
 * Being easy to leave is what stops people reporting mail as spam instead.
 *
 * It sends in batches of 100, the provider's limit, and records the provider's
 * message id against each activity so the webhook can match opens and clicks
 * back to the right person later.
 *
 * No campaign is named on the send. A batch may contain leads from several
 * campaigns, and each lead already records the campaign that produced it - so
 * campaign performance is derived by grouping the activities through the lead,
 * which stays right however mixed the audience was.
 */
export async function sendLeadEmail(
  input: z.infer<typeof massEmailSchema>,
): Promise<ActionResult<SendResult>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = massEmailSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "No mail provider is configured, so nothing can be sent." };

  const db = await supabaseServer();
  const admin = supabaseAdmin();

  const { data: leads, error: leadError } = await db
    .from("lead")
    .select("id, firstName, lastName, companyName, email, status")
    .in("id", d.leadIds)
    .is("deletedAt", null);

  if (leadError) return { ok: false, error: leadError.message };
  if (!leads?.length) return { ok: false, error: "None of those leads could be found." };

  // One lookup for the whole send rather than one per lead.
  const addresses = leads
    .map((l) => l.email?.toLowerCase().trim())
    .filter((e): e is string => Boolean(e));

  const { data: suppressed } = await db
    .from("email_suppression")
    .select("email, reason")
    .in("email", addresses.length ? addresses : ["-"]);

  const suppressionByEmail = new Map(
    (suppressed ?? []).map((s) => [s.email as string, s.reason as string]),
  );

  type Lead = (typeof leads)[number];
  const sendable: Lead[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;

  // The same address twice in one send would mail somebody twice - exactly what
  // duplicate leads produce, and exactly what they must not cause.
  const seen = new Set<string>();

  for (const l of leads) {
    const name = `${l.firstName} ${l.lastName ?? ""}`.trim();
    const email = l.email?.toLowerCase().trim();

    if (!email) { skipped += 1; skippedReasons.push(`${name}: no email address`); continue; }
    if (seen.has(email)) {
      skipped += 1;
      skippedReasons.push(`${name}: duplicate of another lead in this send`);
      continue;
    }
    const reason = suppressionByEmail.get(email);
    if (reason) {
      skipped += 1;
      skippedReasons.push(`${name}: ${reason.toLowerCase()}`);
      continue;
    }
    seen.add(email);
    sendable.push(l);
  }

  if (sendable.length === 0) {
    return {
      ok: false,
      error: `Nobody in this selection can be emailed. ${skippedReasons.slice(0, 3).join("; ")}`,
    };
  }

  const batchId = randomUUID();
  const stamp = new Date().toISOString();

  const { error: batchError } = await db.from("email_batch").insert({
    id: batchId,
    subject: d.subject,
    bodyText: d.bodyText,
    fromName: nullable(d.fromName),
    replyTo: nullable(d.replyTo),
    audienceType: "Lead",
    sentById: auth.user.id,
    sentAt: stamp,
    skippedCount: skipped,
    skippedReasons: skippedReasons.slice(0, 50),
    updatedAt: stamp,
  });
  if (batchError) return { ok: false, error: batchError.message };

  // The activity rows are created BEFORE sending, because the unsubscribe link
  // in each message is built from its activity id. Writing them afterwards would
  // mean either a second pass to insert the links or a link that cannot be
  // resolved back to a person.
  const activities = sendable.map((l) => ({
    id: randomUUID(),
    lead: l,
  }));

  const { error: insertError } = await db.from("activity").insert(
    activities.map(({ id, lead }) => ({
      id,
      activityType: "EMAIL",
      subject: d.subject,
      ownerUserId: auth.user.id,
      relatedEntityType: "Lead",
      relatedEntityId: lead.id,
      batchId,
      toAddress: lead.email,
      status: "COMPLETED",
      updatedAt: stamp,
    })),
  );
  if (insertError) return { ok: false, error: insertError.message };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const from = process.env.EMAIL_FROM ?? "BabulTech <onboarding@resend.dev>";
  const fromLine = d.fromName
    ? `${d.fromName} <${from.replace(/^.*</, "").replace(/>$/, "")}>`
    : from;

  const resend = new Resend(key);
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < activities.length; i += 100) {
    const batch = activities.slice(i, i + 100);

    const payload = batch.map(({ id, lead }) => {
      const unsubscribe = `${appUrl}/unsubscribe/${id}`;
      const body = fill(d.bodyText, lead);
      const footer =
        `<hr style="border:0;border-top:1px solid #e5e5e5;margin:28px 0 14px">` +
        `<p style="font-family:system-ui,sans-serif;font-size:12px;color:#777;margin:0">` +
        `You are receiving this because you are on our mailing list. ` +
        `<a href="${unsubscribe}" style="color:#777">Unsubscribe</a>.</p>`;

      return {
        from: fromLine,
        to: lead.email as string,
        replyTo: nullable(d.replyTo) ?? undefined,
        subject: fill(d.subject, lead),
        html: textToHtml(body) + footer,
        text: `${body}\n\n---\nUnsubscribe: ${unsubscribe}`,
        headers: {
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });

    const result = await resend.batch.send(payload);
    const at = new Date().toISOString();

    if (result.error) {
      failed += batch.length;
      await admin
        .from("activity")
        .update({ failReason: result.error.message.slice(0, 500), updatedAt: at })
        .in("id", batch.map((b) => b.id));
    } else {
      const ids = (result.data?.data ?? []) as { id: string }[];
      for (let j = 0; j < batch.length; j += 1) {
        await admin
          .from("activity")
          .update({ sentAt: at, providerMessageId: ids[j]?.id ?? null, updatedAt: at })
          .eq("id", batch[j].id);
      }
      sent += batch.length;
    }

    // A short pause between batches keeps within the provider's rate limit
    // without needing a queue.
    if (i + 100 < activities.length) await new Promise((r) => setTimeout(r, 600));
  }

  revalidatePath("/leads");
  revalidatePath("/activities");
  return { ok: true, data: { batchId, sent, failed, skipped, skippedReasons: skippedReasons.slice(0, 20) } };
}

// ---------------------------------------------------------------------------
// How a send performed
// ---------------------------------------------------------------------------

export interface EmailStats {
  audience: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  failed: number;
}

/**
 * Counted from the activities every time rather than stored on the batch.
 *
 * A stored total and the rows it came from disagree eventually - a webhook
 * arrives late, a row is corrected - and when they disagree the stored one is
 * believed, because it is the one on the screen.
 */
function tally(rows: Record<string, unknown>[]): EmailStats {
  return {
    audience: rows.length,
    sent: rows.filter((r) => r.sentAt).length,
    delivered: rows.filter((r) => r.deliveredAt).length,
    opened: rows.filter((r) => r.openedAt).length,
    clicked: rows.filter((r) => r.clickedAt).length,
    bounced: rows.filter((r) => r.bouncedAt).length,
    unsubscribed: rows.filter((r) => r.unsubscribedAt).length,
    failed: rows.filter((r) => r.failReason).length,
  };
}

const STAT_COLUMNS =
  "sentAt, deliveredAt, openedAt, clickedAt, bouncedAt, unsubscribedAt, failReason";

export interface EmailBatchSummary {
  id: string;
  subject: string;
  sentAt: string;
  skippedCount: number;
  sentBy?: { fullName: string } | null;
  stats: EmailStats;
}

/** Every send, newest first, each with its own scorecard. */
export async function listEmailBatches(limit = 50): Promise<EmailBatchSummary[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data: batches, error } = await db
    .from("email_batch")
    .select(`id, subject, sentAt, skippedCount,
             sentBy:app_user!email_batch_sentById_fkey ( fullName )`)
    .order("sentAt", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not load sends: ${error.message}`);
  if (!batches?.length) return [];

  // One query for every batch's rows rather than one per batch.
  const { data: rows } = await db
    .from("activity")
    .select(`batchId, ${STAT_COLUMNS}`)
    .in("batchId", batches.map((b) => b.id as string));

  const byBatch = new Map<string, Record<string, unknown>[]>();
  for (const r of rows ?? []) {
    const key = r.batchId as string;
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key)!.push(r as Record<string, unknown>);
  }

  return batches.map((b) => ({
    id: b.id as string,
    subject: b.subject as string,
    sentAt: b.sentAt as string,
    skippedCount: (b.skippedCount as number) ?? 0,
    sentBy: one(b.sentBy as never),
    stats: tally(byBatch.get(b.id as string) ?? []),
  }));
}

/**
 * How every email to a campaign's leads has performed.
 *
 * Grouped through the LEAD rather than off the batch. A single send may go to
 * leads from several campaigns, so stamping a campaign on the batch would
 * credit all of it to one of them; going through the lead gives each campaign
 * only its own, however mixed the audience was.
 */
export async function getCampaignEmailStats(campaignId: string): Promise<EmailStats> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data: leads } = await db
    .from("lead")
    .select("id")
    .eq("campaignId", campaignId)
    .is("deletedAt", null);

  const leadIds = (leads ?? []).map((l) => l.id as string);
  if (!leadIds.length) return tally([]);

  const { data: rows } = await db
    .from("activity")
    .select(STAT_COLUMNS)
    .eq("activityType", "EMAIL")
    .eq("relatedEntityType", "Lead")
    .in("relatedEntityId", leadIds)
    .is("deletedAt", null);

  return tally((rows ?? []) as Record<string, unknown>[]);
}
