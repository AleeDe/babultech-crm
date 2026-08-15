"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { updateRecord } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { registrationExpiry, protectionDaysFor } from "@/lib/partner-policy";

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
  /// Blank means the tier default applies.
  registrationProtectionDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
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
    const db = await supabaseServer();

    // Account/contact creation, the PARTNER-type promotion and the partner row
    // all in one transaction — partner_identity_check requires the account or
    // contact to exist first, and a half-done create would leave an account
    // silently promoted to PARTNER with no partner behind it.
    // Split by branch: `data` is a discriminated union, so the COMPANY-only and
    // INDIVIDUAL-only fields are not both present on it.
    const kindFields =
      data.kind === "COMPANY"
        ? {
            accountId: data.accountId ?? null,
            companyName: data.companyName ?? null,
            industry: data.industry ?? null,
            billingAddress: data.billingAddress ?? null,
            primaryContactFirstName: data.primaryContactFirstName ?? null,
            primaryContactLastName: data.primaryContactLastName ?? null,
            primaryContactEmail: data.primaryContactEmail ?? null,
          }
        : {
            contactId: data.contactId ?? null,
            firstName: data.firstName ?? null,
            lastName: data.lastName ?? null,
            mobile: data.mobile ?? null,
            whatsapp: data.whatsapp ?? null,
          };

    const { data: partner, error } = await db.rpc("create_partner", {
      p_payload: {
        kind: data.kind,
        ...kindFields,
        partnerType: data.partnerType,
        tier: data.tier,
        status: data.status,
        partnerManagerId: data.partnerManagerId ?? null,
        territory: data.territory ?? null,
        startDate: data.startDate ? data.startDate.toISOString().slice(0, 10) : null,
        agreementExpiryDate: data.agreementExpiryDate
          ? data.agreementExpiryDate.toISOString().slice(0, 10)
          : null,
        defaultCommissionPercent: data.defaultCommissionPercent ?? null,
        commissionPlanId: data.commissionPlanId ?? null,
        payoutCurrencyCode: data.payoutCurrencyCode,
        taxNumber: data.taxNumber ?? null,
        withholdingTaxPercent: data.withholdingTaxPercent ?? null,
        bankDetails: data.bankDetails ?? null,
        website: data.website ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        notes: data.notes ?? null,
      },
      p_actor_id: user.id,
    });

    if (error) return { ok: false, error: error.message };

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
    await updateRecord(
      "partner",
      id,
      {
        ...changes,
        email: changes.email === "" ? null : changes.email,
        bankDetails: changes.bankDetails ?? null,
        startDate: changes.startDate
          ? changes.startDate.toISOString().slice(0, 10)
          : changes.startDate,
        agreementExpiryDate: changes.agreementExpiryDate
          ? changes.agreementExpiryDate.toISOString().slice(0, 10)
          : changes.agreementExpiryDate,
      },
      "Partner",
      user.id,
    );

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
    const db = await supabaseServer();

    // The partner tier drives the default protection window, so it is read
    // here and the resolved day count passed in — the tier rules stay in
    // partner-policy.ts rather than being duplicated in SQL.
    const { data: partner } = await db
      .from("partner")
      .select("tier, registrationProtectionDays")
      .eq("id", data.partnerId)
      .maybeSingle();

    if (!partner) return { ok: false, error: "That partner no longer exists." };

    const defaultDays = protectionDaysFor(
      partner.tier as never,
      partner.registrationProtectionDays,
    );

    // The 100%% guard runs inside the function, under a lock on the deal: two
    // concurrent attaches each seeing 60%% used would otherwise both pass.
    const { data: link, error } = await db.rpc("attach_partner_to_deal", {
      p_opportunity_id: data.opportunityId,
      p_partner_id: data.partnerId,
      p_role: data.role,
      p_share_percent: data.revenueSharePercent,
      p_override_percent: data.commissionPercentOverride ?? null,
      p_expires_at: data.registrationExpiresAt
        ? data.registrationExpiresAt.toISOString()
        : null,
      p_default_days: defaultDays,
      p_notes: data.notes ?? null,
    });

    if (error) return { ok: false, error: error.message };

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
    const db = await supabaseServer();

    const { data: link } = await db
      .from("opportunity_partner")
      .select("opportunityId, commissionRecords:commission_record ( id )")
      .eq("id", linkId)
      .maybeSingle();

    if (!link) return { ok: false, error: "That link no longer exists." };

    if (((link.commissionRecords ?? []) as unknown[]).length > 0) {
      return {
        ok: false,
        error: "This partner already has commission records on the deal. Claw those back before removing the link.",
      };
    }

    const { error } = await db.from("opportunity_partner").delete().eq("id", linkId);
    if (error) throw new Error(error.message);
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

  const db = await supabaseServer();

  let query = db
    .from("partner")
    .select(
      `*,
       account ( id, name ),
       contact ( id, firstName, lastName, email ),
       partnerManager:app_user!partner_partnerManagerId_fkey ( id, fullName ),
       commissionPlan:commission_plan ( id, name ),
       opportunities:opportunity_partner ( count ),
       commissionRecords:commission_record ( count ),
       referredLeads:lead ( count )`,
    )
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.partnerType) query = query.eq("partnerType", filters.partnerType);
  if (filters?.kind) query = query.eq("kind", filters.kind);
  if (filters?.search) {
    const s = filters.search.replace(/[,()]/g, "");
    query = query.or(
      `displayName.ilike.%${s}%,partnerNumber.ilike.%${s}%,email.ilike.%${s}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load partners: ${error.message}`);

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  return (data ?? []).map((p) => ({
    ...p,
    account: one(p.account as never),
    contact: one(p.contact as never),
    partnerManager: one(p.partnerManager as never),
    commissionPlan: one(p.commissionPlan as never),
    _count: {
      opportunities: countOf(p.opportunities),
      commissionRecords: countOf(p.commissionRecords),
      referredLeads: countOf(p.referredLeads),
    },
  }));
}

