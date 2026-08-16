"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { toDecimal } from "@/lib/decimal";

/**
 * Live figures for the dashboard.
 *
 * Every number is a HEAD count or a narrow select rather than a list read, so
 * the whole thing costs a few dozen cheap queries instead of pulling thousands
 * of rows in to length them. They all run in parallel.
 *
 * What each user sees is what RLS lets them see — an OWN-scope rep's "open
 * deals" is their own, not the company's — so these totals agree with the list
 * screens the reader can actually open.
 */

const OPEN_CASE_STATUSES = '("CLOSED","CANCELLED","RESOLVED")';
const CLOSED_STAGES = '("CLOSED_WON","CLOSED_LOST")';

export interface ModuleSummary {
  /**
   * Which modules the reader is allowed to see at all.
   *
   * A permission they lack produces zeros, and a row of confident zeros reads
   * as "nothing is happening" rather than "this is not yours" — so the page
   * hides those cards instead of showing them empty.
   */
  visible: {
    sales: boolean;
    finance: boolean;
    delivery: boolean;
    service: boolean;
    partners: boolean;
  };
  sales: {
    openDeals: number;
    openValue: string;
    wonThisMonth: number;
    wonValueThisMonth: string;
    newLeads: number;
    leadsToFollowUp: number;
    quotesAwaitingReply: number;
    quoteValueOut: string;
  };
  delivery: {
    activeProjects: number;
    atRiskProjects: number;
    milestonesDueSoon: number;
    overdueTasks: number;
    hoursAwaitingApproval: string;
  };
  finance: {
    outstanding: string;
    overdue: string;
    overdueCount: number;
    collectedThisMonth: string;
    unallocatedPayments: string;
    draftInvoices: number;
  };
  service: {
    openCases: number;
    criticalCases: number;
    breachedSla: number;
    unassignedCases: number;
  };
  partners: {
    activePartners: number;
    commissionPayable: string;
    commissionPendingApproval: number;
    agreementsExpiringSoon: number;
  };
}

/** Count rows matching a filter without transferring any of them. */
async function countRows(
  build: (q: ReturnType<Awaited<ReturnType<typeof supabaseServer>>["from"]>) => unknown,
  table: string,
): Promise<number> {
  const db = await supabaseServer();
  const query = build(db.from(table)) as { count: number | null };
  const { count } = (await query) as unknown as { count: number | null };
  return count ?? 0;
}

/** Sum one numeric column across the rows a filter selects. */
async function sumColumn(
  table: string,
  column: string,
  refine: (q: any) => any = (q) => q,
): Promise<string> {
  const db = await supabaseServer();
  const { data } = await refine(db.from(table).select(column).is("deletedAt", null));
  return ((data ?? []) as Record<string, unknown>[])
    .reduce((total, row) => total.plus(toDecimal(row[column])), toDecimal(0))
    .toFixed(2);
}

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

