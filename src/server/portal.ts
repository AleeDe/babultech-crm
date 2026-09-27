"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sumBy, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, AuthorizationError } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * The partner portal's data layer.
 *
 * Every function here starts with `requirePartner()`, which reads the partner
 * id **from the session** and nowhere else. No portal query accepts a partner
 * id as an argument, so there is no parameter for an external user to tamper
 * with - the worst they can do is ask for their own data.
 *
 * What a partner may see is deliberately narrow: the deals credited to them,
 * the customers behind those deals, and the commission on each. They never see
 * another partner's records, internal cost or margin, anyone else's pipeline,
 * or any employee data.
 */

export interface PortalContext {
  userId: string;
  fullName: string;
  partnerId: string;
}

/** Resolves the signed-in user to the partner they act for. */
async function requirePartner(): Promise<PortalContext> {
  const user = await requireUser();
  if (!user.partnerId) {
    throw new AuthorizationError("This account is not a partner portal login.");
  }
  return { userId: user.id, fullName: user.fullName, partnerId: user.partnerId };
}

/** Safe for a layout to call - returns null instead of throwing. */
export async function getPortalContext(): Promise<PortalContext | null> {
  try {
    return await requirePartner();
  } catch {
    return null;
  }
}

export async function getPartnerProfile() {
  const { partnerId } = await requirePartner();
  const db = await supabaseServer();

  // The column list stays explicit: bankDetails, internal notes and the
  // partner manager must never reach the portal.
  const { data, error } = await db
    .from("partner")
    .select(
      `id, partnerNumber, displayName, kind, partnerType, tier, status,
       territory, startDate, agreementExpiryDate, defaultCommissionPercent,
       payoutCurrencyCode, withholdingTaxPercent, taxNumber, email, phone, website,
       account!partner_accountId_fkey ( id, name ),
       contact!partner_contactId_fkey ( id, firstName, lastName )`,
    )
    .eq("id", partnerId)
    .single();

  if (error || !data) {
    throw new AuthorizationError("Partner profile not found.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

const COMMISSION_COLUMNS = `id, commissionNumber, status, baseAmount, commissionPercent,
  withholdingTaxPercent, commissionAmount, withholdingAmount, partnerAmount,
  currencyCode, paymentDate, rejectedReason, closedAt, createdAt,
  requestedPercent, requestReason, requestStatus, requestedAt,
  requestDecisionReason, requestDecidedAt,
  opportunity ( id, opportunityNumber, name, stage, actualCloseDate, account ( id, name ) )`;

function shapeCommission(r: Record<string, unknown>) {
  const opportunity = one(r.opportunity as never) as Record<string, unknown> | null;
  return {
    ...(r as Record<string, never>),
    opportunity: opportunity
      ? { ...opportunity, account: one(opportunity.account as never) as { id: string; name: string } | null }
      : null,
  } as PortalCommission;
}

export interface PortalCommission {
  id: string;
  commissionNumber: string;
  status: "IN_PROGRESS" | "PAID" | "REJECTED";
  baseAmount: string | number;
  commissionPercent: string | number;
  withholdingTaxPercent: string | number;
  commissionAmount: string | number;
  withholdingAmount: string | number;
  partnerAmount: string | number;
  currencyCode: string;
  paymentDate: string | null;
  rejectedReason: string | null;
  closedAt: string | null;
  createdAt: string;
  requestedPercent: string | number | null;
  requestReason: string | null;
  requestStatus: "PENDING" | "APPROVED" | "DECLINED" | null;
  requestedAt: string | null;
  requestDecisionReason: string | null;
  requestDecidedAt: string | null;
  opportunity: {
    id: string;
    opportunityNumber: string;
    name: string;
    stage: string;
    actualCloseDate: string | null;
    account: { id: string; name: string } | null;
  } | null;
}

/** The partner's commission, one record per deal, newest first. */
export async function getPortalCommissions(status?: string): Promise<PortalCommission[]> {
  const { partnerId } = await requirePartner();
  const db = await supabaseServer();

  let query = db
    .from("partner_commission")
    .select(COMMISSION_COLUMNS)
    .eq("partnerId", partnerId)
    .order("createdAt", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load commission: ${error.message}`);
  return (data ?? []).map((r) => shapeCommission(r as Record<string, unknown>));
}

/**
 * Headline numbers for the portal landing page. Amounts are what the partner
 * is paid, after withholding tax.
 *
 *   paid      marked Paid
 *   owed      on won deals, not yet paid
 *   pipeline  on deals still open - an estimate that moves with the deal
 */
export async function getPortalSummary() {
  const { partnerId } = await requirePartner();
  const db = await supabaseServer();

  const [recordsRes, dealsRes] = await Promise.all([
    db
      .from("partner_commission")
      .select("status, partnerAmount, currencyCode, opportunity ( stage )")
      .eq("partnerId", partnerId),
    db
      .from("opportunity")
      .select("id", { count: "exact", head: true })
      .eq("sourcePartnerId", partnerId)
      .is("deletedAt", null),
  ]);

  const records = (recordsRes.data ?? []).map((r) => ({
    status: r.status as string,
    partnerAmount: r.partnerAmount,
    currencyCode: r.currencyCode as string,
    stage: (one(r.opportunity as never) as { stage?: string } | null)?.stage ?? null,
  }));

  const paid = records.filter((r) => r.status === "PAID");
  const owed = records.filter((r) => r.status === "IN_PROGRESS" && r.stage === "CLOSED_WON");
  const pipeline = records.filter((r) => r.status === "IN_PROGRESS" && r.stage !== "CLOSED_WON");

  return {
    currency: records[0]?.currencyCode ?? "PKR",
    dealCount: dealsRes.count ?? 0,
    paidTotal: sumBy(paid, "partnerAmount"),
    owedTotal: sumBy(owed, "partnerAmount"),
    owedCount: owed.length,
    pipelineTotal: sumBy(pipeline, "partnerAmount"),
    earnedTotal: sumBy([...paid, ...owed], "partnerAmount"),
  };
}

const requestSchema = z.object({
  id: z.string().uuid(),
  percent: z.coerce.number().min(0, "The percentage must be between 0 and 100.").max(100, "The percentage must be between 0 and 100."),
  reason: z.string().trim().min(1, "Tell us why, so we can decide.").max(2000),
});

/**
 * Ask for a different percentage on one deal. Nothing changes until somebody
 * at BabulTech approves it; the current percentage stands until then.
 */
export async function requestCommissionPercent(
  input: z.infer<typeof requestSchema>,
): Promise<ActionResult> {
  try {
    await requirePartner();
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Please check the request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const db = await supabaseServer();
    const { error } = await db.rpc("partner_commission_request_percent", {
      p_id: parsed.data.id,
      p_percent: parsed.data.percent,
      p_reason: parsed.data.reason,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/commissions");
    revalidatePath("/portal");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "We could not send the request." };
  }
}

/** The partner confirms they have been paid. Only once the deal is won. */
export async function markCommissionPaid(id: string): Promise<ActionResult> {
  try {
    await requirePartner();
    const db = await supabaseServer();
    const { error } = await db.rpc("partner_commission_mark", {
      p_id: id,
      p_status: "PAID",
      p_reason: null,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/commissions");
    revalidatePath("/portal");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "We could not update the commission." };
  }
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

/**
 * Deals credited to the partner, each with its commission. Only the deal's
 * headline and their own commission - the customer's contacts, internal notes
 * and margin stay out of it.
 */
export async function getPortalDeals() {
  const { partnerId } = await requirePartner();
  const db = await supabaseServer();

  const [dealsRes, commissionsRes] = await Promise.all([
    db
      .from("opportunity")
      .select(
        `id, opportunityNumber, name, stage, amount, currencyCode,
         expectedCloseDate, actualCloseDate, createdAt,
         account ( id, name, industry )`,
      )
      .eq("sourcePartnerId", partnerId)
      .is("deletedAt", null)
      .order("createdAt", { ascending: false }),
    db
      .from("partner_commission")
      .select("opportunityId, status, commissionPercent, partnerAmount, requestStatus")
      .eq("partnerId", partnerId),
  ]);

  if (dealsRes.error) throw new Error(`Could not load deals: ${dealsRes.error.message}`);

  const byDeal = new Map(
    (commissionsRes.data ?? []).map((c) => [c.opportunityId as string, c]),
  );

  return (dealsRes.data ?? []).map((o) => {
    const c = byDeal.get(o.id as string);
    return {
      ...o,
      account: one(o.account as never) as { id: string; name: string; industry: string | null } | null,
      commission: c
        ? {
            status: c.status as string,
            percent: c.commissionPercent,
            partnerAmount: c.partnerAmount,
            requestPending: c.requestStatus === "PENDING",
          }
        : null,
    };
  });
}

/**
 * The numbers behind the partner's Overview.
 *
 * Every figure here is derived from rows the partner can already open on their
 * own pages - their deals and their commission. Nothing new becomes visible to
 * them, which is why this needs no separate access decision.
 *
 * No targets, by choice. A conversion rate describes what happened; a quota
 * changes what the relationship is, and that is not ours to introduce from a
 * dashboard.
 */
export async function getPortalAnalytics() {
  const { partnerId } = await requirePartner();
  const db = await supabaseServer();

  const [commissionsRes, dealsRes] = await Promise.all([
    db
      .from("partner_commission")
      .select("status, partnerAmount, paymentDate, currencyCode, opportunity ( stage, actualCloseDate )")
      .eq("partnerId", partnerId),
    db
      .from("opportunity")
      .select("id, name, stage, amount, currencyCode, expectedCloseDate, updatedAt, account ( id, name )")
      .eq("sourcePartnerId", partnerId)
      .is("deletedAt", null),
  ]);

  const commissions = commissionsRes.data ?? [];
  const deals = (dealsRes.data ?? []) as Record<string, unknown>[];
  const currency = (commissions[0]?.currencyCode as string | undefined) ?? "PKR";
  const now = new Date();
  const isOpen = (stage: unknown) => stage !== "CLOSED_WON" && stage !== "CLOSED_LOST";

  // --- earnings, by month ---------------------------------------------------
  //
  // Commission is earned when the deal is won. Six buckets, built from today
  // backwards, so a month in which nothing was earned shows as a zero rather
  // than disappearing and making the line lie.
  const months: { key: string; label: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short" }),
      total: 0,
    });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const c of commissions) {
    if (c.status === "REJECTED") continue;
    const o = one(c.opportunity as never) as { stage?: string; actualCloseDate?: string | null } | null;
    if (o?.stage !== "CLOSED_WON" || !o.actualCloseDate) continue;
    const bucket = byKey.get(String(o.actualCloseDate).slice(0, 7));
    if (bucket) bucket.total += Number(c.partnerAmount ?? 0);
  }

  // Against the month before, which is the comparison a partner actually makes.
  const thisMonth = months[months.length - 1]?.total ?? 0;
  const lastMonth = months[months.length - 2]?.total ?? 0;
  const monthDelta =
    lastMonth === 0 ? null : Math.round(((thisMonth - lastMonth) / lastMonth) * 100);

  // --- pipeline, by stage ---------------------------------------------------
  const stages = new Map<string, { count: number; value: number }>();
  let wonCount = 0;
  let lostCount = 0;
  let openValue = 0;

  for (const o of deals) {
    const stage = String(o.stage);
    const value = Number(o.amount ?? 0);
    if (stage === "CLOSED_WON") wonCount++;
    else if (stage === "CLOSED_LOST") lostCount++;
    else openValue += value;

    const at = stages.get(stage) ?? { count: 0, value: 0 };
    at.count++;
    at.value += value;
    stages.set(stage, at);
  }

  // Of the deals that have been DECIDED. Counting open deals as losses would
  // punish a partner for having a healthy pipeline.
  const decided = wonCount + lostCount;
  const winRate = decided === 0 ? null : Math.round((wonCount / decided) * 100);

  // --- who is actually bringing the money -----------------------------------
  const byAccount = new Map<string, { id: string; name: string; value: number }>();
  for (const o of deals) {
    if (o.stage !== "CLOSED_WON") continue;
    const a = one(o.account as never) as { id: string; name: string } | null;
    if (!a) continue;
    const at = byAccount.get(a.id) ?? { id: a.id, name: a.name, value: 0 };
    at.value += Number(o.amount ?? 0);
    byAccount.set(a.id, at);
  }

  // --- what needs looking at ------------------------------------------------
  const DAY = 24 * 60 * 60 * 1000;
  const today = now.toISOString().slice(0, 10);

  // Won, not yet paid, and the payment date has come.
  const paymentDue = commissions.filter((c) => {
    const o = one(c.opportunity as never) as { stage?: string } | null;
    return c.status === "IN_PROGRESS" && o?.stage === "CLOSED_WON"
      && !!c.paymentDate && String(c.paymentDate) <= today;
  }).length;

  const stale = deals.filter((o) => {
    if (!isOpen(o.stage) || !o.updatedAt) return false;
    return (now.getTime() - new Date(o.updatedAt as string).getTime()) / DAY > 60;
  }).length;

  const overdue = deals.filter((o) => {
    if (!isOpen(o.stage) || !o.expectedCloseDate) return false;
    return new Date(o.expectedCloseDate as string).getTime() < now.getTime();
  }).length;

  return {
    currency,
    months,
    monthDelta,
    thisMonth,
    winRate,
    wonCount,
    lostCount,
    openValue,
    openCount: deals.length - wonCount - lostCount,
    stages: [...stages.entries()]
      .map(([stage, v]) => ({ stage, ...v }))
      .sort((a, b) => b.value - a.value),
    topAccounts: [...byAccount.values()].sort((a, b) => b.value - a.value),
    attention: { paymentDue, stale, overdue },
  };
}
