-- Let the people who spend the money file a claim for it.
--
-- Expenses were gated entirely behind invoice:read / invoice:write, which only
-- Finance, Administrator and (read-only) the sales and project managers hold.
-- Consultants held neither, so a resource who paid for something out of pocket
-- could not record it at all — the claim had to be typed in by Finance on their
-- behalf, which defeats the approval trail the expense module exists to keep.
--
-- invoice:write is the permission createExpense checks, so it is what a claimant
-- needs. It is deliberately NOT paired with invoice:approve: filing a claim and
-- approving one stay separate, and setExpenseApproval independently refuses to
-- let anyone approve their own claim regardless of role.
--
-- Row scope still applies on top of this. Consultant is an OWN-scope role, so a
-- consultant sees their own claims and not their colleagues'.

UPDATE "security_role"
SET "permissions" = (
      SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['invoice:read', 'invoice:write']))
    ),
    "updatedAt" = NOW()
WHERE "name" IN ('Consultant', 'Project Manager');

-- Sales roles keep read-only access: they have invoice:read already for quoting
-- context, and a sales rep filing an expense goes through the same claim flow
-- once someone grants it explicitly.
