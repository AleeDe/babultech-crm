"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { clawback } from "./commission-engine";
import type { ActionResult } from "./partners";

/**
 * Commission lifecycle actions: submit → approve → batch into a payout → pay.
 * The engine in commission-engine.ts creates the records; this file moves them
 * through the workflow and turns approved amounts into money out the door.
 */

const ZERO = new Prisma.Decimal(0);

export async function submitCommissionsForApproval(recordIds: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requirePermission(PERMISSIONS.COMMISSION_WRITE);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const records = await tx.commissionRecord.findMany({
        where: { id: { in: recordIds }, status: "ACCRUED", deletedAt: null },
      });

      if (records.length === 0) throw new Error("No accrued commissions were selected.");

      await tx.commissionRecord.updateMany({
        where: { id: { in: records.map((r) => r.id) } },
        data: { status: "PENDING_APPROVAL" },
      });

      await tx.auditHistory.createMany({
        data: records.map((r) => ({
          entityType: "CommissionRecord",
          entityId: r.id,
          fieldName: "status",
          oldValue: "ACCRUED",
          newValue: "PENDING_APPROVAL",
          changedById: user.id,
          source: "UI",
        })),
      });

      return records.length;
    });

    revalidatePath("/commissions");
    return { ok: true, data: { count: result } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit the commissions." };
  }
}

export async function approveCommissions(recordIds: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requirePermission(PERMISSIONS.COMMISSION_APPROVE);

  try {
    const count = await prisma.$transaction(async (tx) => {
      const records = await tx.commissionRecord.findMany({
        where: {
          id: { in: recordIds },
          status: { in: ["ACCRUED", "PENDING_APPROVAL"] },
          deletedAt: null,
        },
      });

      if (records.length === 0) throw new Error("No commissions awaiting approval were selected.");

      const now = new Date();
      for (const r of records) {
        // A record with a payout delay is approved but not yet payable.
        const payable = !r.payableFromDate || r.payableFromDate <= now;
        await tx.commissionRecord.update({
          where: { id: r.id },
          data: {
            status: payable ? "PAYABLE" : "APPROVED",
            approvedById: user.id,
            approvedAt: now,
            rejectionReason: null,
          },
        });
        await writeAudit(tx, {
          entityType: "CommissionRecord",
          entityId: r.id,
          fieldName: "status",
          oldValue: r.status,
          newValue: payable ? "PAYABLE" : "APPROVED",
          changedById: user.id,
        });
      }

      return records.length;
    });

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
  const user = await requirePermission(PERMISSIONS.COMMISSION_APPROVE);

  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  try {
    const count = await prisma.$transaction(async (tx) => {
      const records = await tx.commissionRecord.findMany({
        where: {
          id: { in: parsed.data.recordIds },
          status: { in: ["ACCRUED", "PENDING_APPROVAL", "APPROVED"] },
          deletedAt: null,
        },
      });

      await tx.commissionRecord.updateMany({
        where: { id: { in: records.map((r) => r.id) } },
        data: { status: "REJECTED", rejectionReason: parsed.data.reason },
      });

      await tx.auditHistory.createMany({
        data: records.map((r) => ({
          entityType: "CommissionRecord",
          entityId: r.id,
          fieldName: "status",
          oldValue: r.status,
          newValue: "REJECTED",
          changedById: user.id,
          source: "UI",
        })),
      });

      return records.length;
    });

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
  await requirePermission(PERMISSIONS.COMMISSION_WRITE);

  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const records = await tx.commissionRecord.findMany({
        where: {
          id: { in: data.recordIds },
          partnerId: data.partnerId,
          status: { in: ["APPROVED", "PAYABLE"] },
          payoutId: null,
          deletedAt: null,
        },
      });

      if (records.length === 0) {
        throw new Error("None of the selected commissions are approved and unpaid for this partner.");
      }
      if (records.length !== data.recordIds.length) {
        throw new Error(
          `${data.recordIds.length - records.length} of the selected commissions are not payable (wrong status, already in a payout, or belong to another partner).`,
        );
      }

      const currencies = new Set(records.map((r) => r.currencyCode));
      if (currencies.size > 1) {
        throw new Error(
          `Cannot batch commissions in ${[...currencies].join(" and ")} into one payout. Create a separate payout per currency.`,
        );
      }

      const gross = records.reduce((s, r) => s.plus(r.commissionAmount), ZERO);
      const wht = records.reduce((s, r) => s.plus(r.withholdingTaxAmount), ZERO);
      const net = records.reduce((s, r) => s.plus(r.netPayableAmount), ZERO);

      const created = await tx.commissionPayout.create({
        data: {
          payoutNumber: await nextNumber(SEQUENCES.PAYOUT, tx),
          partnerId: data.partnerId,
          status: "DRAFT",
          periodStart: data.periodStart ?? null,
          periodEnd: data.periodEnd ?? null,
          grossAmount: gross,
          withholdingTaxAmount: wht,
          netAmount: net,
          currencyCode: records[0].currencyCode,
          notes: data.notes ?? null,
        },
      });

      await tx.commissionRecord.updateMany({
        where: { id: { in: records.map((r) => r.id) } },
        data: { payoutId: created.id },
      });

      return created;
    });

    revalidatePath("/commissions");
    revalidatePath("/commissions/payouts");
    revalidatePath(`/partners/${data.partnerId}`);
    return { ok: true, data: { id: payout.id, payoutNumber: payout.payoutNumber } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the payout." };
  }
}

