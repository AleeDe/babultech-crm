import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";
import type { CommissionBasis, CommissionTier, PlanWithTiers } from "@/lib/types";

/**
 * Commission engine.
 *
 * The source spec (v1.0) carries only a static `commission_percent` on Partner
 * Profile with nothing consuming it. This module turns partner involvement on a
 * deal into an auditable liability:
 *
 *   Opportunity CLOSED_WON ──► accrueForWonOpportunity()
 *   Invoice SENT            ──► accrueForInvoice()
 *   Payment CLEARED         ──► accrueForPayment()
 *
 * Each produces CommissionRecord rows, which then move
 * ACCRUED → PENDING_APPROVAL → APPROVED → PAYABLE → PAID via a CommissionPayout.
 *
 * Rate resolution order (most specific wins):
 *   1. OpportunityPartner.commissionPercentOverride  — negotiated for this deal
 *   2. Plan tiers (TIERED_PERCENT) / flatPercent / fixedAmount
 *   3. Partner.defaultCommissionPercent
 */

/**
 * Coerce to Decimal. Accepts null/undefined (-> 0) because PostgREST returns
 * nullable numeric columns as null, where Prisma gave a Decimal or undefined.
 */
const D = (v: Decimal | number | string | null | undefined) =>
  v === null || v === undefined ? new Decimal(0) : new Decimal(v.toString());
const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

export interface CommissionCalculation {
  basis: CommissionBasis;
  basisAmount: Decimal;
  ratePercent: Decimal | null;
  commissionAmount: Decimal;
  withholdingTaxAmount: Decimal;
  netPayableAmount: Decimal;
  notes: string;
}



/**
 * Applies tiered rates progressively: an amount of 1.5M against tiers
 * 0–1M @ 5% and 1M+ @ 8% yields 50,000 + 40,000 = 90,000 — not a flat 8%.
 */
function tieredAmount(amount: Decimal, tiers: CommissionTier[]): {
  total: Decimal;
  effectiveRate: Decimal;
  breakdown: string[];
} {
  const sorted = [...tiers].sort((a, b) => D(a.fromAmount).comparedTo(D(b.fromAmount)));
  let total = ZERO;
  const breakdown: string[] = [];

  for (const tier of sorted) {
    const from = D(tier.fromAmount);
    const to = tier.toAmount === null ? null : D(tier.toAmount);

    if (amount.lessThanOrEqualTo(from)) break;

    const upper = to === null ? amount : Decimal.min(amount, to);
    const slice = upper.minus(from);
    if (slice.lessThanOrEqualTo(ZERO)) continue;

    const portion = slice.times(D(tier.ratePercent)).dividedBy(HUNDRED);
    total = total.plus(portion);
    breakdown.push(
      `${slice.toFixed(2)} @ ${D(tier.ratePercent).toFixed(2)}% = ${portion.toFixed(2)}`,
    );
  }

  const effectiveRate = amount.isZero()
    ? ZERO
    : total.dividedBy(amount).times(HUNDRED);

  return { total, effectiveRate, breakdown };
}

/**
 * Works out what a single partner earns on a single triggering amount.
 * `grossAmount` is the full deal/invoice/payment value BEFORE the partner's
 * revenue share is applied.
 */
