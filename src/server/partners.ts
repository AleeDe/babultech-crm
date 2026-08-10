"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { auditChanges, writeAudit } from "@/lib/audit";

/**
 * Partner management.
 *
 * A partner is either a COMPANY (backed by an Account with accountType =
 * PARTNER) or an INDIVIDUAL (backed by a Contact with no account at all).
 * `createPartner` handles both, creating the underlying Account/Contact when
 * one isn't supplied — so a freelance referrer can be onboarded in one step
 * without inventing a fake company.
 */

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
  })
  .optional();

const basePartnerSchema = z.object({
  partnerType: z.enum(["REFERRAL", "RESELLER", "IMPLEMENTATION", "TECHNOLOGY", "DISTRIBUTOR"]),
  tier: z.enum(["REGISTERED", "SILVER", "GOLD", "PLATINUM"]).default("REGISTERED"),
  status: z.enum(["PROSPECTIVE", "ACTIVE", "INACTIVE", "TERMINATED"]).default("PROSPECTIVE"),
  partnerManagerId: z.string().uuid().optional().nullable(),
  territory: z.string().max(150).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  agreementExpiryDate: z.coerce.date().optional().nullable(),
  defaultCommissionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  commissionPlanId: z.string().uuid().optional().nullable(),
  payoutCurrencyCode: z.string().length(3).default("PKR"),
  taxNumber: z.string().max(50).optional().nullable(),
  withholdingTaxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  bankDetails: z
    .object({
      bankName: z.string().optional(),
      accountTitle: z.string().optional(),
      accountNumber: z.string().optional(),
      iban: z.string().optional(),
      branch: z.string().optional(),
    })
    .optional()
    .nullable(),
});

const companyPartnerSchema = basePartnerSchema.extend({
  kind: z.literal("COMPANY"),
  /** Link an existing account, or supply companyName to create one. */
  accountId: z.string().uuid().optional().nullable(),
  companyName: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional().nullable(),
  billingAddress: addressSchema,
  /** Optional named person at the partner company. */
  primaryContactFirstName: z.string().max(100).optional(),
  primaryContactLastName: z.string().max(100).optional(),
  primaryContactEmail: z.string().email().optional().or(z.literal("")),
});

