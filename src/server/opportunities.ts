"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { picklistCode } from "@/lib/picklists";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { createRecord, updateRecord, applyScope, LIST_LIMIT } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission, scopedContext } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import { accrueForWonOpportunity } from "./commission-engine";
import type { ActionResult } from "./partners";

/** Default win probability per stage. Users can still override it. */
const STAGE_PROBABILITY: Record<string, number> = {
  DISCOVERY: 10,
  QUALIFICATION: 20,
  REQUIREMENTS: 30,
  SOLUTION_PROPOSED: 45,
  QUOTE_SUBMITTED: 60,
  NEGOTIATION: 75,
  VERBAL_CONFIRMATION: 90,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
  ON_HOLD: 15,
};

const opportunitySchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  primaryContactId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid(),
  campaignId: z.string().uuid().optional().nullable(),
  stage: z
    .enum([
      "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
      "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
      "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
    ])
    .default("DISCOVERY"),
  // An estimate until the deal has products and services on it. From the
  // first line onwards the amount is their total and this is ignored - see
  // updateOpportunity.
  amount: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().min(0)),
  currencyCode: z.string().length(3).default("PKR"),
  // Nullable, not just optional: z.coerce would turn a blank form field's null
  // into 0 and silently beat the stage default below.
  probabilityPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  expectedCloseDate: z.coerce.date(),
  opportunityType: picklistCode.default("NEW"),
  leadSource: z.string().max(100).optional().nullable(),
  nextStep: z.string().max(500).optional().nullable(),
  description: z.string().optional().nullable(),
});

/**
 * Create a deal.
 *
 * Products and services are NOT set here. They are added afterwards with Add
 * Product & Service, which chooses the price book and prices each line - the
 * deal has to exist first for its lines to belong to it.
 */
export async function createOpportunity(
  input: z.infer<typeof opportunitySchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const opp = await createRecord<{ id: string }>(
      "opportunity",
      {
        name: data.name,
        accountId: data.accountId,
        primaryContactId: data.primaryContactId ?? null,
        ownerUserId: data.ownerUserId,
        campaignId: data.campaignId ?? null,
        stage: data.stage,
        amount: data.amount,
        currencyCode: data.currencyCode,
        probabilityPercent: data.probabilityPercent ?? STAGE_PROBABILITY[data.stage] ?? 10,
        expectedCloseDate: data.expectedCloseDate.toISOString().slice(0, 10),
        opportunityType: data.opportunityType,
        leadSource: data.leadSource ?? null,
        nextStep: data.nextStep ?? null,
        description: data.description ?? null,
      },
      { field: "opportunityNumber", sequence: SEQUENCES.OPPORTUNITY },
    );

    revalidatePath("/opportunities");
    return { ok: true, data: { id: opp.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the opportunity." };
  }
}

/** Stage is deliberately absent — it moves only through `changeStage`, which
 *  carries the §13 gates and fires commission accrual. */
const opportunityUpdateSchema = opportunitySchema.omit({ stage: true });

/**
 * Update a deal's details.
 *
 * Deliberately leaves its products and services alone. Those are edited only
 * through Add Product & Service, which saves them all together. The edit form
 * used to delete and re-insert every line on every save, which is a quiet way
 * to lose a line that has since become a project task.
 */
export async function updateOpportunity(
  id: string,
  input: z.infer<typeof opportunityUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = opportunityUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("opportunity")
      .select("amount, probabilityPercent, pricedByLines, commissionRecords:commission_record ( id )")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "Opportunity not found." };

    // Once a deal has lines, its amount is their total and nothing typed here
    // may replace it.
    const pricedByLines = Boolean(before.pricedByLines);
    const nextAmount = pricedByLines ? before.amount : data.amount;

    // Commission has already been calculated off this amount. Changing it now
    // would silently desync the ledger — clawback is the correct path.
    const accrued = ((before.commissionRecords ?? []) as unknown[]).length;
    if (accrued > 0 && !toDecimal(before.amount).equals(toDecimal(nextAmount))) {
      return {
        ok: false,
        error:
          "Commission has already accrued on this deal, so its amount is locked. Claw the commission back first if the value was wrong.",
      };
    }

    await updateRecord(
      "opportunity",
      id,
      {
        name: data.name,
        accountId: data.accountId,
        primaryContactId: data.primaryContactId ?? null,
        ownerUserId: data.ownerUserId,
        campaignId: data.campaignId ?? null,
        ...(pricedByLines ? {} : { amount: data.amount }),
        currencyCode: data.currencyCode,
        probabilityPercent: data.probabilityPercent ?? before.probabilityPercent,
        expectedCloseDate: data.expectedCloseDate.toISOString().slice(0, 10),
        opportunityType: data.opportunityType,
        leadSource: data.leadSource ?? null,
        nextStep: data.nextStep ?? null,
        description: data.description ?? null,
      },
      "Opportunity",
      user.id,
    );

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the opportunity." };
  }
}

const stageSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum([
    "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
    "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
    "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
  ]),
  lossReason: z.string().max(255).optional().nullable(),
  competitorName: z.string().max(200).optional().nullable(),
});

/**
 * Stage transitions carry the business rules from spec §13:
 *   - Closed Won needs an account, an amount, a close date and an accepted quote.
 *   - Closed Lost needs a loss reason.
 * Winning a deal is also what fires commission accrual for ON_CLOSE_WON plans.
 */
export async function changeStage(
  input: z.infer<typeof stageSchema>,
): Promise<ActionResult<{ commissionsCreated: number; project: { id: string; projectNumber: string } | null; projectError: string | null }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("opportunity")
      .select(
        "amount, probabilityPercent, competitorName, lines:opportunity_product ( id ), quotations:quotation ( id, status )",
      )
      .eq("id", data.id)
      .maybeSingle();

    if (!before) return { ok: false, error: "Opportunity not found." };

    if (data.stage === "CLOSED_LOST" && !data.lossReason) {
      return { ok: false, error: "A loss reason is required to mark a deal Closed Lost." };
    }

    if (data.stage === "CLOSED_WON") {
      if (toDecimal(before.amount).lessThanOrEqualTo(0)) {
        return { ok: false, error: "A won deal needs an amount greater than zero." };
      }
      // The lines are what creates the delivery project and its tasks, and the
      // project is how an invoice later finds its way back to this deal to pay
      // partner commission. Winning with none breaks both, silently - so it is
      // refused here rather than discovered a quarter later.
      if (((before.lines ?? []) as unknown[]).length === 0) {
        return {
          ok: false,
          error:
            "A won deal needs at least one product or service. Add what is being sold, then close it - the delivery project and its tasks are created from those lines.",
        };
      }
      // Prisma filtered the embedded quotations in the query; PostgREST returns
      // them all, so the ACCEPTED filter is applied here.
      const accepted = ((before.quotations ?? []) as { status: string }[]).filter(
        (q) => q.status === "ACCEPTED",
      );
      if (accepted.length === 0) {
        return {
          ok: false,
          error:
            "A won deal needs an accepted quotation. Accept the customer's quote first, or record an approved exception.",
        };
      }
    }

    const isClosing = data.stage === "CLOSED_WON" || data.stage === "CLOSED_LOST";

    await updateRecord(
      "opportunity",
      data.id,
      {
        stage: data.stage,
        probabilityPercent: STAGE_PROBABILITY[data.stage] ?? before.probabilityPercent,
        lossReason: data.stage === "CLOSED_LOST" ? data.lossReason : null,
        competitorName: data.competitorName ?? before.competitorName,
        actualCloseDate: isClosing ? new Date().toISOString().slice(0, 10) : null,
      },
      "Opportunity",
      user.id,
    );

    // Accrual runs in its own transaction so a commission-config problem can
    // never roll back a legitimate stage change.
    let commissionsCreated = 0;
    if (data.stage === "CLOSED_WON") {
      const records = await accrueForWonOpportunity(data.id, user.id);
      commissionsCreated = records.length;
    }

    // A won deal that sold a product gets its delivery project straight away.
    // Separate from the stage change for the same reason as commission: a
    // problem creating the project must not undo a legitimate win, so it is
    // reported alongside the success rather than failing it.
    let project: { id: string; projectNumber: string } | null = null;
    let projectError: string | null = null;
    if (data.stage === "CLOSED_WON") {
      const { data: created, error: projectErr } = await db.rpc("create_project_for_won_opportunity", {
        p_opportunity: data.id,
      });
      if (projectErr) projectError = projectErr.message;
      else if (created) project = { id: created.id, projectNumber: created.projectNumber };
      revalidatePath("/projects");
    }

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${data.id}`);
    revalidatePath("/commissions");
    return { ok: true, data: { commissionsCreated, project, projectError } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change the stage." };
  }
}

export async function listOpportunities(filters?: { stage?: string; search?: string; ownerUserId?: string }) {
  const { where } = await scopedContext("ownerUserId");

  const db = await supabaseServer();

  let query = db
    .from("opportunity")
    .select(
      `*,
       account ( id, name ),
       owner:app_user!opportunity_ownerUserId_fkey ( id, fullName ),
       primaryContact:contact ( firstName, lastName ),
       partners:opportunity_partner ( *, partner ( id, displayName, kind ) ),
       quotations:quotation ( count ),
       commissionRecords:commission_record ( count )`,
    )
    .is("deletedAt", null)
    .order("expectedCloseDate", { ascending: true });

  query = applyScope(query, where);

  if (filters?.stage) query = query.eq("stage", filters.stage);
  if (filters?.ownerUserId) query = query.eq("ownerUserId", filters.ownerUserId);
  if (filters?.search) {
    // Prisma's OR also matched the related account's name. PostgREST cannot OR
    // across an embedded table ("failed to parse logic tree"), so the matching
    // account ids are resolved first and folded into the same or() clause —
    // dropping the clause would silently narrow the search.
    const s = filters.search.replace(/[,()]/g, "");

    const { data: matchingAccounts } = await db
      .from("account")
      .select("id")
      .ilike("name", `%${s}%`)
      .is("deletedAt", null);

    const accountIds = (matchingAccounts ?? []).map((a) => a.id);

    const clauses = [`name.ilike.%${s}%`, `opportunityNumber.ilike.%${s}%`];
    if (accountIds.length) clauses.push(`accountId.in.(${accountIds.join(",")})`);

    query = query.or(clauses.join(","));
  }

  const { data, error } = await query.limit(LIST_LIMIT);
  if (error) throw new Error(`Could not load opportunities: ${error.message}`);

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  return (data ?? []).map((row) => ({
    ...row,
    account: one(row.account as never),
    owner: one(row.owner as never),
    primaryContact: one(row.primaryContact as never),
    partners: ((row.partners ?? []) as Record<string, unknown>[]).map((p) => ({
      ...p,
      partner: one(p.partner as never),
    })),
    _count: {
      quotations: countOf(row.quotations),
      commissionRecords: countOf(row.commissionRecords),
    },
  }));
}

export async function getOpportunity(id: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("opportunity")
    .select(
      `*,
       account ( * ),
       primaryContact:contact ( * ),
       owner:app_user!opportunity_ownerUserId_fkey ( id, fullName, email ),
       campaign ( id, name ),
       priceBook:price_book ( id, name, active ),
       lines:opportunity_product ( *, product ( * ), taxRate:tax_rate ( * ) ),
       quotations:quotation ( * ),
       contracts:contract ( * ),
       projects:project ( id, projectNumber, name, status ),
       partners:opportunity_partner (
         *,
         partner (
           id, partnerNumber, displayName, kind, partnerType,
           defaultCommissionPercent,
           commissionPlan:commission_plan ( name, flatPercent, rateType )
         )
       ),
       commissionRecords:commission_record ( *, partner ( id, displayName ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load opportunity: ${error.message}`);
  if (!data) return null;

  // PostgREST returns embedded collections unordered and unfiltered, so the
  // per-relation orderBy/where from the Prisma query are applied here.
  type Row = Record<string, unknown>;
  const rows = (v: unknown) => ((v as Row[] | null) ?? []);
  const num = (v: unknown) => Number(v ?? 0);

  return {
    ...data,
    account: one(data.account as never),
    primaryContact: one(data.primaryContact as never),
    owner: one(data.owner as never),
    campaign: one(data.campaign as never),
    priceBook: one(data.priceBook as never),
    lines: rows(data.lines)
      .map((l): Row => ({ ...l, product: one(l.product as never), taxRate: one(l.taxRate as never) }))
      .sort((a, b) => num(a.sortOrder) - num(b.sortOrder)),
    quotations: rows(data.quotations).sort(
      (a, b) => num(b.versionNumber) - num(a.versionNumber),
    ),
    contracts: rows(data.contracts),
    projects: rows(data.projects),
    partners: rows(data.partners).map((p) => {
      const partner = one(p.partner as never) as Row | null;
      return {
        ...p,
        partner: partner
          ? { ...partner, commissionPlan: one(partner.commissionPlan as never) }
          : null,
      };
    }),
    commissionRecords: rows(data.commissionRecords)
      .filter((r) => !r.deletedAt)
      .map((r): Row => ({ ...r, partner: one(r.partner as never) }))
      .sort((a, b) => String(b.earnedDate ?? "").localeCompare(String(a.earnedDate ?? ""))),
  };
}

/** Pipeline grouped by stage, for the kanban board. */
export async function getPipelineByStage() {
  const { where } = await scopedContext("ownerUserId");

  const db = await supabaseServer();

  // PostgREST has no groupBy, so the scoped rows are fetched and aggregated
  // here. Pipeline-sized, not report-sized — a larger version would want a view.
  let q = db.from("opportunity").select("stage, amount").is("deletedAt", null);
  q = applyScope(q, where);

  const { data: raw, error } = await q;
  if (error) throw new Error(`Could not load pipeline: ${error.message}`);

  const byStage = new Map<string, { count: number; total: Decimal }>();
  for (const r of raw ?? []) {
    const key = r.stage as string;
    const acc = byStage.get(key) ?? { count: 0, total: toDecimal(0) };
    acc.count += 1;
    acc.total = acc.total.plus(toDecimal(r.amount));
    byStage.set(key, acc);
  }

  const rows = [...byStage.entries()].map(([stage, v]) => ({
    stage,
    _count: v.count,
    _sum: { amount: v.total },
  }));

  return rows.map((r) => ({
    stage: r.stage,
    count: r._count,
    total: r._sum.amount ?? toDecimal(0),
  }));
}