export async function getPartner(id: string) {
  await requirePermission(PERMISSIONS.PARTNER_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("partner")
    .select(
      `*,
       account ( * ),
       contact ( * ),
       partnerManager:app_user!partner_partnerManagerId_fkey ( id, fullName, email ),
       commissionPlan:commission_plan ( *, tiers:commission_tier ( * ) ),
       contacts:partner_contact ( *, contact ( * ) ),
       referredLeads:lead ( id, leadNumber, firstName, lastName, companyName, status, estimatedValue, createdAt, deletedAt ),
       opportunities:opportunity_partner (
         *,
         opportunity (
           id, opportunityNumber, name, stage, amount, currencyCode,
           expectedCloseDate, account ( name )
         )
       ),
       commissionRecords:commission_record (
         *,
         opportunity ( opportunityNumber, name )
       ),
       payouts:commission_payout ( * )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load partner: ${error.message}`);
  if (!data) return null;

  // PostgREST returns embedded collections unfiltered and unordered, so the
  // per-relation where/orderBy/take from the Prisma query are applied here.
  type Row = Record<string, unknown>;
  const rows = (v: unknown) => ((v as Row[] | null) ?? []);
  const desc = (a: unknown, b: unknown) => String(b ?? "").localeCompare(String(a ?? ""));

  const plan = one(data.commissionPlan as never) as Row | null;

  return {
    ...data,
    account: one(data.account as never),
    contact: one(data.contact as never),
    partnerManager: one(data.partnerManager as never),
    commissionPlan: plan
      ? {
          ...plan,
          tiers: rows(plan.tiers).sort(
            (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
          ),
        }
      : null,
    contacts: rows(data.contacts).map((c): Row => ({ ...c, contact: one(c.contact as never) })),
    referredLeads: rows(data.referredLeads)
      .filter((l) => !l.deletedAt)
      .sort((a, b) => desc(a.createdAt, b.createdAt))
      .slice(0, 20),
    opportunities: rows(data.opportunities)
      .map((o): Row => {
        const opp = one(o.opportunity as never) as Row | null;
        return {
          ...o,
          opportunity: opp ? { ...opp, account: one(opp.account as never) } : null,
        };
      })
      .sort((a, b) => desc(a.createdAt, b.createdAt)),
    commissionRecords: rows(data.commissionRecords)
      .filter((r) => !r.deletedAt)
      .map((r): Row => ({ ...r, opportunity: one(r.opportunity as never) }))
      .sort((a, b) => desc(a.earnedDate, b.earnedDate)),
    payouts: rows(data.payouts).sort((a, b) => desc(a.createdAt, b.createdAt)),
  };
}

/** Headline numbers for the partner detail page. */
export async function getPartnerSummary(partnerId: string) {
  await requirePermission(PERMISSIONS.PARTNER_READ);

  const db = await supabaseServer();

  const [dealsRes, commissionsRes] = await Promise.all([
    db
      .from("opportunity_partner")
      .select("revenueSharePercent, opportunity ( stage, amount )")
      .eq("partnerId", partnerId),
    // PostgREST has no groupBy, so the records are fetched and bucketed below.
    db
      .from("commission_record")
      .select("status, netPayableAmount")
      .eq("partnerId", partnerId)
      .is("deletedAt", null),
  ]);

  type DealRow = { revenueSharePercent: unknown; opportunity: { stage: string; amount: unknown } };

  const deals = (dealsRes.data ?? []).map((d) => ({
    revenueSharePercent: d.revenueSharePercent,
    opportunity: one(d.opportunity as never) as unknown as { stage: string; amount: unknown },
  })) as DealRow[];

  const won = deals.filter((d) => d.opportunity?.stage === "CLOSED_WON");
  const lost = deals.filter((d) => d.opportunity?.stage === "CLOSED_LOST");
  const open = deals.filter(
    (d) => d.opportunity?.stage !== "CLOSED_WON" && d.opportunity?.stage !== "CLOSED_LOST",
  );

  const sourcedValue = (rows: DealRow[]) =>
    rows.reduce(
      (sum, d) =>
        sum.plus(
          toDecimal(d.opportunity?.amount)
            .times(toDecimal(d.revenueSharePercent))
            .dividedBy(100),
        ),
      toDecimal(0),
    );

  const byStatus: Record<string, Decimal> = {};
  for (const c of commissionsRes.data ?? []) {
    const key = c.status as string;
    byStatus[key] = (byStatus[key] ?? toDecimal(0)).plus(toDecimal(c.netPayableAmount));
  }

  const sumOf = (...statuses: string[]) =>
    statuses.reduce((acc, s) => acc.plus(byStatus[s] ?? toDecimal(0)), toDecimal(0));

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
