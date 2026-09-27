import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Emailing a set of leads - shared by our team's mass email and a partner's.
 *
 * Three things a naive loop would not do.
 *
 * It checks the suppression list, which is keyed on the ADDRESS rather than the
 * lead, so one unsubscribe covers every record that person is on.
 *
 * Every message carries an unsubscribe link built from its own activity id,
 * plus a List-Unsubscribe header so the mail client offers its own button.
 * Being easy to leave is what stops people reporting mail as spam instead.
 *
 * It sends in batches of 100, the provider's limit, and records the provider's
 * message id against each activity so the webhook can match opens and clicks
 * back to the right person later.
 *
 * Who may email which leads is the caller's business: this sends to exactly the
 * leads it is given. Our team's leads are read under their own permissions; a
 * partner's are read under theirs, which only ever return the partner's own.
 */

export interface MailableLead {
  id: string;
  firstName: string;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
}

export interface SendResult {
  batchId: string;
  sent: number;
  failed: number;
  skipped: number;
  skippedReasons: string[];
}

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

export async function deliverLeadEmails(opts: {
  leads: MailableLead[];
  subject: string;
  bodyText: string;
  fromName: string | null;
  replyTo: string | null;
  /** The person sending: the batch and every activity are theirs. */
  sentById: string;
  /** Reads the suppression list and writes the batch and its activities. */
  db: SupabaseClient;
  /** Records what the provider said about each message. */
  admin: SupabaseClient;
}): Promise<{ ok: true; data: SendResult } | { ok: false; error: string }> {
  const { leads, subject, bodyText, fromName, replyTo, sentById, db, admin } = opts;

  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "No mail provider is configured, so nothing can be sent." };
  if (!leads.length) return { ok: false, error: "None of those leads could be found." };

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

  const sendable: MailableLead[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;

  // The same address twice in one send would mail somebody twice.
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
    subject,
    bodyText,
    fromName,
    replyTo,
    audienceType: "Lead",
    sentById,
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
  const activities = sendable.map((l) => ({ id: randomUUID(), lead: l }));

  const { error: insertError } = await db.from("activity").insert(
    activities.map(({ id, lead }) => ({
      id,
      activityType: "EMAIL",
      subject,
      ownerUserId: sentById,
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
  const fromLine = fromName
    ? `${fromName} <${from.replace(/^.*</, "").replace(/>$/, "")}>`
    : from;

  const resend = new Resend(key);
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < activities.length; i += 100) {
    const batch = activities.slice(i, i + 100);

    const payload = batch.map(({ id, lead }) => {
      const unsubscribe = `${appUrl}/unsubscribe/${id}`;
      const body = fill(bodyText, lead);
      const footer =
        `<hr style="border:0;border-top:1px solid #e5e5e5;margin:28px 0 14px">` +
        `<p style="font-family:system-ui,sans-serif;font-size:12px;color:#777;margin:0">` +
        `You are receiving this because you are on our mailing list. ` +
        `<a href="${unsubscribe}" style="color:#777">Unsubscribe</a>.</p>`;

      return {
        from: fromLine,
        to: lead.email as string,
        replyTo: replyTo ?? undefined,
        subject: fill(subject, lead),
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

  return { ok: true, data: { batchId, sent, failed, skipped, skippedReasons: skippedReasons.slice(0, 20) } };
}
