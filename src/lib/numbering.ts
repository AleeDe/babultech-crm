import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Human-readable record numbers (spec §1.1: "separate unique fields generated
 * by controlled sequences"). Uses a row lock so two concurrent creates can
 * never collide on the same number.
 */
export async function nextNumber(
  entityType: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const seq = await tx.numberSequence.findUnique({ where: { entityType } });
  if (!seq) {
    throw new Error(
      `No number sequence configured for "${entityType}". Add one in prisma/seed.ts.`,
    );
  }

  // Atomic increment — returns the row as it was AFTER the update.
  const updated = await tx.numberSequence.update({
    where: { entityType },
    data: { nextValue: { increment: 1 } },
  });

  const value = updated.nextValue - 1;
  const padded = String(value).padStart(seq.paddingLength, "0");
  const year = new Date().getFullYear();

  return seq.includeYear
    ? `${seq.prefix}-${year}-${padded}`
    : `${seq.prefix}-${padded}`;
}

export const SEQUENCES = {
  LEAD: "Lead",
  ACCOUNT: "Account",
  OPPORTUNITY: "Opportunity",
  QUOTATION: "Quotation",
  CONTRACT: "Contract",
  CASE: "Case",
  PROJECT: "Project",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  EXPENSE: "Expense",
  VENDOR_BILL: "VendorBill",
  VENDOR_PAYMENT: "VendorPayment",
  CAMPAIGN: "Campaign",
  ARTICLE: "KnowledgeArticle",
  CHANGE_REQUEST: "ChangeRequest",
  TRANSACTION: "FinancialTransaction",
  PARTNER: "Partner",
  COMMISSION: "CommissionRecord",
  PAYOUT: "CommissionPayout",
} as const;
