"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { requireUser, AuthorizationError } from "@/lib/authz";
import { SEQUENCES } from "@/lib/numbering";
import { sanitizeRichText } from "@/lib/rich-text";
import type { ActionResult } from "./partners";

/**
 * The customer portal's data layer.
 *
 * The same discipline as the partner portal: the account and the contact come
 * from the **session**, never from an argument, so the worst a customer can ask
 * for is their own data. The database agrees independently - the policies added
 * with this feature scope every read to app_current_customer_account_id() - so
 * a mistake here is caught there.
 *
 * What a customer may see is deliberately small: their own tickets, the replies
 * written for them, and published knowledge articles. Never another company's
 * anything, never an internal note, never a price, a pipeline or an employee.
 */

type Admin = ReturnType<typeof supabaseAdmin>;

/**
 * The SLA clock for a new portal ticket.
 *
 * A copy of what createCase does internally, run through the admin client: a
 * customer cannot read sla_policy, and should not be able to. Elapsed time
 * rather than business hours, matching the internal behaviour it mirrors.
 */
async function portalSlaDeadlines(admin: Admin, priority: string, from: Date) {
  const { data: policy } = await admin
    .from("sla_policy")
    .select("id, firstResponseMinutes, resolutionMinutes")
    .eq("active", true)
    .eq("priority", priority)
    .limit(1)
    .maybeSingle();

  if (!policy) return { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null };
  return {
    slaPolicyId: policy.id as string,
    firstResponseDueAt: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
    resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
  };
}

export interface CustomerContext {
  userId: string;
  fullName: string;
  contactId: string;
  accountId: string;
  ownTicketsOnly: boolean;
}

async function requireCustomer(): Promise<CustomerContext> {
  const user = await requireUser();
  if (user.userType !== "CUSTOMER" || !user.contactId || !user.customerAccountId) {
    throw new AuthorizationError("This account is not a customer portal login.");
  }
  return {
    userId: user.id,
    fullName: user.fullName,
    contactId: user.contactId,
    accountId: user.customerAccountId,
    ownTicketsOnly: user.portalScope === "OWN",
  };
}

/** Safe for a layout to call — returns null instead of throwing. */
export async function getCustomerContext(): Promise<CustomerContext | null> {
  try {
    return await requireCustomer();
  } catch {
    return null;
  }
}

export interface PortalCase {
  id: string;
  caseNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
  contactId: string | null;
  raisedBy: string | null;
}

const CASE_COLUMNS =
  "id, caseNumber, subject, status, priority, createdAt, resolvedAt, contactId, contact:contact ( firstName, lastName )";

const named = (row: Record<string, any>) => {
  const c = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return c ? `${c.firstName} ${c.lastName}`.trim() : null;
};

export async function listMyCases(): Promise<PortalCase[]> {
  const me = await requireCustomer();
  const db = await supabaseServer();

  let query = db
    .from("support_case")
    .select(CASE_COLUMNS)
    .eq("accountId", me.accountId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false })
    .limit(200);

  if (me.ownTicketsOnly) query = query.eq("contactId", me.contactId);

  const { data, error } = await query;
  if (error) throw new Error("Could not load your tickets.");

  return (data ?? []).map((row) => ({
    id: row.id,
    caseNumber: row.caseNumber,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    contactId: row.contactId,
    raisedBy: named(row),
  }));
}

export interface PortalCaseDetail extends PortalCase {
  description: string;
  resolution: string | null;
  comments: {
    id: string;
    body: string;
    createdAt: string;
    fromUs: boolean;
    author: string;
  }[];
}

export async function getMyCase(id: string): Promise<PortalCaseDetail | null> {
  const me = await requireCustomer();
  const db = await supabaseServer();

  // Scoped by account here and by policy in the database. An id from somewhere
  // else simply finds nothing.
  let query = db
    .from("support_case")
    .select(`${CASE_COLUMNS}, description, resolution`)
    .eq("id", id)
    .eq("accountId", me.accountId)
    .is("deletedAt", null);
  if (me.ownTicketsOnly) query = query.eq("contactId", me.contactId);

  const { data: row, error } = await query.maybeSingle();
  if (error || !row) return null;

  // Internal notes are excluded here and refused by the policy. Both, because
  // this is the one query where a mistake shows a customer what was said about
  // them rather than to them.
  const { data: comments } = await db
    .from("case_comment")
    .select("id, body, createdAt, commentType, authorContactId, author:app_user!case_comment_authorUserId_fkey ( fullName )")
    .eq("caseId", id)
    .eq("isPublic", true)
    .neq("commentType", "INTERNAL_NOTE")
    .order("createdAt");

  return {
    id: row.id,
    caseNumber: row.caseNumber,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    contactId: row.contactId,
    raisedBy: named(row),
    description: row.description,
    resolution: row.resolution,
    comments: (comments ?? []).map((c: Record<string, any>) => {
      const author = Array.isArray(c.author) ? c.author[0] : c.author;
      return {
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        fromUs: c.commentType === "AGENT_RESPONSE",
        author: c.commentType === "AGENT_RESPONSE" ? (author?.fullName ?? "Support") : "You",
      };
    }),
  };
}

