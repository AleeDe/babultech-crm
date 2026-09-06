-- Let the company run its own projects, not only customers'.
--
-- Every project needed an accountId, because a project was assumed to be work
-- sold to somebody. In-house product work has no customer, and the only way to
-- record it was to point it at a fake account — which then showed BabulTech's
-- own R&D sitting in an account record beside real customer engagements, and
-- fed it into anything that reads project value per account.
--
-- Two changes, together:
--
--   * "projectType" says what kind of work this is. It is NOT NULL with a
--     CUSTOMER default so every existing row keeps exactly the meaning it had —
--     nothing is reclassified by this migration.
--
--   * "accountId" becomes nullable, because internal work genuinely has no
--     account. The CHECK below is what stops that nullability from being a hole:
--     a CUSTOMER project must still name its customer, so the requirement is not
--     lost, it is now conditional on the type that actually implies it.
--
-- The same CHECK forbids the other direction: an INTERNAL project may not carry
-- an account. Without that half, an internal project could keep a stale account
-- from before it was reclassified, and every report filtering on accountId would
-- silently count it as customer work again.

CREATE TYPE "ProjectType" AS ENUM ('CUSTOMER', 'INTERNAL');

ALTER TABLE "project"
  ADD COLUMN "projectType" "ProjectType" NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE "project"
  ALTER COLUMN "accountId" DROP NOT NULL;

ALTER TABLE "project"
  ADD CONSTRAINT "project_account_matches_type" CHECK (
    ("projectType" = 'CUSTOMER' AND "accountId" IS NOT NULL)
    OR
    ("projectType" = 'INTERNAL' AND "accountId" IS NULL)
  );

-- The list screen filters by type, and every project row carries one.
CREATE INDEX "project_projectType_idx" ON "project" ("projectType");
