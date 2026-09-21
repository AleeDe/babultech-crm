"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Resend } from "resend";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { picklistCode } from "@/lib/picklists";
import type { ActionResult } from "./partners";

/**
 * Campaign activities: the outreach, and how each person responded.
 *
 * An activity is what you run; a junction row is one person's outcome within
 * it. Everything here is gated on lead:read and lead:write, as campaign members
 * are.
 */

export interface CampaignActivity {
  id: string;
  campaignId: string;
  name: string;
  activityType: string;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  fromName: string | null;
  replyTo: string | null;
  description: string | null;
  createdAt: string;
  campaign?: { name: string } | null;
  owner?: { fullName: string } | null;
  audienceCount?: number;
}

const ACTIVITY_SELECT = `
  id, campaignId, name, activityType, status, scheduledAt, startedAt, completedAt,
  subject, bodyHtml, bodyText, fromName, replyTo, description, createdAt,
  campaign ( name ),
  owner:app_user!campaign_activity_ownerUserId_fkey ( fullName )
`;

export async function listCampaignActivities(campaignId?: string): Promise<CampaignActivity[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  let query = db.from("campaign_activity").select(ACTIVITY_SELECT).is("deletedAt", null);
  if (campaignId) query = query.eq("campaignId", campaignId);

  const { data, error } = await query.order("createdAt", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load activities: ${error.message}`);

  const activities = (data ?? []) as unknown as CampaignActivity[];
  if (activities.length === 0) return activities;

  // One query for every audience size, rather than one per activity.
  const { data: rows } = await db
    .from("campaign_activity_member")
    .select("activityId")
    .in("activityId", activities.map((a) => a.id));

  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row.activityId as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return activities.map((a) => ({ ...a, audienceCount: counts.get(a.id) ?? 0 }));
}

export async function getCampaignActivity(id: string): Promise<CampaignActivity | null> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("campaign_activity")
    .select(ACTIVITY_SELECT)
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();

  if (error) throw new Error(`Could not load the activity: ${error.message}`);
  return (data as unknown as CampaignActivity) ?? null;
}

const activitySchema = z.object({
  id: z.string().uuid().optional().nullable(),
  campaignId: z.string().uuid("Choose which campaign this belongs to."),
  name: z.string().trim().min(2, "Give the activity a name.").max(200),
  activityType: picklistCode,
  scheduledAt: z.string().trim().optional().or(z.literal("")),
  subject: z.string().trim().max(300).optional().or(z.literal("")),
  bodyText: z.string().trim().max(50000).optional().or(z.literal("")),
  fromName: z.string().trim().max(120).optional().or(z.literal("")),
  replyTo: z.string().trim().email("That does not look like an email address.").optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
});

function nullable(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export async function saveCampaignActivity(
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

  // An email with no subject is not a draft, it is a mistake waiting to be
  // sent. Checked here rather than in the schema because the requirement
  // depends on the type.
  if (d.activityType === "EMAIL" && !nullable(d.subject)) {
    return {
      ok: false,
      error: "An email activity needs a subject line.",
      fieldErrors: { subject: ["Needed for an email."] },
    };
  }

  const db = await supabaseServer();

  if (d.id) {
    const { data: before } = await db
      .from("campaign_activity")
      .select("status")
      .eq("id", d.id)
      .maybeSingle();
    if (before && ["RUNNING", "COMPLETED"].includes(before.status as string)) {
      return { ok: false, error: "This activity has already run, so it can no longer be edited." };
    }
  }

  const row = {
    campaignId: d.campaignId,
    name: d.name,
    activityType: d.activityType,
    scheduledAt: nullable(d.scheduledAt),
    subject: nullable(d.subject),
    bodyText: nullable(d.bodyText),
    bodyHtml: nullable(d.bodyText) ? textToHtml(d.bodyText!) : null,
    fromName: nullable(d.fromName),
    replyTo: nullable(d.replyTo),
    description: nullable(d.description),
    updatedAt: new Date().toISOString(),
  };

  const { data, error } = d.id
    ? await db.from("campaign_activity").update(row).eq("id", d.id).select("id").maybeSingle()
    : await db
        .from("campaign_activity")
        .insert({ id: randomUUID(), ownerUserId: auth.user.id, status: "DRAFT", ...row })
        .select("id")
        .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That activity no longer exists." };

  revalidatePath("/campaigns");
  return { ok: true, data: { id: data.id as string } };
}

export async function deleteCampaignActivity(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { error } = await db
    .from("campaign_activity")
    .update({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The audience
// ---------------------------------------------------------------------------

export interface AudienceRow {
  id: string;
  memberId: string;
  outcome: string | null;
  outcomeNotes: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
  openCount: number;
  clickCount: number;
  failReason: string | null;
  member: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    emailOptOut: boolean;
    emailBounced: boolean;
    lastCampaignRunAt: string | null;
  };
}

export async function getActivityAudience(activityId: string): Promise<AudienceRow[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("campaign_activity_member")
    .select(
      `id, memberId, outcome, outcomeNotes, sentAt, deliveredAt, openedAt, clickedAt,
       bouncedAt, unsubscribedAt, openCount, clickCount, failReason,
       member:campaign_member ( firstName, lastName, email, phone, companyName,
                                emailOptOut, emailBounced, lastCampaignRunAt )`,
    )
    .eq("activityId", activityId)
    .order("createdAt");

  if (error) throw new Error(`Could not load the audience: ${error.message}`);
  return (data ?? []) as unknown as AudienceRow[];
}

export async function addMembersToActivity(
  activityId: string,
  memberIds: string[],
): Promise<ActionResult<{ added: number; alreadyThere: number }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  if (memberIds.length === 0) return { ok: false, error: "Nobody was selected." };

  const db = await supabaseServer();
  const { data, error } = await db.rpc("add_members_to_activity", {
    p_activity: activityId,
    p_members: memberIds,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns");
  return { ok: true, data: (typeof data === "string" ? JSON.parse(data) : data) as never };
}

export async function removeMemberFromActivity(rowId: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  // Only before it has gone out; afterwards the row is the record of what was
  // sent, and deleting it would make the numbers lie.
  const { data: row } = await db
    .from("campaign_activity_member")
    .select("sentAt")
    .eq("id", rowId)
    .maybeSingle();

  if (row?.sentAt) {
    return { ok: false, error: "This person has already been contacted, so they stay on the list." };
  }

  const { error } = await db.from("campaign_activity_member").delete().eq("id", rowId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  return { ok: true, data: undefined };
}

const outcomeSchema = z.object({
  rowId: z.string().uuid(),
  outcome: picklistCode,
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Records how a call or a webinar went for one person. */
export async function recordOutcome(
  input: z.infer<typeof outcomeSchema>,
): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const db = await supabaseServer();
  const { error } = await db
    .from("campaign_activity_member")
    .update({
      outcome: parsed.data.outcome,
      outcomeNotes: nullable(parsed.data.notes),
      recordedById: auth.user.id,
      recordedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", parsed.data.rowId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns");
  return { ok: true, data: undefined };
}

/** Marks a call round or webinar as done, stamping everyone's last-contacted. */
export async function markActivityRun(activityId: string): Promise<ActionResult<{ touched: number }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { data, error } = await db.rpc("mark_activity_run", { p_activity: activityId });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  revalidatePath("/campaign-members");
  return { ok: true, data: (typeof data === "string" ? JSON.parse(data) : data) as never };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * A web address in the middle of a line.
 *
 * Stops before trailing punctuation, so "see https://example.com." links the
 * address and leaves the full stop as a full stop. Applied after escaping, so
 * it matches &amp; in a query string rather than a raw ampersand.
 */
const BARE_URL = /\bhttps?:\/\/[^\s<]+[^\s<.,:;!?"')\]]/g;

/**
 * Plain text to simple HTML: paragraphs, and nothing a sender did not type.
 *
 * Web addresses become real links. Without that a sender typing an address
 * gets text nobody can click - and click tracking works by rewriting anchor
 * tags, so an email of bare URLs would report no clicks however many people
 * followed them.
 */
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
function fill(template: string, member: { firstName: string; lastName: string | null; companyName: string | null }): string {
  return template
    .replace(/\{\{\s*firstName\s*\}\}/g, member.firstName)
    .replace(/\{\{\s*lastName\s*\}\}/g, member.lastName ?? "")
    .replace(/\{\{\s*companyName\s*\}\}/g, member.companyName ?? "there");
}

export interface SendResult {
  sent: number;
  failed: number;
  skipped: number;
  skippedReasons: string[];
}

/**
 * Send a mass email to an activity's audience.
 *
 * Three things this does that a naive loop would not.
 *
 * Anyone who has unsubscribed, bounced, or has no address is skipped and
 * counted, not sent to. Mailing an unsubscribed address is the one thing that
 * turns a mailing list into a legal problem, and mailing a dead one damages the
 * domain's reputation, which would also break the invoice and portal emails.
 *
 * Every message carries an unsubscribe link built from that person's own token,
 * plus a List-Unsubscribe header so the mail client offers it too.
 *
 * It sends in batches of 100, which is the provider's limit, and records the
 * provider's message id against each person so the webhook can match the
 * opens and clicks back to them later.
 */
export async function sendCampaignEmail(activityId: string): Promise<ActionResult<SendResult>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const admin = supabaseAdmin();

  const { data: activity } = await db
    .from("campaign_activity")
    .select("id, name, activityType, status, subject, bodyText, fromName, replyTo")
    .eq("id", activityId)
    .is("deletedAt", null)
    .maybeSingle();

  if (!activity) return { ok: false, error: "That activity no longer exists." };
  if (activity.activityType !== "EMAIL") {
    return { ok: false, error: "Only an email activity can be sent." };
  }
  if (["RUNNING", "COMPLETED"].includes(activity.status as string)) {
    return { ok: false, error: "This email has already been sent." };
  }
  if (!activity.subject || !activity.bodyText) {
    return { ok: false, error: "The email needs a subject and a message before it can go out." };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "No mail provider is configured, so nothing can be sent." };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const from = process.env.EMAIL_FROM ?? "BabulTech <onboarding@resend.dev>";
  const fromLine = activity.fromName ? `${activity.fromName} <${from.replace(/^.*</, "").replace(/>$/, "")}>` : from;

  const { data: audience, error: audienceError } = await db
    .from("campaign_activity_member")
    .select(
      `id, sentAt,
       member:campaign_member ( id, firstName, lastName, email, companyName,
                                emailOptOut, emailBounced, active, unsubscribeToken )`,
    )
    .eq("activityId", activityId);

  if (audienceError) return { ok: false, error: audienceError.message };
  if (!audience?.length) return { ok: false, error: "Nobody has been added to this activity yet." };

  await admin
    .from("campaign_activity")
    .update({ status: "RUNNING", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", activityId);

  type Row = (typeof audience)[number] & {
    member: {
      id: string; firstName: string; lastName: string | null; email: string | null;
      companyName: string | null; emailOptOut: boolean; emailBounced: boolean;
      active: boolean; unsubscribeToken: string;
    };
  };

  const sendable: Row[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;

  for (const row of audience as unknown as Row[]) {
    const m = row.member;
    const name = `${m.firstName} ${m.lastName ?? ""}`.trim();
    if (row.sentAt) { skipped += 1; skippedReasons.push(`${name}: already sent`); continue; }
    if (!m.email) { skipped += 1; skippedReasons.push(`${name}: no email address`); continue; }
    if (m.emailOptOut) { skipped += 1; skippedReasons.push(`${name}: unsubscribed`); continue; }
    if (m.emailBounced) { skipped += 1; skippedReasons.push(`${name}: address bounced before`); continue; }
    if (!m.active) { skipped += 1; skippedReasons.push(`${name}: off the active list`); continue; }
    sendable.push(row);
  }

  if (sendable.length === 0) {
    await admin
      .from("campaign_activity")
      .update({ status: "DRAFT", startedAt: null, updatedAt: new Date().toISOString() })
      .eq("id", activityId);
    return {
      ok: false,
      error: `Nobody in this audience can be emailed. ${skippedReasons.slice(0, 3).join("; ")}`,
    };
  }

  const resend = new Resend(key);
  let sent = 0;
  let failed = 0;

  // 100 is the provider's batch limit; a short pause between batches keeps
  // within its rate limit without needing a queue.
  for (let i = 0; i < sendable.length; i += 100) {
    const batch = sendable.slice(i, i + 100);

    const payload = batch.map((row) => {
      const m = row.member;
      const unsubscribe = `${appUrl}/unsubscribe/${m.unsubscribeToken}`;
      const body = fill(activity.bodyText as string, m);
      const footer =
        `<hr style="border:0;border-top:1px solid #e5e5e5;margin:28px 0 14px">` +
        `<p style="font-family:system-ui,sans-serif;font-size:12px;color:#777;margin:0">` +
        `You are receiving this because you are on our mailing list. ` +
        `<a href="${unsubscribe}" style="color:#777">Unsubscribe</a>.</p>`;

      return {
        from: fromLine,
        to: m.email as string,
        replyTo: activity.replyTo ?? undefined,
        subject: fill(activity.subject as string, m),
        html: textToHtml(body) + footer,
        text: `${body}\n\n---\nUnsubscribe: ${unsubscribe}`,
        headers: {
          // Lets the mail client show its own unsubscribe button, which is far
          // likelier to be used than a link at the bottom — and being easy to
          // leave is what keeps people from reporting mail as spam instead.
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });

    const result = await resend.batch.send(payload);
    const stamp = new Date().toISOString();

    if (result.error) {
      failed += batch.length;
      await admin
        .from("campaign_activity_member")
        .update({ failReason: result.error.message.slice(0, 500), updatedAt: stamp })
        .in("id", batch.map((r) => r.id));
    } else {
      const ids = (result.data?.data ?? []) as { id: string }[];
      for (let j = 0; j < batch.length; j += 1) {
        await admin
          .from("campaign_activity_member")
          .update({
            sentAt: stamp,
            providerMessageId: ids[j]?.id ?? null,
            updatedAt: stamp,
          })
          .eq("id", batch[j].id);
      }
      sent += batch.length;
    }

    if (i + 100 < sendable.length) await new Promise((r) => setTimeout(r, 600));
  }

  await admin.rpc("mark_activity_run", { p_activity: activityId });

  revalidatePath("/campaigns");
  revalidatePath("/campaign-members");
  return { ok: true, data: { sent, failed, skipped, skippedReasons: skippedReasons.slice(0, 20) } };
}

// ---------------------------------------------------------------------------
// How it went
// ---------------------------------------------------------------------------

export interface ActivityStats {
  audience: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  /** Calls and webinars: outcome code to how many. */
  outcomes: { outcome: string; count: number }[];
  recorded: number;
}

export async function getActivityStats(activityId: string): Promise<ActivityStats> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data } = await db
    .from("campaign_activity_member")
    .select("outcome, sentAt, deliveredAt, openedAt, clickedAt, bouncedAt, unsubscribedAt")
    .eq("activityId", activityId);

  const rows = data ?? [];
  const outcomes = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
  }

  return {
    audience: rows.length,
    sent: rows.filter((r) => r.sentAt).length,
    delivered: rows.filter((r) => r.deliveredAt).length,
    opened: rows.filter((r) => r.openedAt).length,
    clicked: rows.filter((r) => r.clickedAt).length,
    bounced: rows.filter((r) => r.bouncedAt).length,
    unsubscribed: rows.filter((r) => r.unsubscribedAt).length,
    outcomes: [...outcomes.entries()].map(([outcome, count]) => ({ outcome, count })),
    recorded: rows.filter((r) => r.outcome).length,
  };
}
