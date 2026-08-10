"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import { accrueForInvoice, accrueForPayment } from "./commission-engine";
import type { ActionResult } from "./partners";

/**
 * Billing: invoices, billing runs and cash application (spec §10.5, §11).
 *
 * Two balances are maintained by this module and never edited by hand:
 *   paidAmount        = sum of the invoice's payment allocations
 *   outstandingAmount = totalAmount - paidAmount - writeOffAmount
 *
 * `recalculateInvoice` is the single place either is written, so the AR ageing
 * view can be trusted. The database's `payment_allocation_check` trigger is the
 * backstop that stops allocations exceeding the payment.
 */

const ZERO = new Prisma.Decimal(0);
const EDITABLE_INVOICE = ["DRAFT", "APPROVED"] as const;

const lineSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  milestoneId: z.string().uuid().optional().nullable(),
  description: z.string().min(1, "Every line needs a description."),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
});

const invoiceSchema = z.object({
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  contractId: z.string().uuid().optional().nullable(),
  milestoneId: z.string().uuid().optional().nullable(),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currencyCode: z.string().length(3).default("PKR"),
  paymentTermsDays: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "An invoice needs at least one line."),
});

async function computeLines(tx: Prisma.TransactionClient, lines: z.infer<typeof lineSchema>[]) {
  const taxRateIds = [...new Set(lines.map((l) => l.taxRateId).filter(Boolean))] as string[];
  const taxRates = taxRateIds.length
    ? await tx.taxRate.findMany({ where: { id: { in: taxRateIds } }, select: { id: true, ratePercent: true } })
    : [];
  const rateOf = (id: string | null | undefined) =>
    new Prisma.Decimal(taxRates.find((t) => t.id === id)?.ratePercent ?? 0);

  let subtotal = ZERO;
  let discountAmount = ZERO;
  let taxAmount = ZERO;

  const computed = lines.map((line) => {
    const gross = new Prisma.Decimal(line.quantity).times(line.unitPrice);
    const discount = gross.times(line.discountPercent ?? 0).dividedBy(100);
    const net = gross.minus(discount).toDecimalPlaces(2);
    const tax = net.times(rateOf(line.taxRateId)).dividedBy(100).toDecimalPlaces(2);

    subtotal = subtotal.plus(gross);
    discountAmount = discountAmount.plus(discount);
    taxAmount = taxAmount.plus(tax);

    return {
      productId: line.productId ?? null,
      projectId: line.projectId ?? null,
      milestoneId: line.milestoneId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? null,
      taxRateId: line.taxRateId ?? null,
      lineTotal: net,
    };
  });

  subtotal = subtotal.toDecimalPlaces(2);
  discountAmount = discountAmount.toDecimalPlaces(2);
  taxAmount = taxAmount.toDecimalPlaces(2);

  return {
    lines: computed,
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: subtotal.minus(discountAmount).plus(taxAmount).toDecimalPlaces(2),
  };
}

/**
 * Recomputes paidAmount, outstandingAmount and status from the allocations.
 * Every mutation that can move an invoice's balance ends by calling this.
 */
async function recalculateInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { allocations: { include: { payment: { select: { status: true } } } } },
  });

  // Only cleared money counts. A cheque that has not cleared is not payment.
  const paid = invoice.allocations
    .filter((a) => a.payment.status === "CLEARED")
    .reduce((s, a) => s.plus(a.allocatedAmount), ZERO)
    .toDecimalPlaces(2);

  const total = new Prisma.Decimal(invoice.totalAmount);
  const writeOff = new Prisma.Decimal(invoice.writeOffAmount);
  const outstanding = total.minus(paid).minus(writeOff).toDecimalPlaces(2);

  let status = invoice.status;
  if (!["CANCELLED", "DRAFT", "APPROVED"].includes(invoice.status)) {
    if (writeOff.greaterThan(0) && outstanding.lessThanOrEqualTo(0.005)) status = "WRITTEN_OFF";
    else if (outstanding.lessThanOrEqualTo(0.005)) status = "PAID";
    else if (paid.greaterThan(0)) status = "PARTIALLY_PAID";
    else if (invoice.dueDate < new Date()) status = "OVERDUE";
    else status = "SENT";
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount: paid, outstandingAmount: outstanding, status },
  });

  return { paid, outstanding, status };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export async function createInvoice(
  input: z.infer<typeof invoiceSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.INVOICE_WRITE);

  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.dueDate < data.invoiceDate) {
    return {
      ok: false,
      error: "An invoice cannot fall due before it is issued.",
      fieldErrors: { dueDate: ["Must be on or after the invoice date."] },
    };
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const totals = await computeLines(tx, data.lines);

      return tx.invoice.create({
        data: {
          invoiceNumber: await nextNumber(SEQUENCES.INVOICE, tx),
          accountId: data.accountId,
          contactId: data.contactId ?? null,
          projectId: data.projectId ?? null,
          contractId: data.contractId ?? null,
          milestoneId: data.milestoneId ?? null,
          invoiceDate: data.invoiceDate,
          dueDate: data.dueDate,
          status: "DRAFT",
          currencyCode: data.currencyCode,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          paidAmount: ZERO,
          outstandingAmount: totals.totalAmount,
          paymentTermsDays: data.paymentTermsDays ?? null,
          notes: data.notes ?? null,
          lines: { create: totals.lines.map((l, i) => ({ ...l, sortOrder: i })) },
        },
      });
    });

    revalidatePath("/invoices");
    return { ok: true, data: { id: invoice.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the invoice." };
  }
}

