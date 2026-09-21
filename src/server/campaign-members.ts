"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { LIST_LIMIT } from "@/lib/db";
import { picklistCode } from "@/lib/picklists";
import type { ActionResult } from "./partners";

/**
 * Campaign members: the people marketing talks to.
 *
 * A member exists once, not once per campaign. Which campaigns somebody took
 * part in is recorded by the activity that contacted them, so correcting a
 * phone number is one edit rather than a hunt through every list they are on.
 *
 * Gated on lead:read and lead:write throughout. A campaign member is a prospect
 * who has not become a lead yet, and the people who work leads are the people
 * who should see them.
 */

export interface CampaignMember {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  companyName: string | null;
  website: string | null;
  businessType: string | null;
  companySize: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  lastCampaignRunAt: string | null;
  lastCampaignId: string | null;
  campaignCount: number;
  emailOptOut: boolean;
  emailBounced: boolean;
  source: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  lastCampaign?: { name: string } | null;
  owner?: { fullName: string } | null;
}

const SELECT = `
  id, firstName, lastName, email, phone, whatsapp, companyName, website,
  businessType, companySize, street, city, state, postalCode, country,
  lastCampaignRunAt, lastCampaignId, campaignCount, emailOptOut, emailBounced,
  source, notes, active, createdAt,
  lastCampaign:campaign ( name ),
  owner:app_user!campaign_member_ownerUserId_fkey ( fullName )
`;

export interface MemberFilters {
  /** Matches a name, company or email. */
  search?: string;
  businessType?: string;
  companySize?: string;
  /** Leave out anyone who has unsubscribed or whose address bounced. */
  contactableOnly?: boolean;
  /** Only people no campaign has touched since this date. */
  notContactedSince?: string;
}

export async function listCampaignMembers(filters: MemberFilters = {}): Promise<CampaignMember[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  let query = db.from("campaign_member").select(SELECT).is("deletedAt", null);

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    query = query.or(
      `firstName.ilike.${term},lastName.ilike.${term},companyName.ilike.${term},email.ilike.${term}`,
    );
  }
  if (filters.businessType) query = query.eq("businessType", filters.businessType);
  if (filters.companySize) query = query.eq("companySize", filters.companySize);
  if (filters.contactableOnly) {
    query = query.eq("emailOptOut", false).eq("emailBounced", false).eq("active", true);
  }
  if (filters.notContactedSince) {
    // Somebody never contacted has a null date, and null is not "before" a
    // date in SQL — so they have to be asked for explicitly or the people most
    // worth mailing drop out of the list.
    query = query.or(
      `lastCampaignRunAt.is.null,lastCampaignRunAt.lt.${filters.notContactedSince}`,
    );
  }

  const { data, error } = await query
    .order("createdAt", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw new Error(`Could not load campaign members: ${error.message}`);
  return (data ?? []) as unknown as CampaignMember[];
}

export async function getCampaignMember(id: string): Promise<CampaignMember | null> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("campaign_member")
    .select(SELECT)
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();

  if (error) throw new Error(`Could not load the member: ${error.message}`);
  return (data as unknown as CampaignMember) ?? null;
}

const memberSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  firstName: z.string().trim().min(1, "A member needs a first name.").max(100),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  email: z.string().trim().email("That does not look like an email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(50).optional().or(z.literal("")),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
  website: z.string().trim().max(255).optional().or(z.literal("")),
  businessType: picklistCode.optional().or(z.literal("")),
  companySize: picklistCode.optional().or(z.literal("")),
  street: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().max(30).optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  source: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  active: z.coerce.boolean().default(true),
});

