-- Let a logged touch say "message sent", and remember which campaign it was for.
--
-- Two gaps showed up in the same place: the activity form.
--
-- 1. MESSAGE_SENT
--
-- ActivityType only had TASK, CALL, MEETING and REMINDER. A rep who sent a
-- WhatsApp, an SMS or a LinkedIn message had to file it as a CALL — which is
-- wrong in the one place it matters, the report that asks "how did we reach
-- this lead?". Calls and messages have very different answer rates, so folding
-- them together makes the channel comparison meaningless.
--
-- The value is deliberately channel-neutral. A separate enum member per
-- channel (WHATSAPP, SMS, LINKEDIN) would multiply the type filter and force a
-- migration every time a new channel appears; the channel goes in `channel`
-- below instead, where it is data rather than schema.
--
-- 2. campaignId
--
-- The activity table could already point at an arbitrary record through
-- relatedEntityType/relatedEntityId, but that is the generic polymorphic link
-- and it is what a touch's *subject* uses (the lead, the case). Attribution is
-- a second, independent question: this call was made as part of the Q3
-- outbound push. Overloading the polymorphic pair for it would mean a touch
-- could be attributed to a campaign only if it pointed at nothing else.
--
-- A real column also lets the campaign report aggregate touches with an index
-- instead of filtering on a text discriminator.

-- IF NOT EXISTS makes this safe to re-run.
--
-- Nothing in this migration uses the new value — no default, no CHECK, no
-- backfill casting a string to ActivityType. That matters because `supabase db
-- push` runs a migration inside a transaction, and Postgres refuses to use an
-- enum value added in the same transaction that created it (the restriction was
-- lifted for committed types in 12, but only outside the adding transaction).
-- The first row using MESSAGE_SENT is written by the application later, so the
-- constraint is never hit here. Do not add a backfill to this file.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MESSAGE_SENT';

ALTER TABLE "activity"
  ADD COLUMN IF NOT EXISTS "campaignId" UUID,
  -- Which medium the message went out on. Free text rather than an enum for
  -- the reason given above; the application constrains it to a known list so
  -- the reports stay clean, and a new channel is a one-line UI change.
  ADD COLUMN IF NOT EXISTS "channel" VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_campaignId_fkey'
  ) THEN
    ALTER TABLE "activity"
      ADD CONSTRAINT "activity_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "campaign"("id")
      -- SET NULL, not CASCADE: deleting a campaign must not delete the record
      -- that a human being made a call. The touch outlives the attribution.
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The campaign detail page asks for "every touch in this campaign, newest
-- first". Without this that is a full scan of activity per campaign view.
CREATE INDEX IF NOT EXISTS "activity_campaignId_createdAt_idx"
  ON "activity" ("campaignId", "createdAt" DESC)
  WHERE "campaignId" IS NOT NULL;

-- The lead timeline reads touches by the record they concern. The existing
-- schema had no index on the polymorphic pair at all, so every lead detail
-- page scanned the whole table; this is the item-3 half of the change.
CREATE INDEX IF NOT EXISTS "activity_related_idx"
  ON "activity" ("relatedEntityType", "relatedEntityId", "createdAt" DESC)
  WHERE "relatedEntityId" IS NOT NULL;