export async function getModuleSummary(): Promise<ModuleSummary> {
  const me = await requireUser();
  const db = await supabaseServer();

  // Permission gates return zeros rather than throwing: a Finance user's
  // dashboard should show finance and simply omit delivery, not fail to load.
  const seeSales = can(me, PERMISSIONS.OPPORTUNITY_READ);
  const seeFinance = can(me, PERMISSIONS.INVOICE_READ);
  const seeCases = can(me, PERMISSIONS.CASE_READ);
  const seeProjects = can(me, PERMISSIONS.PROJECT_READ);
  const seePartners = can(me, PERMISSIONS.PARTNER_READ);

  const monthStart = startOfMonth();
  const now = today();
  const soon = daysFromNow(14);
  const agreementHorizon = daysFromNow(60);

  const nil = { count: null } as const;
  const skip = async () => nil;

  const [
    openDeals, openValueRows, wonThisMonth, wonValueRows,
    newLeads, leadsToFollowUp, quotesOut, quoteValueRows,
    activeProjects, atRiskProjects, milestonesDue, overdueTasks, hoursPending,
    outstandingRows, overdueRows, collectedRows, unallocatedRows, draftInvoices,
    openCases, criticalCases, breachedSla, unassignedCases,
    activePartners, payableRows, pendingApproval, expiringAgreements,
  ] = await Promise.all([
    // ---- sales
    seeSales
      ? db.from("opportunity").select("id", { count: "exact", head: true })
          .is("deletedAt", null).not("stage", "in", CLOSED_STAGES)
      : skip(),
    seeSales
      ? db.from("opportunity").select("amount").is("deletedAt", null).not("stage", "in", CLOSED_STAGES)
      : { data: [] },
    seeSales
      ? db.from("opportunity").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("stage", "CLOSED_WON").gte("actualCloseDate", monthStart)
      : skip(),
    seeSales
      ? db.from("opportunity").select("amount").is("deletedAt", null)
          .eq("stage", "CLOSED_WON").gte("actualCloseDate", monthStart)
      : { data: [] },
    db.from("lead").select("id", { count: "exact", head: true })
      .is("deletedAt", null).in("status", ["NEW", "ASSIGNED"]),
    db.from("lead").select("id", { count: "exact", head: true })
      .is("deletedAt", null).is("convertedAt", null).lte("nextFollowUpAt", new Date().toISOString()),
    seeSales
      ? db.from("quotation").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("status", "SENT")
      : skip(),
    seeSales
      ? db.from("quotation").select("totalAmount").is("deletedAt", null).eq("status", "SENT")
      : { data: [] },

    // ---- delivery
    seeProjects
      ? db.from("project").select("id", { count: "exact", head: true })
          .is("deletedAt", null).in("status", ["ACTIVE", "PLANNING"])
      : skip(),
    seeProjects
      ? db.from("project").select("id", { count: "exact", head: true })
          .is("deletedAt", null).or("status.eq.AT_RISK,health.eq.RED")
      : skip(),
    seeProjects
      ? db.from("milestone").select("id", { count: "exact", head: true })
          .neq("status", "COMPLETED").lte("dueDate", soon)
      : skip(),
    seeProjects
      ? db.from("project_task").select("id", { count: "exact", head: true })
          .not("status", "in", '("COMPLETED","CANCELLED")').lt("dueDate", now)
      : skip(),
    seeProjects
      ? db.from("time_log").select("hours").eq("approvalStatus", "SUBMITTED")
      : { data: [] },

    // ---- finance
    seeFinance
      ? db.from("invoice").select("outstandingAmount").is("deletedAt", null)
          .not("status", "in", '("PAID","CANCELLED","WRITTEN_OFF","DRAFT")')
      : { data: [] },
    seeFinance
      ? db.from("invoice").select("outstandingAmount").is("deletedAt", null)
          .not("status", "in", '("PAID","CANCELLED","WRITTEN_OFF","DRAFT")').lt("dueDate", now)
      : { data: [] },
    seeFinance
      ? db.from("payment").select("amount").is("deletedAt", null)
          .eq("status", "CLEARED").gte("paymentDate", monthStart)
      : { data: [] },
    seeFinance
      ? db.from("payment").select("unallocatedAmount").is("deletedAt", null).gt("unallocatedAmount", 0)
      : { data: [] },
    seeFinance
      ? db.from("invoice").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("status", "DRAFT")
      : skip(),

    // ---- service
    seeCases
      ? db.from("support_case").select("id", { count: "exact", head: true })
          .is("deletedAt", null).not("status", "in", OPEN_CASE_STATUSES)
      : skip(),
    seeCases
      ? db.from("support_case").select("id", { count: "exact", head: true })
          .is("deletedAt", null).not("status", "in", OPEN_CASE_STATUSES).eq("priority", "CRITICAL")
      : skip(),
    seeCases
      ? db.from("support_case").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("slaBreached", true).not("status", "in", OPEN_CASE_STATUSES)
      : skip(),
    seeCases
      ? db.from("support_case").select("id", { count: "exact", head: true })
          .is("deletedAt", null).not("status", "in", OPEN_CASE_STATUSES)
          .is("ownerUserId", null).is("teamId", null)
      : skip(),

    // ---- partners
    seePartners
      ? db.from("partner").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("status", "ACTIVE")
      : skip(),
    seePartners
      ? db.from("commission_record").select("netPayableAmount").is("deletedAt", null)
          .in("status", ["APPROVED", "PAYABLE", "PARTIALLY_PAID"])
      : { data: [] },
    seePartners
      ? db.from("commission_record").select("id", { count: "exact", head: true })
          .is("deletedAt", null).in("status", ["ACCRUED", "PENDING_APPROVAL"])
      : skip(),
    seePartners
      ? db.from("partner").select("id", { count: "exact", head: true })
          .is("deletedAt", null).eq("status", "ACTIVE")
          .not("agreementExpiryDate", "is", null).lte("agreementExpiryDate", agreementHorizon)
      : skip(),
  ]);

  const sum = (res: { data?: unknown }, column: string) =>
    ((res.data ?? []) as Record<string, unknown>[])
      .reduce((total, row) => total.plus(toDecimal(row[column])), toDecimal(0))
      .toFixed(2);

  const n = (res: { count?: number | null }) => res.count ?? 0;

  return {
    visible: {
      sales: seeSales,
      finance: seeFinance,
      delivery: seeProjects,
      service: seeCases,
      partners: seePartners,
    },
    sales: {
      openDeals: n(openDeals),
      openValue: sum(openValueRows, "amount"),
      wonThisMonth: n(wonThisMonth),
      wonValueThisMonth: sum(wonValueRows, "amount"),
      newLeads: n(newLeads),
      leadsToFollowUp: n(leadsToFollowUp),
      quotesAwaitingReply: n(quotesOut),
      quoteValueOut: sum(quoteValueRows, "totalAmount"),
    },
    delivery: {
      activeProjects: n(activeProjects),
      atRiskProjects: n(atRiskProjects),
      milestonesDueSoon: n(milestonesDue),
      overdueTasks: n(overdueTasks),
      hoursAwaitingApproval: sum(hoursPending, "hours"),
    },
    finance: {
      outstanding: sum(outstandingRows, "outstandingAmount"),
      overdue: sum(overdueRows, "outstandingAmount"),
      overdueCount: ((overdueRows.data ?? []) as unknown[]).length,
      collectedThisMonth: sum(collectedRows, "amount"),
      unallocatedPayments: sum(unallocatedRows, "unallocatedAmount"),
      draftInvoices: n(draftInvoices),
    },
    service: {
      openCases: n(openCases),
      criticalCases: n(criticalCases),
      breachedSla: n(breachedSla),
      unassignedCases: n(unassignedCases),
    },
    partners: {
      activePartners: n(activePartners),
      commissionPayable: sum(payableRows, "netPayableAmount"),
      commissionPendingApproval: n(pendingApproval),
      agreementsExpiringSoon: n(expiringAgreements),
    },
  };
}

