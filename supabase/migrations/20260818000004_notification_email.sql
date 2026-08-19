-- Separate where a person signs in from where their mail is delivered.
--
-- app_user.email is sign-in identity: it must match auth.users.email exactly,
-- because that pair is what authenticates. It was also doubling as the delivery
-- address for every notification, which ties two unrelated decisions together.
--
-- That coupling bites the moment the two need to differ. Moving the team onto
-- @babultech.com logins is worth doing on its own — it is professional, and the
-- company keeps control of the accounts when someone leaves — but the mailboxes
-- behind those addresses do not exist yet. Under the old arrangement the switch
-- would have silently redirected every approval email to an inbox nobody can
-- open, which is worse than not switching at all.
--
-- notificationEmail is nullable and means "send here instead". Null is the
-- normal case and keeps today's behaviour, so nothing changes for a user who
-- has not set one. Clearing it once the real mailbox exists is how this is
-- unwound — no second migration needed.
--
-- Deliberately NOT unique: two people may legitimately route notifications to
-- the same shared inbox, and a uniqueness constraint here would only produce
-- confusing failures. Uniqueness matters on `email`, which is identity.

ALTER TABLE "app_user"
  ADD COLUMN IF NOT EXISTS "notificationEmail" VARCHAR(255);

COMMENT ON COLUMN "app_user"."notificationEmail" IS
  'Where notifications are delivered, when that differs from the sign-in address in "email". Null means use "email".';
