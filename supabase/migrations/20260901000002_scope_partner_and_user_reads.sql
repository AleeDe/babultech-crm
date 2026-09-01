-- Scope the two tables whose read policy was "any internal user".
--
-- partner and app_user both carried `FOR SELECT USING (app_is_internal())`,
-- which is not a scope — it is "is this an employee". A Consultant holding
-- neither partner:read nor admin could read every partner record and every
-- user row through the anon key. The application guards both properly, so no
-- screen showed it; RLS is the backstop for when the application layer is
-- bypassed, and here it was not one.
--
--
-- partner — gated on the permission that already governs the screen
--
-- Straightforward: partner:read is what listPartners() requires, so the policy
-- now asks the same question. Partner portal logins keep their existing
-- policy, which limits them to their own record.
--
--
-- app_user — left alone, deliberately
--
-- The obvious tightening is to revoke costRate and defaultBillingRate from the
-- authenticated role, since those are salary data sitting on a row every
-- employee can read.
--
-- It was checked and rejected: logTime() reads app_user.costRate and
-- defaultBillingRate through the *user's* client to snapshot rates onto a time
-- entry (src/server/timesheets.ts:182), and getUtilisation() does the same for
-- the resources report (:705). Revoking the columns would break time logging
-- for everyone rather than protect anything.
--
-- Restricting the rows instead is worse: thirty-one places read app_user, and
-- several fetch id and fullName to fill owner and assignee dropdowns. Limiting
-- rows to self-and-admin would empty every picker in the app.
--
-- Doing this properly means moving those two reads onto the service-role client
-- first, then revoking the columns. That is an application change, not a policy
-- one, and it is not being smuggled into a migration. Until then app_user stays
-- readable by internal staff, and the application's own permission checks
-- remain the guard — which is what they already were.

-- ------------------------------------------------------------------ partner
DROP POLICY IF EXISTS partner_internal_read ON public.partner;

CREATE POLICY partner_internal_read ON public.partner
  FOR SELECT
  USING (app_is_internal() AND app_has_permission('partner:read'));
