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
