import { supabaseServer } from "./supabase";

/**
 * The slice of a Prisma transaction client this needs. Structural, so it
 * accepts `Prisma.TransactionClient` without importing it — the goal is for
 * this file to stop depending on Prisma once every module is ported.
 */
interface PrismaLike {
  numberSequence: {
    findUnique(args: { where: { entityType: string } }): Promise<{
      prefix: string;
      paddingLength: number;
      includeYear: boolean;
    } | null>;
    update(args: {
      where: { entityType: string };
      data: { nextValue: { increment: number } };
    }): Promise<{ nextValue: number }>;
  };
}

/**
 * Human-readable record numbers (spec §1.1: "separate unique fields generated
 * by controlled sequences").
 *
 * The allocation itself lives in the database — `next_sequence_number()` in
 * prisma/rls/009_fn_numbering.sql — because it must happen in the same
 * transaction as the insert it numbers. Allocating here and inserting in a
 * separate HTTP call would burn a number whenever the insert failed.
 *
 * Prefer `createRecord(table, payload, { field, sequence })` from lib/db, which
 * does both in one call. Use this directly only when a number is needed without
 * an immediate insert.
 */
export async function nextNumber(
  entityType: string,
  tx?: PrismaLike,
): Promise<string> {
  // Modules still on Prisma pass their transaction client and must allocate
  // inside that transaction — see docs/SUPABASE-MIGRATION.md for which ones.
  if (tx) {
    const seq = await tx.numberSequence.findUnique({ where: { entityType } });
    if (!seq) {
      throw new Error(
        `No number sequence configured for "${entityType}". Add one in prisma/seed.ts.`,
      );
    }

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

  const db = await supabaseServer();

  const { data, error } = await db.rpc("next_sequence_number", {
    p_entity_type: entityType,
  });

  if (error) throw new Error(error.message);
  return data as string;
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
