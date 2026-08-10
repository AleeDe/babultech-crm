"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { requireUser, AuthorizationError } from "@/lib/authz";
import { REGISTRATION_REVIEW_SLA_DAYS } from "@/lib/partner-policy";
import type { ActionResult } from "./partners";

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
      // A partner is entitled to know why their registration was turned down.
      disqualifiedReason: true,
      convertedOpportunity: {
        select: { id: true, opportunityNumber: true, name: true, stage: true, amount: true, currencyCode: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Deal registration — the one thing a partner can write
// ---------------------------------------------------------------------------

const registrationSchema = z.object({
  companyName: z.string().min(2, "Give the customer's company name.").max(200),
  firstName: z.string().min(1, "Who is your contact there?").max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email("A valid email helps us verify the registration.").optional().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  estimatedValue: z.coerce.number().min(0).optional().nullable(),
  expectedCloseDate: z.coerce.date().optional().nullable(),
  description: z.string().min(20, "Tell us what they need — at least a couple of sentences."),
});

/**
 * A partner registering a deal they are working.
 *
 * This creates a **Lead**, not an Opportunity. A partner cannot conjure a deal
 * into the pipeline — an internal owner qualifies it first, and converting the
 * lead is what attaches the partner as SOURCED and starts commission. That
 * conversion path already exists, so registration plugs into it rather than
 * inventing a parallel one.
 *
 * The important rule here is conflict detection. If the customer is already
 * registered to another partner, or already ours, the registration is still
 * accepted — refusing outright would hide the conflict — but it is flagged for
 * a human, and the partner is told plainly that it is contested. That is what
 * stops the same deal being credited twice.
 */
export async function submitDealRegistration(
  input: z.infer<typeof registrationSchema>,
): Promise<ActionResult<{ leadNumber: string; contested: boolean; message: string }>> {
  let ctx: PortalContext;
  try {
    ctx = await requirePartner();
  } catch {
    return { ok: false, error: "Your session has ended. Sign in again and retry." };
  }

  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  try {
    const partner = await prisma.partner.findUniqueOrThrow({
      where: { id: ctx.partnerId },
      select: {
        displayName: true, status: true, partnerManagerId: true,
        agreementExpiryDate: true, commissionPlanId: true,
      },
    });

    if (partner.status !== "ACTIVE") {
      return {
        ok: false,
        error: "Only an active partnership can register deals. Please speak to your partner manager.",
      };
    }
    if (partner.agreementExpiryDate && partner.agreementExpiryDate < new Date()) {
      return {
        ok: false,
        error: "Your partner agreement has expired, so new registrations cannot be accepted. Please speak to your partner manager.",
      };
    }

    const company = data.companyName.trim();

    // Has this customer already been registered, or are they already ours?
    const [existingLead, existingAccount] = await Promise.all([
      prisma.lead.findFirst({
        where: {
          deletedAt: null,
          companyName: { equals: company, mode: "insensitive" },
          status: { notIn: ["DISQUALIFIED"] },
        },
        select: {
          leadNumber: true,
          referredByPartnerId: true,
          referredByPartner: { select: { displayName: true } },
        },
      }),
      prisma.account.findFirst({
        where: { deletedAt: null, name: { equals: company, mode: "insensitive" } },
        select: {
          name: true,
          opportunities: {
            where: { deletedAt: null, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
            select: { id: true },
          },
        },
      }),
    ]);

    const alreadyMine =
      existingLead?.referredByPartnerId === ctx.partnerId;
    const contestedByOther =
      Boolean(existingLead) && !alreadyMine;
    const alreadyCustomer =
      Boolean(existingAccount && existingAccount.opportunities.length > 0);

    if (alreadyMine) {
      return {
        ok: false,
        error: `You have already registered ${company} — it is lead ${existingLead!.leadNumber}. Check your referrals page for its progress.`,
      };
    }

    // Leads need an internal owner. The partner manager is the right person;
    // fall back to an administrator so a registration is never orphaned.
    const ownerId =
      partner.partnerManagerId ??
      (
        await prisma.user.findFirst({
          where: { status: "ACTIVE", deletedAt: null, role: { permissions: { has: "*" } } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        })
      )?.id;

    if (!ownerId) {
      return { ok: false, error: "We could not route your registration. Please contact your partner manager." };
    }

    const flags: string[] = [];
    if (contestedByOther) {
      flags.push(
        `CONTESTED: ${company} is already on lead ${existingLead!.leadNumber}` +
          (existingLead!.referredByPartner
            ? `, registered by ${existingLead!.referredByPartner.displayName}.`
            : ", submitted directly."),
      );
    }
    if (alreadyCustomer) {
      flags.push(`EXISTING CUSTOMER: ${existingAccount!.name} already has an open opportunity.`);
    }

    const contested = contestedByOther || alreadyCustomer;

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          leadNumber: await nextNumber(SEQUENCES.LEAD, tx),
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          companyName: company,
          email: data.email || null,
          phone: data.phone ?? null,
          industry: data.industry ?? null,
          leadSource: "Partner",
          referredByPartnerId: ctx.partnerId,
          ownerUserId: ownerId,
          status: "NEW",
          estimatedValue: data.estimatedValue ?? null,
          nextFollowUpAt: data.expectedCloseDate ?? null,
          description: [
            `Deal registration submitted by ${partner.displayName} via the partner portal.`,
            data.expectedCloseDate
              ? `Partner expects to close around ${data.expectedCloseDate.toISOString().slice(0, 10)}.`
              : null,
            "",
            data.description.trim(),
            flags.length ? `\n--- Needs review ---\n${flags.join("\n")}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });

      // There is no email out of this system yet, so "notify" means putting a
      // dated task in front of the right person. It appears on their
      // Activities page and links back to the lead. Without this a
      // registration just sits in a list waiting to be noticed.
      const due = new Date();
      due.setDate(due.getDate() + REGISTRATION_REVIEW_SLA_DAYS);

      await tx.activity.create({
        data: {
          activityType: "TASK",
          subject: contested
            ? `Contested deal registration: ${company}`
            : `Review deal registration: ${company}`,
          description:
            `${partner.displayName} registered ${company} through the partner portal ` +
            `(${created.leadNumber}).` +
            (flags.length ? `\n\n${flags.join("\n")}` : "") +
            `\n\nDecide whether to qualify it. Converting the lead is what credits the partner.`,
          ownerUserId: ownerId,
          relatedEntityType: "Lead",
          relatedEntityId: created.id,
          dueAt: due,
          priority: contested ? "HIGH" : "MEDIUM",
          status: "OPEN",
        },
      });

      return created;
    });

    revalidatePath("/portal/referrals");
    revalidatePath("/leads");

    return {
      ok: true,
      data: {
        leadNumber: lead.leadNumber,
        contested,
        message: contested
          ? "Registered, but it needs review — we already have a record for this customer. Your partner manager will be in touch about who it belongs to."
          : "Registered. Your partner manager will review it and come back to you.",
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "We could not submit your registration.",
    };
  }
}