export async function updateInvoice(
  id: string,
  input: z.infer<typeof invoiceSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requirePermission(PERMISSIONS.INVOICE_WRITE);

  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.invoice.findUniqueOrThrow({ where: { id } });

      if (!(EDITABLE_INVOICE as readonly string[]).includes(before.status)) {
        throw new Error(
          `${before.invoiceNumber} has been sent to the customer. Issue a credit note or write it off — a sent invoice is not editable.`,
        );
      }

      const totals = await computeLines(tx, data.lines);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });

      const after = await tx.invoice.update({
        where: { id },
        data: {
          contactId: data.contactId ?? null,
          projectId: data.projectId ?? null,
          contractId: data.contractId ?? null,
          milestoneId: data.milestoneId ?? null,
          invoiceDate: data.invoiceDate,
          dueDate: data.dueDate,
          currencyCode: data.currencyCode,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          outstandingAmount: totals.totalAmount.minus(before.paidAmount).minus(before.writeOffAmount),
          paymentTermsDays: data.paymentTermsDays ?? null,
          notes: data.notes ?? null,
          lines: { create: totals.lines.map((l, i) => ({ ...l, sortOrder: i })) },
        },
      });

      await auditChanges(tx, {
        entityType: "Invoice",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the invoice." };
  }
}

/**
 * Issues the invoice. Also stamps the milestone as invoiced so a milestone can
 * never be billed twice (spec §13), and fires ON_INVOICE_SENT commission.
 */