const newTicketSchema = z.object({
  subject: z.string().trim().min(1, "Say what the problem is.").max(200, "That is too long for a title."),
  description: z.string().trim().min(1, "Describe what is happening.").max(20000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

/**
 * Raises a ticket, and puts it on someone's desk.
 *
 * Written with the admin client rather than the customer's own: a customer
 * holds no CRM permission at all, and giving them an insert policy on
 * support_case would mean writing a policy that lets an external login create
 * internal records. Everything that decides what the row contains - the
 * account, the contact - comes from the session, so there is nothing here for
 * the caller to aim somewhere else.
 */
export async function raiseTicket(
  input: z.infer<typeof newTicketSchema>,
): Promise<ActionResult<{ id: string; caseNumber: string }>> {
  let me: CustomerContext;
  try {
    me = await requireCustomer();
  } catch {
    return { ok: false, error: "This account cannot raise tickets." };
  }

  const parsed = newTicketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  try {
    const admin = supabaseAdmin();
    const now = new Date();
    const sla = await portalSlaDeadlines(admin, data.priority, now);

    // Round robin: the least-loaded person in the Support department.
    //
    // If there is no Support department yet, the ticket goes to the account's
    // own manager rather than to nobody. An open case with no owner is refused
    // by the database (case_assignment_check), and it should be: a ticket
    // nobody owns is a ticket nobody answers. Support can reassign it.
    const { data: roundRobin } = await admin.rpc("next_support_assignee");
    let assignee: string | null = (roundRobin as string | null) ?? null;
    if (!assignee) {
      const { data: account } = await admin
        .from("account")
        .select("ownerUserId")
        .eq("id", me.accountId)
        .maybeSingle();
      assignee = (account?.ownerUserId as string | null) ?? null;
    }

    const { data: caseNumber, error: numberError } = await admin.rpc("next_sequence_number", {
      p_entity_type: SEQUENCES.CASE,
    });
    if (numberError) throw new Error(numberError.message);
    const { data: created, error } = await admin
      .from("support_case")
      .insert({
        caseNumber,
        subject: data.subject,
        description: sanitizeRichText(data.description) ?? data.description,
        accountId: me.accountId,
        contactId: me.contactId,
        caseType: "INCIDENT",
        priority: data.priority,
        source: "PORTAL",
        status: assignee ? "ASSIGNED" : "NEW",
        ownerUserId: assignee ?? null,
        slaPolicyId: sla.slaPolicyId,
        firstResponseDueAt: sla.firstResponseDueAt?.toISOString() ?? null,
        resolutionDueAt: sla.resolutionDueAt?.toISOString() ?? null,
        updatedAt: now.toISOString(),
      })
      .select("id, caseNumber")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath("/support");
    revalidatePath("/cases");
    return { ok: true, data: { id: created.id, caseNumber: created.caseNumber } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not raise the ticket." };
  }
}

const replySchema = z.object({
  caseId: z.string().uuid(),
  body: z.string().trim().min(1, "Write something first.").max(20000),
});

/** Adds the customer's reply to their own ticket. */
export async function replyToTicket(input: z.infer<typeof replySchema>): Promise<ActionResult> {
  let me: CustomerContext;
  try {
    me = await requireCustomer();
  } catch {
    return { ok: false, error: "This account cannot reply to tickets." };
  }

  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  // The ticket has to be one this customer can see, read through their own
  // session rather than taken on trust from the form.
  const visible = await getMyCase(parsed.data.caseId);
  if (!visible) return { ok: false, error: "That ticket is not yours." };

  try {
    const admin = supabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await admin.from("case_comment").insert({
      caseId: parsed.data.caseId,
      authorContactId: me.contactId,
      commentType: "CUSTOMER_COMMENT",
      body: sanitizeRichText(parsed.data.body) ?? parsed.data.body,
      isPublic: true,
      updatedAt: now,
    });
    if (error) throw new Error(error.message);

    // A reply on a resolved ticket reopens the conversation for support, but
    // does not reopen the ticket: only support decides that.
    revalidatePath(`/support/tickets/${parsed.data.caseId}`);
    revalidatePath("/cases");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send your reply." };
  }
}

export interface PortalArticle {
  id: string;
  articleNumber: string;
  title: string;
  summary: string | null;
  content?: string;
  tags: string[] | null;
  publishedAt: string | null;
}

/** Published articles marked for the customer portal. */
export async function listArticles(search?: string): Promise<PortalArticle[]> {
  await requireCustomer();
  const db = await supabaseServer();

  let query = db
    .from("knowledge_article")
    .select("id, articleNumber, title, summary, tags, publishedAt")
    .eq("status", "PUBLISHED")
    .eq("visibility", "CUSTOMER_PORTAL")
    .is("deletedAt", null)
    .order("publishedAt", { ascending: false })
    .limit(100);

  const term = search?.replace(/[,()]/g, "").trim();
  if (term) query = query.or(`title.ilike.%${term}%,summary.ilike.%${term}%`);

  const { data, error } = await query;
  if (error) throw new Error("Could not load the knowledge base.");
  return (data ?? []) as PortalArticle[];
}

export async function getArticle(id: string): Promise<PortalArticle | null> {
  await requireCustomer();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("knowledge_article")
    .select("id, articleNumber, title, summary, content, tags, publishedAt")
    .eq("id", id)
    .eq("status", "PUBLISHED")
    .eq("visibility", "CUSTOMER_PORTAL")
    .is("deletedAt", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as PortalArticle;
}
