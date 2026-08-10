"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthorizationError } from "@/lib/authz";

/**
 * The partner portal's data layer.
 *
 * Every function here starts with `requirePartner()`, which reads the partner
 * id **from the session** and nowhere else. No portal query accepts a partner
 * id as an argument, so there is no parameter for an external user to tamper
 * with — the worst they can do is ask for their own data.
 *
 * What a partner may see is deliberately narrow: the deals they are attached
 * to, the customers behind those deals, their own commission ledger, and their
 * payouts. They never see another partner's records, internal cost or margin,
 * anyone's pipeline, or any employee data.
 */

export interface PortalContext {
  userId: string;
  fullName: string;
  partnerId: string;
}

/** Resolves the signed-in user to the partner they act for. */
async function requirePartner(): Promise<PortalContext> {
  const user = await requireUser();
  if (!user.partnerId) {
    throw new AuthorizationError("This account is not a partner portal login.");
  }
  return { userId: user.id, fullName: user.fullName, partnerId: user.partnerId };
}

/** Safe for a layout to call — returns null instead of throwing. */
export async function getPortalContext(): Promise<PortalContext | null> {
  try {
    return await requirePartner();
  } catch {
    return null;
  }
}

export async function getPartnerProfile() {
  const { partnerId } = await requirePartner();

  return prisma.partner.findUniqueOrThrow({
    where: { id: partnerId },
    select: {
      id: true,
      partnerNumber: true,
      displayName: true,
      kind: true,
      partnerType: true,
      tier: true,
      status: true,
      territory: true,
      startDate: true,
      agreementExpiryDate: true,
      defaultCommissionPercent: true,
      payoutCurrencyCode: true,
      withholdingTaxPercent: true,
      taxNumber: true,
      email: true,
      phone: true,
      website: true,
      // Deliberately absent: bankDetails, internal notes, partnerManager.
      commissionPlan: {
        select: {
          name: true, rateType: true, flatPercent: true, fixedAmount: true, basis: true, trigger: true,
          tiers: { select: { fromAmount: true, toAmount: true, ratePercent: true }, orderBy: { fromAmount: "asc" } },
        },
      },
      account: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/** Headline numbers for the portal landing page. */
export async function getPortalSummary() {
  const { partnerId } = await requirePartner();

  const [records, payouts, deals] = await Promise.all([
    prisma.commissionRecord.findMany({
      where: { partnerId, deletedAt: null },
      select: { status: true, commissionAmount: true, netPayableAmount: true, currencyCode: true },
    }),
    prisma.commissionPayout.findMany({
      where: { partnerId, deletedAt: null },
      select: { status: true, netAmount: true, currencyCode: true },
    }),
    prisma.opportunityPartner.count({
      where: { partnerId, opportunity: { deletedAt: null } },
    }),
  ]);

  const sum = (
    rows: { commissionAmount?: Prisma.Decimal; netPayableAmount?: Prisma.Decimal }[],
    key: "commissionAmount" | "netPayableAmount",
  ) => rows.reduce((s, r) => s.plus(new Prisma.Decimal(r[key] ?? 0)), new Prisma.Decimal(0));

  const paid = records.filter((r) => r.status === "PAID");
  const pipeline = records.filter((r) => ["ACCRUED", "PENDING_APPROVAL", "APPROVED", "PAYABLE"].includes(r.status));
  const clawedBack = records.filter((r) => r.status === "CLAWED_BACK");

  return {
    currency: records[0]?.currencyCode ?? payouts[0]?.currencyCode ?? "PKR",
    dealCount: deals,
    recordCount: records.length,
    earnedTotal: sum(records, "commissionAmount"),
    paidTotal: sum(paid, "netPayableAmount"),
    pendingTotal: sum(pipeline, "netPayableAmount"),
    clawedBackTotal: sum(clawedBack, "commissionAmount"),
    payoutsPending: payouts.filter((p) => p.status !== "PAID").length,
  };
}

/** The partner's own commission ledger. */
export async function getPortalCommissions(status?: string) {
  const { partnerId } = await requirePartner();

  return prisma.commissionRecord.findMany({
    where: {
      partnerId,
      deletedAt: null,
      ...(status ? { status: status as never } : {}),
    },
    select: {
      id: true,
      commissionNumber: true,
      status: true,
      earnedDate: true,
      basisAmount: true,
      ratePercent: true,
      commissionAmount: true,
      withholdingTaxAmount: true,
      netPayableAmount: true,
      currencyCode: true,
      opportunity: { select: { id: true, opportunityNumber: true, name: true, account: { select: { name: true } } } },
      invoice: { select: { invoiceNumber: true, invoiceDate: true } },
      payout: { select: { id: true, payoutNumber: true, status: true, paymentDate: true } },
    },
    orderBy: { earnedDate: "desc" },
  });
}

/** Payout batches, which is how commission actually reaches them. */
export async function getPortalPayouts() {
  const { partnerId } = await requirePartner();

  return prisma.commissionPayout.findMany({
    where: { partnerId, deletedAt: null },
    select: {
      id: true,
      payoutNumber: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      grossAmount: true,
      withholdingTaxAmount: true,
      netAmount: true,
      currencyCode: true,
      paymentDate: true,
      referenceNumber: true,
      _count: { select: { records: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Deals the partner is attached to. Only their own share and role — the
 * customer's contacts, internal notes, quotes and margin stay out of it.
 */
export async function getPortalDeals() {
  const { partnerId } = await requirePartner();

  const links = await prisma.opportunityPartner.findMany({
    where: { partnerId, opportunity: { deletedAt: null } },
    select: {
      id: true,
      role: true,
      revenueSharePercent: true,
      commissionPercentOverride: true,
      registeredAt: true,
      registrationExpiresAt: true,
      opportunity: {
        select: {
          id: true,
          opportunityNumber: true,
          name: true,
          stage: true,
          amount: true,
          currencyCode: true,
          expectedCloseDate: true,
          actualCloseDate: true,
          account: { select: { id: true, name: true, industry: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Commission earned per deal, so the partner can tie a deal to its payment.
  const earned = await prisma.commissionRecord.groupBy({
    by: ["opportunityId"],
    where: { partnerId, deletedAt: null },
    _sum: { commissionAmount: true },
  });

  return links.map((l) => ({
    ...l,
    earnedAmount:
      earned.find((e) => e.opportunityId === l.opportunity.id)?._sum.commissionAmount ??
      new Prisma.Decimal(0),
  }));
}

/**
 * The customers behind the partner's deals — plus their own account record if
 * they are a company partner. This is the "accounts" view they asked for, and
 * it is derived, not a free look at the customer list.
 */
export async function getPortalAccounts() {
  const { partnerId } = await requirePartner();

  const partner = await prisma.partner.findUniqueOrThrow({
    where: { id: partnerId },
    select: { accountId: true },
  });

  const links = await prisma.opportunityPartner.findMany({
    where: { partnerId, opportunity: { deletedAt: null } },
    select: {
      opportunity: {
        select: {
          id: true, stage: true, amount: true, currencyCode: true,
          accountId: true,
          account: { select: { id: true, name: true, industry: true, accountType: true } },
        },
      },
    },
  });

  const byAccount = new Map<
    string,
    {
      id: string;
      name: string;
      industry: string | null;
      accountType: string;
      isOwnRecord: boolean;
      deals: number;
      wonDeals: number;
      totalValue: Prisma.Decimal;
      currency: string;
    }
  >();

  for (const l of links) {
    const a = l.opportunity.account;
    const row = byAccount.get(a.id) ?? {
      id: a.id,
      name: a.name,
      industry: a.industry,
      accountType: a.accountType,
      isOwnRecord: a.id === partner.accountId,
      deals: 0,
      wonDeals: 0,
      totalValue: new Prisma.Decimal(0),
      currency: l.opportunity.currencyCode,
    };
    row.deals += 1;
    if (l.opportunity.stage === "CLOSED_WON") row.wonDeals += 1;
    row.totalValue = row.totalValue.plus(l.opportunity.amount);
    byAccount.set(a.id, row);
  }

  return [...byAccount.values()].sort((a, b) => b.totalValue.comparedTo(a.totalValue));
}

/** Leads this partner referred, and what became of them. */
export async function getPortalReferrals() {
  const { partnerId } = await requirePartner();

  return prisma.lead.findMany({
    where: { referredByPartnerId: partnerId, deletedAt: null },
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      companyName: true,
      status: true,
      estimatedValue: true,
      createdAt: true,
      convertedAt: true,
      convertedOpportunity: {
        select: { id: true, opportunityNumber: true, name: true, stage: true, amount: true, currencyCode: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