export async function sendInvoice(id: string): Promise<ActionResult<{ commissionsCreated: number }>> {
  const user = await requirePermission(PERMISSIONS.INVOICE_APPROVE);

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { lines: { select: { id: true } }, milestone: true },
      });

      if (!(EDITABLE_INVOICE as readonly string[]).includes(before.status)) {
        throw new Error(`${before.invoiceNumber} has already been issued.`);
      }
      if (before.lines.length === 0) {
        throw new Error("An invoice with no lines cannot be sent.");
      }
      if (before.milestone?.invoicedAt) {
        throw new Error(
          `Milestone "${before.milestone.name}" was already invoiced on ${before.milestone.invoicedAt.toLocaleDateString("en-GB")}.`,
        );
      }

      const after = await tx.invoice.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
      });

      if (before.milestoneId) {
        await tx.milestone.update({
          where: { id: before.milestoneId },
          data: { invoicedAt: new Date() },
        });
      }

      await auditChanges(tx, {
        entityType: "Invoice",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    // Accrual runs outside the transaction so a commission-config problem can
    // never roll back a legitimate invoice being issued.
    const records = await accrueForInvoice(id, user.id);

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/commissions");
    return { ok: true, data: { commissionsCreated: records.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send the invoice." };
  }
}

export async function writeOffInvoice(id: string, amount: number, reason: string): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.INVOICE_APPROVE);

  if (!reason.trim()) return { ok: false, error: "A write-off needs a reason." };
  if (!(amount > 0)) return { ok: false, error: "Enter the amount being written off." };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.invoice.findUniqueOrThrow({ where: { id } });
      const writeOff = new Prisma.Decimal(amount);

      if (writeOff.greaterThan(new Prisma.Decimal(before.outstandingAmount).plus(0.005))) {
        throw new Error(
          `You cannot write off more than the ${before.outstandingAmount} still outstanding.`,
        );
      }

      const after = await tx.invoice.update({
        where: { id },
        data: {
          writeOffAmount: new Prisma.Decimal(before.writeOffAmount).plus(writeOff),
          notes: `${before.notes ?? ""}\n\n[Written off ${writeOff.toString()} by ${user.fullName}: ${reason.trim()}]`.trim(),
        },
      });

      await auditChanges(tx, {
        entityType: "Invoice",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      await recalculateInvoice(tx, id);
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not write the invoice off." };
  }
}

/**
 * Milestone billing run. Finds every completed, billing-triggering milestone
 * that has not yet been invoiced and raises a draft invoice for each.
 */
export async function runMilestoneBilling(
  projectId?: string,
): Promise<ActionResult<{ created: number; skipped: string[] }>> {
  await requirePermission(PERMISSIONS.INVOICE_WRITE);

  try {
    const due = await prisma.milestone.findMany({
      where: {
        billingTrigger: true,
        status: "COMPLETED",
        // `invoicedAt` is only stamped when an invoice is *issued*, so on its
        // own it would let a second run raise a duplicate draft for the same
        // milestone. Excluding milestones that already carry a live invoice
        // makes the run safe to re-run.
        invoicedAt: null,
        invoices: { none: { deletedAt: null, status: { not: "CANCELLED" } } },
        ...(projectId ? { projectId } : {}),
        project: { deletedAt: null },
      },
      include: {
        project: {
          select: {
            id: true, name: true, accountId: true, contractId: true,
            contractValue: true, currencyCode: true,
          },
        },
      },
    });

    const skipped: string[] = [];
    let created = 0;

    for (const milestone of due) {
      const contractValue = new Prisma.Decimal(milestone.project.contractValue ?? 0);
      const amount = milestone.billingAmount
        ? new Prisma.Decimal(milestone.billingAmount)
        : contractValue.times(milestone.billingPercent ?? 0).dividedBy(100);

      if (amount.lessThanOrEqualTo(0)) {
        skipped.push(`${milestone.name} — no billable amount could be worked out`);
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.invoice.create({
          data: {
            invoiceNumber: await nextNumber(SEQUENCES.INVOICE, tx),
            accountId: milestone.project.accountId,
            projectId: milestone.project.id,
            contractId: milestone.project.contractId,
            milestoneId: milestone.id,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 86_400_000),
            status: "DRAFT",
            currencyCode: milestone.project.currencyCode,
            subtotal: amount,
            discountAmount: ZERO,
            taxAmount: ZERO,
            totalAmount: amount,
            paidAmount: ZERO,
            outstandingAmount: amount,
            paymentTermsDays: 30,
            notes: `Milestone billing — ${milestone.name} (${milestone.project.name}).`,
            lines: {
              create: [{
                description: `${milestone.project.name} — ${milestone.name}`,
                projectId: milestone.project.id,
                milestoneId: milestone.id,
                quantity: 1,
                unitPrice: amount,
                lineTotal: amount,
                sortOrder: 0,
              }],
            },
          },
        });
      });
      created += 1;
    }

    revalidatePath("/invoices");
    return { ok: true, data: { created, skipped } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The billing run failed." };
  }
}

/**
 * Time-and-materials billing run: turns approved, billable, un-invoiced time
 * into invoice lines grouped by person and rate.
 */
export async function runTimeBilling(
  projectId: string,
): Promise<ActionResult<{ id: string; hours: number } | null>> {
  await requirePermission(PERMISSIONS.INVOICE_WRITE);

  try {
    const logs = await prisma.timeLog.findMany({
      where: {
        projectId,
        approvalStatus: "APPROVED",
        billable: true,
        invoiceLineId: null,
        billingRate: { not: null },
      },
      include: { user: { select: { id: true, fullName: true } } },
    });

    if (logs.length === 0) {
      return { ok: false, error: "No approved, billable, un-invoiced time on this project." };
    }

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, accountId: true, contractId: true, currencyCode: true },
    });

    // One line per person per rate — the way a T&M invoice actually reads.
    const groups = new Map<string, { name: string; rate: Prisma.Decimal; hours: Prisma.Decimal; ids: string[] }>();
    for (const log of logs) {
      const rate = new Prisma.Decimal(log.billingRate!);
      const key = `${log.userId}:${rate.toString()}`;
      const group = groups.get(key) ?? { name: log.user.fullName, rate, hours: ZERO, ids: [] };
      group.hours = group.hours.plus(log.hours);
      group.ids.push(log.id);
      groups.set(key, group);
    }

    const invoice = await prisma.$transaction(async (tx) => {
      let subtotal = ZERO;
      const lines = [...groups.values()].map((g, i) => {
        const lineTotal = g.hours.times(g.rate).toDecimalPlaces(2);
        subtotal = subtotal.plus(lineTotal);
        return {
          description: `${g.name} — ${g.hours.toString()} hours @ ${g.rate.toString()}`,
          projectId: project.id,
          quantity: g.hours,
          unitPrice: g.rate,
          lineTotal,
          sortOrder: i,
        };
      });

      const created = await tx.invoice.create({
        data: {
          invoiceNumber: await nextNumber(SEQUENCES.INVOICE, tx),
          accountId: project.accountId,
          projectId: project.id,
          contractId: project.contractId,
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          status: "DRAFT",
          currencyCode: project.currencyCode,
          subtotal,
          discountAmount: ZERO,
          taxAmount: ZERO,
          totalAmount: subtotal,
          paidAmount: ZERO,
          outstandingAmount: subtotal,
          paymentTermsDays: 30,
          notes: `Time and materials — ${project.name}.`,
          lines: { create: lines },
        },
        include: { lines: true },
      });

      // Stamp the time so the next run cannot bill it again.
      const sorted = [...groups.values()];
      for (let i = 0; i < sorted.length; i += 1) {
        await tx.timeLog.updateMany({
          where: { id: { in: sorted[i].ids } },
          data: { invoiceLineId: created.lines[i].id },
        });
      }

      return created;
    });

    revalidatePath("/invoices");
    revalidatePath(`/projects/${projectId}`);
    const hours = logs.reduce((s, l) => s + Number(l.hours), 0);
    return { ok: true, data: { id: invoice.id, hours } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The billing run failed." };
  }
}

