import { Prisma, type CommissionBasis, type CommissionPlan, type CommissionTier } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { writeAudit } from "@/lib/audit";

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

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v.toString());
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export interface CommissionCalculation {
  basis: CommissionBasis;
  basisAmount: Prisma.Decimal;
  ratePercent: Prisma.Decimal | null;
  commissionAmount: Prisma.Decimal;
  withholdingTaxAmount: Prisma.Decimal;
  netPayableAmount: Prisma.Decimal;
  notes: string;
}

type PlanWithTiers = CommissionPlan & { tiers: CommissionTier[] };

/**
 * Applies tiered rates progressively: an amount of 1.5M against tiers
 * 0–1M @ 5% and 1M+ @ 8% yields 50,000 + 40,000 = 90,000 — not a flat 8%.
 */
function tieredAmount(amount: Prisma.Decimal, tiers: CommissionTier[]): {
  total: Prisma.Decimal;
  effectiveRate: Prisma.Decimal;
  breakdown: string[];
} {
  const sorted = [...tiers].sort((a, b) => D(a.fromAmount).comparedTo(D(b.fromAmount)));
  let total = ZERO;
  const breakdown: string[] = [];

  for (const tier of sorted) {
    const from = D(tier.fromAmount);
    const to = tier.toAmount === null ? null : D(tier.toAmount);

    if (amount.lessThanOrEqualTo(from)) break;

    const upper = to === null ? amount : Prisma.Decimal.min(amount, to);
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
  grossAmount: Prisma.Decimal | number | string;
  revenueSharePercent: Prisma.Decimal | number | string;
  basis: CommissionBasis;
  plan: PlanWithTiers | null;
  overridePercent?: Prisma.Decimal | number | string | null;
  partnerDefaultPercent?: Prisma.Decimal | number | string | null;
  withholdingTaxPercent?: Prisma.Decimal | number | string | null;
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

  let ratePercent: Prisma.Decimal | null = null;
  let commission: Prisma.Decimal;

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
  grossAmount: Prisma.Decimal | number | string;
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
  return prisma.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.findUnique({
      where: { id: ctx.opportunityId },
      include: {
        partners: {
          include: {
            partner: { include: { commissionPlan: { include: { tiers: true } } } },
            commissionPlan: { include: { tiers: true } },
          },
        },
      },
    });

    if (!opportunity) throw new Error(`Opportunity ${ctx.opportunityId} not found.`);
    if (opportunity.partners.length === 0) return [];

    const created = [];

    for (const link of opportunity.partners) {
      // The plan snapshotted at deal registration wins over the partner's
      // current plan, so later plan edits never rewrite history.
      const plan = link.commissionPlan ?? link.partner.commissionPlan;

      const effectiveTrigger = plan?.trigger ?? "ON_PAYMENT_RECEIVED";
      if (effectiveTrigger !== ctx.trigger) continue;

      if (plan && !plan.active) continue;
      if (link.partner.status !== "ACTIVE") continue;

      // Registration expiry — a lapsed claim earns nothing.
      if (link.registrationExpiresAt && link.registrationExpiresAt < ctx.earnedDate) {
        continue;
      }

      const calc = calculateCommission({
        grossAmount: ctx.grossAmount,
        revenueSharePercent: link.revenueSharePercent,
        basis: plan?.basis ?? "OPPORTUNITY_AMOUNT",
        plan: plan ?? null,
        overridePercent: link.commissionPercentOverride,
        partnerDefaultPercent: link.partner.defaultCommissionPercent,
        withholdingTaxPercent: link.partner.withholdingTaxPercent,
      });

      if (calc.commissionAmount.lessThanOrEqualTo(ZERO)) continue;

      const existing = await tx.commissionRecord.findFirst({
        where: {
          opportunityPartnerId: link.id,
          invoiceId: ctx.invoiceId ?? null,
          paymentId: ctx.paymentId ?? null,
        },
      });
      if (existing) continue;

      const record = await tx.commissionRecord.create({
        data: {
          commissionNumber: await nextNumber(SEQUENCES.COMMISSION, tx),
          partnerId: link.partnerId,
          opportunityId: opportunity.id,
          opportunityPartnerId: link.id,
          planId: plan?.id ?? null,
          invoiceId: ctx.invoiceId ?? null,
          paymentId: ctx.paymentId ?? null,
          status: "ACCRUED",
          basis: calc.basis,
          basisAmount: calc.basisAmount,
          ratePercent: calc.ratePercent,
          commissionAmount: calc.commissionAmount,
          withholdingTaxAmount: calc.withholdingTaxAmount,
          netPayableAmount: calc.netPayableAmount,
          currencyCode: ctx.currencyCode,
          earnedDate: ctx.earnedDate,
          payableFromDate: addDays(ctx.earnedDate, plan?.payoutDelayDays ?? 0),
          calculationNotes: calc.notes,
        },
      });

      await writeAudit(tx, {
        entityType: "CommissionRecord",
        entityId: record.id,
        fieldName: "status",
        oldValue: null,
        newValue: "ACCRUED",
        changedById: ctx.actorUserId,
        source: "automation",
      });

      created.push(record);
    }

    return created;
  });
}

