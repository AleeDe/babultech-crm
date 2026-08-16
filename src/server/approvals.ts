"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { toDecimal, one } from "@/lib/decimal";

/**
 * Everything waiting on a decision, in one queue.
 *
 * Approvals are not centralised in the database and deliberately stay that
 * way: quotations, expenses, timesheets, vendor bills and commissions each
 * carry their own status column and their own transition rules, and those
 * rules differ — an expense cannot be approved by the person who claimed it,
 * a quotation can be revised instead of rejected. Rewriting five working
 * mechanisms onto one generic table would risk all of them to gain a shared
 * shape nothing actually needs.
 *
 * What was missing is the view across them. This reads each source, filters to
 * what the reader is allowed to approve, and returns one list — so nobody has
 * to remember which of five screens is holding something up.
 *
 * Each item links to where the decision is actually made, because that screen
 * has the context the approver needs.
 */

export type ApprovalKind =
  | "quotation"
  | "expense"
  | "timesheet"
  | "vendor-bill"
  | "commission";

export interface PendingApproval {
  kind: ApprovalKind;
  id: string;
  reference: string;
  title: string;
  subtitle: string | null;
  /** Money at stake, where the item has an amount. */
  amount: string | null;
  currencyCode: string | null;
  requestedBy: string | null;
  waitingSince: string;
  href: string;
  /** Set when the reader may not decide this one, and why. */
  blockedReason?: string;
}

const daysSince = (iso: string | null | undefined) => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
};

