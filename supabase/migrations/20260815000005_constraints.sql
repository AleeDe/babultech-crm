-- Integrity rules that Prisma's schema language cannot express.
-- Run after `prisma migrate dev` / `prisma db push`:
--   psql "$DATABASE_URL" -f prisma/sql/01_constraints.sql

-- --------------------------------------------------------------------------
-- Partner identity: a partner is EITHER a company (account) OR an individual
-- (contact) — never both, never neither. This is what makes "a partner can be
-- created as a contact only, without any partner account" safe.
-- --------------------------------------------------------------------------
ALTER TABLE partner DROP CONSTRAINT IF EXISTS partner_identity_check;
ALTER TABLE partner ADD CONSTRAINT partner_identity_check CHECK (
  (kind = 'COMPANY'    AND "accountId" IS NOT NULL AND "contactId" IS NULL) OR
  (kind = 'INDIVIDUAL' AND "contactId" IS NOT NULL AND "accountId" IS NULL)
);

-- Spec §13 "Account roles": Partner Profile is allowed only when the linked
-- account is of type PARTNER.
CREATE OR REPLACE FUNCTION assert_partner_account_type() RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS NOT NULL THEN
    IF (SELECT "accountType" FROM account WHERE id = NEW."accountId") <> 'PARTNER' THEN
      RAISE EXCEPTION 'Account % must have accountType = PARTNER to carry a partner record', NEW."accountId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partner_account_type_check ON partner;
CREATE TRIGGER partner_account_type_check
  BEFORE INSERT OR UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION assert_partner_account_type();

-- --------------------------------------------------------------------------
-- Revenue-share splits on a deal may not exceed 100%.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_revenue_share_total() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
BEGIN
  SELECT COALESCE(SUM("revenueSharePercent"), 0) INTO total
  FROM opportunity_partner
  WHERE "opportunityId" = NEW."opportunityId" AND id <> NEW.id;

  IF total + NEW."revenueSharePercent" > 100.0001 THEN
    RAISE EXCEPTION 'Partner revenue share for opportunity % would total %%% (max 100%%)',
      NEW."opportunityId", total + NEW."revenueSharePercent";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opportunity_partner_share_check ON opportunity_partner;
CREATE TRIGGER opportunity_partner_share_check
  BEFORE INSERT OR UPDATE ON opportunity_partner
  FOR EACH ROW EXECUTE FUNCTION assert_revenue_share_total();

-- --------------------------------------------------------------------------
-- Spec §13: only one Accepted quotation version per opportunity.
-- --------------------------------------------------------------------------
DROP INDEX IF EXISTS quotation_one_accepted_per_opportunity;
CREATE UNIQUE INDEX quotation_one_accepted_per_opportunity
  ON quotation ("opportunityId") WHERE status = 'ACCEPTED' AND "deletedAt" IS NULL;

-- --------------------------------------------------------------------------
-- Spec §13: payment allocations cannot exceed the payment amount.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_payment_allocation() RETURNS trigger AS $$
DECLARE
  allocated NUMERIC;
  payment_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM("allocatedAmount"), 0) INTO allocated
  FROM payment_allocation WHERE "paymentId" = NEW."paymentId" AND id <> NEW.id;

  SELECT amount INTO payment_total FROM payment WHERE id = NEW."paymentId";

  IF allocated + NEW."allocatedAmount" > payment_total + 0.005 THEN
    RAISE EXCEPTION 'Allocations (%) exceed payment amount (%)', allocated + NEW."allocatedAmount", payment_total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_allocation_check ON payment_allocation;
CREATE TRIGGER payment_allocation_check
  BEFORE INSERT OR UPDATE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION assert_payment_allocation();

-- --------------------------------------------------------------------------
-- Spec §13 "Time logging": a time log must reference at least one work context.
-- --------------------------------------------------------------------------
ALTER TABLE time_log DROP CONSTRAINT IF EXISTS time_log_context_check;
ALTER TABLE time_log ADD CONSTRAINT time_log_context_check CHECK (
  "projectId" IS NOT NULL OR "projectTaskId" IS NOT NULL OR "caseId" IS NOT NULL
);

-- Spec §13 "Case ownership": an open case needs an owner or a team.
ALTER TABLE support_case DROP CONSTRAINT IF EXISTS case_assignment_check;
ALTER TABLE support_case ADD CONSTRAINT case_assignment_check CHECK (
  status IN ('CLOSED', 'CANCELLED', 'RESOLVED')
  OR "ownerUserId" IS NOT NULL OR "teamId" IS NOT NULL
);

-- Spec §13 "Opportunity closure": Closed Lost requires a loss reason.
ALTER TABLE opportunity DROP CONSTRAINT IF EXISTS opportunity_loss_reason_check;
ALTER TABLE opportunity ADD CONSTRAINT opportunity_loss_reason_check CHECK (
  stage <> 'CLOSED_LOST' OR "lossReason" IS NOT NULL
);

-- A campaign member must be a lead or a contact.
ALTER TABLE campaign_member DROP CONSTRAINT IF EXISTS campaign_member_target_check;
ALTER TABLE campaign_member ADD CONSTRAINT campaign_member_target_check CHECK (
  "leadId" IS NOT NULL OR "contactId" IS NOT NULL
);