// ---------------------------------------------------------------------------
// Payments and cash application
// ---------------------------------------------------------------------------

const paymentSchema = z.object({
  accountId: z.string().uuid(),
  paymentDate: z.coerce.date(),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().length(3).default("PKR"),
  paymentMethod: z.enum(["BANK", "CHEQUE", "CASH", "CARD", "WALLET"]),
  referenceNumber: z.string().max(100).optional().nullable(),
  status: z.enum(["PENDING", "CLEARED"]).default("CLEARED"),
  notes: z.string().optional().nullable(),
  /** Optional same-transaction application against specific invoices. */
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount: z.coerce.number().positive() }))
    .optional(),
});

export async function recordPayment(
  input: z.infer<typeof paymentSchema>,
): Promise<ActionResult<{ id: string; commissionsCreated: number }>> {
  const user = await requirePermission(PERMISSIONS.PAYMENT_WRITE);

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const allocations = data.allocations ?? [];
  const allocatedTotal = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocatedTotal > data.amount + 0.005) {
    return {
      ok: false,
      error: `You have applied ${allocatedTotal} against a payment of ${data.amount}.`,
    };
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNumber: await nextNumber(SEQUENCES.PAYMENT, tx),
          accountId: data.accountId,
          paymentDate: data.paymentDate,
          amount: data.amount,
          unallocatedAmount: new Prisma.Decimal(data.amount).minus(allocatedTotal),
          currencyCode: data.currencyCode,
          paymentMethod: data.paymentMethod,
          referenceNumber: data.referenceNumber ?? null,
          status: data.status,
          clearedAt: data.status === "CLEARED" ? new Date() : null,
          notes: data.notes ?? null,
        },
      });

      for (const alloc of allocations) {
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: alloc.invoiceId },
          select: { accountId: true, currencyCode: true, outstandingAmount: true, invoiceNumber: true, status: true },
        });

        if (invoice.accountId !== data.accountId) {
          throw new Error(`${invoice.invoiceNumber} belongs to a different customer.`);
        }
        if (invoice.currencyCode !== data.currencyCode) {
          throw new Error(
            `${invoice.invoiceNumber} is in ${invoice.currencyCode} but the payment is in ${data.currencyCode}. Cross-currency application is not supported.`,
          );
        }
        if (["DRAFT", "CANCELLED"].includes(invoice.status)) {
          throw new Error(`${invoice.invoiceNumber} has not been issued yet.`);
        }
        if (new Prisma.Decimal(alloc.amount).greaterThan(new Prisma.Decimal(invoice.outstandingAmount).plus(0.005))) {
          throw new Error(
            `Applying ${alloc.amount} to ${invoice.invoiceNumber} would overpay it — only ${invoice.outstandingAmount} is outstanding.`,
          );
        }

        await tx.paymentAllocation.create({
          data: {
            paymentId: created.id,
            invoiceId: alloc.invoiceId,
            allocatedAmount: alloc.amount,
            allocatedById: user.id,
          },
        });

        await recalculateInvoice(tx, alloc.invoiceId);
      }

      return created;
    });

    // Collected cash is what most commission plans actually pay on.
    const records = data.status === "CLEARED" ? await accrueForPayment(payment.id, user.id) : [];

    revalidatePath("/invoices");
    revalidatePath("/payments");
    revalidatePath("/commissions");
    return { ok: true, data: { id: payment.id, commissionsCreated: records.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the payment." };
  }
}

