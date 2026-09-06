-- A register of the credentials the company depends on.
--
-- API keys, service passwords and mailbox logins were living in .env files, a
-- spreadsheet and people's heads. Nobody could answer the two questions that
-- actually cause outages and breaches: what is about to expire, and who still
-- has a key that should have been revoked when they changed role.
--
-- WHAT IS AND IS NOT STORED
--
-- "valueCiphertext" holds the secret encrypted with AES-256-GCM. The key is
-- SECRET_VAULT_KEY in the environment, never in this database. That separation
-- is the whole security model: a dump of this table, on its own, yields
-- nothing readable. Anyone who can read the table AND the app environment can
-- decrypt, so SECRET_VAULT_KEY must never be committed or stored in a row here.
--
-- The IV is stored per row, in the clear, which is how GCM is meant to be used
-- — it must be unique per encryption, not secret. The auth tag is stored with
-- it so tampering with a ciphertext fails to decrypt rather than silently
-- returning wrong plaintext.
--
-- EXPIRY
--
-- "expiresAt" is nullable because plenty of credentials genuinely never expire.
-- A null means "no known expiry", NOT "expired" — every screen has to treat the
-- two differently or non-expiring keys would sit permanently in the warning list
-- and train people to ignore it.

CREATE TYPE "SecretKind" AS ENUM (
  'API_KEY', 'PASSWORD', 'EMAIL_ACCOUNT', 'DATABASE', 'CERTIFICATE',
  'SSH_KEY', 'WEBHOOK_SECRET', 'TOKEN', 'OTHER'
);

CREATE TYPE "SecretEnvironment" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'SHARED');

CREATE TYPE "SecretStatus" AS ENUM ('ACTIVE', 'ROTATING', 'REVOKED');

CREATE TABLE "secret" (
    "id" UUID NOT NULL,
    "secretNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "kind" "SecretKind" NOT NULL DEFAULT 'API_KEY',
    "environment" "SecretEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "status" "SecretStatus" NOT NULL DEFAULT 'ACTIVE',

    -- Which system this belongs to ("Stripe", "Resend"), and the login it goes
    -- with where there is one. A key with no service name is unattributable
    -- six months later, so the service is required.
    "service" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255),
    "url" TEXT,

    -- The secret itself. Ciphertext, IV and auth tag are base64.
    "valueCiphertext" TEXT NOT NULL,
    "valueIv" TEXT NOT NULL,
    "valueTag" TEXT NOT NULL,
    -- Last 4 characters, in the clear, so a key can be matched against a
    -- provider's dashboard without decrypting anything.
    "valueHint" VARCHAR(8),

    -- Who is accountable for it, as distinct from whoever typed it in.
    "ownerUserId" UUID NOT NULL,

    "expiresAt" DATE,
    "rotationDays" INTEGER,
    "lastRotatedAt" DATE,

    -- Where the live copy actually is, e.g. "Vercel env STRIPE_SECRET_KEY".
    "storedIn" TEXT,
    "notes" TEXT,

    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "secret_pkey" PRIMARY KEY ("id"),
    -- A rotation period of zero or a negative number would make "next due"
    -- meaningless, and nulls already express "we do not rotate this".
    CONSTRAINT "secret_rotation_days_positive" CHECK ("rotationDays" IS NULL OR "rotationDays" > 0)
);

CREATE UNIQUE INDEX "secret_secretNumber_key" ON "secret"("secretNumber");
CREATE INDEX "secret_service_idx" ON "secret"("service");
CREATE INDEX "secret_expiresAt_idx" ON "secret"("expiresAt");
CREATE INDEX "secret_ownerUserId_idx" ON "secret"("ownerUserId");

ALTER TABLE "secret" ADD CONSTRAINT "secret_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "secret" ADD CONSTRAINT "secret_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every decryption, recorded.
--
-- A separate table rather than audit_history rows: reading a secret is not a
-- change to it, and the thing that matters during an incident is "who saw this
-- key, and when" — a question you want to answer without filtering it out of
-- every field-level edit in the system. This table is append-only by intent;
-- no policy below grants update or delete to anyone.
CREATE TABLE "secret_access_log" (
    "id" UUID NOT NULL,
    "secretId" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(30) NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "secret_access_log_secretId_idx" ON "secret_access_log"("secretId", "accessedAt" DESC);

ALTER TABLE "secret_access_log" ADD CONSTRAINT "secret_access_log_secretId_fkey"
  FOREIGN KEY ("secretId") REFERENCES "secret"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "secret_access_log" ADD CONSTRAINT "secret_access_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- includeYear off: a credential's reference should stay stable across a new
-- year, and these are not documents anyone files by year.
INSERT INTO "number_sequence" ("id", "entityType", "prefix", "nextValue", "paddingLength", "includeYear", "updatedAt")
VALUES (gen_random_uuid(), 'Secret', 'SEC-', 1, 5, false, now());

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Deliberately the tightest rules in the schema. There is no "own records"
-- scope here and no partner access at all: a credential is either something you
-- are trusted to handle or it is not, and the vault holds production keys whose
-- exposure is not undone by revoking a row later.
--
-- SELECT is granted on secret:read, which does NOT reveal the value — the
-- ciphertext is useless without SECRET_VAULT_KEY, and the application never
-- sends it to the browser except through the audited reveal path.

ALTER TABLE "secret" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "secret_access_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "secret_read" ON "secret"
  FOR SELECT USING (app_has_permission('secret:read'));

-- Split rather than FOR ALL, so the write rule cannot widen the read rule.
-- See 20260901000001_write_policies_not_select.sql for why that matters.
CREATE POLICY "secret_insert" ON "secret"
  FOR INSERT WITH CHECK (app_has_permission('secret:write'));

CREATE POLICY "secret_update" ON "secret"
  FOR UPDATE USING (app_has_permission('secret:write'))
  WITH CHECK (app_has_permission('secret:write'));

-- No DELETE policy. Secrets are retired by setting status REVOKED and stamping
-- deletedAt through the application, so the access log keeps pointing at a row
-- that still exists. A hard delete would erase the record of who held what.

-- The log is readable by the same people who can read the vault, and written by
-- the application. No update or delete policy exists for anyone, which is what
-- makes it append-only: someone who reveals a key cannot then erase the trace.
CREATE POLICY "secret_access_log_read" ON "secret_access_log"
  FOR SELECT USING (app_has_permission('secret:read'));

CREATE POLICY "secret_access_log_insert" ON "secret_access_log"
  FOR INSERT WITH CHECK (app_has_permission('secret:read'));
