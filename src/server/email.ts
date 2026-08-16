"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import { formatMoney, formatDate } from "@/lib/utils";
import type { ActionResult } from "./partners";

/**
 * Sending quotations and invoices to customers.
 *
 * Every send is written to the `email` table whether or not the provider
 * accepted it, so "did we ever send this?" has an answer that does not depend
 * on the provider's dashboard. A failed send is recorded as FAILED rather than
 * dropped — silence is the worst outcome when someone is waiting on a quote.
 *
 * Resend is optional. Without RESEND_API_KEY the actions refuse with a message
 * naming what is missing rather than throwing, so the rest of the app runs on
 * a development machine with no mail configured.
 */

const FROM = process.env.EMAIL_FROM ?? "BabulTech CRM <onboarding@resend.dev>";
const REPLY_TO = process.env.EMAIL_REPLY_TO;

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export async function isEmailConfigured(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY);
}

const sendSchema = z.object({
  to: z.string().email("That does not look like an email address."),
  cc: z.string().optional().nullable(),
  subject: z.string().trim().min(1, "Give the email a subject.").max(500),
  message: z.string().trim().min(1, "Write something in the body."),
});

/**
 * Records the attempt, sends it, then records the outcome.
 *
 * The row is written first so a send that crashes mid-flight still leaves a
 * trace. relatedEntityType/Id are the polymorphic link used elsewhere, so the
 * email shows up on the record it concerns.
 */
