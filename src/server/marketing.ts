"use server";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser, requirePermission, can, PERMISSIONS } from "@/lib/authz";
import { INTERACTION_TYPES } from "@/lib/marketing";
import type { ActionResult } from "./partners";

/**
 * Marketing: prospects, where people came from, what they did with our
 * campaigns, which campaigns earned the deals, and what each campaign returned.
 *
 * Reads go through the person's own session, so row security decides whose
 * leads, contacts and deals are counted - two people can correctly see
 * different funnels.
 */

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export async function countProspects(): Promise<number> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const { count } = await db
    .from("lead")
    .select("id", { count: "exact", head: true })
    .is("deletedAt", null)
    .eq("status", "PROSPECT");
  return count ?? 0;
}

/** A prospect becomes a New lead and joins the sales queue. */
export async function qualifyProspect(leadId: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(leadId).success) return { ok: false, error: "That lead could not be found." };
  const db = await supabaseServer();
  const { data, error } = await db
    .from("lead")
    .update({ status: "NEW", updatedAt: new Date().toISOString() })
    .eq("id", leadId)
    .eq("status", "PROSPECT")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a prospect can be qualified, and this one could not be changed." };
  // No revalidatePath: the button refreshes the page itself. Revalidating
  // here made the action's own response carry the whole lead page, and that
  // long response could be cut off, leaving the button spinning.
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Touches
// ---------------------------------------------------------------------------

export interface Touch {
  id: string;
  interactionType: string;
  occurredAt: string;
  campaign: { id: string; name: string } | null;
  source: string | null;
  medium: string | null;
  landingPage: string | null;
  details: string | null;
  createdByName: string | null;
  lead: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
}

const TOUCH_SELECT = `id, interactionType, occurredAt, source, medium, landingPage, details,
  campaign ( id, name ),
  createdBy:app_user!campaign_interaction_createdById_fkey ( fullName ),
  lead ( id, firstName, lastName ),
  contact ( id, firstName, lastName )`;

