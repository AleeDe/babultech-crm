"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission, scopedContext } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import { registrationExpiry } from "@/lib/partner-policy";
import type { ActionResult } from "./partners";

/** Accounts, Contacts, Leads, Campaigns and Products — the Phase 1 core. */

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  name: z.string().min(1).max(200),
  accountType: z.enum(["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "COMPETITOR", "OTHER"]).default("PROSPECT"),
  customerStatus: z.enum(["ONBOARDING", "ACTIVE", "AT_RISK", "CHURNED"]).optional().nullable(),
  parentAccountId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid(),
  industry: z.string().max(100).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  mainPhone: z.string().max(50).optional().nullable(),
  taxNumberNtn: z.string().max(50).optional().nullable(),
  creditLimit: z.coerce.number().min(0).optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).optional().nullable(),
  customerHealth: z.enum(["GREEN", "AMBER", "RED"]).optional().nullable(),
  description: z.string().optional().nullable(),
  billingAddress: z.record(z.string()).optional().nullable(),
});

export async function createAccount(
  input: z.infer<typeof accountSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const account = await prisma.$transaction(async (tx) =>
      tx.account.create({
        data: {
          ...parsed.data,
          accountNumber: await nextNumber(SEQUENCES.ACCOUNT, tx),
          billingAddress: (parsed.data.billingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );

    revalidatePath("/accounts");
    return { ok: true, data: { id: account.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the account." };
  }
}

export async function updateAccount(
  id: string,
  input: z.infer<typeof accountSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.account.findUniqueOrThrow({ where: { id } });
      const after = await tx.account.update({
        where: { id },
        data: {
          ...parsed.data,
          billingAddress: (parsed.data.billingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await auditChanges(tx, {
        entityType: "Account",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/accounts");
    revalidatePath(`/accounts/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the account." };
  }
}

export async function listAccounts(filters?: { search?: string; accountType?: string }) {
  const { where } = await scopedContext("ownerUserId");

  return prisma.account.findMany({
    where: {
      deletedAt: null,
      ...where,
      ...(filters?.accountType ? { accountType: filters.accountType as never } : {}),
      ...(filters?.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" as const } },
              { accountNumber: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      owner: { select: { id: true, fullName: true } },
      partner: { select: { id: true, partnerNumber: true, partnerType: true, tier: true } },
      _count: { select: { contacts: true, opportunities: true, cases: true, projects: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getAccount(id: string) {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);

  return prisma.account.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, fullName: true, email: true } },
      parentAccount: { select: { id: true, name: true } },
      childAccounts: { select: { id: true, name: true, accountType: true } },
      partner: { include: { commissionPlan: { select: { name: true } } } },
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }] },
      opportunities: {
        where: { deletedAt: null },
        select: { id: true, opportunityNumber: true, name: true, stage: true, amount: true, currencyCode: true, expectedCloseDate: true },
        orderBy: { expectedCloseDate: "desc" },
        take: 20,
      },
      contracts: { where: { deletedAt: null }, orderBy: { endDate: "desc" }, take: 10 },
      cases: {
        where: { deletedAt: null },
        select: { id: true, caseNumber: true, subject: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      projects: { where: { deletedAt: null }, select: { id: true, projectNumber: true, name: true, status: true, health: true } },
      invoices: {
        where: { deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
        select: { id: true, invoiceNumber: true, totalAmount: true, outstandingAmount: true, dueDate: true, status: true, currencyCode: true },
        orderBy: { invoiceDate: "desc" },
        take: 10,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  /** Nullable — an individual partner or private person has no employer. */
  accountId: z.string().uuid().optional().nullable(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  jobTitle: z.string().max(150).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  mobile: z.string().max(50).optional().nullable(),
  whatsapp: z.string().max(50).optional().nullable(),
  contactRole: z.string().max(100).optional().nullable(),
  isPrimary: z.boolean().default(false),
  preferredChannel: z.enum(["EMAIL", "PHONE", "WHATSAPP"]).optional().nullable(),
  communicationConsent: z.boolean().default(false),
});

export async function createContact(
  input: z.infer<typeof contactSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const contact = await prisma.$transaction(async (tx) => {
      // Only one primary contact per account.
      if (data.isPrimary && data.accountId) {
        await tx.contact.updateMany({
          where: { accountId: data.accountId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contact.create({
        data: { ...data, accountId: data.accountId ?? null, email: data.email || null },
      });
    });

    revalidatePath("/contacts");
    if (data.accountId) revalidatePath(`/accounts/${data.accountId}`);
    return { ok: true, data: { id: contact.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the contact." };
  }
}

export async function getContact(id: string) {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);

  return prisma.contact.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true } },
      partnerAsPerson: { select: { id: true, partnerNumber: true } },
    },
  });
}

export async function updateContact(
  id: string,
  input: z.infer<typeof contactSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.contact.findUniqueOrThrow({ where: { id } });

      // A contact that backs an individual partner must keep accountId null —
      // the partner_identity_check trigger depends on it.
      const isPartnerPerson = await tx.partner.findFirst({
        where: { contactId: id, deletedAt: null },
        select: { id: true },
      });
      if (isPartnerPerson && data.accountId) {
        throw new Error(
          "This contact is an individual partner and cannot be attached to a company account.",
        );
      }

      if (data.isPrimary && data.accountId) {
        await tx.contact.updateMany({
          where: { accountId: data.accountId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        });
      }

      const after = await tx.contact.update({
        where: { id },
        data: { ...data, accountId: data.accountId ?? null, email: data.email || null },
      });

      await auditChanges(tx, {
        entityType: "Contact",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/contacts");
    if (data.accountId) revalidatePath(`/accounts/${data.accountId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the contact." };
  }
}

export async function listContacts(filters?: { search?: string; accountId?: string; unaffiliatedOnly?: boolean }) {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);

  return prisma.contact.findMany({
    where: {
      deletedAt: null,
      ...(filters?.accountId ? { accountId: filters.accountId } : {}),
      ...(filters?.unaffiliatedOnly ? { accountId: null } : {}),
      ...(filters?.search
        ? {
            OR: [
              { firstName: { contains: filters.search, mode: "insensitive" as const } },
              { lastName: { contains: filters.search, mode: "insensitive" as const } },
              { email: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      partnerAsPerson: { select: { id: true, partnerNumber: true, partnerType: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const leadSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyName: z.string().max(200).optional().nullable(),
  jobTitle: z.string().max(150).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  whatsapp: z.string().max(50).optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  leadSource: z.string().max(100).optional().nullable(),
  campaignId: z.string().uuid().optional().nullable(),
  /** Credits a partner for the referral — carries through to the opportunity. */
  referredByPartnerId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid(),
  rating: z.enum(["HOT", "WARM", "COLD"]).optional().nullable(),
  estimatedValue: z.coerce.number().min(0).optional().nullable(),
  description: z.string().optional().nullable(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
});

export async function createLead(
  input: z.infer<typeof leadSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const lead = await prisma.$transaction(async (tx) =>
      tx.lead.create({
        data: {
          ...parsed.data,
          email: parsed.data.email || null,
          leadNumber: await nextNumber(SEQUENCES.LEAD, tx),
        },
      }),
    );

    revalidatePath("/leads");
    return { ok: true, data: { id: lead.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the lead." };
  }
}

export async function getLead(id: string) {
  await requirePermission(PERMISSIONS.LEAD_READ);

  return prisma.lead.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, fullName: true } },
      campaign: { select: { id: true, name: true } },
      referredByPartner: { select: { id: true, displayName: true } },
      convertedAccount: { select: { id: true, name: true } },
      convertedOpportunity: { select: { id: true, name: true } },
    },
  });
}

const leadUpdateSchema = leadSchema.extend({
  status: z.enum([
    "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
    "QUALIFIED", "NURTURING", "DISQUALIFIED",
  ]),
  disqualifiedReason: z.string().max(255).optional().nullable(),
});

export async function updateLead(
  id: string,
  input: z.infer<typeof leadUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = leadUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.status === "DISQUALIFIED" && !data.disqualifiedReason) {
    return {
      ok: false,
      error: "A reason is required to disqualify a lead.",
      fieldErrors: { disqualifiedReason: ["Tell us why this lead was disqualified."] },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.lead.findUniqueOrThrow({ where: { id } });

      // Spec §13: a converted lead is read-only.
      if (before.status === "CONVERTED") {
        throw new Error(`Lead ${before.leadNumber} has been converted and can no longer be edited.`);
      }

      const after = await tx.lead.update({
        where: { id },
        data: {
          ...data,
          email: data.email || null,
          disqualifiedReason: data.status === "DISQUALIFIED" ? data.disqualifiedReason : null,
        },
      });

      await auditChanges(tx, {
        entityType: "Lead",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the lead." };
  }
}

const convertSchema = z.object({
  leadId: z.string().uuid(),
  /** Reuse an existing account instead of creating one. */
  accountId: z.string().uuid().optional().nullable(),
  createOpportunity: z.boolean().default(true),
  opportunityName: z.string().max(255).optional(),
  amount: z.coerce.number().min(0).optional(),
  expectedCloseDate: z.coerce.date().optional(),
});

/**
 * Lead conversion (spec §13): the lead becomes read-only and points at the
 * resulting Account and Contact; the Opportunity is optional. If the lead came
 * through a partner referral, that partner is attached to the new opportunity
 * as SOURCED so commission flows automatically when the deal is won.
 */
export async function convertLead(
  input: z.infer<typeof convertSchema>,
): Promise<ActionResult<{ accountId: string; contactId: string; opportunityId: string | null }>> {
  const _auth = await authorize(PERMISSIONS.LEAD_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: data.leadId },
        include: { referredByPartner: true },
      });

      if (lead.status === "CONVERTED") {
        throw new Error(`Lead ${lead.leadNumber} has already been converted.`);
      }

      const accountId =
        data.accountId ??
        (
          await tx.account.create({
            data: {
              accountNumber: await nextNumber(SEQUENCES.ACCOUNT, tx),
              name: lead.companyName ?? `${lead.firstName} ${lead.lastName}`,
              accountType: "PROSPECT",
              ownerUserId: lead.ownerUserId,
              industry: lead.industry,
              mainPhone: lead.phone,
            },
          })
        ).id;

      const contact = await tx.contact.create({
        data: {
          accountId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          jobTitle: lead.jobTitle,
          email: lead.email,
          phone: lead.phone,
          whatsapp: lead.whatsapp,
          isPrimary: true,
          communicationConsent: true,
        },
      });

      let opportunityId: string | null = null;
      if (data.createOpportunity) {
        const opp = await tx.opportunity.create({
          data: {
            opportunityNumber: await nextNumber(SEQUENCES.OPPORTUNITY, tx),
            name: data.opportunityName ?? `${lead.companyName ?? lead.lastName} — new business`,
            accountId,
            primaryContactId: contact.id,
            ownerUserId: lead.ownerUserId,
            campaignId: lead.campaignId,
            stage: "QUALIFICATION",
            amount: data.amount ?? lead.estimatedValue ?? 0,
            probabilityPercent: 20,
            expectedCloseDate:
              data.expectedCloseDate ?? new Date(Date.now() + 60 * 86_400_000),
            opportunityType: "NEW",
            leadSource: lead.leadSource,
          },
        });
        opportunityId = opp.id;

        // Carry the referral credit onto the deal.
        if (lead.referredByPartnerId) {
          // Protection runs from when the partner registered the deal, not
          // from today — a slow internal review must not quietly extend their
          // claim, and a fast one must not shorten it.
          const registeredAt = lead.createdAt;
          const expiresAt = registrationExpiry(registeredAt);

          await tx.opportunityPartner.create({
            data: {
              opportunityId: opp.id,
              partnerId: lead.referredByPartnerId,
              role: "SOURCED",
              revenueSharePercent: 100,
              commissionPlanId: lead.referredByPartner?.commissionPlanId ?? null,
              registeredAt,
              registrationExpiresAt: expiresAt,
              notes: `Auto-attached on conversion of lead ${lead.leadNumber}. Registration protected until ${expiresAt.toISOString().slice(0, 10)}.`,
            },
          });
        }
      }

      const after = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
          convertedAccountId: accountId,
          convertedContactId: contact.id,
          convertedOpportunityId: opportunityId,
        },
      });

      await auditChanges(tx, {
        entityType: "Lead",
        entityId: lead.id,
        before: lead,
        after,
        changedById: user.id,
      });

      return { accountId, contactId: contact.id, opportunityId };
    });

    revalidatePath("/leads");
    revalidatePath("/accounts");
    revalidatePath("/opportunities");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not convert the lead." };
  }
}

export async function listLeads(filters?: { search?: string; status?: string; source?: string }) {
  const { where } = await scopedContext("ownerUserId");

  return prisma.lead.findMany({
    where: {
      deletedAt: null,
      ...where,
      // Deals partners have registered through the portal, awaiting a decision.
      ...(filters?.source === "partner" ? { referredByPartnerId: { not: null } } : {}),
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(filters?.search
        ? {
            OR: [
              { firstName: { contains: filters.search, mode: "insensitive" as const } },
              { lastName: { contains: filters.search, mode: "insensitive" as const } },
              { companyName: { contains: filters.search, mode: "insensitive" as const } },
              { leadNumber: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      owner: { select: { id: true, fullName: true } },
      campaign: { select: { id: true, name: true } },
      referredByPartner: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Campaigns & Products
// ---------------------------------------------------------------------------

export async function listCampaigns() {
  await requirePermission(PERMISSIONS.LEAD_READ);

  return prisma.campaign.findMany({
    where: { deletedAt: null },
    include: {
      campaignType: true,
      owner: { select: { fullName: true } },
      _count: { select: { members: true, leads: true, opportunities: true } },
    },
    orderBy: { startDate: "desc" },
  });
}

/** Campaign ROI straight from the v_campaign_performance view (spec §11). */
export async function getCampaignPerformance() {
  await requirePermission(PERMISSIONS.LEAD_READ);

  return prisma.$queryRaw<
    Array<{
      campaign_id: string;
      campaign_name: string;
      status: string;
      actual_cost: Prisma.Decimal;
      leads: bigint;
      converted_leads: bigint;
      opportunities: bigint;
      pipeline_value: Prisma.Decimal;
      won_value: Prisma.Decimal;
      roi_percent: Prisma.Decimal | null;
      cost_per_lead: Prisma.Decimal | null;
    }>
  >`SELECT * FROM v_campaign_performance ORDER BY won_value DESC NULLS LAST`;
}

export async function listProducts(activeOnly = true) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  return prisma.product.findMany({
    where: { deletedAt: null, ...(activeOnly ? { active: true } : {}) },
    include: { defaultTaxRate: true },
    orderBy: { name: "asc" },
  });
}

/** Option lists for form dropdowns. */
export async function getFormOptions() {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);

  const [users, accounts, campaigns, plans, currencies, partners, contacts, products, taxRates] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, accountType: true },
      orderBy: { name: "asc" },
    }),
    prisma.campaign.findMany({
      where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.commissionPlan.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, rateType: true, flatPercent: true },
      orderBy: { name: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.partner.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      select: { id: true, displayName: true, partnerNumber: true, kind: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null },
      select: { id: true, firstName: true, lastName: true, accountId: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, productCode: true, standardPrice: true, defaultTaxRateId: true },
      orderBy: { name: "asc" },
    }),
    prisma.taxRate.findMany({
      where: { active: true },
      select: { id: true, name: true, ratePercent: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { users, accounts, campaigns, plans, currencies, partners, contacts, products, taxRates };
}
