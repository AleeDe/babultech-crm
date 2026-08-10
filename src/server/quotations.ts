"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Quotations (spec §10.2).
 *
 * A quote is a document you have sent a customer, so it is treated as
 * immutable once it leaves the building: editing a SENT quote is refused and
 * `reviseQuotation` supersedes it with a new version instead. That is also
 * what makes `quotation_one_accepted_per_opportunity` — the partial unique
 * index in prisma/sql — safe to rely on.
 *
 * Totals are always recomputed here from the lines. Nothing writes a total
 * directly, so the header can never disagree with the body.
 */

const EDITABLE = ["DRAFT", "UNDER_REVIEW", "APPROVED"] as const;

const lineSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  description: z.string().min(1, "Every line needs a description."),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
});

const quotationSchema = z.object({
  opportunityId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  quoteDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  currencyCode: z.string().length(3).default("PKR"),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "A quote needs at least one line."),
});

interface Totals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  lines: {
    lineTotal: Prisma.Decimal;
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number | null;
    taxRateId: string | null;
  }[];
}

/**
 * Money maths for a document. Discount comes off the line before tax, because
 * you do not charge sales tax on a discount you did not collect.
 */
async function computeTotals(
  tx: Prisma.TransactionClient,
  lines: z.infer<typeof lineSchema>[],
): Promise<Totals> {
  const taxRateIds = [...new Set(lines.map((l) => l.taxRateId).filter(Boolean))] as string[];
  const taxRates = taxRateIds.length
    ? await tx.taxRate.findMany({ where: { id: { in: taxRateIds } }, select: { id: true, ratePercent: true } })
    : [];
  const rateOf = (id: string | null | undefined) =>
    new Prisma.Decimal(taxRates.find((t) => t.id === id)?.ratePercent ?? 0);

  let subtotal = new Prisma.Decimal(0);
  let discountAmount = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);

  const computed = lines.map((line) => {
    const gross = new Prisma.Decimal(line.quantity).times(line.unitPrice);
    const discount = gross.times(line.discountPercent ?? 0).dividedBy(100);
    const net = gross.minus(discount).toDecimalPlaces(2);
    const tax = net.times(rateOf(line.taxRateId)).dividedBy(100).toDecimalPlaces(2);

    subtotal = subtotal.plus(gross);
    discountAmount = discountAmount.plus(discount);
    taxAmount = taxAmount.plus(tax);

    return {
      lineTotal: net,
      productId: line.productId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? null,
      taxRateId: line.taxRateId ?? null,
    };
  });

  subtotal = subtotal.toDecimalPlaces(2);
  discountAmount = discountAmount.toDecimalPlaces(2);
  taxAmount = taxAmount.toDecimalPlaces(2);

  return {
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: subtotal.minus(discountAmount).plus(taxAmount).toDecimalPlaces(2),
    lines: computed,
  };
}

