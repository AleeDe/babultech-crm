import Decimal from "decimal.js";
import { supabaseServer } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Change history (spec §13 Audit: "Status, owner, amount, dates, approvals and
 * financial balances require change history"). One row per changed field.
 *
 * Most updates now go through `update_record` (prisma/rls/014_fn_generic_write.sql),
 * which does this diff inside the same transaction as the update — history can
 * never drift from the record. These helpers remain for the write paths that
 * record history without a matching row update (approvals, state machines).
 *
 * AUDITED_FIELDS is mirrored by audited_fields() in that SQL file. Keep both in
 * step: a field added here but not there is silently untracked on generic
 * updates.
 */

type Db = Pick<SupabaseClient, "from">;

export interface AuditEntry {
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedById: string | null;
  source?: string;
}

export async function writeAudit(entry: AuditEntry, client?: Db): Promise<void> {
  const db = client ?? (await supabaseServer());

  const { error } = await db.from("audit_history").insert({
    id: crypto.randomUUID(),
    entityType: entry.entityType,
    entityId: entry.entityId,
    fieldName: entry.fieldName,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    changedById: entry.changedById,
    source: entry.source ?? "UI",
    changedAt: new Date().toISOString(),
  });

  if (error) throw new Error(`Could not write audit history: ${error.message}`);
}

/** Change history for one record, newest first. */
export async function getAuditTrail(
  entityType: string,
  entityId: string,
  take = 50,
) {
  const db = await supabaseServer();

  const { data, error } = await db
    .from("audit_history")
    .select("*, changedBy:app_user ( fullName )")
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .order("changedAt", { ascending: false })
    .limit(take);

  if (error) throw new Error(`Could not load history: ${error.message}`);

  return (data ?? []).map((row) => ({
    ...row,
    changedBy: Array.isArray(row.changedBy) ? row.changedBy[0] : row.changedBy,
  }));
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
  if (value instanceof Decimal) return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Diffs before/after and writes one audit row per changed audited field.
 *
 * Prefer `update_record`, which is atomic with the update itself. Use this only
 * where the history is recorded separately from a row write.
 */
interface AuditChangeParams {
  entityType: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedById: string | null;
  source?: string;
}

export async function auditChanges(
  params: AuditChangeParams,
  client?: Db,
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

  const db = client ?? (await supabaseServer());

  const { error } = await db.from("audit_history").insert(
    entries.map((e) => ({
      id: crypto.randomUUID(),
      entityType: e.entityType,
      entityId: e.entityId,
      fieldName: e.fieldName,
      oldValue: e.oldValue,
      newValue: e.newValue,
      changedById: e.changedById,
      source: e.source ?? "UI",
      changedAt: new Date().toISOString(),
    })),
  );

  if (error) throw new Error(`Could not write audit history: ${error.message}`);
}
