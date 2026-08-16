"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal, toDecimal, sumBy, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
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
  const db = await supabaseServer();

  // The column list stays explicit for the same reason it always was:
  // bankDetails, internal notes and partnerManager must never reach the portal.
  const { data, error } = await db
    .from("partner")
    .select(
      `id, partnerNumber, displayName, kind, partnerType, tier, status,
       territory, startDate, agreementExpiryDate, defaultCommissionPercent,
       payoutCurrencyCode, withholdingTaxPercent, registrationProtectionDays,
       taxNumber, email, phone, website,
       commissionPlan:commission_plan (
         name, rateType, flatPercent, fixedAmount, basis, trigger,
         tiers:commission_tier ( fromAmount, toAmount, ratePercent )
       ),
       account ( id, name ),
       contact ( id, firstName, lastName )`,
    )
    .eq("id", partnerId)
    .single();

  if (error || !data) {
    throw new AuthorizationError("Partner profile not found.");
  }

  // PostgREST cannot order an embedded relation inline; sort client-side to
  // preserve the previous `orderBy: { fromAmount: "asc" }`.
  const plan = Array.isArray(data.commissionPlan)
    ? data.commissionPlan[0]
    : data.commissionPlan;

  if (plan?.tiers) {
    plan.tiers.sort(
      (a: { fromAmount: unknown }, b: { fromAmount: unknown }) =>
        toDecimal(a.fromAmount).comparedTo(toDecimal(b.fromAmount)),
    );
  }

  return { ...data, commissionPlan: plan };
}

