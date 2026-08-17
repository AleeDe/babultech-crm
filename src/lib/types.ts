/**
 * Domain types.
 *
 * These replace the types Prisma used to generate. They describe the shapes the
 * application actually reads, which is a subset of each table — supabase-js
 * returns plain JSON, so nothing generates them for us.
 *
 * Numeric columns arrive from PostgREST as `number | string` (never a Decimal
 * object), which is why money fields are typed that way. Always put them
 * through `toDecimal()` from lib/decimal before doing arithmetic.
 */

export type CommissionBasis =
  | "OPPORTUNITY_AMOUNT"
  | "INVOICED_AMOUNT"
  | "COLLECTED_AMOUNT"
  | "GROSS_MARGIN";

export type CommissionRateType = "FLAT_PERCENT" | "TIERED_PERCENT" | "FIXED_AMOUNT";

export type CommissionTrigger =
  | "ON_OPPORTUNITY_WON"
  | "ON_INVOICE_SENT"
  | "ON_PAYMENT_RECEIVED";

/**
 * A money value as it comes back from PostgREST.
 *
 * Nullable columns widen this to `Numeric | null` at the field. Arithmetic must
 * go through `toDecimal()`, which maps null/undefined to zero — passing a raw
 * null into `new Decimal()` throws.
 */
export type Numeric = number | string;

export interface CommissionTier {
  id: string;
  planId: string;
  fromAmount: Numeric;
  toAmount: Numeric | null;
  ratePercent: Numeric;
}

export interface CommissionPlan {
  id: string;
  name: string;
  rateType: CommissionRateType;
  flatPercent: Numeric | null;
  fixedAmount: Numeric | null;
  minimumDealAmount: Numeric | null;
  maximumPayout: Numeric | null;
  basis: CommissionBasis;
  trigger: CommissionTrigger;
  payoutDelayDays: number | null;
  clawbackWindowDays: number | null;
  active: boolean;
}

export type PlanWithTiers = CommissionPlan & { tiers: CommissionTier[] };

export interface PartnerSummary {
  id: string;
  displayName: string;
  status: string;
  tier: string | null;
  defaultCommissionPercent: Numeric;
  withholdingTaxPercent: Numeric;
  registrationProtectionDays: number | null;
  commissionPlanId: string | null;
}

export interface OpportunityPartnerLink {
  id: string;
  partnerId: string;
  role: string;
  revenueSharePercent: Numeric;
  commissionPercentOverride: Numeric;
  registeredAt: string | null;
  registrationExpiresAt: string | null;
  commissionPlanId: string | null;
}

/**
 * The mediums a MESSAGE_SENT touch can go out on.
 *
 * Here rather than in server/crm.ts because that file is "use server", where
 * every export must be an async function — a plain array there is a build
 * error. Both the Zod schema and the form's select read it from this module.
 */
export const MESSAGE_CHANNELS = ["WHATSAPP", "SMS", "LINKEDIN", "OTHER"] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
