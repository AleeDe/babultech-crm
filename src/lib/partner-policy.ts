/**
 * Partner programme policy.
 *
 * Commercial decisions, not technical ones, kept in one place where the
 * business can see and change them rather than scattered through the code.
 */

/**
 * Where a partner's email goes unless they change it.
 *
 * Here rather than in the server module that uses it: a "use server" file may
 * only export async functions, and pages need this value to seed the form.
 */
export const DEFAULT_PARTNER_EMAIL_TO = "contact@babultech.com";