function toTouch(r: Record<string, unknown>): Touch {
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const lead = one<{ id: string; firstName: string; lastName: string | null }>(r.lead);
  const contact = one<{ id: string; firstName: string; lastName: string | null }>(r.contact);
  return {
    id: r.id as string,
    interactionType: r.interactionType as string,
    occurredAt: r.occurredAt as string,
    campaign: one<{ id: string; name: string }>(r.campaign),
    source: (r.source as string | null) ?? null,
    medium: (r.medium as string | null) ?? null,
    landingPage: (r.landingPage as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    createdByName: one<{ fullName: string }>(r.createdBy)?.fullName ?? null,
    lead: lead ? { id: lead.id, name: `${lead.firstName} ${lead.lastName === "-" ? "" : lead.lastName ?? ""}`.trim() } : null,
    contact: contact ? { id: contact.id, name: `${contact.firstName} ${contact.lastName ?? ""}`.trim() } : null,
  };
}

export async function listTouches(filter: { leadId?: string; contactId?: string; campaignId?: string }, limit = 50): Promise<Touch[]> {
  await requireUser();
  const db = await supabaseServer();
  let query = db.from("campaign_interaction").select(TOUCH_SELECT).order("occurredAt", { ascending: false }).limit(limit);
  if (filter.leadId) query = query.eq("leadId", filter.leadId);
  if (filter.contactId) query = query.eq("contactId", filter.contactId);
  if (filter.campaignId) query = query.eq("campaignId", filter.campaignId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load campaign touches: ${error.message}`);
  return (data ?? []).map((r) => toTouch(r as Record<string, unknown>));
}

const touchSchema = z.object({
  leadId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  campaignId: z.string().uuid().nullable(),
  interactionType: z.enum(INTERACTION_TYPES.map((t) => t.value) as [string, ...string[]]),
  occurredAt: z.string().datetime({ offset: true }),
  details: z.string().trim().max(4000).optional(),
});

/** Logs a touch by hand: an event they came to, a call about the campaign. */
export async function logTouch(input: z.infer<typeof touchSchema>): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = touchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the touch." };
  const d = parsed.data;
  if (!d.leadId && !d.contactId) return { ok: false, error: "Say who it was." };
  if (new Date(d.occurredAt).getTime() > Date.now() + 86_400_000) return { ok: false, error: "A touch cannot be in the future." };

  const db = await supabaseServer();
  const { error } = await db.from("campaign_interaction").insert({
    leadId: d.leadId,
    contactId: d.leadId ? null : d.contactId,
    campaignId: d.campaignId,
    interactionType: d.interactionType,
    occurredAt: d.occurredAt,
    details: d.details || null,
    source: "Logged by hand",
    createdById: auth.user.id,
  });
  if (error) {
    return { ok: false, error: /row-level security/i.test(error.message) ? "You cannot log touches on that record." : error.message };
  }
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Where a person came from
// ---------------------------------------------------------------------------

export interface Tracking {
  first: { source: string | null; medium: string | null; campaign: { id: string; name: string } | null; landingPage: string | null; referrer: string | null; at: string | null };
  latest: { source: string | null; medium: string | null; campaign: { id: string; name: string } | null; landingPage: string | null; referrer: string | null; at: string | null };
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null } | null;
  score: number | null;
  referredByContact: { id: string; name: string } | null;
}

export async function getTracking(entity: "Lead" | "Contact", id: string): Promise<Tracking | null> {
  await requireUser();
  const db = await supabaseServer();
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  if (entity === "Lead") {
    const { data: r } = await db
      .from("lead")
      .select(`firstSource, firstMedium, firstLandingPage, firstReferrer, firstTouchAt,
        latestSource, latestMedium, latestLandingPage, latestReferrer, latestTouchAt,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm, score,
        firstCampaign:campaign!lead_firstCampaignId_fkey ( id, name ),
        latestCampaign:campaign!lead_latestCampaignId_fkey ( id, name ),
        referredByContact:contact!lead_referredByContactId_fkey ( id, firstName, lastName )`)
      .eq("id", id)
      .maybeSingle();
    if (!r) return null;
    const ref = one<{ id: string; firstName: string; lastName: string | null }>(r.referredByContact);
    const hasUtm = r.utmSource || r.utmMedium || r.utmCampaign || r.utmContent || r.utmTerm;
    return {
      first: { source: r.firstSource, medium: r.firstMedium, campaign: one(r.firstCampaign), landingPage: r.firstLandingPage, referrer: r.firstReferrer, at: r.firstTouchAt },
      latest: { source: r.latestSource, medium: r.latestMedium, campaign: one(r.latestCampaign), landingPage: r.latestLandingPage, referrer: r.latestReferrer, at: r.latestTouchAt },
      utm: hasUtm ? { source: r.utmSource, medium: r.utmMedium, campaign: r.utmCampaign, content: r.utmContent, term: r.utmTerm } : null,
      score: r.score ?? 0,
      referredByContact: ref ? { id: ref.id, name: `${ref.firstName} ${ref.lastName ?? ""}`.trim() } : null,
    };
  }
  const { data: r } = await db
    .from("contact")
    .select(`firstSource, firstMedium, firstTouchAt, latestSource, latestMedium, latestTouchAt,
      firstCampaign:campaign!contact_firstCampaignId_fkey ( id, name ),
      latestCampaign:campaign!contact_latestCampaignId_fkey ( id, name )`)
    .eq("id", id)
    .maybeSingle();
  if (!r) return null;
  return {
    first: { source: r.firstSource, medium: r.firstMedium, campaign: one(r.firstCampaign), landingPage: null, referrer: null, at: r.firstTouchAt },
    latest: { source: r.latestSource, medium: r.latestMedium, campaign: one(r.latestCampaign), landingPage: null, referrer: null, at: r.latestTouchAt },
    utm: null,
    score: null,
    referredByContact: null,
  };
}

/** Who referred this lead, as a contact. */
export async function setReferredBy(leadId: string, contactId: string | null): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const ids = z.object({ leadId: z.string().uuid(), contactId: z.string().uuid().nullable() }).safeParse({ leadId, contactId });
  if (!ids.success) return { ok: false, error: "That contact could not be found." };
  const db = await supabaseServer();
  if (contactId) {
    const { data: seen } = await db.from("contact").select("id").eq("id", contactId).maybeSingle();
    if (!seen) return { ok: false, error: "That contact could not be found." };
  }
  const { data, error } = await db
    .from("lead")
    .update({ referredByContactId: contactId, ...(contactId ? { leadSource: "Referral" } : {}), updatedAt: new Date().toISOString() })
    .eq("id", leadId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "You cannot change that lead." };
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Deal attribution
// ---------------------------------------------------------------------------

export interface Attribution {
  primary: { id: string; name: string } | null;
  first: { id: string; name: string } | null;
  leadCreation: { id: string; name: string } | null;
  latest: { id: string; name: string } | null;
}

export async function getDealAttribution(opportunityId: string): Promise<Attribution> {
  await requireUser();
  const db = await supabaseServer();
  const [{ data: opp }, { data: rows }] = await Promise.all([
    db.from("opportunity").select("campaign ( id, name )").eq("id", opportunityId).maybeSingle(),
    db.from("opportunity_campaign").select("role, campaign ( id, name )").eq("opportunityId", opportunityId),
  ]);
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const byRole = new Map((rows ?? []).map((r) => [r.role as string, one<{ id: string; name: string }>(r.campaign)]));
  return {
    primary: one(opp?.campaign),
    first: byRole.get("FIRST") ?? null,
    leadCreation: byRole.get("LEAD_CREATION") ?? null,
    latest: byRole.get("LATEST") ?? null,
  };
}

// ---------------------------------------------------------------------------
// Campaign funnel and return
// ---------------------------------------------------------------------------

export type AttributionModel = "PRIMARY" | "FIRST" | "LEAD_CREATION" | "LATEST";

export interface CampaignMetrics {
  campaignIds: string[];
  members: number;
  engaged: number;
  prospects: number;
  leads: number;
  qualified: number;
  deals: number;
  won: number;
  wonRevenue: number;
  pipeline: number;
  cost: number;
  budget: number;
  roiPercent: number | null;
  costPerLead: number | null;
  costPerWon: number | null;
}

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/** Each campaign's children, from one read of the campaign tree. */
async function campaignTree(db: Db): Promise<Map<string, string[]>> {
  const { data } = await db.from("campaign").select("id, parentCampaignId").is("deletedAt", null);
  const children = new Map<string, string[]>();
  for (const c of data ?? []) {
    if (!c.parentCampaignId) continue;
    children.set(c.parentCampaignId as string, [...(children.get(c.parentCampaignId as string) ?? []), c.id as string]);
  }
  return children;
}

/** A campaign and every campaign beneath it, however deep. */
function descendants(children: Map<string, string[]>, rootId: string): string[] {
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

const QUALIFIED = ["QUALIFIED", "CONVERTED", "DISCOVERY_SCHEDULED"];

interface RawMetrics {
  members: { campaignId: string }[];
  touches: { campaignId: string; person: string }[];
  leads: { campaignId: string; status: string }[];
  campaigns: { id: string; actualCost: number; budgetAmount: number }[];
  deals: { campaignId: string; stage: string; amount: number }[];
}

/**
 * Everything the funnel counts, for a set of campaigns, in a handful of reads.
 * Summed per campaign tree afterwards, so a dashboard of many campaigns costs
 * the same few queries as one.
 */
async function loadRaw(db: Db, campaignIds: string[], model: AttributionModel, range?: { from?: string; to?: string }): Promise<RawMetrics> {
  const ids = campaignIds.length ? campaignIds : ["00000000-0000-0000-0000-000000000000"];
  const inRange = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T, column: string) => {
    let out = q;
    if (range?.from) out = out.gte(column, range.from);
    if (range?.to) out = out.lte(column, `${range.to}T23:59:59`);
    return out;
  };

  const [members, touches, leads, campaigns, credited] = await Promise.all([
    inRange(db.from("campaign_member").select("campaignId").is("deletedAt", null).in("campaignId", ids), "createdAt"),
    inRange(db.from("campaign_interaction").select("campaignId, leadId, contactId").in("campaignId", ids), "occurredAt"),
    inRange(db.from("lead").select("campaignId, status").is("deletedAt", null).in("campaignId", ids), "createdAt"),
    db.from("campaign").select("id, actualCost, budgetAmount").in("id", ids),
    model === "PRIMARY"
      ? db.from("opportunity").select("id, campaignId").is("deletedAt", null).in("campaignId", ids)
      : db.from("opportunity_campaign").select("opportunityId, campaignId").eq("role", model).in("campaignId", ids),
  ]);

  const creditRows = (credited.data ?? []).map((r) => ({
    opportunityId: ((r as { id?: string }).id ?? (r as { opportunityId?: string }).opportunityId) as string,
    campaignId: r.campaignId as string,
  }));
  const oppIds = [...new Set(creditRows.map((r) => r.opportunityId))];
  const byId = new Map<string, { stage: string; amount: number }>();
  for (let i = 0; i < oppIds.length; i += 500) {
    const { data } = await inRange(
      db.from("opportunity").select("id, stage, amount, createdAt").is("deletedAt", null).in("id", oppIds.slice(i, i + 500)),
      "createdAt",
    );
    for (const o of data ?? []) byId.set(o.id as string, { stage: o.stage as string, amount: Number(o.amount ?? 0) });
  }

  return {
    members: (members.data ?? []) as RawMetrics["members"],
    touches: (touches.data ?? []).map((t) => ({ campaignId: t.campaignId as string, person: (t.leadId ?? t.contactId) as string })),
    leads: (leads.data ?? []) as RawMetrics["leads"],
    campaigns: (campaigns.data ?? []).map((c) => ({ id: c.id as string, actualCost: Number(c.actualCost ?? 0), budgetAmount: Number(c.budgetAmount ?? 0) })),
    deals: creditRows.filter((r) => byId.has(r.opportunityId)).map((r) => ({ campaignId: r.campaignId, ...byId.get(r.opportunityId)! })),
  };
}

function aggregate(raw: RawMetrics, campaignIds: string[]): CampaignMetrics {
  const set = new Set(campaignIds);
  const leadRows = raw.leads.filter((l) => set.has(l.campaignId));
  const deals = raw.deals.filter((d) => set.has(d.campaignId));
  const campaigns = raw.campaigns.filter((c) => set.has(c.id));
  const won = deals.filter((d) => d.stage === "CLOSED_WON");
  const wonRevenue = won.reduce((s, d) => s + d.amount, 0);
  const pipeline = deals.filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage)).reduce((s, d) => s + d.amount, 0);
  const cost = campaigns.reduce((s, c) => s + c.actualCost, 0);
  const budget = campaigns.reduce((s, c) => s + c.budgetAmount, 0);
  return {
    campaignIds,
    members: raw.members.filter((m) => set.has(m.campaignId)).length,
    engaged: new Set(raw.touches.filter((t) => set.has(t.campaignId)).map((t) => t.person)).size,
    prospects: leadRows.length,
    leads: leadRows.filter((l) => l.status !== "PROSPECT").length,
    qualified: leadRows.filter((l) => QUALIFIED.includes(l.status)).length,
    deals: deals.length,
    won: won.length,
    wonRevenue,
    pipeline,
    cost,
    budget,
    roiPercent: cost > 0 ? ((wonRevenue - cost) / cost) * 100 : null,
    costPerLead: cost > 0 && leadRows.length ? cost / leadRows.length : null,
    costPerWon: cost > 0 && won.length ? cost / won.length : null,
  };
}

/** One campaign's funnel, including every child campaign beneath it. */
export async function getCampaignFunnel(campaignId: string, model: AttributionModel = "PRIMARY"): Promise<CampaignMetrics & { childCount: number }> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const ids = descendants(await campaignTree(db), campaignId);
  const metrics = aggregate(await loadRaw(db, ids, model), ids);
  return { ...metrics, childCount: ids.length - 1 };
}

export interface DashboardRow extends CampaignMetrics {
  id: string;
  name: string;
  status: string;
  typeName: string | null;
  ownerName: string | null;
  childCount: number;
}

/**
 * The marketing dashboard: every top-level campaign (or the children of the
 * chosen parent) with its whole tree rolled up, filtered by date, type, owner
 * and status, under the chosen attribution model.
 */
export async function getMarketingDashboard(filters: {
  from?: string; to?: string; typeId?: string; ownerId?: string; parentId?: string; status?: string; model?: AttributionModel;
}): Promise<{ rows: DashboardRow[]; totals: CampaignMetrics }> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const model = filters.model ?? "PRIMARY";
  let query = db
    .from("campaign")
    .select(`id, name, status, parentCampaignId, campaignTypeId, ownerUserId,
      type:campaign_type ( name ), owner:app_user!campaign_ownerUserId_fkey ( fullName )`)
    .is("deletedAt", null)
    .order("name");
  if (filters.parentId) query = query.eq("parentCampaignId", filters.parentId);
  else query = query.is("parentCampaignId", null);
  if (filters.typeId) query = query.eq("campaignTypeId", filters.typeId);
  if (filters.ownerId) query = query.eq("ownerUserId", filters.ownerId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data: campaigns, error } = await query.limit(100);
  if (error) throw new Error(`Could not load campaigns: ${error.message}`);

  const range = { from: filters.from, to: filters.to };
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const tree = await campaignTree(db);
  const trees = new Map((campaigns ?? []).map((c) => [c.id as string, descendants(tree, c.id as string)]));
  const raw = await loadRaw(db, [...new Set([...trees.values()].flat())], model, range);
  const rows: DashboardRow[] = [];
  for (const c of campaigns ?? []) {
    const ids = trees.get(c.id as string)!;
    const m = aggregate(raw, ids);
    rows.push({
      ...m,
      id: c.id as string,
      name: c.name as string,
      status: c.status as string,
      typeName: one<{ name: string }>(c.type)?.name ?? null,
      ownerName: one<{ fullName: string }>(c.owner)?.fullName ?? null,
      childCount: ids.length - 1,
    });
  }
  const allIds = [...new Set(rows.flatMap((r) => r.campaignIds))];
  const totals = aggregate(raw, allIds);
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export interface ReferralRow {
  referrer: { kind: "Contact" | "Partner"; id: string; name: string };
  leads: number;
  converted: number;
  leadIds: string[];
}

export async function listReferrals(): Promise<ReferralRow[]> {
  await requirePermission(PERMISSIONS.LEAD_READ);
  const db = await supabaseServer();
  const { data } = await db
    .from("lead")
    .select(`id, status, referredByContactId, referredByPartnerId,
      contact:contact!lead_referredByContactId_fkey ( id, firstName, lastName ),
      partner:partner!lead_referredByPartnerId_fkey ( id, displayName )`)
    .is("deletedAt", null)
    .or("referredByContactId.not.is.null,referredByPartnerId.not.is.null")
    .limit(2000);
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const byKey = new Map<string, ReferralRow>();
  for (const l of data ?? []) {
    const contact = one<{ id: string; firstName: string; lastName: string | null }>(l.contact);
    const partner = one<{ id: string; displayName: string }>(l.partner);
    const referrer = contact
      ? { kind: "Contact" as const, id: contact.id, name: `${contact.firstName} ${contact.lastName ?? ""}`.trim() }
      : partner
        ? { kind: "Partner" as const, id: partner.id, name: partner.displayName }
        : null;
    if (!referrer) continue;
    const key = `${referrer.kind}:${referrer.id}`;
    const row = byKey.get(key) ?? { referrer, leads: 0, converted: 0, leadIds: [] };
    row.leads += 1;
    if (l.status === "CONVERTED") row.converted += 1;
    row.leadIds.push(l.id as string);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.leads - a.leads);
}

/** Contacts to choose a referrer from, by name. */
export async function searchContactsForReferral(term: string): Promise<{ id: string; name: string; company: string | null }[]> {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ACCOUNT_READ) && !can(user, PERMISSIONS.LEAD_WRITE)) return [];
  const s = term.replace(/[,()%]/g, "").trim();
  if (s.length < 2) return [];
  const db = await supabaseServer();
  const { data } = await db
    .from("contact")
    .select("id, firstName, lastName, account ( name )")
    .is("deletedAt", null)
    .or(`firstName.ilike.%${s}%,lastName.ilike.%${s}%,email.ilike.%${s}%`)
    .limit(15);
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
    company: one<{ name: string }>(c.account)?.name ?? null,
  }));
}