async function deliver(input: {
  to: string;
  cc: string[];
  subject: string;
  html: string;
  text: string;
  relatedEntityType: string;
  relatedEntityId: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  const db = await supabaseServer();
  const now = new Date().toISOString();

  const resend = client();
  if (!resend) {
    return {
      ok: false,
      error:
        "Email is not configured. Set RESEND_API_KEY (and EMAIL_FROM) before sending from here.",
    };
  }

  const rowId = randomUUID();

  const { error: writeError } = await db.from("email").insert({
    id: rowId,
    updatedAt: now,
    direction: "OUTBOUND",
    subject: input.subject,
    fromAddress: FROM,
    toAddresses: [input.to],
    ccAddresses: input.cc.length ? input.cc : null,
    bodyHtml: input.html,
    bodyText: input.text,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    sentReceivedAt: now,
    status: "DRAFT",
    hasAttachments: false,
  });

  if (writeError) return { ok: false, error: writeError.message };

  const { data, error } = await resend.emails.send({
    from: FROM,
    to: input.to,
    cc: input.cc.length ? input.cc : undefined,
    replyTo: REPLY_TO ?? me.email,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) {
    await db
      .from("email")
      .update({ status: "FAILED", updatedAt: new Date().toISOString() })
      .eq("id", rowId);

    return { ok: false, error: `Could not send: ${error.message}` };
  }

  await db
    .from("email")
    .update({
      status: "SENT",
      messageId: data?.id ?? null,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", rowId);

  return { ok: true, data: { id: rowId } };
}

/**
 * The wrapper every outbound email gets.
 *
 * Deliberately plain: inline styles only, a table-free layout and no images,
 * because anything cleverer breaks in Outlook and this has to arrive readable
 * rather than look designed.
 */
function wrap(heading: string, body: string, footer?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2233;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(heading)}</h1>
${body}
${footer ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e8ef;font-size:12px;color:#6b7688;">${esc(footer)}</p>` : ""}
</div>
</body></html>`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function summaryTable(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:6px 0;color:#6b7688;">${label}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${value}</td></tr>`,
  )
  .join("")}
</table>`;
}

export async function sendQuotation(
  quotationId: string,
  input: z.infer<typeof sendSchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return { ok: false, error: "You do not have permission to send quotations." };
  }

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the email.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();

  const { data: quote } = await db
    .from("quotation")
    .select("*, account ( name ), opportunity ( name )")
    .eq("id", quotationId)
    .is("deletedAt", null)
    .maybeSingle();

  if (!quote) return { ok: false, error: "That quotation is not available to you." };

  const account = one(quote.account as never) as Record<string, unknown> | null;

  const html = wrap(
    `Quotation ${quote.quoteNumber}`,
    paragraphs(d.message) +
      summaryTable([
        ["Quotation", String(quote.quoteNumber)],
        ["Date", formatDate(quote.quoteDate)],
        ["Valid until", formatDate(quote.expiryDate)],
        ["Total", formatMoney(quote.totalAmount, quote.currencyCode)],
      ]),
    `Sent by ${me.fullName} · BabulTech`,
  );

  const text = `${d.message}

Quotation: ${quote.quoteNumber}
Date: ${formatDate(quote.quoteDate)}
Valid until: ${formatDate(quote.expiryDate)}
Total: ${formatMoney(quote.totalAmount, quote.currencyCode)}

Sent by ${me.fullName}, BabulTech`;

  const result = await deliver({
    to: d.to,
    cc: (d.cc ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    subject: d.subject,
    html,
    text,
    relatedEntityType: "Quotation",
    relatedEntityId: quotationId,
  });

  if (!result.ok) return result;

  // Sending is what moves a draft quote into the customer's hands, so the
  // status follows — otherwise the pipeline still reads it as unsent.
  if (["DRAFT", "APPROVED", "UNDER_REVIEW"].includes(quote.status)) {
    await db
      .from("quotation")
      .update({
        status: "SENT",
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", quotationId);
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  return result;
}

export async function sendInvoice(
  invoiceId: string,
  input: z.infer<typeof sendSchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_WRITE)) {
    return { ok: false, error: "You do not have permission to send invoices." };
  }

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the email.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();

  const { data: invoice } = await db
    .from("invoice")
    .select("*, account ( name )")
    .eq("id", invoiceId)
    .is("deletedAt", null)
    .maybeSingle();

  if (!invoice) return { ok: false, error: "That invoice is not available to you." };

  if (invoice.status === "DRAFT") {
    return { ok: false, error: "Approve the invoice before sending it." };
  }

  const html = wrap(
    `Invoice ${invoice.invoiceNumber}`,
    paragraphs(d.message) +
      summaryTable([
        ["Invoice", String(invoice.invoiceNumber)],
        ["Issued", formatDate(invoice.invoiceDate)],
        ["Due", formatDate(invoice.dueDate)],
        ["Total", formatMoney(invoice.totalAmount, invoice.currencyCode)],
        ["Outstanding", formatMoney(invoice.outstandingAmount, invoice.currencyCode)],
      ]),
    `Sent by ${me.fullName} · BabulTech`,
  );

  const text = `${d.message}

Invoice: ${invoice.invoiceNumber}
Issued: ${formatDate(invoice.invoiceDate)}
Due: ${formatDate(invoice.dueDate)}
Total: ${formatMoney(invoice.totalAmount, invoice.currencyCode)}
Outstanding: ${formatMoney(invoice.outstandingAmount, invoice.currencyCode)}

Sent by ${me.fullName}, BabulTech`;

  const result = await deliver({
    to: d.to,
    cc: (d.cc ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    subject: d.subject,
    html,
    text,
    relatedEntityType: "Invoice",
    relatedEntityId: invoiceId,
  });

  if (!result.ok) return result;

  if (invoice.status === "APPROVED") {
    await db
      .from("invoice")
      .update({
        status: "SENT",
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", invoiceId);
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return result;
}

/** Emails already sent about one record, newest first. */
export async function listEmails(entityType: string, entityId: string) {
  await requireUser();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("email")
    .select("id, subject, toAddresses, status, sentReceivedAt, direction")
    .eq("relatedEntityType", entityType)
    .eq("relatedEntityId", entityId)
    .order("sentReceivedAt", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Could not load emails: ${error.message}`);
  return data ?? [];
}