/** Empty strings become null, so a cleared field is cleared rather than blank. */
function nullable(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function saveCampaignMember(
  input: z.infer<typeof memberSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const row = {
    firstName: d.firstName,
    lastName: nullable(d.lastName),
    email: nullable(d.email)?.toLowerCase() ?? null,
    phone: nullable(d.phone),
    whatsapp: nullable(d.whatsapp),
    companyName: nullable(d.companyName),
    website: nullable(d.website),
    businessType: nullable(d.businessType),
    companySize: nullable(d.companySize),
    street: nullable(d.street),
    city: nullable(d.city),
    state: nullable(d.state),
    postalCode: nullable(d.postalCode),
    country: nullable(d.country),
    source: nullable(d.source),
    notes: nullable(d.notes),
    active: d.active,
    updatedAt: new Date().toISOString(),
  };

  const db = await supabaseServer();

  // The unique index would catch this, but its error message is a constraint
  // name. Saying whose address it is lets them go and find the person.
  if (row.email) {
    let clash = db
      .from("campaign_member")
      .select("id, firstName, lastName")
      .eq("email", row.email)
      .is("deletedAt", null);
    if (d.id) clash = clash.neq("id", d.id);

    const { data: existing } = await clash.maybeSingle();
    if (existing) {
      return {
        ok: false,
        error: `${existing.firstName} ${existing.lastName ?? ""}`.trim() +
          ` already uses ${row.email}.`,
        fieldErrors: { email: ["Already on the list."] },
      };
    }
  }

  const { data, error } = d.id
    ? await db.from("campaign_member").update(row).eq("id", d.id).select("id").maybeSingle()
    : await db
        .from("campaign_member")
        .insert({ id: randomUUID(), ownerUserId: auth.user.id, ...row })
        .select("id")
        .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That member no longer exists." };

  revalidatePath("/campaign-members");
  return { ok: true, data: { id: data.id as string } };
}

/** Soft delete, as everywhere else — the campaigns they were in still ran. */
export async function deleteCampaignMember(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { error } = await db
    .from("campaign_member")
    .update({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaign-members");
  return { ok: true, data: undefined };
}

/**
 * Unsubscribe somebody, by hand.
 *
 * Separate from an ordinary edit because it is not an ordinary edit: it applies
 * to every campaign, for good, and the date it happened is the evidence that we
 * honoured it. The public unsubscribe link will call the same path.
 */
export async function setEmailOptOut(
  id: string,
  optOut: boolean,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { error } = await db
    .from("campaign_member")
    .update({
      emailOptOut: optOut,
      emailOptOutAt: optOut ? new Date().toISOString() : null,
      emailOptOutReason: optOut ? (reason?.trim() || "Asked to be removed") : null,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaign-members");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const importRowSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  whatsapp: z.string().trim().optional(),
  companyName: z.string().trim().optional(),
  website: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  companySize: z.string().trim().optional(),
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
  source: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Import a list, matching on email.
 *
 * A known address updates what it can and leaves the rest; an unknown one is
 * added. Lists are bought, exported and re-exported, so the same people arrive
 * again and again — an import that only ever inserted would fill the table with
 * duplicates by the third file.
 */
export async function importCampaignMembers(
  rows: z.infer<typeof importRowSchema>[],
): Promise<ActionResult<ImportSummary>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "There is nothing in that file." };
  }
  if (rows.length > 5000) {
    return { ok: false, error: `That file has ${rows.length} rows. Import up to 5,000 at a time.` };
  }

  const clean = rows.filter((r) => (r?.firstName ?? "").trim() !== "");
  if (clean.length === 0) {
    return { ok: false, error: "No row in that file has a first name." };
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("import_campaign_members", {
    p_rows: clean,
    p_owner: auth.user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaign-members");
  const summary = (typeof data === "string" ? JSON.parse(data) : data) as ImportSummary;
  return { ok: true, data: { ...summary, skipped: summary.skipped + (rows.length - clean.length) } };
}

/** Totals for the list header. */
export async function getCampaignMemberTotals() {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const [total, contactable, optedOut, untouched] = await Promise.all([
    db.from("campaign_member").select("id", { count: "exact", head: true }).is("deletedAt", null),
    db
      .from("campaign_member")
      .select("id", { count: "exact", head: true })
      .is("deletedAt", null)
      .eq("emailOptOut", false)
      .eq("emailBounced", false)
      .eq("active", true)
      .not("email", "is", null),
    db
      .from("campaign_member")
      .select("id", { count: "exact", head: true })
      .is("deletedAt", null)
      .eq("emailOptOut", true),
    db
      .from("campaign_member")
      .select("id", { count: "exact", head: true })
      .is("deletedAt", null)
      .is("lastCampaignRunAt", null),
  ]);

  return {
    total: total.count ?? 0,
    contactable: contactable.count ?? 0,
    optedOut: optedOut.count ?? 0,
    neverContacted: untouched.count ?? 0,
  };
}
