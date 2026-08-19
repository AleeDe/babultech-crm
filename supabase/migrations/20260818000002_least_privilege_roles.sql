-- Apply least privilege to the seeded roles.
--
-- Three things were wider than the job needs. Each is a case where a role could
-- see or do something its holder has no business reason for, and none of them
-- were deliberate — they came from broad wildcards in the original seed.
--
--
-- 1. Finance: dataScope ALL -> DEPARTMENT
--
-- Finance held ALL, which is every row in the system: every lead, every deal,
-- every project, every support case. Its permissions already stop it *acting*
-- outside invoices and payments, but scope governs what is *visible*, and
-- "can read every customer conversation in the company" is not part of paying
-- bills. DEPARTMENT keeps finance staff seeing each other's work while ending
-- the blanket read.
--
-- Note this does NOT restrict the finance module itself. Invoices, payments and
-- expenses are filtered by their own ownership rules, not by scopeFilter on a
-- generic ownerUserId, so Finance still sees the whole ledger. What changes is
-- the CRM records around it.
--
--
-- 2. Sales Manager: loses commission:approve and payout:approve
--
-- The manager who books the deal was also approving the commission earned on
-- it and releasing the payout. That is the textbook separation-of-duties
-- failure: one person creates the obligation, approves it, and pays it, with no
-- second pair of eyes anywhere in the chain.
--
-- Commission approval moves to Finance, which already holds payout:approve and
-- is the function that should be signing off money going out. Sales Manager
-- keeps commission:read and commission:write, so they can still see and adjust
-- what their team is owed — they just cannot approve their own team's payments.
--
--
-- 3. Consultant: loses account:read
--
-- A consultant's work is projects and support cases. The account list is the
-- full customer book including revenue and credit terms, and nothing a
-- consultant does needs it. Project and case records carry the customer name
-- they actually need.
--
-- Deliberately NOT changed: Administrator keeps ["*"] with ALL. A founder-level
-- role that can see and fix everything is correct, and the separation that
-- matters is enforced per action rather than per role — setExpenseApproval
-- refuses self-approval no matter who is asking.

-- 1. Finance: narrow the blanket read.
UPDATE "security_role"
SET "dataScope" = 'DEPARTMENT',
    "updatedAt" = NOW()
WHERE "name" = 'Finance';

-- 2. Finance gains commission approval, so it is not left unheld.
UPDATE "security_role"
SET "permissions" = ARRAY(
      SELECT DISTINCT unnest("permissions" || ARRAY['commission:approve'])
    ),
    "updatedAt" = NOW()
WHERE "name" = 'Finance';

-- 3. Sales Manager gives up approving the money it generates.
--
-- commission:* is expanded to the specific grants first, because the wildcard
-- silently re-grants commission:approve however many times it is removed.
UPDATE "security_role"
SET "permissions" = ARRAY(
      SELECT DISTINCT unnest(
        array_remove(
          array_remove(
            array_remove("permissions", 'commission:*'),
            'commission:approve'
          ),
          'payout:approve'
        ) || ARRAY['commission:read', 'commission:write']
      )
    ),
    "updatedAt" = NOW()
WHERE "name" = 'Sales Manager';

-- 4. Consultant loses the customer book.
UPDATE "security_role"
SET "permissions" = array_remove("permissions", 'account:read'),
    "updatedAt" = NOW()
WHERE "name" = 'Consultant';