export async function createQuotation(
  input: z.infer<typeof quotationSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);

  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.expiryDate < data.quoteDate) {
    return {
      ok: false,
      error: "A quote cannot expire before it is issued.",
      fieldErrors: { expiryDate: ["Must be on or after the quote date."] },
    };
  }

  try {
    const quote = await prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findUniqueOrThrow({
        where: { id: data.opportunityId },
        select: { accountId: true },
      });

      const last = await tx.quotation.findFirst({
        where: { opportunityId: data.opportunityId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      const totals = await computeTotals(tx, data.lines);

      return tx.quotation.create({
        data: {
          quoteNumber: await nextNumber(SEQUENCES.QUOTATION, tx),
          opportunityId: data.opportunityId,
          accountId: opportunity.accountId,
          contactId: data.contactId ?? null,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          status: "DRAFT",
          quoteDate: data.quoteDate,
          expiryDate: data.expiryDate,
          currencyCode: data.currencyCode,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          paymentTerms: data.paymentTerms ?? null,
          notes: data.notes ?? null,
          termsAndConditions: data.termsAndConditions ?? null,
          lines: {
            create: totals.lines.map((l, i) => ({ ...l, sortOrder: i })),
          },
        },
      });
    });

    revalidatePath("/quotations");
    revalidatePath(`/opportunities/${data.opportunityId}`);
    return { ok: true, data: { id: quote.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the quote." };
  }
}

export async function updateQuotation(
  id: string,
  input: z.infer<typeof quotationSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);

  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.quotation.findUniqueOrThrow({ where: { id } });

      if (!(EDITABLE as readonly string[]).includes(before.status)) {
        throw new Error(
          `${before.quoteNumber} is ${before.status.toLowerCase().replace("_", " ")} and the customer has seen it. Create a revision instead of editing it.`,
        );
      }

      const totals = await computeTotals(tx, data.lines);

      await tx.quoteLine.deleteMany({ where: { quotationId: id } });
      const after = await tx.quotation.update({
        where: { id },
        data: {
          contactId: data.contactId ?? null,
          quoteDate: data.quoteDate,
          expiryDate: data.expiryDate,
          currencyCode: data.currencyCode,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          paymentTerms: data.paymentTerms ?? null,
          notes: data.notes ?? null,
          termsAndConditions: data.termsAndConditions ?? null,
          lines: { create: totals.lines.map((l, i) => ({ ...l, sortOrder: i })) },
        },
      });

      await auditChanges(tx, {
        entityType: "Quotation",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the quote." };
  }
}

/**
 * Supersedes a sent quote with a fresh draft copy at the next version number.
 * The original is marked REVISED rather than edited, so the trail of what the
 * customer was actually shown survives.
 */
export async function reviseQuotation(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);

  try {
    const revision = await prisma.$transaction(async (tx) => {
      const original = await tx.quotation.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });

      if (original.status === "ACCEPTED") {
        throw new Error("An accepted quote cannot be revised — it is the basis of the deal.");
      }

      const last = await tx.quotation.findFirst({
        where: { opportunityId: original.opportunityId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      const copy = await tx.quotation.create({
        data: {
          quoteNumber: await nextNumber(SEQUENCES.QUOTATION, tx),
          opportunityId: original.opportunityId,
          accountId: original.accountId,
          contactId: original.contactId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          status: "DRAFT",
          quoteDate: new Date(),
          expiryDate: new Date(Date.now() + 30 * 86_400_000),
          currencyCode: original.currencyCode,
          subtotal: original.subtotal,
          discountAmount: original.discountAmount,
          taxAmount: original.taxAmount,
          totalAmount: original.totalAmount,
          paymentTerms: original.paymentTerms,
          notes: original.notes,
          termsAndConditions: original.termsAndConditions,
          lines: {
            create: original.lines.map((l, i) => ({
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent,
              taxRateId: l.taxRateId,
              lineTotal: l.lineTotal,
              sortOrder: i,
            })),
          },
        },
      });

      const after = await tx.quotation.update({ where: { id }, data: { status: "REVISED" } });
      await auditChanges(tx, {
        entityType: "Quotation",
        entityId: id,
        before: original,
        after,
        changedById: user.id,
      });

      return copy;
    });

    revalidatePath("/quotations");
    return { ok: true, data: { id: revision.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not revise the quote." };
  }
}

/** DRAFT/APPROVED → SENT. Also nudges the deal to Quote Submitted. */
export async function sendQuotation(id: string): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.quotation.findUniqueOrThrow({
        where: { id },
        include: { lines: { select: { id: true } } },
      });

      if (!(EDITABLE as readonly string[]).includes(before.status)) {
        throw new Error(`${before.quoteNumber} has already been sent.`);
      }
      if (before.lines.length === 0) {
        throw new Error("A quote with no lines cannot be sent.");
      }
      if (before.expiryDate < new Date()) {
        throw new Error("This quote's expiry date has already passed. Extend it before sending.");
      }

      const after = await tx.quotation.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
      });

      await auditChanges(tx, {
        entityType: "Quotation",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      const opp = await tx.opportunity.findUniqueOrThrow({
        where: { id: before.opportunityId },
        select: { stage: true },
      });
      const earlyStages = ["DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED"];
      if (earlyStages.includes(opp.stage)) {
        await tx.opportunity.update({
          where: { id: before.opportunityId },
          data: { stage: "QUOTE_SUBMITTED", probabilityPercent: 60 },
        });
      }
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/opportunities");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send the quote." };
  }
}

/**
 * Customer acceptance. This is the gate `changeStage` checks before a deal can
 * be marked Closed Won, so it is deliberately a separate, audited action.
 */
export async function decideQuotation(
  id: string,
  decision: "ACCEPTED" | "REJECTED",
): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.quotation.findUniqueOrThrow({ where: { id } });

      if (before.status !== "SENT") {
        throw new Error("Only a quote that has been sent to the customer can be accepted or rejected.");
      }

      if (decision === "ACCEPTED") {
        const alreadyAccepted = await tx.quotation.findFirst({
          where: { opportunityId: before.opportunityId, status: "ACCEPTED", deletedAt: null },
          select: { quoteNumber: true },
        });
        if (alreadyAccepted) {
          throw new Error(
            `${alreadyAccepted.quoteNumber} is already the accepted quote on this deal. Only one quote per opportunity can be accepted.`,
          );
        }
      }

      const after = await tx.quotation.update({
        where: { id },
        data: {
          status: decision,
          acceptedAt: decision === "ACCEPTED" ? new Date() : null,
        },
      });

      await auditChanges(tx, {
        entityType: "Quotation",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      // An accepted quote is the customer's commitment — reflect it on the deal.
      if (decision === "ACCEPTED") {
        await tx.opportunity.update({
          where: { id: before.opportunityId },
          data: {
            stage: "VERBAL_CONFIRMATION",
            probabilityPercent: 90,
            amount: before.totalAmount,
          },
        });
      }
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/opportunities");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the decision." };
  }
}

export async function getQuotation(id: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  return prisma.quotation.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true, opportunityNumber: true, accountId: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getQuotationFormOptions(opportunityId?: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const [opportunities, products, taxRates, currencies, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: {
        deletedAt: null,
        ...(opportunityId ? {} : { stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } }),
      },
      select: {
        id: true, opportunityNumber: true, name: true, accountId: true,
        currencyCode: true, account: { select: { name: true } },
        lines: {
          select: {
            productId: true, quantity: true, unitPrice: true,
            discountPercent: true, taxRateId: true,
            product: { select: { name: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { expectedCloseDate: "asc" },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, productCode: true, standardPrice: true, defaultTaxRateId: true },
      orderBy: { name: "asc" },
    }),
    prisma.taxRate.findMany({
      where: { active: true },
      select: { id: true, name: true, ratePercent: true },
      orderBy: { name: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.contact.findMany({
      where: { deletedAt: null, accountId: { not: null } },
      select: { id: true, firstName: true, lastName: true, accountId: true },
      orderBy: [{ lastName: "asc" }],
    }),
  ]);

  return { opportunities, products, taxRates, currencies, contacts };
}
