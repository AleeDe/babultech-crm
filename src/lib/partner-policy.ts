/**
 * Partner programme policy.
 *
 * These are commercial decisions, not technical ones — they belong in one place
 * where the business can see and change them, rather than scattered through the
 * code as magic numbers.
 */

/**
 * How long a partner's claim on a registered deal is protected.
 *
 * The clock runs from when the partner **registered** the deal, not from when
 * we got round to converting it — otherwise a slow internal review would
 * silently extend their protection, and a fast one would shorten it.
 *
 * Ninety days is the common default across partner programmes. Raising it is
 * generous to partners; lowering it makes the claim harder to keep alive.
 * `commission-engine.ts` refuses to accrue against a lapsed registration, so
 * this number decides real money.
 */
export const DEAL_REGISTRATION_PROTECTION_DAYS = 90;

/**
 * Protection window by partner tier.
 *
 * A longer window is the cheapest reward in a partner programme: it costs
 * nothing unless the partner actually wins, and it is what a partner feels
 * when they are promoted. These are the conventional shape — each step roughly
 * half again as long — but they are **BabulTech's commercial policy to set**,
 * not a technical constant. Change the numbers here and every future
 * registration follows; existing registrations keep the window they were given,
 * because the expiry is stamped on the record rather than computed on read.
 */
export const TIER_PROTECTION_DAYS: Record<string, number> = {
  REGISTERED: 60,
  SILVER: 90,
  GOLD: 120,
  PLATINUM: 180,
};

/**
 * How long this partner's registrations are protected.
 *
 * Precedence: a per-partner override beats the tier default, which beats the
 * programme default. The override exists because a specific partner will
 * eventually negotiate a specific number, and encoding that as a fake tier
 * would corrupt the tier's meaning everywhere else.
 */
export function protectionDaysFor(
  tier: string | null | undefined,
  override?: number | null,
): number {
  if (override && override > 0) return override;
  return (tier && TIER_PROTECTION_DAYS[tier]) || DEAL_REGISTRATION_PROTECTION_DAYS;
}

/** How long before expiry a partner is warned on their portal. */
export const REGISTRATION_EXPIRY_WARNING_DAYS = 30;

/** Working days a partner manager has to review a new registration. */
export const REGISTRATION_REVIEW_SLA_DAYS = 2;

export function registrationExpiry(
  registeredAt: Date,
  days = DEAL_REGISTRATION_PROTECTION_DAYS,
): Date {
  const expiry = new Date(registeredAt);
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}

/**
 * Where a partner's email goes unless they change it.
 *
 * Here rather than in the server module that uses it: a "use server" file may
 * only export async functions, and pages need this value to seed the form.
 */
export const DEFAULT_PARTNER_EMAIL_TO = "contact@babultech.com";
