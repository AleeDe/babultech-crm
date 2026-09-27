"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requirePermission, PERMISSIONS } from "@/lib/authz";
import { one, sumBy } from "@/lib/decimal";
import { getAuditTrail } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Partner commission: one record per deal with a partner.
 *
 * The database creates the record with the deal and keeps it in step - see
 * supabase/migrations/20260928000000_partner_commission.sql. Nothing here
 * calculates commission. What is here is reading the records, and the four
 * decisions people make about them, each of which is a database function that
 * checks who is asking.
 */

const LIST_COLUMNS = `id, commissionNumber, status, baseAmount, commissionPercent,
  withholdingTaxPercent, commissionAmount, withholdingAmount, partnerAmount,
  currencyCode, paymentDate, rejectedReason, closedAt, createdAt,
  requestedPercent, requestReason, requestStatus, requestedAt,
  partner ( id, partnerNumber, displayName ),
  opportunity ( id, opportunityNumber, name, stage, actualCloseDate, account ( id, name ) )`;

export interface CommissionRow {
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
  partner: { id: string; partnerNumber: string; displayName: string } | null;
  opportunity: {
    id: string;
    opportunityNumber: string;
    name: string;
    stage: string;
    actualCloseDate: string | null;
    account: { id: string; name: string } | null;
  } | null;
}

function shape(r: Record<string, unknown>): CommissionRow {
  const opportunity = one(r.opportunity as never) as Record<string, unknown> | null;
  return {
    ...(r as Record<string, never>),
    partner: one(r.partner as never),
    opportunity: opportunity
      ? { ...opportunity, account: one(opportunity.account as never) }
      : null,
  } as CommissionRow;
}

/** Where a record stands, in the words the screens use. */
export type CommissionView = "open" | "owed" | "due" | "paid" | "rejected" | "requests";