/**
 * Things that need someone to act, newest concern first.
 *
 * Distinct from the counts above: a count tells you the shape of the business,
 * this tells you what is going wrong right now.
 */
export async function getAttentionItems() {
  const me = await requireUser();
  const db = await supabaseServer();
  const now = today();

  const [overdueInvoices, breachedCases, staleDeals, expiringAgreements] = await Promise.all([
    can(me, PERMISSIONS.INVOICE_READ)
      ? db.from("invoice")
          .select("id, invoiceNumber, totalAmount, outstandingAmount, dueDate, currencyCode, account ( id, name )")
          .is("deletedAt", null)
          .not("status", "in", '("PAID","CANCELLED","WRITTEN_OFF","DRAFT")')
          .lt("dueDate", now)
          .order("dueDate")
          .limit(5)
      : { data: [] },
    can(me, PERMISSIONS.CASE_READ)
      ? db.from("support_case")
          .select("id, caseNumber, subject, priority, status, resolutionDueAt, account ( id, name )")
          .is("deletedAt", null)
          .not("status", "in", OPEN_CASE_STATUSES)
          .or(`slaBreached.eq.true,priority.eq.CRITICAL`)
          .order("resolutionDueAt")
          .limit(5)
      : { data: [] },
    can(me, PERMISSIONS.OPPORTUNITY_READ)
      ? db.from("opportunity")
          .select("id, opportunityNumber, name, stage, amount, currencyCode, expectedCloseDate, account ( id, name )")
          .is("deletedAt", null)
          .not("stage", "in", CLOSED_STAGES)
          .lt("expectedCloseDate", now)
          .order("expectedCloseDate")
          .limit(5)
      : { data: [] },
    can(me, PERMISSIONS.PARTNER_READ)
      ? db.from("partner")
          .select("id, displayName, partnerNumber, agreementExpiryDate, tier")
          .is("deletedAt", null)
          .eq("status", "ACTIVE")
          .not("agreementExpiryDate", "is", null)
          .lte("agreementExpiryDate", daysFromNow(60))
          .order("agreementExpiryDate")
          .limit(5)
      : { data: [] },
  ]);

  const first = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

  type Named = { id: string; name: string };

  return {
    overdueInvoices: (overdueInvoices.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      account: first<Named>(r.account),
    })),
    breachedCases: (breachedCases.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      account: first<Named>(r.account),
    })),
    staleDeals: (staleDeals.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      account: first<Named>(r.account),
    })),
    expiringAgreements: expiringAgreements.data ?? [],
  };
}