export function calculateCommission(input: {
  grossAmount: Decimal | number | string;
  revenueSharePercent: Decimal | number | string;
  basis: CommissionBasis;
  plan: PlanWithTiers | null;
  overridePercent?: Decimal | number | string | null;
  partnerDefaultPercent?: Decimal | number | string | null;
  withholdingTaxPercent?: Decimal | number | string | null;
}): CommissionCalculation {
  const gross = D(input.grossAmount);
  const share = D(input.revenueSharePercent);
  const basisAmount = gross.times(share).dividedBy(HUNDRED);

  const notes: string[] = [
    `Gross ${gross.toFixed(2)} x ${share.toFixed(2)}% share = basis ${basisAmount.toFixed(2)}`,
  ];

  // Deal too small to qualify.
  if (input.plan?.minimumDealAmount && gross.lessThan(D(input.plan.minimumDealAmount))) {
    return {
      basis: input.basis,
      basisAmount,
      ratePercent: null,
      commissionAmount: ZERO,
      withholdingTaxAmount: ZERO,
      netPayableAmount: ZERO,
      notes: `No commission: deal ${gross.toFixed(2)} is below the plan minimum ${D(input.plan.minimumDealAmount).toFixed(2)}.`,
    };
  }

  let ratePercent: Decimal | null = null;
  let commission: Decimal;

  if (input.overridePercent !== null && input.overridePercent !== undefined) {
    ratePercent = D(input.overridePercent);
    commission = basisAmount.times(ratePercent).dividedBy(HUNDRED);
    notes.push(`Deal-level override rate ${ratePercent.toFixed(2)}%`);
  } else if (input.plan) {
    switch (input.plan.rateType) {
      case "FIXED_AMOUNT": {
        commission = D(input.plan.fixedAmount ?? 0).times(share).dividedBy(HUNDRED);
        notes.push(`Fixed amount ${D(input.plan.fixedAmount ?? 0).toFixed(2)} x ${share.toFixed(2)}% share`);
        break;
      }
      case "TIERED_PERCENT": {
        const t = tieredAmount(basisAmount, input.plan.tiers);
        commission = t.total;
        ratePercent = t.effectiveRate;
        notes.push(`Tiered: ${t.breakdown.join(" + ") || "no tier matched"} (effective ${t.effectiveRate.toFixed(2)}%)`);
        break;
      }
      case "FLAT_PERCENT":
      default: {
        ratePercent = D(input.plan.flatPercent ?? 0);
        commission = basisAmount.times(ratePercent).dividedBy(HUNDRED);
        notes.push(`Plan "${input.plan.name}" flat rate ${ratePercent.toFixed(2)}%`);
        break;
      }
    }
  } else {
    ratePercent = D(input.partnerDefaultPercent ?? 0);
    commission = basisAmount.times(ratePercent).dividedBy(HUNDRED);
    notes.push(`Partner default rate ${ratePercent.toFixed(2)}% (no plan assigned)`);
  }

  // Cap.
  if (input.plan?.maximumPayout && commission.greaterThan(D(input.plan.maximumPayout))) {
    notes.push(`Capped from ${commission.toFixed(2)} to plan maximum ${D(input.plan.maximumPayout).toFixed(2)}`);
    commission = D(input.plan.maximumPayout);
  }

  commission = commission.toDecimalPlaces(2);

  const whtRate = D(input.withholdingTaxPercent ?? 0);
  const wht = commission.times(whtRate).dividedBy(HUNDRED).toDecimalPlaces(2);
  if (whtRate.greaterThan(ZERO)) {
    notes.push(`Withholding tax ${whtRate.toFixed(2)}% = ${wht.toFixed(2)}`);
  }

  return {
    basis: input.basis,
    basisAmount: basisAmount.toDecimalPlaces(2),
    ratePercent,
    commissionAmount: commission,
    withholdingTaxAmount: wht,
    netPayableAmount: commission.minus(wht).toDecimalPlaces(2),
    notes: notes.join("; "),
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

interface AccrualContext {
  opportunityId: string;
  /** Amount that triggered this accrual. */
  grossAmount: Decimal | number | string;
  currencyCode: string;
  earnedDate: Date;
  invoiceId?: string | null;
  paymentId?: string | null;
  /** Only accrue for partners whose plan uses this trigger. */
  trigger: "ON_CLOSE_WON" | "ON_INVOICE_SENT" | "ON_PAYMENT_RECEIVED";
  actorUserId: string;
}

/**
 * Core accrual. Creates one CommissionRecord per partner on the deal whose
 * plan trigger matches. Idempotent: the (opportunityPartner, invoice, payment)
 * unique index means re-running for the same triggering document is a no-op.
 */
export async function accrue(ctx: AccrualContext) {
  const db = await supabaseServer();

  const { data: opportunity } = await db
    .from("opportunity")
    .select(
      `id,
       partners:opportunity_partner (
         id, partnerId, revenueSharePercent, commissionPercentOverride,
         registeredAt, registrationExpiresAt, commissionPlanId,
         partner ( *, commissionPlan:commission_plan ( *, tiers:commission_tier ( * ) ) ),
         commissionPlan:commission_plan ( *, tiers:commission_tier ( * ) )
       )`,
    )
    .eq("id", ctx.opportunityId)
    .maybeSingle();

  if (!opportunity) throw new Error(`Opportunity ${ctx.opportunityId} not found.`);

  const links = (opportunity.partners ?? []) as Array<Record<string, unknown>>;
  if (links.length === 0) return [];

  const created: Array<{ id: string; commissionNumber: string }> = [];

  for (const link of links) {
    const partner = one(link.partner as never) as unknown as Record<string, unknown>;
    if (!partner) continue;

    // The plan snapshotted at deal registration wins over the partner's
    // current plan, so later plan edits never rewrite history.
    const linkPlan = one(link.commissionPlan as never) as PlanWithTiers | null;
    const partnerPlan = one(partner.commissionPlan as never) as PlanWithTiers | null;
    const plan = linkPlan ?? partnerPlan;

    const effectiveTrigger = plan?.trigger ?? "ON_PAYMENT_RECEIVED";
    if (effectiveTrigger !== ctx.trigger) continue;

    if (plan && !plan.active) continue;

    // Registration expiry — a lapsed claim earns nothing. Say so out loud:
    // commission that quietly fails to accrue is far harder to notice than
    // commission that accrues wrongly, and the partner will eventually ask.
    //
    // PostgREST returns dates as ISO strings, so parse before comparing —
    // a string/Date comparison is silently always false.
    const expiresAt = link.registrationExpiresAt
      ? new Date(link.registrationExpiresAt as string)
      : null;

    if (expiresAt && expiresAt < ctx.earnedDate) {
      await writeAudit(
        {
          entityType: "Opportunity",
          entityId: opportunity.id as string,
          fieldName: "commissionSkipped",
          oldValue: null,
          newValue:
            `${partner.displayName}: no commission - deal registration lapsed on ` +
            `${expiresAt.toISOString().slice(0, 10)}, before this was earned on ` +
            `${ctx.earnedDate.toISOString().slice(0, 10)}.`,
          changedById: ctx.actorUserId,
          source: "automation",
        },
        db,
      );
      continue;
    }

    // Same for a partnership that has gone inactive since registration.
    if (partner.status !== "ACTIVE") {
      await writeAudit(
        {
          entityType: "Opportunity",
          entityId: opportunity.id as string,
          fieldName: "commissionSkipped",
          oldValue: null,
          newValue: `${partner.displayName}: no commission - partnership is ${String(
            partner.status,
          ).toLowerCase()}.`,
          changedById: ctx.actorUserId,
          source: "automation",
        },
        db,
      );
      continue;
    }

    const calc = calculateCommission({
      grossAmount: ctx.grossAmount,
      revenueSharePercent: toDecimal(link.revenueSharePercent),
      basis: plan?.basis ?? "OPPORTUNITY_AMOUNT",
      plan: plan ?? null,
      overridePercent: link.commissionPercentOverride
        ? toDecimal(link.commissionPercentOverride)
        : null,
      partnerDefaultPercent: partner.defaultCommissionPercent
        ? toDecimal(partner.defaultCommissionPercent)
        : null,
      withholdingTaxPercent: partner.withholdingTaxPercent
        ? toDecimal(partner.withholdingTaxPercent)
        : null,
    });

    if (calc.commissionAmount.lessThanOrEqualTo(ZERO)) continue;

    // Number allocation, insert and audit in one transaction. Returns null when
    // a record already exists for this (link, invoice, payment) — the duplicate
    // guard that stops a retry double-paying the partner.
    const { data: record, error } = await db.rpc("accrue_commission", {
      p_partner_id: link.partnerId,
      p_opportunity_id: opportunity.id,
      p_opportunity_partner_id: link.id,
      p_plan_id: plan?.id ?? null,
      p_invoice_id: ctx.invoiceId ?? null,
      p_payment_id: ctx.paymentId ?? null,
      p_basis: calc.basis,
      p_basis_amount: calc.basisAmount.toFixed(2),
      p_rate_percent: calc.ratePercent ? calc.ratePercent.toFixed(4) : null,
      p_commission_amount: calc.commissionAmount.toFixed(2),
      p_withholding_amount: calc.withholdingTaxAmount.toFixed(2),
      p_net_payable: calc.netPayableAmount.toFixed(2),
      p_currency: ctx.currencyCode,
      p_earned_date: ctx.earnedDate.toISOString().slice(0, 10),
      p_payable_from: addDays(ctx.earnedDate, plan?.payoutDelayDays ?? 0)
        .toISOString()
        .slice(0, 10),
      p_notes: calc.notes,
      p_actor_id: ctx.actorUserId,
    });

    if (error) throw new Error(error.message);
    if (record) created.push(record as { id: string; commissionNumber: string });
  }

  return created;
}

/** Trigger: opportunity moved to CLOSED_WON. */
export async function accrueForWonOpportunity(opportunityId: string, actorUserId: string) {
  const db = await supabaseServer();

  const { data: opp, error } = await db
    .from("opportunity")
    .select("amount, currencyCode, actualCloseDate")
    .eq("id", opportunityId)
    .single();

  if (error || !opp) throw new Error(`Opportunity ${opportunityId} not found.`);

  return accrue({
    opportunityId,
    grossAmount: toDecimal(opp.amount),
    currencyCode: opp.currencyCode,
    earnedDate: opp.actualCloseDate ? new Date(opp.actualCloseDate) : new Date(),
    trigger: "ON_CLOSE_WON",
    actorUserId,
  });
}

/** Trigger: invoice sent to the customer. */
export async function accrueForInvoice(invoiceId: string, actorUserId: string) {
  const db = await supabaseServer();

  const { data: invoice, error } = await db
    .from("invoice")
    .select(
      `id, totalAmount, taxAmount, currencyCode, invoiceDate,
       project ( opportunityId ), contract ( opportunityId )`,
    )
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) throw new Error(`Invoice ${invoiceId} not found.`);

  const project = one(invoice.project as never) as { opportunityId?: string } | null;
  const contract = one(invoice.contract as never) as { opportunityId?: string } | null;
  const opportunityId = project?.opportunityId ?? contract?.opportunityId;
  if (!opportunityId) return [];

  return accrue({
    opportunityId,
    // Commission is earned on revenue, not on the tax you collect for the state.
    grossAmount: toDecimal(invoice.totalAmount).minus(toDecimal(invoice.taxAmount)),
    currencyCode: invoice.currencyCode,
    earnedDate: new Date(invoice.invoiceDate),
    invoiceId: invoice.id,
    trigger: "ON_INVOICE_SENT",
    actorUserId,
  });
}

/** Trigger: payment cleared. */
export async function accrueForPayment(paymentId: string, actorUserId: string) {
  const db = await supabaseServer();

  const { data: payment, error } = await db
    .from("payment")
    .select(
      `id, status, currencyCode, paymentDate,
       allocations:payment_allocation (
         allocatedAmount,
         invoice ( id, totalAmount, taxAmount,
           project ( opportunityId ), contract ( opportunityId ) )
       )`,
    )
    .eq("id", paymentId)
    .single();

  if (error || !payment) throw new Error(`Payment ${paymentId} not found.`);
  if (payment.status !== "CLEARED") return [];

  const results: Array<{ id: string; commissionNumber: string }> = [];

  for (const alloc of (payment.allocations ?? []) as Array<Record<string, unknown>>) {
    const inv = one(alloc.invoice as never) as Record<string, unknown> | null;
    if (!inv) continue;

    const project = one(inv.project as never) as { opportunityId?: string } | null;
    const contract = one(inv.contract as never) as { opportunityId?: string } | null;
    const opportunityId = project?.opportunityId ?? contract?.opportunityId;
    if (!opportunityId) continue;

    // Strip the tax portion from the allocated amount, pro rata.
    const total = toDecimal(inv.totalAmount);
    const netRatio = total.isZero()
      ? ZERO
      : total.minus(toDecimal(inv.taxAmount)).dividedBy(total);
    const netCollected = toDecimal(alloc.allocatedAmount).times(netRatio);

    const created = await accrue({
      opportunityId,
      grossAmount: netCollected,
      currencyCode: payment.currencyCode,
      earnedDate: new Date(payment.paymentDate),
      invoiceId: inv.id as string,
      paymentId: payment.id,
      trigger: "ON_PAYMENT_RECEIVED",
      actorUserId,
    });
    results.push(...created);
  }
  return results;
}

/**
 * Reverses a commission when the revenue behind it goes away.
 */
export async function clawback(
  commissionRecordId: string,
  reason: string,
  actorUserId: string,
) {
  const db = await supabaseServer();

  // Read, reverse, update and audit in one transaction — see
  // supabase/functions-sql/010_fn_clawback.sql. The window check and the "already clawed
  // back" guard live there too, so two concurrent clawbacks cannot both pass.
  const { data, error } = await db.rpc("claw_back_commission", {
    p_record_id: commissionRecordId,
    p_reason: reason,
    p_actor_id: actorUserId,
  });

  if (error) throw new Error(error.message);
  return data as string;
}