export async function getPendingApprovals(): Promise<{
  items: PendingApproval[];
  byKind: Record<string, number>;
  totalValue: string;
  oldestDays: number;
}> {
  const me = await requireUser();
  const db = await supabaseServer();

  const seeQuotations = can(me, PERMISSIONS.QUOTATION_APPROVE);
  const seeInvoicing = can(me, PERMISSIONS.INVOICE_APPROVE);
  const seeTime = can(me, PERMISSIONS.TIME_APPROVE);
  const seeCommission = can(me, PERMISSIONS.COMMISSION_APPROVE);

  const none = { data: [] as Record<string, unknown>[] };

  const [quotations, expenses, timeLogs, bills, commissions] = await Promise.all([
    seeQuotations
      ? db
          .from("quotation")
          .select(
            "id, quoteNumber, totalAmount, currencyCode, createdAt, account ( name ), opportunity ( name )",
          )
          .eq("approvalStatus", "PENDING")
          .is("deletedAt", null)
          .order("createdAt")
          .limit(100)
      : none,

    seeInvoicing
      ? db
          .from("expense")
          .select(
            "id, expenseNumber, amount, currencyCode, description, createdAt, employeeUserId, category:expense_category ( name ), employee:app_user!expense_employeeUserId_fkey ( fullName )",
          )
          .eq("approvalStatus", "SUBMITTED")
          .is("deletedAt", null)
          .order("createdAt")
          .limit(100)
      : none,

    seeTime
      ? db
          .from("time_log")
          .select(
            "id, hours, workDate, description, createdAt, userId, user:app_user!time_log_userId_fkey ( fullName ), project ( id, name )",
          )
          .eq("approvalStatus", "SUBMITTED")
          .order("workDate")
          .limit(100)
      : none,

    seeInvoicing
      ? db
          .from("vendor_bill")
          .select("id, billNumber, totalAmount, currencyCode, createdAt, vendor:account ( name )")
          .eq("status", "UNDER_REVIEW")
          .is("deletedAt", null)
          .order("createdAt")
          .limit(100)
      : none,

    seeCommission
      ? db
          .from("commission_record")
          .select(
            "id, commissionNumber, netPayableAmount, currencyCode, createdAt, partner ( displayName ), opportunity ( name )",
          )
          .in("status", ["ACCRUED", "PENDING_APPROVAL"])
          .is("deletedAt", null)
          .order("createdAt")
          .limit(100)
      : none,
  ]);

  type Row = Record<string, any>;
  const items: PendingApproval[] = [];

  for (const q of (quotations.data ?? []) as Row[]) {
    const account = one(q.account as never) as Row | null;
    const opportunity = one(q.opportunity as never) as Row | null;
    items.push({
      kind: "quotation",
      id: q.id,
      reference: q.quoteNumber,
      title: opportunity?.name ?? "Quotation",
      subtitle: account?.name ?? null,
      amount: String(q.totalAmount ?? 0),
      currencyCode: q.currencyCode,
      requestedBy: null,
      waitingSince: q.createdAt,
      href: `/quotations/${q.id}`,
    });
  }

  for (const e of (expenses.data ?? []) as Row[]) {
    const category = one(e.category as never) as Row | null;
    const employee = one(e.employee as never) as Row | null;
    items.push({
      kind: "expense",
      id: e.id,
      reference: e.expenseNumber,
      title: e.description ?? category?.name ?? "Expense",
      subtitle: category?.name ?? null,
      amount: String(e.amount ?? 0),
      currencyCode: e.currencyCode,
      requestedBy: employee?.fullName ?? null,
      waitingSince: e.createdAt,
      href: `/expenses/${e.id}`,
      // Surfaced rather than hidden: the claimant should see their own item is
      // queued, and understand why the button is not theirs to press.
      blockedReason:
        e.employeeUserId === me.id ? "Your own claim — someone else has to approve it." : undefined,
    });
  }

  // Time is approved a week at a time on its own screen, so the entries are
  // grouped by person rather than listed one by one.
  const byUser = new Map<string, { name: string; hours: number; oldest: string; count: number }>();
  for (const t of (timeLogs.data ?? []) as Row[]) {
    const user = one(t.user as never) as Row | null;
    const key = t.userId;
    const existing = byUser.get(key);
    const hours = Number(t.hours ?? 0);
    if (existing) {
      existing.hours += hours;
      existing.count += 1;
      if (t.createdAt < existing.oldest) existing.oldest = t.createdAt;
    } else {
      byUser.set(key, {
        name: user?.fullName ?? "Unknown",
        hours,
        oldest: t.createdAt,
        count: 1,
      });
    }
  }

  for (const [userId, group] of byUser) {
    items.push({
      kind: "timesheet",
      id: userId,
      reference: `${group.count} entr${group.count === 1 ? "y" : "ies"}`,
      title: `${group.hours.toFixed(2)} hours from ${group.name}`,
      subtitle: "Submitted time awaiting approval",
      amount: null,
      currencyCode: null,
      requestedBy: group.name,
      waitingSince: group.oldest,
      href: "/timesheets/approvals",
    });
  }

  for (const b of (bills.data ?? []) as Row[]) {
    const vendor = one(b.vendor as never) as Row | null;
    items.push({
      kind: "vendor-bill",
      id: b.id,
      reference: b.billNumber,
      title: vendor?.name ?? "Vendor bill",
      subtitle: "Awaiting approval for payment",
      amount: String(b.totalAmount ?? 0),
      currencyCode: b.currencyCode,
      requestedBy: null,
      waitingSince: b.createdAt,
      href: `/vendor-bills/${b.id}`,
    });
  }

  for (const c of (commissions.data ?? []) as Row[]) {
    const partner = one(c.partner as never) as Row | null;
    const opportunity = one(c.opportunity as never) as Row | null;
    items.push({
      kind: "commission",
      id: c.id,
      reference: c.commissionNumber,
      title: partner?.displayName ?? "Commission",
      subtitle: opportunity?.name ?? null,
      amount: String(c.netPayableAmount ?? 0),
      currencyCode: c.currencyCode,
      requestedBy: null,
      waitingSince: c.createdAt,
      href: `/commissions/${c.id}`,
    });
  }

  // Oldest first: what has been waiting longest is what is holding someone up.
  items.sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));

  const byKind: Record<string, number> = {};
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;

  const totalValue = items
    .reduce((total, item) => total.plus(toDecimal(item.amount ?? 0)), toDecimal(0))
    .toFixed(2);

  return {
    items,
    byKind,
    totalValue,
    oldestDays: items.length ? daysSince(items[0].waitingSince) : 0,
  };
}