export async function approvePayout(payoutId: string): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.PAYOUT_APPROVE);

  try {
    await prisma.$transaction(async (tx) => {
      const payout = await tx.commissionPayout.findUniqueOrThrow({ where: { id: payoutId } });
      if (payout.status !== "DRAFT" && payout.status !== "PENDING_APPROVAL") {
        throw new Error(`Payout ${payout.payoutNumber} is ${payout.status.toLowerCase()} and cannot be approved.`);
      }

      await tx.commissionPayout.update({
        where: { id: payoutId },
        data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
      });

      await writeAudit(tx, {
        entityType: "CommissionPayout",
        entityId: payoutId,
        fieldName: "status",
        oldValue: payout.status,
        newValue: "APPROVED",
        changedById: user.id,
      });
    });

    revalidatePath("/commissions/payouts");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not approve the payout." };
  }
}

const markPaidSchema = z.object({
  payoutId: z.string().uuid(),
  paymentDate: z.coerce.date(),
  paymentMethod: z.enum(["BANK", "CHEQUE", "CASH", "CARD", "WALLET"]),
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
  const user = await requirePermission(PERMISSIONS.PAYOUT_APPROVE);

  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const payout = await tx.commissionPayout.findUniqueOrThrow({
        where: { id: data.payoutId },
        include: { partner: { select: { displayName: true } } },
      });

      if (payout.status !== "APPROVED") {
        throw new Error(`Payout ${payout.payoutNumber} must be approved before it can be paid.`);
      }

      await tx.commissionPayout.update({
        where: { id: data.payoutId },
        data: {
          status: "PAID",
          paymentDate: data.paymentDate,
          paymentMethod: data.paymentMethod,
          bankAccountId: data.bankAccountId ?? null,
          referenceNumber: data.referenceNumber ?? null,
        },
      });

      await tx.commissionRecord.updateMany({
        where: { payoutId: data.payoutId },
        data: { status: "PAID", paidAt: data.paymentDate },
      });

      await tx.financialTransaction.create({
        data: {
          transactionNumber: await nextNumber(SEQUENCES.TRANSACTION, tx),
          transactionDate: data.paymentDate,
          transactionType: "COMMISSION_PAYOUT",
          direction: "OUTGOING",
          amount: payout.netAmount,
          currencyCode: payout.currencyCode,
          bankAccountId: data.bankAccountId ?? null,
          sourceEntityType: "CommissionPayout",
          sourceEntityId: payout.id,
          status: "POSTED",
          reference: data.referenceNumber ?? payout.payoutNumber,
          description: `Partner commission payout ${payout.payoutNumber} to ${payout.partner.displayName}`,
        },
      });

      await writeAudit(tx, {
        entityType: "CommissionPayout",
        entityId: payout.id,
        fieldName: "status",
        oldValue: "APPROVED",
        newValue: "PAID",
        changedById: user.id,
      });
    });

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
  const user = await requirePermission(PERMISSIONS.COMMISSION_APPROVE);

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

  return prisma.commissionRecord.findMany({
    where: {
      deletedAt: null,
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(filters?.partnerId ? { partnerId: filters.partnerId } : {}),
      ...(filters?.from || filters?.to
        ? { earnedDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    },
    include: {
      partner: { select: { id: true, displayName: true, partnerNumber: true, kind: true } },
      opportunity: {
        select: {
          id: true, opportunityNumber: true, name: true, stage: true,
          account: { select: { name: true } },
        },
      },
      plan: { select: { name: true, basis: true, trigger: true } },
      invoice: { select: { invoiceNumber: true } },
      payout: { select: { id: true, payoutNumber: true, status: true } },
    },
    orderBy: [{ earnedDate: "desc" }, { createdAt: "desc" }],
  });
}

/** Totals by status, for the commissions dashboard tiles. */
export async function getCommissionTotals() {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const rows = await prisma.commissionRecord.groupBy({
    by: ["status", "currencyCode"],
    where: { deletedAt: null },
    _sum: { commissionAmount: true, netPayableAmount: true },
    _count: true,
  });

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

  return prisma.commissionPayout.findMany({
    where: {
      deletedAt: null,
      ...(status ? { status: status as never } : {}),
    },
    include: {
      partner: { select: { id: true, displayName: true, partnerNumber: true } },
      approvedBy: { select: { fullName: true } },
      bankAccount: { select: { name: true } },
      _count: { select: { records: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPayout(id: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  return prisma.commissionPayout.findUnique({
    where: { id },
    include: {
      partner: true,
      approvedBy: { select: { fullName: true } },
      bankAccount: true,
      records: {
        include: {
          opportunity: { select: { opportunityNumber: true, name: true, account: { select: { name: true } } } },
        },
        orderBy: { earnedDate: "asc" },
      },
    },
  });
}

/** Approved, unpaid commissions for one partner — the "ready to pay" queue. */
export async function getPayableCommissions(partnerId: string) {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  return prisma.commissionRecord.findMany({
    where: {
      partnerId,
      status: { in: ["APPROVED", "PAYABLE"] },
      payoutId: null,
      deletedAt: null,
    },
    include: {
      opportunity: { select: { opportunityNumber: true, name: true, account: { select: { name: true } } } },
    },
    orderBy: { earnedDate: "asc" },
  });
}

export async function listCommissionPlans() {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  return prisma.commissionPlan.findMany({
    where: { deletedAt: null },
    include: {
      tiers: { orderBy: { sortOrder: "asc" } },
      _count: { select: { partners: true, commissionRecords: true } },
    },
    orderBy: { name: "asc" },
  });
}