/** Headline numbers for the portal landing page. */
export async function getPortalSummary() {
  const { partnerId } = await requirePartner();

  const db = await supabaseServer();

  const [recordsRes, payoutsRes, dealsRes] = await Promise.all([
    db
      .from("commission_record")
      .select("status, commissionAmount, netPayableAmount, currencyCode")
      .eq("partnerId", partnerId)
      .is("deletedAt", null),
    db
      .from("commission_payout")
      .select("status, netAmount, currencyCode")
      .eq("partnerId", partnerId)
      .is("deletedAt", null),
    // Prisma filtered on the related opportunity (`opportunity: { deletedAt: null }`).
    // PostgREST expresses that as an inner join with a filter on the embedded table.
    db
      .from("opportunity_partner")
      .select("id, opportunity!inner(deletedAt)", { count: "exact", head: true })
      .eq("partnerId", partnerId)
      .is("opportunity.deletedAt", null),
  ]);

  const records = recordsRes.data ?? [];
  const payouts = payoutsRes.data ?? [];
  const deals = dealsRes.count ?? 0;

  // sumBy normalises PostgREST's numeric-as-number into Decimal. Doing this in
  // plain JS numbers would silently lose precision on Decimal(18,2) money.
  const sum = (
    rows: readonly Record<string, unknown>[],
    key: "commissionAmount" | "netPayableAmount",
  ) => sumBy(rows, key as never);

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

  const db = await supabaseServer();

  let query = db
    .from("commission_record")
    .select(
      `id, commissionNumber, status, earnedDate, basisAmount, ratePercent,
       commissionAmount, withholdingTaxAmount, netPayableAmount, currencyCode,
       opportunity ( id, opportunityNumber, name, account ( name ) ),
       invoice ( invoiceNumber, invoiceDate ),
       payout:commission_payout ( id, payoutNumber, status, paymentDate )`,
    )
    .eq("partnerId", partnerId)
    .is("deletedAt", null)
    .order("earnedDate", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load commissions: ${error.message}`);

  // Flatten the embedded to-one relations back to objects.
  return (data ?? []).map((r) => {
    const opportunity = one(r.opportunity);
    return {
      ...r,
      opportunity: opportunity
        ? { ...opportunity, account: one(opportunity.account) }
        : null,
      invoice: one(r.invoice),
      payout: one(r.payout),
    };
  });
}

/** Payout batches, which is how commission actually reaches them. */
export async function getPortalPayouts() {
  const { partnerId } = await requirePartner();

  const db = await supabaseServer();

  const { data, error } = await db
    .from("commission_payout")
    .select(
      `id, payoutNumber, status, periodStart, periodEnd, grossAmount,
       withholdingTaxAmount, netAmount, currencyCode, paymentDate,
       referenceNumber,
       records:commission_record ( count )`,
    )
    .eq("partnerId", partnerId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`Could not load payouts: ${error.message}`);

  // Prisma returned `_count: { records: n }`. PostgREST returns an aggregate
  // relation `records: [{ count: n }]` — reshape so callers are unchanged.
  return (data ?? []).map((row) => {
    const { records, ...rest } = row as typeof row & {
      records?: { count: number }[];
    };
    return { ...rest, _count: { records: records?.[0]?.count ?? 0 } };
  });
}

/**
 * Deals the partner is attached to. Only their own share and role — the
 * customer's contacts, internal notes, quotes and margin stay out of it.
 */
export async function getPortalDeals() {
  const { partnerId } = await requirePartner();

  const db = await supabaseServer();

  const { data: links, error } = await db
    .from("opportunity_partner")
    .select(
      `id, role, revenueSharePercent, commissionPercentOverride, registeredAt,
       registrationExpiresAt,
       opportunity!inner (
         id, opportunityNumber, name, stage, amount, currencyCode,
         expectedCloseDate, actualCloseDate,
         account ( id, name, industry )
       )`,
    )
    .eq("partnerId", partnerId)
    .is("opportunity.deletedAt", null)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`Could not load deals: ${error.message}`);

  // Commission earned per deal, so the partner can tie a deal to its payment.
  //
  // PostgREST has no groupBy, so the rows are fetched and summed here. Safe at
  // portal scale (one partner's records); a reporting-sized version of this
  // would want a database view or an .rpc() instead.
  const { data: records } = await db
    .from("commission_record")
    .select("opportunityId, commissionAmount")
    .eq("partnerId", partnerId)
    .is("deletedAt", null);

  const earnedByOpportunity = new Map<string, Decimal>();
  for (const r of records ?? []) {
    const key = r.opportunityId as string;
    earnedByOpportunity.set(
      key,
      (earnedByOpportunity.get(key) ?? new Decimal(0)).plus(
        toDecimal(r.commissionAmount),
      ),
    );
  }

  return (links ?? []).map((l) => {
    // Keep the whole opportunity shape the pages read (stage, amount,
    // currencyCode, account…); only its id is needed for the lookup here.
    const opp = one(l.opportunity)!;
    return {
      ...l,
      opportunity: { ...opp, account: one(opp.account) },
      earnedAmount: earnedByOpportunity.get(opp.id) ?? new Decimal(0),
    };
  });
}

/**
 * The customers behind the partner's deals — plus their own account record if
 * they are a company partner. This is the "accounts" view they asked for, and
 * it is derived, not a free look at the customer list.
 */
export async function getPortalAccounts() {
  const { partnerId } = await requirePartner();

  const db = await supabaseServer();

  const { data: partner } = await db
    .from("partner")
    .select("accountId")
    .eq("id", partnerId)
    .single();

  const { data: links, error } = await db
    .from("opportunity_partner")
    .select(
      `opportunity!inner (
         id, stage, amount, currencyCode, accountId, deletedAt,
         account ( id, name, industry, accountType )
       )`,
    )
    .eq("partnerId", partnerId)
    .is("opportunity.deletedAt", null);

  if (error) throw new Error(`Could not load customers: ${error.message}`);

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
      totalValue: Decimal;
      currency: string;
    }
  >();

  for (const l of links ?? []) {
    const opp = (Array.isArray(l.opportunity) ? l.opportunity[0] : l.opportunity) as unknown as {
      id: string;
      stage: string;
      amount: unknown;
      currencyCode: string;
      account: { id: string; name: string; industry: string | null; accountType: string };
    };
    const a = Array.isArray(opp.account) ? opp.account[0] : opp.account;

    const row = byAccount.get(a.id) ?? {
      id: a.id,
      name: a.name,
      industry: a.industry,
      accountType: a.accountType,
      isOwnRecord: a.id === partner?.accountId,
      deals: 0,
      wonDeals: 0,
      totalValue: new Decimal(0),
      currency: opp.currencyCode,
    };
    row.deals += 1;
    if (opp.stage === "CLOSED_WON") row.wonDeals += 1;
    row.totalValue = row.totalValue.plus(toDecimal(opp.amount));
    byAccount.set(a.id, row);
  }

  return [...byAccount.values()].sort((a, b) => b.totalValue.comparedTo(a.totalValue));
}

/** Leads this partner referred, and what became of them. */
export async function getPortalReferrals() {
  const { partnerId } = await requirePartner();

  const db = await supabaseServer();

  const { data, error } = await db
    .from("lead")
    .select(
      `id, leadNumber, firstName, lastName, companyName, status,
       estimatedValue, createdAt, convertedAt,
       disqualifiedReason,
       convertedOpportunity:opportunity (
         id, opportunityNumber, name, stage, amount, currencyCode
       )`,
    )
    .eq("referredByPartnerId", partnerId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`Could not load referrals: ${error.message}`);

  return (data ?? []).map((l) => ({
    ...l,
    convertedOpportunity: one(l.convertedOpportunity),
  }));
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
    const db = await supabaseServer();

    const { data: partner, error: partnerErr } = await db
      .from("partner")
      .select(
        "displayName, status, partnerManagerId, agreementExpiryDate, commissionPlanId",
      )
      .eq("id", ctx.partnerId)
      .single();

    if (partnerErr || !partner) {
      return { ok: false, error: "Partner record not found." };
    }

    if (partner.status !== "ACTIVE") {
      return {
        ok: false,
        error: "Only an active partnership can register deals. Please speak to your partner manager.",
      };
    }
    // PostgREST returns dates as ISO strings, where Prisma hydrated Date
    // objects. Comparing a string to a Date would be a silent always-false.
    if (
      partner.agreementExpiryDate &&
      new Date(partner.agreementExpiryDate) < new Date()
    ) {
      return {
        ok: false,
        error: "Your partner agreement has expired, so new registrations cannot be accepted. Please speak to your partner manager.",
      };
    }

    const company = data.companyName.trim();

    // Has this customer already been registered, or are they already ours?
    // `ilike` with no wildcards is PostgREST's case-insensitive equality,
    // matching Prisma's `mode: "insensitive"`.
    const [leadRes, accountRes] = await Promise.all([
      db
        .from("lead")
        .select(
          `leadNumber, referredByPartnerId,
           referredByPartner:partner ( displayName )`,
        )
        .is("deletedAt", null)
        .ilike("companyName", company)
        .neq("status", "DISQUALIFIED")
        .limit(1)
        .maybeSingle(),
      db
        .from("account")
        .select(
          `name,
           opportunities:opportunity ( id, stage, deletedAt )`,
        )
        .is("deletedAt", null)
        .ilike("name", company)
        .limit(1)
        .maybeSingle(),
    ]);

    const existingLead = leadRes.data;
    const rawAccount = accountRes.data;

    // Prisma filtered the nested opportunities in the query. PostgREST returns
    // them all, so the open-deal filter is applied here instead.
    const existingAccount = rawAccount
      ? {
          ...rawAccount,
          opportunities: (rawAccount.opportunities ?? []).filter(
            (o: { stage: string; deletedAt: string | null }) =>
              !o.deletedAt && !["CLOSED_WON", "CLOSED_LOST"].includes(o.stage),
          ),
        }
      : null;

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
    let ownerId = partner.partnerManagerId as string | null;

    if (!ownerId) {
      // `role.permissions has "*"` becomes an inner join with a contains filter.
      const { data: admin } = await db
        .from("app_user")
        .select("id, role:security_role!inner(permissions)")
        .eq("status", "ACTIVE")
        .is("deletedAt", null)
        .contains("role.permissions", ["*"])
        .order("createdAt", { ascending: true })
        .limit(1)
        .maybeSingle();
      ownerId = admin?.id ?? null;
    }

    if (!ownerId) {
      return { ok: false, error: "We could not route your registration. Please contact your partner manager." };
    }

    const flags: string[] = [];
    if (contestedByOther) {
      // PostgREST types an embedded to-one relation as an array.
      const referrer = (
        Array.isArray(existingLead!.referredByPartner)
          ? existingLead!.referredByPartner[0]
          : existingLead!.referredByPartner
      ) as { displayName: string } | null;

      flags.push(
        `CONTESTED: ${company} is already on lead ${existingLead!.leadNumber}` +
          (referrer
            ? `, registered by ${referrer.displayName}.`
            : ", submitted directly."),
      );
    }
    if (alreadyCustomer) {
      flags.push(`EXISTING CUSTOMER: ${existingAccount!.name} already has an open opportunity.`);
    }

    const contested = contestedByOther || alreadyCustomer;

    const due = new Date();
    due.setDate(due.getDate() + REGISTRATION_REVIEW_SLA_DAYS);

    const activityBody =
      `${partner.displayName} registered ${company} through the partner portal.` +
      (flags.length ? `\n\n${flags.join("\n")}` : "") +
      `\n\nDecide whether to qualify it. Converting the lead is what credits the partner.`;

    const description = [
      `Deal registration submitted by ${partner.displayName} via the partner portal.`,
      data.expectedCloseDate
        ? `Partner expects to close around ${data.expectedCloseDate.toISOString().slice(0, 10)}.`
        : null,
      "",
      data.description.trim(),
      flags.length ? `\n--- Needs review ---\n${flags.join("\n")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Lead + review task must be created together: a lead with no review task
    // is a registration nobody is assigned to look at. supabase-js has no
    // transaction, so this runs as one database function.
    const { data: created, error: rpcError } = await db
      .rpc("register_partner_deal", {
        p_partner_id: ctx.partnerId,
        p_owner_id: ownerId,
        p_first_name: data.firstName.trim(),
        p_last_name: data.lastName.trim(),
        p_company: company,
        p_email: data.email || "",
        p_phone: data.phone ?? null,
        p_industry: data.industry ?? null,
        p_estimated_value: data.estimatedValue ?? null,
        p_follow_up: data.expectedCloseDate
          ? data.expectedCloseDate.toISOString().slice(0, 10)
          : null,
        p_description: description,
        p_activity_subject: contested
          ? `Contested deal registration: ${company}`
          : `Review deal registration: ${company}`,
        p_activity_body: activityBody,
        p_priority: contested ? "HIGH" : "MEDIUM",
        p_due_at: due.toISOString(),
      })
      .single();

    if (rpcError || !created) {
      return {
        ok: false,
        error: rpcError?.message ?? "We could not submit your registration.",
      };
    }

    const lead = created as { id: string; leadNumber: string };

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
