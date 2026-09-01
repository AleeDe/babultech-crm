-- Take salary data off the row every employee can read.
--
-- app_user's read policy is `USING (app_is_internal())` — any employee reads
-- every colleague's row. That is defensible for a staff directory, and the app
-- depends on it: thirty-one places read app_user, several to fill owner and
-- assignee dropdowns. Restricting the rows would empty every picker.
--
-- The problem was never the names. It is that the same row carries costRate and
-- defaultBillingRate, so "I can see my colleagues in a dropdown" also meant "I
-- can read what everyone is paid". RLS is row-level and cannot separate those.
--
-- Column privileges can. The row policy stays open, so the directory keeps
-- working; these two columns are revoked from anon and authenticated, so a
-- query naming them errors instead of returning them.
--
-- The five places that legitimately need the rates were moved onto the
-- service-role client first, which column privileges do not restrict:
--
--   logTime()                  — snapshots the caller's own rates onto an entry
--   getUtilisation()           — the resources report, now behind time:approve
--   addProjectMember()         — seeds a new member's rates
--   getProjectFormOptions()    — the team picker
--   the project page's user list
--
-- Each is pinned either to the caller's own id or behind a permission check, so
-- none of them is a wider door than it was before.
--
-- getUtilisation also had its own guard raised from project:read to
-- time:approve in the same change. The page that renders it already required
-- time:approve, so the weaker check on the function was a way around its own
-- screen's gate.

-- A column-level REVOKE cannot override a table-level GRANT, and app_user has
-- one: `GRANT SELECT ON app_user TO anon, authenticated` covers every column,
-- including any added later. Revoking the two columns alone therefore did
-- nothing — the table grant still allowed them.
--
-- So the table grant goes, and column grants are issued back for everything
-- except the two rate columns. This is the only way Postgres expresses
-- "all columns but these".
--
-- Listed explicitly rather than generated, so a column added in a later
-- migration is invisible to these roles until someone decides it should be
-- readable. That is the safe direction for a default: a new column that turns
-- out to be sensitive stays hidden, rather than being exposed the moment it
-- exists.
--
-- passwordHash falls out of the list too, and stays out. It is dead since the
-- move to Supabase Auth and nothing reads it, but a column of bcrypt hashes
-- readable by every signed-in user was never a good idea.
REVOKE SELECT ON public.app_user FROM anon, authenticated;

GRANT SELECT (
  "id",
  "email",
  "fullName",
  "jobTitle",
  "phone",
  "employeeNumber",
  "status",
  "roleId",
  "departmentId",
  "managerUserId",
  "partnerId",
  "avatarUrl",
  -- Shown on the profile and user screens, which read through the user's own
  -- client — withholding it would break three pages to protect nothing. When
  -- someone last signed in is not a secret from their colleagues.
  "lastLoginAt",
  "createdAt",
  "updatedAt",
  "deletedAt"
) ON public.app_user TO anon, authenticated;

COMMENT ON COLUMN public.app_user."costRate" IS
  'What this person costs per hour. Revoked from anon and authenticated — readable only through the service role, behind an application permission check.';

COMMENT ON COLUMN public.app_user."defaultBillingRate" IS
  'Standard charge-out rate. Same restriction as costRate.';
