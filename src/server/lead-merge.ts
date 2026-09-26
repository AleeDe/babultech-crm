"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { MERGEABLE_FIELDS } from "@/lib/mergeable-fields";
import type { ActionResult } from "./partners";

/**
 * Finding and merging duplicate leads.
 *
 * Duplicates are expected here rather than prevented. A campaign member belongs
 * to the campaign that produced them, so somebody at a webinar and a trade show
 * is two members and two leads - and keeping the fact that they came from both
 * places is worth more than a tidy list.
 *
 * The person who can tell whether two records are one human is the agent working
 * them, so merging is a deliberate act with a screen behind it rather than a
 * guess made at import time.
 */



export interface DuplicateLead {
  id: string;
  leadNumber: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  industry: string | null;
  businessType: string | null;
  companySize: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  leadSource: string | null;
  description: string | null;
  status: string;
  convertedAt: string | null;
  createdAt: string;
  campaignId: string | null;
  /** How many of the fields above are filled in. Decides the default survivor. */
  completeness: number;
}

export interface DuplicateGroup {
  /** The address or number they share, for saying why they are grouped. */
  matchedOn: string;
  leads: DuplicateLead[];
}

const LEAD_COLUMNS = `
  id, leadNumber, firstName, lastName, companyName, jobTitle, email, phone,
  whatsapp, website, industry, businessType, companySize, street, city, state,
  postalCode, country, leadSource, description, status, convertedAt, createdAt,
  campaignId
`;

const completenessOf = (lead: Record<string, unknown>) =>
  MERGEABLE_FIELDS.filter((f) => {
    const v = lead[f.key];
    return typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined;
  }).length;

/**
 * Leads that share an address or a phone number, grouped.
 *
 * Grouping is done here rather than in SQL because the answer is a shape - a
 * list of groups - and PostgREST returns rows. The view supplies the match keys;
 * this assembles them.
 *
 * Phone matches on its last nine digits, the same rule the view and the partner
 * conflict check use, so +92 300 7654321 and 03007654321 are one number.
 */
export async function findDuplicateLeads(): Promise<DuplicateGroup[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("lead")
    .select(LEAD_COLUMNS)
    .is("deletedAt", null)
    .is("mergedIntoId", null)
    // A converted lead cannot be merged, so offering it would only lead to a
    // refusal further in.
    .is("convertedAt", null)
    .order("createdAt", { ascending: true })
    .limit(2000);

  if (error) throw new Error(`Could not look for duplicates: ${error.message}`);

  const leads = (data ?? []).map((l) => ({
    ...l,
    completeness: completenessOf(l as Record<string, unknown>),
  })) as unknown as DuplicateLead[];

  const digits = (phone: string | null) => {
    const only = (phone ?? "").replace(/\D/g, "");
    return only.length >= 9 ? only.slice(-9) : null;
  };

  // One bucket per key, then keys with more than one lead in them become groups.
  const byKey = new Map<string, { label: string; leads: DuplicateLead[] }>();

  const add = (key: string, label: string, lead: DuplicateLead) => {
    if (!byKey.has(key)) byKey.set(key, { label, leads: [] });
    byKey.get(key)!.leads.push(lead);
  };

  for (const lead of leads) {
    const email = lead.email?.toLowerCase().trim();
    if (email) add(`e:${email}`, email, lead);
    const tail = digits(lead.phone);
    if (tail) add(`p:${tail}`, lead.phone!, lead);
  }

  const groups: DuplicateGroup[] = [];
  // A pair matching on BOTH email and phone would otherwise be offered twice.
  const shown = new Set<string>();

  for (const { label, leads: group } of byKey.values()) {
    if (group.length < 2) continue;
    const signature = group.map((l) => l.id).sort().join("|");
    if (shown.has(signature)) continue;
    shown.add(signature);
    groups.push({ matchedOn: label, leads: group });
  }

  // Biggest groups first: they are the worst mess and the best use of a minute.
  return groups.sort((a, b) => b.leads.length - a.leads.length);
}

/** The leads for one merge screen, in the order they were created. */
export async function getLeadsForMerge(ids: string[]): Promise<DuplicateLead[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("lead")
    .select(LEAD_COLUMNS)
    .in("id", ids)
    .is("deletedAt", null)
    .order("createdAt", { ascending: true });

  if (error) throw new Error(`Could not load those leads: ${error.message}`);

  return (data ?? []).map((l) => ({
    ...l,
    completeness: completenessOf(l as Record<string, unknown>),
  })) as unknown as DuplicateLead[];
}

const mergeSchema = z.object({
  survivorId: z.string().uuid(),
  loserIds: z.array(z.string().uuid()).min(1, "Choose at least one duplicate to merge in."),
  /** The chosen value per field. Anything absent leaves the survivor as it is. */
  values: z.record(z.string(), z.string()),
});

/**
 * Merge the chosen duplicates into the survivor.
 *
 * The work is in merge_leads(), in the database: applying the chosen values,
 * moving notes, emails, documents, activities and campaign members off the
 * losers, retiring them and writing the audit rows all have to happen together.
 * Split across calls, a failure half-way leaves records attached to a lead that
 * has been soft-deleted, which is the one outcome worse than a duplicate.
 */
export async function mergeLeads(
  input: z.infer<typeof mergeSchema>,
): Promise<ActionResult<{ survivorId: string; mergedCount: number; recordsMoved: number }>> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  // Only fields the database will accept, so a stray key is refused here with a
  // sentence rather than there with a constraint name.
  const allowed = new Set(MERGEABLE_FIELDS.map((f) => f.key as string));
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(d.values)) {
    if (allowed.has(key)) values[key] = value;
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("merge_leads", {
    p_survivor: d.survivorId,
    p_losers: d.loserIds,
    p_values: values,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  revalidatePath("/leads/duplicates");
  revalidatePath(`/leads/${d.survivorId}`);

  return {
    ok: true,
    data: data as { survivorId: string; mergedCount: number; recordsMoved: number },
  };
}
