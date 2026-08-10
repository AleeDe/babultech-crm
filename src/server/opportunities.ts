"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission, scopedContext } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import { accrueForWonOpportunity } from "./commission-engine";
import type { ActionResult } from "./partners";

/** Default win probability per stage. Users can still override it. */
const STAGE_PROBABILITY: Record<string, number> = {
  DISCOVERY: 10,
  QUALIFICATION: 20,
  REQUIREMENTS: 30,
  SOLUTION_PROPOSED: 45,
  QUOTE_SUBMITTED: 60,
  NEGOTIATION: 75,
  VERBAL_CONFIRMATION: 90,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
  ON_HOLD: 15,
};

const lineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
});

const opportunitySchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  primaryContactId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid(),
  campaignId: z.string().uuid().optional().nullable(),
  stage: z
    .enum([
      "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
      "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
      "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
    ])
    .default("DISCOVERY"),
  amount: z.coerce.number().min(0),
  currencyCode: z.string().length(3).default("PKR"),
  // Nullable, not just optional: z.coerce would turn a blank form field's null
  // into 0 and silently beat the stage default below.
  probabilityPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  expectedCloseDate: z.coerce.date(),
  opportunityType: z.enum(["NEW", "RENEWAL", "UPSELL", "CROSS_SELL"]).default("NEW"),
  leadSource: z.string().max(100).optional().nullable(),
  nextStep: z.string().max(500).optional().nullable(),
  description: z.string().optional().nullable(),
  lines: z.array(lineSchema).optional(),
});

function lineTotal(line: z.infer<typeof lineSchema>): Prisma.Decimal {
  const gross = new Prisma.Decimal(line.quantity).times(line.unitPrice);
  const discount = gross.times(line.discountPercent ?? 0).dividedBy(100);
  return gross.minus(discount).toDecimalPlaces(2);
}

export async function createOpportunity(
  input: z.infer<typeof opportunitySchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const opp = await prisma.$transaction(async (tx) => {
      const created = await tx.opportunity.create({
        data: {
          opportunityNumber: await nextNumber(SEQUENCES.OPPORTUNITY, tx),
          name: data.name,
          accountId: data.accountId,
          primaryContactId: data.primaryContactId ?? null,
          ownerUserId: data.ownerUserId,
          campaignId: data.campaignId ?? null,
          stage: data.stage,
          amount: data.amount,
          currencyCode: data.currencyCode,
          probabilityPercent: data.probabilityPercent ?? STAGE_PROBABILITY[data.stage] ?? 10,
          expectedCloseDate: data.expectedCloseDate,
          opportunityType: data.opportunityType,
          leadSource: data.leadSource ?? null,
          nextStep: data.nextStep ?? null,
          description: data.description ?? null,
        },
      });

      if (data.lines?.length) {
        await tx.opportunityProduct.createMany({
          data: data.lines.map((line, i) => ({
            opportunityId: created.id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent ?? null,
            taxRateId: line.taxRateId ?? null,
            lineTotal: lineTotal(line),
            sortOrder: i,
          })),
        });
      }

      return created;
    });

    revalidatePath("/opportunities");
    return { ok: true, data: { id: opp.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the opportunity." };
  }
}

/** Stage is deliberately absent — it moves only through `changeStage`, which
 *  carries the §13 gates and fires commission accrual. */
const opportunityUpdateSchema = opportunitySchema.omit({ stage: true });

export async function updateOpportunity(
  id: string,
  input: z.infer<typeof opportunityUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = opportunityUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { commissionRecords: true } } },
      });

      // Commission has already been calculated off this amount. Changing it
      // now would silently desync the ledger — clawback is the correct path.
      if (
        before._count.commissionRecords > 0 &&
        !new Prisma.Decimal(before.amount).equals(new Prisma.Decimal(data.amount))
      ) {
        throw new Error(
          "Commission has already accrued on this deal, so its amount is locked. Claw the commission back first if the value was wrong.",
        );
      }

      const after = await tx.opportunity.update({
        where: { id },
        data: {
          name: data.name,
          accountId: data.accountId,
          primaryContactId: data.primaryContactId ?? null,
          ownerUserId: data.ownerUserId,
          campaignId: data.campaignId ?? null,
          amount: data.amount,
          currencyCode: data.currencyCode,
          probabilityPercent: data.probabilityPercent ?? before.probabilityPercent,
          expectedCloseDate: data.expectedCloseDate,
          opportunityType: data.opportunityType,
          leadSource: data.leadSource ?? null,
          nextStep: data.nextStep ?? null,
          description: data.description ?? null,
        },
      });

      // Line items are replaced wholesale — simpler than diffing, and the
      // lines carry no downstream references of their own.
      await tx.opportunityProduct.deleteMany({ where: { opportunityId: id } });
      if (data.lines?.length) {
        await tx.opportunityProduct.createMany({
          data: data.lines.map((line, i) => ({
            opportunityId: id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent ?? null,
            taxRateId: line.taxRateId ?? null,
            lineTotal: lineTotal(line),
            sortOrder: i,
          })),
        });
      }

      await auditChanges(tx, {
        entityType: "Opportunity",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the opportunity." };
  }
}

const stageSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum([
    "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
    "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
    "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
  ]),
  lossReason: z.string().max(255).optional().nullable(),
  competitorName: z.string().max(200).optional().nullable(),
});

/**
 * Stage transitions carry the business rules from spec §13:
 *   - Closed Won needs an account, an amount, a close date and an accepted quote.
 *   - Closed Lost needs a loss reason.
 * Winning a deal is also what fires commission accrual for ON_CLOSE_WON plans.
 */
export async function changeStage(
  input: z.infer<typeof stageSchema>,
): Promise<ActionResult<{ commissionsCreated: number }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.opportunity.findUniqueOrThrow({
        where: { id: data.id },
        include: { quotations: { where: { status: "ACCEPTED" }, select: { id: true } } },
      });

      if (data.stage === "CLOSED_LOST" && !data.lossReason) {
        throw new Error("A loss reason is required to mark a deal Closed Lost.");
      }

      if (data.stage === "CLOSED_WON") {
        if (new Prisma.Decimal(before.amount).lessThanOrEqualTo(0)) {
          throw new Error("A won deal needs an amount greater than zero.");
        }
        if (before.quotations.length === 0) {
          throw new Error(
            "A won deal needs an accepted quotation. Accept the customer's quote first, or record an approved exception.",
          );
        }
      }

      const isClosing = data.stage === "CLOSED_WON" || data.stage === "CLOSED_LOST";

      const after = await tx.opportunity.update({
        where: { id: data.id },
        data: {
          stage: data.stage,
          probabilityPercent: STAGE_PROBABILITY[data.stage] ?? before.probabilityPercent,
          lossReason: data.stage === "CLOSED_LOST" ? data.lossReason : null,
          competitorName: data.competitorName ?? before.competitorName,
          actualCloseDate: isClosing ? new Date() : null,
        },
      });

      await auditChanges(tx, {
        entityType: "Opportunity",
        entityId: data.id,
        before,
        after,
        changedById: user.id,
      });
    });

    // Accrual runs in its own transaction so a commission-config problem can
    // never roll back a legitimate stage change.
    let commissionsCreated = 0;
    if (data.stage === "CLOSED_WON") {
      const records = await accrueForWonOpportunity(data.id, user.id);
      commissionsCreated = records.length;
    }

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${data.id}`);
    revalidatePath("/commissions");
    return { ok: true, data: { commissionsCreated } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change the stage." };
  }
}

export async function listOpportunities(filters?: { stage?: string; search?: string; ownerUserId?: string }) {
  const { where } = await scopedContext("ownerUserId");

  return prisma.opportunity.findMany({
    where: {
      deletedAt: null,
      ...where,
      ...(filters?.stage ? { stage: filters.stage as never } : {}),
      ...(filters?.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
      ...(filters?.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" as const } },
              { opportunityNumber: { contains: filters.search, mode: "insensitive" as const } },
              { account: { name: { contains: filters.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      owner: { select: { id: true, fullName: true } },
      primaryContact: { select: { firstName: true, lastName: true } },
      partners: { include: { partner: { select: { id: true, displayName: true, kind: true } } } },
      _count: { select: { quotations: true, commissionRecords: true } },
    },
    orderBy: { expectedCloseDate: "asc" },
  });
}

export async function getOpportunity(id: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  return prisma.opportunity.findUnique({
    where: { id },
    include: {
      account: true,
      primaryContact: true,
      owner: { select: { id: true, fullName: true, email: true } },
      campaign: { select: { id: true, name: true } },
      lines: { include: { product: true, taxRate: true }, orderBy: { sortOrder: "asc" } },
      quotations: { orderBy: { versionNumber: "desc" } },
      contracts: true,
      projects: { select: { id: true, projectNumber: true, name: true, status: true } },
      partners: {
        include: {
          partner: {
            select: {
              id: true, partnerNumber: true, displayName: true, kind: true,
              partnerType: true, defaultCommissionPercent: true,
              commissionPlan: { select: { name: true, flatPercent: true, rateType: true } },
            },
          },
        },
      },
      commissionRecords: {
        where: { deletedAt: null },
        include: { partner: { select: { id: true, displayName: true } } },
        orderBy: { earnedDate: "desc" },
      },
    },
  });
}

/** Pipeline grouped by stage, for the kanban board. */
export async function getPipelineByStage() {
  const { where } = await scopedContext("ownerUserId");

  const rows = await prisma.opportunity.groupBy({
    by: ["stage"],
    where: { deletedAt: null, ...where },
    _sum: { amount: true },
    _count: true,
  });

  return rows.map((r) => ({
    stage: r.stage,
    count: r._count,
    total: r._sum.amount ?? new Prisma.Decimal(0),
  }));
}