export async function listPartnerCommissions(filters: {
  view?: string;
  partnerId?: string;
  search?: string;
} = {}): Promise<CommissionRow[]> {
  await requirePermission(PERMISSIONS.COMMISSION_READ);
  const db = await supabaseServer();

  let query = db
    .from("partner_commission")
    .select(LIST_COLUMNS)
    .order("createdAt", { ascending: false })
    .limit(500);

  if (filters.partnerId) query = query.eq("partnerId", filters.partnerId);
  switch (filters.view) {
    case "paid":
      query = query.eq("status", "PAID");
      break;
    case "rejected":
      query = query.eq("status", "REJECTED");
      break;
    case "requests":
      query = query.eq("requestStatus", "PENDING");
      break;
    case "open":
    case "owed":
    case "due":
      query = query.eq("status", "IN_PROGRESS");
      break;
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load partner commission: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  let rows = (data ?? []).map((r) => shape(r as Record<string, unknown>));

  // Views that depend on the deal's stage, which PostgREST cannot filter on
  // through an embedded to-one relation without an inner join per case.
  if (filters.view === "open") rows = rows.filter((r) => r.opportunity?.stage !== "CLOSED_WON");
  if (filters.view === "owed") rows = rows.filter((r) => r.opportunity?.stage === "CLOSED_WON");
  if (filters.view === "due") {
    rows = rows.filter(
      (r) => r.opportunity?.stage === "CLOSED_WON" && !!r.paymentDate && r.paymentDate <= today,
    );
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter((r) =>
      [r.commissionNumber, r.partner?.displayName, r.opportunity?.name, r.opportunity?.opportunityNumber,
        r.opportunity?.account?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(search)),
    );
  }
  return rows;
}

/** The figures across the top of the commission list. */
export async function getPartnerCommissionTotals() {
  await requirePermission(PERMISSIONS.COMMISSION_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from("partner_commission")
    .select("status, partnerAmount, paymentDate, requestStatus, currencyCode, opportunity ( stage )");
  if (error) throw new Error(`Could not load commission totals: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).map((r) => ({
    status: r.status as string,
    partnerAmount: r.partnerAmount,
    paymentDate: r.paymentDate as string | null,
    requestStatus: r.requestStatus as string | null,
    stage: (one(r.opportunity as never) as { stage?: string } | null)?.stage ?? null,
  }));
  const inProgress = rows.filter((r) => r.status === "IN_PROGRESS");
  const owed = inProgress.filter((r) => r.stage === "CLOSED_WON");
  const due = owed.filter((r) => !!r.paymentDate && r.paymentDate <= today);

  return {
    currency: (data?.[0]?.currencyCode as string | undefined) ?? "PKR",
    openTotal: sumBy(inProgress.filter((r) => r.stage !== "CLOSED_WON"), "partnerAmount"),
    owedTotal: sumBy(owed, "partnerAmount"),
    owedCount: owed.length,
    dueTotal: sumBy(due, "partnerAmount"),
    dueCount: due.length,
    paidTotal: sumBy(rows.filter((r) => r.status === "PAID"), "partnerAmount"),
    pendingRequests: rows.filter((r) => r.requestStatus === "PENDING").length,
  };
}

export async function getPartnerCommission(id: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from("partner_commission")
    .select(
      `${LIST_COLUMNS}, requestDecisionReason, requestDecidedAt,
       closedBy:app_user!partner_commission_closedById_fkey ( fullName ),
       requestedBy:app_user!partner_commission_requestedById_fkey ( fullName ),
       requestDecidedBy:app_user!partner_commission_requestDecidedById_fkey ( fullName )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the commission: ${error.message}`);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const history = await getAuditTrail("PartnerCommission", id);
  return {
    ...shape(row),
    requestDecisionReason: row.requestDecisionReason as string | null,
    requestDecidedAt: row.requestDecidedAt as string | null,
    closedBy: one(row.closedBy as never) as { fullName: string } | null,
    requestedBy: one(row.requestedBy as never) as { fullName: string } | null,
    requestDecidedBy: one(row.requestDecidedBy as never) as { fullName: string } | null,
    history,
  };
}

/** The deal page's view of its commission, for people who may see commission. */
export async function getCommissionForOpportunity(opportunityId: string): Promise<CommissionRow | null> {
  const db = await supabaseServer();
  const { data } = await db
    .from("partner_commission")
    .select(LIST_COLUMNS)
    .eq("opportunityId", opportunityId)
    .maybeSingle();
  return data ? shape(data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function refresh(id: string) {
  revalidatePath("/commissions");
  revalidatePath(`/commissions/${id}`);
  revalidatePath("/approvals");
  revalidatePath("/opportunities", "layout");
}

const markSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["PAID", "REJECTED"]),
  reason: z.string().trim().max(2000).optional().nullable(),
});

export async function markPartnerCommission(input: z.infer<typeof markSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the details." };

  const db = await supabaseServer();
  const { error } = await db.rpc("partner_commission_mark", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

const dateSchema = z.object({
  id: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date."),
});

export async function setCommissionPaymentDate(input: z.infer<typeof dateSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = dateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a payment date." };

  const db = await supabaseServer();
  const { error } = await db.rpc("partner_commission_set_payment_date", {
    p_id: parsed.data.id,
    p_date: parsed.data.paymentDate,
  });
  if (error) return { ok: false, error: error.message };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

const percentSchema = z.object({
  id: z.string().uuid(),
  percent: z.coerce.number().min(0, "The percentage must be between 0 and 100.").max(100, "The percentage must be between 0 and 100."),
  reason: z.string().trim().min(1, "Give a reason for the change.").max(2000),
});

export async function changeCommissionPercent(input: z.infer<typeof percentSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = percentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the details." };

  const db = await supabaseServer();
  const { error } = await db.rpc("partner_commission_change_percent", {
    p_id: parsed.data.id,
    p_percent: parsed.data.percent,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  reason: z.string().trim().max(2000).optional().nullable(),
});

export async function decideCommissionRequest(input: z.infer<typeof decideSchema>): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the details." };
  if (!parsed.data.approve && !parsed.data.reason?.trim()) {
    return { ok: false, error: "Give a reason for declining. The partner will see it." };
  }

  const db = await supabaseServer();
  const { error } = await db.rpc("partner_commission_decide_request", {
    p_id: parsed.data.id,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

/**
 * Give a deal its partner, where it has none. A deal raised before its account
 * had a partner does not pick one up later on its own. Setting it creates the
 * commission record.
 */
export async function setDealPartner(opportunityId: string, partnerId: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(opportunityId).success || !z.string().uuid().safeParse(partnerId).success) {
    return { ok: false, error: "Choose a partner." };
  }
  const db = await supabaseServer();
  const { error } = await db.rpc("set_opportunity_partner", {
    p_opportunity: opportunityId,
    p_partner: partnerId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/commissions");
  return { ok: true, data: undefined };
}