/** Trigger: opportunity moved to CLOSED_WON. */
export async function accrueForWonOpportunity(opportunityId: string, actorUserId: string) {
  const opp = await prisma.opportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: { amount: true, currencyCode: true, actualCloseDate: true },
  });
  return accrue({
    opportunityId,
    grossAmount: opp.amount,
    currencyCode: opp.currencyCode,
    earnedDate: opp.actualCloseDate ?? new Date(),
    trigger: "ON_CLOSE_WON",
    actorUserId,
  });
}

/** Trigger: invoice sent to the customer. */
export async function accrueForInvoice(invoiceId: string, actorUserId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { project: { select: { opportunityId: true } }, contract: { select: { opportunityId: true } } },
  });

  const opportunityId = invoice.project?.opportunityId ?? invoice.contract?.opportunityId;
  if (!opportunityId) return [];

  return accrue({
    opportunityId,
    // Commission is earned on revenue, not on the tax you collect for the state.
    grossAmount: new Prisma.Decimal(invoice.totalAmount).minus(invoice.taxAmount),
    currencyCode: invoice.currencyCode,
    earnedDate: invoice.invoiceDate,
    invoiceId: invoice.id,
    trigger: "ON_INVOICE_SENT",
    actorUserId,
  });
}

/**
 * Trigger: customer payment cleared. Accrues per allocated invoice so a
 * partial payment only earns partial commission.
 */
export async function accrueForPayment(paymentId: string, actorUserId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      allocations: {
        include: {
          invoice: {
            include: {
              project: { select: { opportunityId: true } },
              contract: { select: { opportunityId: true } },
            },
          },
        },
      },
    },
  });

  if (payment.status !== "CLEARED") return [];

  const results = [];
  for (const alloc of payment.allocations) {
    const inv = alloc.invoice;
    const opportunityId = inv.project?.opportunityId ?? inv.contract?.opportunityId;
    if (!opportunityId) continue;

    // Strip the tax portion from the allocated amount, pro rata.
    const total = new Prisma.Decimal(inv.totalAmount);
    const netRatio = total.isZero()
      ? ZERO
      : total.minus(inv.taxAmount).dividedBy(total);
    const netCollected = new Prisma.Decimal(alloc.allocatedAmount).times(netRatio);

    const created = await accrue({
      opportunityId,
      grossAmount: netCollected,
      currencyCode: payment.currencyCode,
      earnedDate: payment.paymentDate,
      invoiceId: inv.id,
      paymentId: payment.id,
      trigger: "ON_PAYMENT_RECEIVED",
      actorUserId,
    });
    results.push(...created);
  }
  return results;
}

/**
 * Reverses commission when a won deal is later lost, refunded, or the customer
 * churns inside the plan's clawback window. Creates an offsetting negative
 * record rather than deleting — the ledger stays immutable (spec §13 Audit).
 */
export async function clawback(
  commissionRecordId: string,
  reason: string,
  actorUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.commissionRecord.findUniqueOrThrow({
      where: { id: commissionRecordId },
      include: { plan: true },
    });

    if (original.status === "CLAWED_BACK") {
      throw new Error("This commission has already been clawed back.");
    }

    if (original.plan?.clawbackWindowDays) {
      const deadline = addDays(original.earnedDate, original.plan.clawbackWindowDays);
      if (new Date() > deadline) {
        throw new Error(
          `Clawback window closed on ${deadline.toISOString().slice(0, 10)} for ${original.commissionNumber}.`,
        );
      }
    }

    const reversal = await tx.commissionRecord.create({
      data: {
        commissionNumber: await nextNumber(SEQUENCES.COMMISSION, tx),
        partnerId: original.partnerId,
        opportunityId: original.opportunityId,
        opportunityPartnerId: original.opportunityPartnerId,
        planId: original.planId,
        status: "CLAWED_BACK",
        basis: original.basis,
        basisAmount: new Prisma.Decimal(original.basisAmount).negated(),
        ratePercent: original.ratePercent,
        commissionAmount: new Prisma.Decimal(original.commissionAmount).negated(),
        withholdingTaxAmount: new Prisma.Decimal(original.withholdingTaxAmount).negated(),
        netPayableAmount: new Prisma.Decimal(original.netPayableAmount).negated(),
        currencyCode: original.currencyCode,
        earnedDate: new Date(),
        reversesRecordId: original.id,
        calculationNotes: `Clawback of ${original.commissionNumber}: ${reason}`,
      },
    });

    await tx.commissionRecord.update({
      where: { id: original.id },
      data: { status: "CLAWED_BACK", rejectionReason: reason },
    });

    await writeAudit(tx, {
      entityType: "CommissionRecord",
      entityId: original.id,
      fieldName: "status",
      oldValue: original.status,
      newValue: "CLAWED_BACK",
      changedById: actorUserId,
      source: "UI",
    });

    return reversal;
  });
}