const individualPartnerSchema = basePartnerSchema.extend({
  kind: z.literal("INDIVIDUAL"),
  /** Link an existing contact, or supply the name to create one. */
  contactId: z.string().uuid().optional().nullable(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  mobile: z.string().max(50).optional().nullable(),
  whatsapp: z.string().max(50).optional().nullable(),
});

// Not exported: a "use server" module may only export async functions.
// Types are erased at build time, so the inferred type below is fine to export.
const partnerSchema = z.discriminatedUnion("kind", [
  companyPartnerSchema,
  individualPartnerSchema,
]);

export type PartnerInput = z.infer<typeof partnerSchema>;

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createPartner(input: PartnerInput): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PARTNER_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = partnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const partner = await prisma.$transaction(async (tx) => {
      let accountId: string | null = null;
      let contactId: string | null = null;
      let displayName: string;

      if (data.kind === "COMPANY") {
        if (data.accountId) {
          const account = await tx.account.findUniqueOrThrow({ where: { id: data.accountId } });
          // The DB trigger enforces this too; promote the account here so the
          // common "this existing customer is now also a reseller" path works.
          if (account.accountType !== "PARTNER") {
            await tx.account.update({
              where: { id: account.id },
              data: { accountType: "PARTNER" },
            });
            await writeAudit(tx, {
              entityType: "Account",
              entityId: account.id,
              fieldName: "accountType",
              oldValue: account.accountType,
              newValue: "PARTNER",
              changedById: user.id,
            });
          }
          accountId = account.id;
          displayName = account.name;
        } else {
          if (!data.companyName) {
            throw new Error("Provide either an existing account or a company name.");
          }
          const account = await tx.account.create({
            data: {
              accountNumber: await nextNumber(SEQUENCES.ACCOUNT, tx),
              name: data.companyName,
              accountType: "PARTNER",
              ownerUserId: data.partnerManagerId ?? user.id,
              industry: data.industry ?? null,
              website: data.website ?? null,
              mainPhone: data.phone ?? null,
              taxNumberNtn: data.taxNumber ?? null,
              billingAddress: (data.billingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          });
          accountId = account.id;
          displayName = account.name;
        }

        // Optional named person at the partner company.
        if (data.primaryContactFirstName && data.primaryContactLastName) {
          await tx.contact.create({
            data: {
              accountId,
              firstName: data.primaryContactFirstName,
              lastName: data.primaryContactLastName,
              email: data.primaryContactEmail || null,
              isPrimary: true,
              contactRole: "Partner Manager",
            },
          });
        }
      } else {
        // INDIVIDUAL — a partner who is a person, with no company account.
        if (data.contactId) {
          const contact = await tx.contact.findUniqueOrThrow({ where: { id: data.contactId } });
          contactId = contact.id;
          displayName = `${contact.firstName} ${contact.lastName}`;
        } else {
          if (!data.firstName || !data.lastName) {
            throw new Error("Provide either an existing contact or a first and last name.");
          }
          const contact = await tx.contact.create({
            data: {
              accountId: null, // the whole point: no company behind this person
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email || null,
              phone: data.phone ?? null,
              mobile: data.mobile ?? null,
              whatsapp: data.whatsapp ?? null,
              contactRole: "Partner",
              communicationConsent: true,
            },
          });
          contactId = contact.id;
          displayName = `${contact.firstName} ${contact.lastName}`;
        }
      }

      return tx.partner.create({
        data: {
          partnerNumber: await nextNumber(SEQUENCES.PARTNER, tx),
          displayName,
          kind: data.kind,
          accountId,
          contactId,
          partnerType: data.partnerType,
          tier: data.tier,
          status: data.status,
          partnerManagerId: data.partnerManagerId ?? null,
          territory: data.territory ?? null,
          startDate: data.startDate ?? null,
          agreementExpiryDate: data.agreementExpiryDate ?? null,
          defaultCommissionPercent: data.defaultCommissionPercent ?? null,
          commissionPlanId: data.commissionPlanId ?? null,
          payoutCurrencyCode: data.payoutCurrencyCode,
          taxNumber: data.taxNumber ?? null,
          withholdingTaxPercent: data.withholdingTaxPercent ?? null,
          bankDetails: (data.bankDetails ?? undefined) as Prisma.InputJsonValue | undefined,
          email: data.email || null,
          phone: data.phone ?? null,
          website: data.website ?? null,
          notes: data.notes ?? null,
        },
      });
    });

    revalidatePath("/partners");
    return { ok: true, data: { id: partner.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the partner." };
  }
}

const updatePartnerSchema = basePartnerSchema.partial().extend({ id: z.string().uuid() });

export async function updatePartner(
  input: z.infer<typeof updatePartnerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.PARTNER_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = updatePartnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { id, ...changes } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.partner.findUniqueOrThrow({ where: { id } });
      const after = await tx.partner.update({
        where: { id },
        data: {
          ...changes,
          email: changes.email === "" ? null : changes.email,
          bankDetails: (changes.bankDetails ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await auditChanges(tx, {
        entityType: "Partner",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/partners");
    revalidatePath(`/partners/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the partner." };
  }
}

/** Attach a partner to a deal, with its revenue share and optional rate override. */
const linkSchema = z.object({
  opportunityId: z.string().uuid(),
  partnerId: z.string().uuid(),
  role: z.enum(["SOURCED", "INFLUENCED", "RESOLD", "DELIVERED"]).default("SOURCED"),
  revenueSharePercent: z.coerce.number().min(0).max(100).default(100),
  commissionPercentOverride: z.coerce.number().min(0).max(100).optional().nullable(),
  registrationExpiresAt: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function linkPartnerToOpportunity(
  input: z.infer<typeof linkSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const link = await prisma.$transaction(async (tx) => {
      // Guard the 100% total here as well as in the DB, so the user gets a
      // readable message instead of a raised exception.
      const existing = await tx.opportunityPartner.aggregate({
        where: { opportunityId: data.opportunityId },
        _sum: { revenueSharePercent: true },
      });
      const used = new Prisma.Decimal(existing._sum.revenueSharePercent ?? 0);
      if (used.plus(data.revenueSharePercent).greaterThan(100)) {
        throw new Error(
          `Revenue share would total ${used.plus(data.revenueSharePercent)}%. Only ${new Prisma.Decimal(100).minus(used)}% is unallocated on this deal.`,
        );
      }

      const partner = await tx.partner.findUniqueOrThrow({ where: { id: data.partnerId } });

      return tx.opportunityPartner.create({
        data: {
          opportunityId: data.opportunityId,
          partnerId: data.partnerId,
          role: data.role,
          revenueSharePercent: data.revenueSharePercent,
          commissionPercentOverride: data.commissionPercentOverride ?? null,
          // Snapshot the plan so later plan edits can't rewrite this deal.
          commissionPlanId: partner.commissionPlanId,
          registeredAt: new Date(),
          registrationExpiresAt: data.registrationExpiresAt ?? null,
          notes: data.notes ?? null,
        },
      });
    });

    revalidatePath(`/opportunities/${data.opportunityId}`);
    revalidatePath(`/partners/${data.partnerId}`);
    return { ok: true, data: { id: link.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not link the partner." };
  }
}

export async function unlinkPartnerFromOpportunity(linkId: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  try {
    const link = await prisma.opportunityPartner.findUniqueOrThrow({
      where: { id: linkId },
      include: { _count: { select: { commissionRecords: true } } },
    });

    if (link._count.commissionRecords > 0) {
      return {
        ok: false,
        error: "This partner already has commission records on the deal. Claw those back before removing the link.",
      };
    }

    await prisma.opportunityPartner.delete({ where: { id: linkId } });
    revalidatePath(`/opportunities/${link.opportunityId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not remove the partner." };
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listPartners(filters?: {
  search?: string;
  status?: string;
  partnerType?: string;
  kind?: string;
}) {
  await requirePermission(PERMISSIONS.PARTNER_READ);

  return prisma.partner.findMany({
    where: {
      deletedAt: null,
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(filters?.partnerType ? { partnerType: filters.partnerType as never } : {}),
      ...(filters?.kind ? { kind: filters.kind as never } : {}),
      ...(filters?.search
        ? {
            OR: [
              { displayName: { contains: filters.search, mode: "insensitive" as const } },
              { partnerNumber: { contains: filters.search, mode: "insensitive" as const } },
              { email: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      partnerManager: { select: { id: true, fullName: true } },
      commissionPlan: { select: { id: true, name: true } },
      _count: { select: { opportunities: true, commissionRecords: true, referredLeads: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPartner(id: string) {
  await requirePermission(PERMISSIONS.PARTNER_READ);

  return prisma.partner.findUnique({
    where: { id },
    include: {
      account: true,
      contact: true,
      partnerManager: { select: { id: true, fullName: true, email: true } },
      commissionPlan: { include: { tiers: { orderBy: { sortOrder: "asc" } } } },
      contacts: { include: { contact: true } },
      referredLeads: {
        where: { deletedAt: null },
        select: { id: true, leadNumber: true, firstName: true, lastName: true, companyName: true, status: true, estimatedValue: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      opportunities: {
        include: {
          opportunity: {
            select: {
              id: true, opportunityNumber: true, name: true, stage: true,
              amount: true, currencyCode: true, expectedCloseDate: true,
              account: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      commissionRecords: {
        where: { deletedAt: null },
        include: { opportunity: { select: { opportunityNumber: true, name: true } } },
        orderBy: { earnedDate: "desc" },
      },
      payouts: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Headline numbers for the partner detail page. */
export async function getPartnerSummary(partnerId: string) {
  await requirePermission(PERMISSIONS.PARTNER_READ);

  const [deals, commissions] = await Promise.all([
    prisma.opportunityPartner.findMany({
      where: { partnerId },
      include: { opportunity: { select: { stage: true, amount: true } } },
    }),
    prisma.commissionRecord.groupBy({
      by: ["status"],
      where: { partnerId, deletedAt: null },
      _sum: { commissionAmount: true, netPayableAmount: true },
      _count: true,
    }),
  ]);

  const won = deals.filter((d) => d.opportunity.stage === "CLOSED_WON");
  const lost = deals.filter((d) => d.opportunity.stage === "CLOSED_LOST");
  const open = deals.filter(
    (d) => d.opportunity.stage !== "CLOSED_WON" && d.opportunity.stage !== "CLOSED_LOST",
  );

  const sourcedValue = (rows: typeof deals) =>
    rows.reduce(
      (sum, d) =>
        sum.plus(
          new Prisma.Decimal(d.opportunity.amount)
            .times(d.revenueSharePercent)
            .dividedBy(100),
        ),
      new Prisma.Decimal(0),
    );

  const byStatus = Object.fromEntries(
    commissions.map((c) => [c.status, c._sum.netPayableAmount ?? new Prisma.Decimal(0)]),
  );

  const sumOf = (...statuses: string[]) =>
    statuses.reduce(
      (acc, s) => acc.plus(byStatus[s] ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

  return {
    dealsOpen: open.length,
    dealsWon: won.length,
    dealsLost: lost.length,
    openPipeline: sourcedValue(open),
    wonValue: sourcedValue(won),
    winRate: won.length + lost.length === 0 ? null : (won.length / (won.length + lost.length)) * 100,
    commissionAccrued: sumOf("ACCRUED", "PENDING_APPROVAL"),
    commissionPayable: sumOf("APPROVED", "PAYABLE", "PARTIALLY_PAID"),
    commissionPaid: sumOf("PAID"),
  };
}
