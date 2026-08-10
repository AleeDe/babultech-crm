import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Change history (spec §13 Audit: "Status, owner, amount, dates, approvals and
 * financial balances require change history"). One row per changed field.
 */

export interface AuditEntry {
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedById: string | null;
  source?: string;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditHistory.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      fieldName: entry.fieldName,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      changedById: entry.changedById,
      source: entry.source ?? "UI",
    },
  });
}

/** Fields worth a history row. Everything else is noise. */
const AUDITED_FIELDS = new Set([
  "status",
  "stage",
  "priority",
  "amount",
  "totalAmount",
  "contractValue",
  "commissionAmount",
  "netPayableAmount",
  "ownerUserId",
  "assignedUserId",
  "projectManagerId",
  "approvalStatus",
  "expectedCloseDate",
  "dueDate",
  "startDate",
  "endDate",
  "paidAmount",
  "outstandingAmount",
  "accountType",
  "partnerType",
  "tier",
  "revenueSharePercent",
  "commissionPercentOverride",
]);

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Diffs before/after and writes one audit row per changed audited field.
 * Call it inside the same transaction as the update so history can never
 * drift from the record.
 */
export async function auditChanges(
  tx: Prisma.TransactionClient,
  params: {
    entityType: string;
    entityId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedById: string | null;
    source?: string;
  },
): Promise<void> {
  const entries: AuditEntry[] = [];

  for (const field of Object.keys(params.after)) {
    if (!AUDITED_FIELDS.has(field)) continue;

    const oldValue = stringify(params.before[field]);
    const newValue = stringify(params.after[field]);
    if (oldValue === newValue) continue;

    entries.push({
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: field,
      oldValue,
      newValue,
      changedById: params.changedById,
      source: params.source,
    });
  }

  if (entries.length === 0) return;

  await tx.auditHistory.createMany({
    data: entries.map((e) => ({ ...e, source: e.source ?? "UI" })),
  });
}

export async function getAuditTrail(entityType: string, entityId: string, take = 50) {
  return prisma.auditHistory.findMany({
    where: { entityType, entityId },
    include: { changedBy: { select: { fullName: true } } },
    orderBy: { changedAt: "desc" },
    take,
  });
}
