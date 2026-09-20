"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { getPortalContext } from "./portal";
import type { ActionResult } from "./partners";

/**
 * A partner asking for a different rate on a deal, and our answer.
 *
 * Nothing here pays anybody. A proposal is a request; approving it is what
 * writes opportunity_partner.commissionPercentOverride, and only a holder of
 * commission:approve can do that. The two cannot drift apart because the
 * database function does both in one transaction.
 */

export interface CommissionProposal {
  id: string;
  partnerId: string;
  opportunityId: string;
  proposedPercent: number;
  currentPercent: number | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  decisionNote: string | null;
  approvedPercent: number | null;
  decidedAt: string | null;
  createdAt: string;
  partner?: { displayName: string; partnerNumber: string } | null;
  opportunity?: {
    name: string;
    opportunityNumber: string;
    amount: number;
    currencyCode: string;
    account?: { name: string } | null;
  } | null;
  decidedBy?: { fullName: string } | null;
}

const SELECT = `
  id, partnerId, opportunityId, proposedPercent, currentPercent, reason, status,
  decisionNote, approvedPercent, decidedAt, createdAt,
  partner ( displayName, partnerNumber ),
  opportunity ( name, opportunityNumber, amount, currencyCode, account ( name ) ),
  decidedBy:app_user!commission_proposal_decidedById_fkey ( fullName )
`;

// ---------------------------------------------------------------------------
// The partner's side
// ---------------------------------------------------------------------------

const proposeSchema = z.object({
  opportunityId: z.string().uuid(),
  percent: z.coerce.number().min(0, "A rate cannot be negative.").max(100, "A rate cannot exceed 100%."),
  reason: z.string().trim().min(10, "Say why this deal deserves a different rate — a sentence is enough."),
});

export async function proposeCommission(
  input: z.infer<typeof proposeSchema>,
): Promise<ActionResult<{ id: string; currentPercent: number | null }>> {
  const ctx = await getPortalContext();
  if (!ctx?.partnerId) return { ok: false, error: "Your session has ended. Sign in again and retry." };

  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("partner_propose_commission", {
    p_opportunity_id: parsed.data.opportunityId,
    p_percent: parsed.data.percent,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/deals");
  revalidatePath("/portal/commissions");
  return { ok: true, data: data as { id: string; currentPercent: number | null } };
}

export async function withdrawProposal(id: string): Promise<ActionResult> {
  const ctx = await getPortalContext();
  if (!ctx?.partnerId) return { ok: false, error: "Your session has ended. Sign in again and retry." };

  const db = await supabaseServer();
  const { error } = await db.rpc("partner_withdraw_proposal", { p_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/portal/deals");
  return { ok: true, data: undefined };
}

/** This partner's own requests. RLS scopes it; no filter is needed here. */
export async function listMyProposals(): Promise<CommissionProposal[]> {
  const ctx = await getPortalContext();
  if (!ctx?.partnerId) return [];

  const db = await supabaseServer();
  const { data, error } = await db
    .from("commission_proposal")
    .select(SELECT)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`Could not load your rate requests: ${error.message}`);
  return (data ?? []) as unknown as CommissionProposal[];
}

// ---------------------------------------------------------------------------
// Our side
// ---------------------------------------------------------------------------

export async function listCommissionProposals(status?: string): Promise<CommissionProposal[]> {
  await requirePermission(PERMISSIONS.COMMISSION_READ);

  const db = await supabaseServer();
  let query = db.from("commission_proposal").select(SELECT);
  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("createdAt", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load rate requests: ${error.message}`);
  return (data ?? []) as unknown as CommissionProposal[];
}

/** How many are waiting, for the badge on the approvals inbox. */
export async function countPendingProposals(): Promise<number> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return 0;

  const db = await supabaseServer();
  const { count } = await db
    .from("commission_proposal")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");

  return count ?? 0;
}

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  /** Blank grants exactly what was asked for; a number is a counter-offer. */
  percent: z.coerce.number().min(0).max(100).optional().nullable(),
  note: z.string().trim().max(2000).optional(),
});

export async function decideCommissionProposal(
  input: z.infer<typeof decideSchema>,
): Promise<ActionResult<{ status: string; percent?: number }>> {
  const auth = await authorize(PERMISSIONS.COMMISSION_APPROVE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  // Said here as well as in the database so the partner-facing rule is visible
  // in the code that runs first, and the error arrives without a round trip.
  if (!d.approve && !d.note?.trim()) {
    return { ok: false, error: "Tell the partner why the rate was not agreed." };
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("decide_commission_proposal", {
    p_id: d.id,
    p_approve: d.approve,
    p_percent: d.percent ?? null,
    p_note: d.note ?? null,
    p_actor_id: auth.user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/commissions");
  revalidatePath("/approvals");
  revalidatePath("/portal/deals");
  return { ok: true, data: data as { status: string; percent?: number } };
}
