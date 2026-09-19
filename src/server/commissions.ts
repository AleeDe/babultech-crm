"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { picklistCode } from "@/lib/picklists";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { updateRecord, LIST_LIMIT } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { clawback } from "./commission-engine";
import type { ActionResult } from "./partners";

/**
 * Commission lifecycle actions: submit → approve → batch into a payout → pay.
 * The engine in commission-engine.ts creates the records; this file moves them
 * through the workflow and turns approved amounts into money out the door.
 */

const ZERO = toDecimal(0);

export async function submitCommissionsForApproval(recordIds: string[]): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.COMMISSION_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    // Status change + one audit row per record, atomically.
    const { data: result, error } = await db.rpc("transition_commissions", {
      p_record_ids: recordIds,
      p_from_statuses: ["ACCRUED"],
      p_to_status: "PENDING_APPROVAL",
      p_actor_id: user.id,
      p_reason: null,
    });

    if (error) throw new Error(error.message);
    if (!result) return { ok: false, error: "No accrued commissions were selected." };

    revalidatePath("/commissions");
    return { ok: true, data: { count: result } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit the commissions." };
  }
}

export async function approveCommissions(recordIds: string[]): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    // The APPROVED-vs-PAYABLE decision stays in SQL: payableFromDate is a real
    // date there. Comparing it here would compare a string to a Date, which is
    // always false — every delayed commission would become immediately payable.
    const { data: count, error } = await db.rpc("approve_commissions", {
      p_record_ids: recordIds,
      p_actor_id: user.id,
    });

    if (error) throw new Error(error.message);
    if (!count) {
      return { ok: false, error: "No commissions awaiting approval were selected." };
    }

    revalidatePath("/commissions");
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not approve the commissions." };
  }
}

const rejectSchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1),
  reason: z.string().min(3, "Give a reason so the partner can be told why."),
});

