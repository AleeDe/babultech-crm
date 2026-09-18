"use server";

import { revalidatePath } from "next/cache";
import { authorize, requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { SEQUENCES } from "@/lib/numbering";
import {
  periodsDue, periodAmount, periodLabel, isRecurring,
  periodLockSchema, closableMonths, monthStart,
} from "@/lib/recurring-billing";
import type { ActionResult } from "./partners";

const PAYMENT_TERMS_DAYS = 30;

type ContractRow = {
  id: string; contractNumber: string; name: string; accountId: string;
  startDate: string; endDate: string; contractValue: number;
  currencyCode: string; billingFrequency: string | null;
  invoices: { periodStart: string | null; status: string; deletedAt: string | null }[];
};

/**
 * Recurring billing run. Raises one draft invoice for each contract period that
 * has started and has not been billed yet.
 *
 * Safe to re-run: the period is recorded on the invoice and a unique index
 * refuses a second live invoice for the same contract period, so a run that is
 * started twice cannot bill a customer twice even if two people click at once.
 */
export async function runRecurringBilling(
  contractId?: string,
): Promise<ActionResult<{ created: number; skipped: string[] }>> {
  const _auth = await authorize(PERMISSIONS.INVOICE_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  try {
    const db = await supabaseServer();
    const today = new Date().toISOString().slice(0, 10);

    let query = db
      .from("contract")
      .select(
        `id, contractNumber, name, accountId, startDate, endDate, contractValue,
         currencyCode, billingFrequency,
         invoices:invoice ( periodStart, status, deletedAt )`,
      )
      .eq("status", "ACTIVE")
      .is("deletedAt", null)
      .in("billingFrequency", ["MONTHLY", "QUARTERLY", "ANNUAL"]);

    if (contractId) query = query.eq("id", contractId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const skipped: string[] = [];
    let created = 0;

    for (const contract of (data ?? []) as ContractRow[]) {
      if (!isRecurring(contract.billingFrequency)) continue;

      const amount = periodAmount({
        startDate: contract.startDate,
        endDate: contract.endDate,
        billingFrequency: contract.billingFrequency,
        contractValue: Number(contract.contractValue ?? 0),
      });

      if (amount == null || amount <= 0) {
        skipped.push(`${contract.contractNumber} - no period amount could be worked out`);
        continue;
      }

      // Periods already covered by a live invoice. A cancelled one frees its
      // period, which is the reason someone cancels a draft.
      const billed = new Set(
        (contract.invoices ?? [])
          .filter((i) => !i.deletedAt && i.status !== "CANCELLED" && i.periodStart)
          .map((i) => i.periodStart as string),
      );

      const due = periodsDue(contract, today).filter((p) => !billed.has(p.start));

      for (const period of due) {
        const description = `${contract.name}, ${periodLabel(period)}`;
        const { error: createError } = await db.rpc("create_with_lines", {
          p_table: "invoice",
          p_payload: {
            accountId: contract.accountId,
            contractId: contract.id,
            invoiceDate: today,
            dueDate: new Date(Date.now() + PAYMENT_TERMS_DAYS * 86_400_000).toISOString().slice(0, 10),
            status: "DRAFT",
            currencyCode: contract.currencyCode,
            subtotal: amount.toFixed(2),
            discountAmount: "0.00",
            taxAmount: "0.00",
            totalAmount: amount.toFixed(2),
            paidAmount: "0.00",
            outstandingAmount: amount.toFixed(2),
            paymentTermsDays: PAYMENT_TERMS_DAYS,
            periodStart: period.start,
            periodEnd: period.end,
            notes: `Recurring billing, ${contract.contractNumber} (${periodLabel(period)}).`,
          },
          p_line_table: "invoice_line",
          p_lines: [
            {
              description,
              quantity: 1,
              unitPrice: amount.toFixed(2),
              lineTotal: amount.toFixed(2),
            },
          ],
          p_parent_field: "invoiceId",
          p_number_field: "invoiceNumber",
          p_sequence: SEQUENCES.INVOICE,
        });

        if (createError) {
          // A concurrent run got there first, or the month is closed. Neither
          // is a reason to abandon the remaining contracts.
          const message = createError.message ?? "";
          if (message.includes("invoice_contract_period")) {
            skipped.push(`${contract.contractNumber} ${periodLabel(period)} - already billed`);
          } else if (message.includes("month is closed")) {
            skipped.push(`${contract.contractNumber} ${periodLabel(period)} - that month is closed`);
          } else {
            skipped.push(`${contract.contractNumber} ${periodLabel(period)} - could not be raised`);
          }
          continue;
        }
        created += 1;
      }
    }

    revalidatePath("/invoices");
    revalidatePath("/contracts");
    return { ok: true, data: { created, skipped } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The recurring billing run failed." };
  }
}

// --------------------------------------------------------------- period locks

export async function listPeriodLocks() {
  await requirePermission(PERMISSIONS.INVOICE_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from("accounting_period_lock")
    .select(`periodStart, closedAt, note, reopenedAt, reopenNote,
             closedBy:app_user!accounting_period_lock_closedById_fkey ( fullName ),
             reopenedBy:app_user!accounting_period_lock_reopenedById_fkey ( fullName )`)
    .order("periodStart", { ascending: false })
    .limit(36);
  if (error) throw new Error("Could not load closed periods.");
  return data ?? [];
}

/** Months that could still be closed, oldest first. */
export async function getClosableMonths() {
  await requirePermission(PERMISSIONS.INVOICE_READ);
  const db = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  // A recurring invoice is dated today but covers an earlier period, so the
  // period start counts as activity too - otherwise the month it bills for
  // could never be closed.
  const [invoices, periods, payments, locks] = await Promise.all([
    db.from("invoice").select("invoiceDate").order("invoiceDate", { ascending: true }).limit(1),
    db.from("invoice").select("periodStart").not("periodStart", "is", null).order("periodStart", { ascending: true }).limit(1),
    db.from("payment").select("paymentDate").order("paymentDate", { ascending: true }).limit(1),
    db.from("accounting_period_lock").select("periodStart").is("reopenedAt", null),
  ]);

  const candidates = [
    invoices.data?.[0]?.invoiceDate as string | undefined,
    periods.data?.[0]?.periodStart as string | undefined,
    payments.data?.[0]?.paymentDate as string | undefined,
  ].filter(Boolean) as string[];

  const earliest = candidates.length ? candidates.sort()[0] : null;
  const locked = (locks.data ?? []).map((l) => monthStart(l.periodStart as string));
  return closableMonths(earliest, today, locked);
}

export async function closePeriod(input: unknown): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.INVOICE_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const parsed = periodLockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the period details." };

  const db = await supabaseServer();
  const { error } = await db.rpc("close_accounting_period", {
    p_period: parsed.data.periodStart,
    p_note: parsed.data.note,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "Closing a period needs invoice approval authority."
        : "Could not close that period. Only a month that has already finished can be closed.",
    };
  }
  revalidatePath("/finance/periods");
  revalidatePath("/invoices");
  return { ok: true, data: undefined };
}

export async function reopenPeriod(input: unknown): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.INVOICE_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const parsed = periodLockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Say why this period is being reopened." };

  const db = await supabaseServer();
  const { error } = await db.rpc("reopen_accounting_period", {
    p_period: parsed.data.periodStart,
    p_note: parsed.data.note,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "Reopening a period needs invoice approval authority."
        : "Could not reopen that period.",
    };
  }
  revalidatePath("/finance/periods");
  revalidatePath("/invoices");
  return { ok: true, data: undefined };
}
