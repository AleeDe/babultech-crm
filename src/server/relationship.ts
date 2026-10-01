"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

/**
 * The relationship around an account or a contact - the "360" view. Everything
 * here reads under the person's own row security, so a section someone may not
 * see comes back empty rather than failing the page.
 */

export interface MoneyByCurrency {
  currency: string;
  amount: number;
}

export interface RelatedLead {
  id: string;
  leadNumber: string;
  name: string;
  status: string;
  leadSource: string | null;
  createdAt: string;
  convertedAt: string | null;
}

export interface RelatedProject {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  health: string | null;
  completionPercent: number;
  plannedEndDate: string | null;
}

export interface RelatedDeal {
  id: string;
  opportunityNumber: string;
  name: string;
  stage: string;
  amount: number;
  currencyCode: string;
  expectedCloseDate: string | null;
}

export interface RelatedCase {
  id: string;
  caseNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface ProductBought {
  productId: string | null;
  name: string;
  quantity: number;
  totals: MoneyByCurrency[];
  lastWonAt: string | null;
}

export interface CampaignInfluence {
  id: string;
  campaignNumber: string;
  name: string;
  status: string;
  /** How the campaign reached this account: "deal", "lead", "contact", "member". */
  via: string[];
}

export interface AccountRelationship {
  leads: RelatedLead[];
  projects: RelatedProject[];
  products: ProductBought[];
  campaigns: CampaignInfluence[];
  revenue: {
    won: MoneyByCurrency[];
    invoiced: MoneyByCurrency[];
    paid: MoneyByCurrency[];
    wonDeals: number;
    firstWonAt: string | null;
  };
}

export interface ContactRelationship {
  deals: RelatedDeal[];
  cases: RelatedCase[];
  projects: RelatedProject[];
  leads: RelatedLead[];
}

function addTo(list: MoneyByCurrency[], currency: string | null | undefined, amount: unknown) {
  const value = Number(amount ?? 0);
  if (!value) return;
  const code = currency || "PKR";
  const row = list.find((m) => m.currency === code);
  if (row) row.amount += value;
  else list.push({ currency: code, amount: value });
}

const LEAD_SELECT = "id, leadNumber, firstName, lastName, companyName, status, leadSource, createdAt, convertedAt";
const PROJECT_SELECT = "id, projectNumber, name, status, health, completionPercent, plannedEndDate";

function toLead(r: Record<string, unknown>): RelatedLead {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || (r.companyName as string) || "—";
  return {
    id: r.id as string,
    leadNumber: r.leadNumber as string,
    name,
    status: r.status as string,
    leadSource: (r.leadSource as string | null) ?? null,
    createdAt: r.createdAt as string,
    convertedAt: (r.convertedAt as string | null) ?? null,
  };
}

function toProject(r: Record<string, unknown>): RelatedProject {
  return {
    id: r.id as string,
    projectNumber: r.projectNumber as string,
    name: r.name as string,
    status: r.status as string,
    health: (r.health as string | null) ?? null,
    completionPercent: Number(r.completionPercent ?? 0),
    plannedEndDate: (r.plannedEndDate as string | null) ?? null,
  };
}

export async function getAccountRelationship(accountId: string): Promise<AccountRelationship> {
  const me = await requireUser();
  const db = await supabaseServer();
  const empty = <T,>() => Promise.resolve({ data: [] as T[] });

  const [leadsRes, projectsRes, dealsRes, invoicesRes, contactsRes] = await Promise.all([
    can(me, PERMISSIONS.LEAD_READ)
      ? db.from("lead").select(`${LEAD_SELECT}, campaignId`).eq("convertedAccountId", accountId).is("deletedAt", null).order("createdAt", { ascending: false }).limit(50)
      : empty<Record<string, unknown>>(),
    db.from("project").select(PROJECT_SELECT).eq("accountId", accountId).is("deletedAt", null).order("createdAt", { ascending: false }).limit(50),
    db.from("opportunity").select("id, stage, amount, currencyCode, campaignId, actualCloseDate").eq("accountId", accountId).is("deletedAt", null),
    db.from("invoice").select("totalAmount, paidAmount, currencyCode, status").eq("accountId", accountId).is("deletedAt", null),
    db.from("contact").select("id, firstCampaignId, latestCampaignId").eq("accountId", accountId).is("deletedAt", null),
  ]);

  const deals = (dealsRes.data ?? []) as Record<string, unknown>[];
  const won = deals.filter((d) => d.stage === "CLOSED_WON");
  const revenue: AccountRelationship["revenue"] = { won: [], invoiced: [], paid: [], wonDeals: won.length, firstWonAt: null };
  for (const d of won) {
    addTo(revenue.won, d.currencyCode as string, d.amount);
    const at = d.actualCloseDate as string | null;
    if (at && (!revenue.firstWonAt || at < revenue.firstWonAt)) revenue.firstWonAt = at;
  }
  for (const i of (invoicesRes.data ?? []) as Record<string, unknown>[]) {
    if (["DRAFT", "CANCELLED", "VOID"].includes(i.status as string)) continue;
    addTo(revenue.invoiced, i.currencyCode as string, i.totalAmount);
    addTo(revenue.paid, i.currencyCode as string, i.paidAmount);
  }

  // What they bought: the lines on deals they won, added up by product.
  const products: ProductBought[] = [];
  if (won.length) {
    const { data: lines } = await db
      .from("opportunity_product")
      .select("productId, description, quantity, lineTotal, opportunityId, product ( name )")
      .in("opportunityId", won.map((d) => d.id as string));
    const dealById = new Map(won.map((d) => [d.id as string, d]));
    for (const l of (lines ?? []) as Record<string, unknown>[]) {
      const deal = dealById.get(l.opportunityId as string);
      const product = (Array.isArray(l.product) ? l.product[0] : l.product) as { name?: string } | null;
      const name = product?.name ?? (l.description as string | null) ?? "Unnamed line";
      const key = (l.productId as string | null) ?? `line:${name}`;
      let row = products.find((p) => (p.productId ?? `line:${p.name}`) === key);
      if (!row) {
        row = { productId: (l.productId as string | null) ?? null, name, quantity: 0, totals: [], lastWonAt: null };
        products.push(row);
      }
      row.quantity += Number(l.quantity ?? 0);
      addTo(row.totals, deal?.currencyCode as string, l.lineTotal);
      const at = (deal?.actualCloseDate as string | null) ?? null;
      if (at && (!row.lastWonAt || at > row.lastWonAt)) row.lastWonAt = at;
    }
    products.sort((a, b) => (b.lastWonAt ?? "").localeCompare(a.lastWonAt ?? ""));
  }

  // Campaign influence: every campaign that touched a deal, a lead, a contact
  // or a campaign member who became one of this account's contacts.
  const via = new Map<string, Set<string>>();
  const touch = (id: unknown, how: string) => {
    if (!id) return;
    const set = via.get(id as string) ?? new Set<string>();
    set.add(how);
    via.set(id as string, set);
  };
  for (const d of deals) touch(d.campaignId, "deal");
  for (const l of (leadsRes.data ?? []) as Record<string, unknown>[]) touch(l.campaignId, "lead");
  const contacts = (contactsRes.data ?? []) as Record<string, unknown>[];
  for (const c of contacts) {
    touch(c.firstCampaignId, "contact");
    touch(c.latestCampaignId, "contact");
  }
  if (contacts.length && can(me, PERMISSIONS.LEAD_READ)) {
    const { data: members } = await db.from("campaign_member").select("campaignId, lastCampaignId").in("contactId", contacts.map((c) => c.id as string));
    for (const m of (members ?? []) as Record<string, unknown>[]) {
      touch(m.campaignId, "member");
      touch(m.lastCampaignId, "member");
    }
  }
  let campaigns: CampaignInfluence[] = [];
  if (via.size) {
    const { data } = await db.from("campaign").select("id, campaignNumber, name, status").in("id", [...via.keys()]).is("deletedAt", null);
    campaigns = ((data ?? []) as Record<string, unknown>[]).map((c) => ({
      id: c.id as string,
      campaignNumber: c.campaignNumber as string,
      name: c.name as string,
      status: c.status as string,
      via: [...(via.get(c.id as string) ?? [])],
    }));
  }

  return {
    leads: ((leadsRes.data ?? []) as Record<string, unknown>[]).map(toLead),
    projects: ((projectsRes.data ?? []) as Record<string, unknown>[]).map(toProject),
    products,
    campaigns,
    revenue,
  };
}

export async function getContactRelationship(contactId: string, accountId: string | null): Promise<ContactRelationship> {
  const me = await requireUser();
  const db = await supabaseServer();
  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [dealsRes, casesRes, leadsRes] = await Promise.all([
    can(me, PERMISSIONS.OPPORTUNITY_READ)
      ? db.from("opportunity").select("id, opportunityNumber, name, stage, amount, currencyCode, expectedCloseDate").eq("primaryContactId", contactId).is("deletedAt", null).order("createdAt", { ascending: false }).limit(50)
      : none,
    can(me, PERMISSIONS.CASE_READ)
      ? db.from("support_case").select("id, caseNumber, subject, status, priority, createdAt, projectId").eq("contactId", contactId).is("deletedAt", null).order("createdAt", { ascending: false }).limit(50)
      : none,
    can(me, PERMISSIONS.LEAD_READ)
      ? db.from("lead").select(LEAD_SELECT).or(`convertedContactId.eq.${contactId},referredByContactId.eq.${contactId}`).is("deletedAt", null).order("createdAt", { ascending: false }).limit(50)
      : none,
  ]);

  // Projects that concern them: from their deals and their cases, or failing
  // that their company's projects.
  const deals = (dealsRes.data ?? []) as Record<string, unknown>[];
  const cases = (casesRes.data ?? []) as Record<string, unknown>[];
  const projectIds = new Set<string>(cases.map((c) => c.projectId as string).filter(Boolean));
  let projects: RelatedProject[] = [];
  {
    const filters: string[] = [];
    if (projectIds.size) filters.push(`id.in.(${[...projectIds].join(",")})`);
    if (deals.length) filters.push(`opportunityId.in.(${deals.map((d) => d.id).join(",")})`);
    if (accountId) filters.push(`accountId.eq.${accountId}`);
    if (filters.length) {
      const { data } = await db.from("project").select(PROJECT_SELECT).or(filters.join(",")).is("deletedAt", null).order("createdAt", { ascending: false }).limit(20);
      projects = ((data ?? []) as Record<string, unknown>[]).map(toProject);
    }
  }

  return {
    deals: deals.map((d) => ({
      id: d.id as string,
      opportunityNumber: d.opportunityNumber as string,
      name: d.name as string,
      stage: d.stage as string,
      amount: Number(d.amount ?? 0),
      currencyCode: (d.currencyCode as string) ?? "PKR",
      expectedCloseDate: (d.expectedCloseDate as string | null) ?? null,
    })),
    cases: cases.map((c) => ({
      id: c.id as string,
      caseNumber: c.caseNumber as string,
      subject: c.subject as string,
      status: c.status as string,
      priority: c.priority as string,
      createdAt: c.createdAt as string,
    })),
    projects,
    leads: ((leadsRes.data ?? []) as Record<string, unknown>[]).map(toLead),
  };
}
