-- Give expense claims their own permission, and take the receivables ledger
-- back off the people who only needed to claim a taxi fare.
--
-- 20260818000001 let Consultants and Project Managers file expenses by granting
-- them invoice:read and invoice:write. That worked, but invoice:read is also
-- the key to every other finance screen: listVendorBills, listVendorPayments,
-- getInvoice, getPayablesSummary and the Finance dashboard card all gate on it.
-- So a consultant who could claim an expense could also read the company's
-- invoices, its supplier bills and what it had collected that month — none of
-- which is any part of filing a claim.
--
-- The fix is a permission that means what it says. expense:read / expense:write
-- / expense:approve now gate the expense module, and the roles that only ever
-- needed to claim hold those instead of the invoice family.
--
-- Separation of duties is preserved and slightly tightened:
--   * expense:write files and edits a claim; expense:approve decides it and
--     marks it paid. A claimant holds only the first.
--   * setExpenseApproval independently refuses self-approval whatever the role,
--     so holding both is still not enough to approve your own claim.

-- 1. Everyone who could already work with expenses keeps being able to.
--    Finance and Administrator ran the module through invoice:*, so they take
--    the full expense set.
UPDATE "security_role"
SET "permissions" = ARRAY(
      SELECT DISTINCT unnest(
        "permissions" || ARRAY['expense:read', 'expense:write', 'expense:approve']
      )
    ),
    "updatedAt" = NOW()
WHERE "name" IN ('Finance', 'Administrator');

-- 2. The claimants get to claim, and nothing more.
UPDATE "security_role"
SET "permissions" = ARRAY(
      SELECT DISTINCT unnest(
        "permissions" || ARRAY['expense:read', 'expense:write']
      )
    ),
    "updatedAt" = NOW()
WHERE "name" IN ('Consultant', 'Project Manager');

-- 3. Withdraw the borrowed finance access from Consultant.
--
--    Project Manager is deliberately left holding invoice:read: it had that
--    before the expense change (delivery needs to see what a project has been
--    billed), so removing it here would take away something the role legitimately
--    held. Only invoice:write — granted purely to enable claims — goes.
UPDATE "security_role"
SET "permissions" = array_remove(
      array_remove("permissions", 'invoice:read'),
      'invoice:write'
    ),
    "updatedAt" = NOW()
WHERE "name" = 'Consultant';

UPDATE "security_role"
SET "permissions" = array_remove("permissions", 'invoice:write'),
    "updatedAt" = NOW()
WHERE "name" = 'Project Manager';
