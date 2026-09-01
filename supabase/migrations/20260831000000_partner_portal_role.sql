-- Create the "Partner" role, without which no partner can ever sign in.
--
-- The partner portal is fully built — eight screens under /portal, a session
-- scoped through app_user.partnerId, and both layouts enforcing the internal /
-- external split independently. The user form has a "Partner they act for"
-- picker, and createUser refuses a partner login with no partner attached.
--
-- All of it was unreachable. Both the form and the server key off a role named
-- exactly 'Partner' (PARTNER_ROLE in src/app/(app)/users/user-form.tsx and
-- src/server/users.ts), and the seed never created one. So the picker could not
-- appear, and there was no way to link a login to a partner record through the
-- UI at all.
--
-- Permissions are empty on purpose. The portal does not gate on them: every
-- function in src/server/portal.ts starts with requirePartner(), which checks
-- for a partnerId on the session and nothing else. Granting anything here would
-- only widen what this login could reach if it ever hit an internal screen —
-- and the internal layout already redirects partner users out.
--
-- dataScope is OWN for the same reason: it is the narrowest value the enum
-- allows, and scopeFilter would fall back to it anyway. The real boundary is
-- partnerId, not scope.

INSERT INTO "security_role" ("id", "name", "description", "permissions", "dataScope", "isSystem", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'Partner',
  'External partner portal login. Sees only their own deals, commissions and payouts — never internal records.',
  ARRAY[]::text[],
  'OWN',
  -- System role: this one is structural rather than a customer's own creation,
  -- and renaming it would silently break the partner login path again.
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "security_role" WHERE "name" = 'Partner'
);