/** Applies unallocated cash from an existing payment against an invoice. */
export async function allocatePayment(
  paymentId: string,
  invoiceId: string,
  amount: number,
): Promise<ActionResult<{ commissionsCreated: number }>> {
  const user = await requirePermission(PERMISSIONS.PAYMENT_WRITE);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount to apply." };

  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { allocations: true },
      });
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { accountId: true, currencyCode: true, outstandingAmount: true, invoiceNumber: true, status: true },
      });

      if (invoice.accountId !== payment.accountId) throw new Error("That invoice belongs to a different customer.");
      if (invoice.currencyCode !== payment.currencyCode) {
        throw new Error("The invoice and the payment are in different currencies.");
      }
      if (["DRAFT", "CANCELLED"].includes(invoice.status)) {
        throw new Error(`${invoice.invoiceNumber} has not been issued yet.`);
      }

      const alreadyAllocated = payment.allocations.reduce((s, a) => s.plus(a.allocatedAmount), ZERO);
      const unallocated = new Prisma.Decimal(payment.amount).minus(alreadyAllocated);
      if (new Prisma.Decimal(amount).greaterThan(unallocated.plus(0.005))) {
        throw new Error(`Only ${unallocated.toString()} of this payment is still unapplied.`);
      }
      if (new Prisma.Decimal(amount).greaterThan(new Prisma.Decimal(invoice.outstandingAmount).plus(0.005))) {
        throw new Error(`That would overpay ${invoice.invoiceNumber}.`);
      }

      const existing = payment.allocations.find((a) => a.invoiceId === invoiceId);
      if (existing) {
        await tx.paymentAllocation.update({
          where: { id: existing.id },
          data: { allocatedAmount: new Prisma.Decimal(existing.allocatedAmount).plus(amount) },
        });
      } else {
        await tx.paymentAllocation.create({
          data: { paymentId, invoiceId, allocatedAmount: amount, allocatedById: user.id },
        });
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: { unallocatedAmount: unallocated.minus(amount) },
      });

      await recalculateInvoice(tx, invoiceId);
    });

    const records = await accrueForPayment(paymentId, user.id);

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/payments");
    revalidatePath("/commissions");
    return { ok: true, data: { commissionsCreated: records.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not apply the payment." };
  }
}

export async function listPayments(filters?: { accountId?: string; unappliedOnly?: boolean }) {
  await requirePermission(PERMISSIONS.INVOICE_READ);

  return prisma.payment.findMany({
    where: {
      deletedAt: null,
      ...(filters?.accountId ? { accountId: filters.accountId } : {}),
      ...(filters?.unappliedOnly ? { unallocatedAmount: { gt: 0 } } : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
    },
    orderBy: { paymentDate: "desc" },
  });
}

export async function getInvoice(id: string) {
  await requirePermission(PERMISSIONS.INVOICE_READ);

  return prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

/** Open invoices for a customer, for the cash-application screen. */
export async function getOpenInvoices(accountId: string) {
  await requirePermission(PERMISSIONS.INVOICE_READ);

  return prisma.invoice.findMany({
    where: {
      accountId,
      deletedAt: null,
      status: { notIn: ["DRAFT", "CANCELLED", "PAID", "WRITTEN_OFF"] },
      outstandingAmount: { gt: 0 },
    },
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
      totalAmount: true, outstandingAmount: true, currencyCode: true, status: true,
    },
    orderBy: { dueDate: "asc" },
  });
}

export async function getBillingFormOptions() {
  await requirePermission(PERMISSIONS.INVOICE_READ);

  const [accounts, contacts, projects, contracts, products, taxRates, currencies] = await Promise.all([
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null, accountId: { not: null } },
      select: { id: true, firstName: true, lastName: true, accountId: true },
      orderBy: [{ lastName: "asc" }],
    }),
    prisma.project.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, projectNumber: true, accountId: true, contractId: true,
        milestones: {
          where: { billingTrigger: true },
          select: { id: true, name: true, invoicedAt: true, status: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.contract.findMany({
      where: { deletedAt: null },
      select: { id: true, contractNumber: true, name: true, accountId: true },
      orderBy: { contractNumber: "asc" },
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
  ]);

  return { accounts, contacts, projects, contracts, products, taxRates, currencies };
}