export async function rejectCommissions(
  input: z.infer<typeof rejectSchema>,
): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  try {
    const db = await supabaseServer();

    const { data: count, error } = await db.rpc("transition_commissions", {
      p_record_ids: parsed.data.recordIds,
      p_from_statuses: ["ACCRUED", "PENDING_APPROVAL", "APPROVED"],
      p_to_status: "REJECTED",
      p_actor_id: user.id,
      p_reason: parsed.data.reason,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/commissions");
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reject the commissions." };
  }
}

const payoutSchema = z.object({
  partnerId: z.string().uuid(),
  recordIds: z.array(z.string().uuid()).min(1, "Select at least one commission to pay."),
  periodStart: z.coerce.date().optional().nullable(),
  periodEnd: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Batches approved/payable commissions into a single payout for one partner.
 * All records must share a currency — cross-currency batching needs an FX
 * process that is out of scope until the finance module lands.
 */
export async function createPayout(
  input: z.infer<typeof payoutSchema>,
): Promise<ActionResult<{ id: string; payoutNumber: string }>> {
  const _auth = await authorize(PERMISSIONS.COMMISSION_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    // Payout + record linkage in one transaction. Split apart, a failure
    // between them leaves records unattached to the payout that already
    // covers them — they would be batched again and paid twice. The status,
    // ownership and single-currency checks run inside the same lock.
    const { data: payout, error } = await db.rpc("create_commission_payout", {
      p_partner_id: data.partnerId,
      p_record_ids: data.recordIds,
      p_period_start: data.periodStart ? data.periodStart.toISOString().slice(0, 10) : null,
      p_period_end: data.periodEnd ? data.periodEnd.toISOString().slice(0, 10) : null,
      p_notes: data.notes ?? null,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/commissions");
    revalidatePath("/commissions/payouts");
    revalidatePath(`/partners/${data.partnerId}`);
    return { ok: true, data: { id: payout.id, payoutNumber: payout.payoutNumber } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the payout." };
  }
}

export async function approvePayout(payoutId: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PAYOUT_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    const { data: payout } = await db
      .from("commission_payout")
      .select("status, payoutNumber")
      .eq("id", payoutId)
      .maybeSingle();

    if (!payout) return { ok: false, error: "Payout not found." };

    if (payout.status !== "DRAFT" && payout.status !== "PENDING_APPROVAL") {
      return {
        ok: false,
        error: `Payout ${payout.payoutNumber} is ${String(payout.status).toLowerCase()} and cannot be approved.`,
      };
    }

    await updateRecord(
      "commission_payout",
      payoutId,
      { status: "APPROVED", approvedById: user.id, approvedAt: new Date().toISOString() },
      "CommissionPayout",
      user.id,
    );

    revalidatePath("/commissions/payouts");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not approve the payout." };
  }
}

const markPaidSchema = z.object({
  payoutId: z.string().uuid(),
  paymentDate: z.coerce.date(),
  paymentMethod: picklistCode,
  bankAccountId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
});

/**
 * Records the money leaving. Marks the payout and its records PAID and posts
 * an outgoing FinancialTransaction (spec §13 Transactions: the cash register
 * should be system-created wherever possible).
 */
export async function markPayoutPaid(
  input: z.infer<typeof markPaidSchema>,
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PAYOUT_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    // Payout PAID + its records PAID + the outgoing FinancialTransaction, all
    // in one transaction. A payout marked paid whose records stayed unpaid
    // would show the partner as still owed money that has already left.
    const { data: paid, error } = await db.rpc("mark_payout_paid", {
      p_payout_id: data.payoutId,
      p_payment_date: data.paymentDate.toISOString().slice(0, 10),
      p_payment_method: data.paymentMethod,
      p_bank_account_id: data.bankAccountId ?? null,
      p_reference: data.referenceNumber ?? null,
      p_actor_id: user.id,
    });

    if (error) return { ok: false, error: error.message };
    if (!paid) return { ok: false, error: "Payout not found." };

    revalidatePath("/commissions/payouts");
    revalidatePath("/commissions");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the payment." };
  }
}

const clawbackSchema = z.object({
  recordId: z.string().uuid(),
  reason: z.string().min(3, "Give a reason for the clawback."),
});

export async function clawbackCommission(
  input: z.infer<typeof clawbackSchema>,
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = clawbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  try {
    await clawback(parsed.data.recordId, parsed.data.reason, user.id);
    revalidatePath("/commissions");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not claw back the commission." };
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listCommissions(filters?: {
  status?: string;
  partnerId?: string;
  from?: Date;
  to?: Date;
}) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  let query = db
    .from("commission_record")
    .select(
      `*,
       partner ( id, displayName, partnerNumber, kind ),
       opportunity ( id, opportunityNumber, name, stage, account ( name ) ),
       plan:commission_plan ( name, basis, trigger ),
       invoice ( invoiceNumber ),
       payout:commission_payout ( id, payoutNumber, status )`,
    )
    .is("deletedAt", null)
    .order("earnedDate", { ascending: false })
    .order("createdAt", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.partnerId) query = query.eq("partnerId", filters.partnerId);
  if (filters?.from) query = query.gte("earnedDate", filters.from.toISOString().slice(0, 10));
  if (filters?.to) query = query.lte("earnedDate", filters.to.toISOString().slice(0, 10));

  const { data, error } = await query.limit(LIST_LIMIT);
  if (error) throw new Error(`Could not load commissions: ${error.message}`);

  return (data ?? []).map((r) => {
    const opportunity = one(r.opportunity as never) as Record<string, unknown> | null;
    return {
      ...r,
      partner: one(r.partner as never),
      opportunity: opportunity
        ? { ...opportunity, account: one(opportunity.account as never) }
        : null,
      plan: one(r.plan as never),
      invoice: one(r.invoice as never),
      payout: one(r.payout as never),
    };
  });
}

/** Totals by status, for the commissions dashboard tiles. */
export async function getCommissionTotals() {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  // PostgREST has no groupBy, so the rows are fetched and bucketed here.
  const { data: raw, error } = await db
    .from("commission_record")
    .select("status, currencyCode, commissionAmount, netPayableAmount")
    .is("deletedAt", null);

  if (error) throw new Error(`Could not load commission totals: ${error.message}`);

  const grouped = new Map<
    string,
    { status: string; _count: number; _sum: { netPayableAmount: Decimal } }
  >();

  for (const r of raw ?? []) {
    const key = `${r.status}|${r.currencyCode}`;
    const acc =
      grouped.get(key) ??
      { status: r.status as string, _count: 0, _sum: { netPayableAmount: toDecimal(0) } };
    acc._count += 1;
    acc._sum.netPayableAmount = acc._sum.netPayableAmount.plus(
      toDecimal(r.netPayableAmount),
    );
    grouped.set(key, acc);
  }

  const rows = [...grouped.values()];

  const bucket = (statuses: string[]) =>
    rows
      .filter((r) => statuses.includes(r.status))
      .reduce(
        (acc, r) => ({
          amount: acc.amount.plus(r._sum.netPayableAmount ?? ZERO),
          count: acc.count + r._count,
        }),
        { amount: ZERO, count: 0 },
      );

  return {
    accrued: bucket(["ACCRUED"]),
    pendingApproval: bucket(["PENDING_APPROVAL"]),
    payable: bucket(["APPROVED", "PAYABLE", "PARTIALLY_PAID"]),
    paid: bucket(["PAID"]),
    clawedBack: bucket(["CLAWED_BACK"]),
  };
}

export async function listPayouts(status?: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  let query = db
    .from("commission_payout")
    .select(
      `*,
       partner ( id, displayName, partnerNumber ),
       approvedBy:app_user!commission_payout_approvedById_fkey ( fullName ),
       bankAccount:bank_account ( name ),
       records:commission_record ( count )`,
    )
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query.limit(LIST_LIMIT);
  if (error) throw new Error(`Could not load payouts: ${error.message}`);

  return (data ?? []).map((p) => ({
    ...p,
    partner: one(p.partner as never),
    approvedBy: one(p.approvedBy as never),
    bankAccount: one(p.bankAccount as never),
    _count: {
      records: (p.records as { count: number }[] | undefined)?.[0]?.count ?? 0,
    },
  }));
}

export async function getPayout(id: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("commission_payout")
    .select(
      `*,
       partner ( * ),
       approvedBy:app_user!commission_payout_approvedById_fkey ( fullName ),
       bankAccount:bank_account ( * ),
       records:commission_record (
         *,
         opportunity ( opportunityNumber, name, account ( name ) )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load payout: ${error.message}`);
  if (!data) return null;

  return {
    ...data,
    partner: one(data.partner as never),
    approvedBy: one(data.approvedBy as never),
    bankAccount: one(data.bankAccount as never),
    // PostgREST cannot order an embedded relation inline.
    records: ((data.records ?? []) as Record<string, unknown>[])
      .map((r): Record<string, unknown> => {
        const opportunity = one(r.opportunity as never) as Record<string, unknown> | null;
        return {
          ...r,
          opportunity: opportunity
            ? { ...opportunity, account: one(opportunity.account as never) }
            : null,
        };
      })
      .sort((a, b) =>
        String(a.earnedDate ?? "").localeCompare(String(b.earnedDate ?? "")),
      ),
  };
}

/** Approved, unpaid commissions for one partner — the "ready to pay" queue. */
export async function getPayableCommissions(partnerId: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("commission_record")
    .select(
      `*,
       opportunity ( opportunityNumber, name, account ( name ) )`,
    )
    .eq("partnerId", partnerId)
    .in("status", ["APPROVED", "PAYABLE"])
    .is("payoutId", null)
    .is("deletedAt", null)
    .order("earnedDate", { ascending: true });

  if (error) throw new Error(`Could not load payable commissions: ${error.message}`);

  return (data ?? []).map((r) => {
    const opportunity = one(r.opportunity as never) as Record<string, unknown> | null;
    return {
      ...r,
      opportunity: opportunity
        ? { ...opportunity, account: one(opportunity.account as never) }
        : null,
    };
  });
}

export async function listCommissionPlans() {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("commission_plan")
    .select(
      `*,
       tiers:commission_tier ( * ),
       partners:partner ( count ),
       commissionRecords:commission_record ( count )`,
    )
    .is("deletedAt", null)
    .order("name");

  if (error) throw new Error(`Could not load commission plans: ${error.message}`);

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  return (data ?? []).map((p) => ({
    ...p,
    tiers: ((p.tiers ?? []) as Record<string, unknown>[]).sort(
      (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    ),
    _count: {
      partners: countOf(p.partners),
      commissionRecords: countOf(p.commissionRecords),
    },
  }));
}

export async function getCommission(id: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("commission_record")
    .select(
      `*,
       partner ( id, displayName, partnerNumber, kind, partnerType, tier, withholdingTaxPercent ),
       opportunity ( id, opportunityNumber, name, stage, amount, currencyCode, account ( id, name ) ),
       plan:commission_plan ( id, name, basis, trigger, rateType, flatPercent, clawbackWindowDays ),
       invoice ( id, invoiceNumber, totalAmount, status ),
       payment ( id, paymentNumber, amount, paymentDate ),
       payout:commission_payout ( id, payoutNumber, status, paymentDate ),
       approvedBy:app_user!commission_record_approvedById_fkey ( id, fullName )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load commission: ${error.message}`);
  if (!data) return null;

  const opportunity = one(data.opportunity as never) as Record<string, unknown> | null;

  return {
    ...data,
    partner: one(data.partner as never),
    opportunity: opportunity
      ? { ...opportunity, account: one(opportunity.account as never) }
      : null,
    plan: one(data.plan as never),
    invoice: one(data.invoice as never),
    payment: one(data.payment as never),
    payout: one(data.payout as never),
    approvedBy: one(data.approvedBy as never),
  };
}
