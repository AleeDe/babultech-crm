-- Campaign activities go, now that their replacement works.
--
-- The model was: a campaign had activities, an activity had an audience, and a
-- row in that audience recorded one person's outcome. Emails are now activities
-- against a LEAD, which is where the sales work actually happens - so the
-- audience table has nothing left to hold, and the activity table duplicates
-- what campaign plus email_batch now say between them.
--
-- Done last on purpose. Every screen and server function that replaced these has
-- already shipped and been exercised; nothing is removed before its replacement
-- works, so there is no window where the feature is simply missing.
--
-- Safe to drop rather than migrate: both tables are empty, and the send path
-- that used to write them was replaced rather than extended.

-- ---------------------------------------------------------------------------
-- 1. The functions first
-- ---------------------------------------------------------------------------
--
-- Before the tables, or dropping the tables would leave functions whose bodies
-- no longer compile - which only shows up the next time somebody calls them.

drop function if exists add_members_to_activity(uuid, uuid[]);
drop function if exists mark_activity_run(uuid);

-- unsubscribe_by_token read campaign_member."unsubscribeToken". Its replacement,
-- unsubscribe_activity(), works from the activity that sent the message and
-- writes to email_suppression, so consent follows the ADDRESS and covers every
-- duplicate of a person rather than the one record we happened to mail.
drop function if exists unsubscribe_by_token(uuid);

-- ---------------------------------------------------------------------------
-- 2. The tables
-- ---------------------------------------------------------------------------

drop table if exists campaign_activity_member;
drop table if exists campaign_activity;

-- ---------------------------------------------------------------------------
-- 3. What is left on campaign_member
-- ---------------------------------------------------------------------------
--
-- lastCampaignRunAt, lastCampaignId and campaignCount were written by
-- mark_activity_run() and shown when building an audience, so nobody was mailed
-- three weeks running. Audiences are now chosen from the leads list, so nothing
-- writes them any more.
--
-- They are KEPT rather than dropped, for two reasons. They are a true record of
-- what was sent under the old model, and a column that stops being updated is a
-- smaller problem than one that is dropped while a screen still reads it. The
-- member page labels them as history.
--
-- emailOptOut, emailOptOutAt, emailOptOutReason and emailBounced are likewise
-- kept: they record decisions people made, and email_suppression is now the
-- list the send actually consults.
comment on column campaign_member."lastCampaignRunAt" is
  'When a campaign last reached this person under the old campaign-activity model. No longer written - email is now sent to leads, and the record of it is the EMAIL activity against the lead.';

comment on column campaign_member."campaignCount" is
  'How many campaign activities included this person, under the old model. No longer written.';

comment on column campaign_member."emailOptOut" is
  'An unsubscribe recorded against this member. The list a send actually consults is email_suppression, which is keyed on the address so it covers every duplicate of a person.';

-- unsubscribeToken is no longer the key to anything: the unsubscribe link now
-- carries the activity id, which identifies one send to one person. Kept so any
-- link already sitting in somebody's inbox is not left pointing at a column that
-- has gone - the route answers the same way either way.
comment on column campaign_member."unsubscribeToken" is
  'Unused. Unsubscribe links now carry the sending activity id. Kept so no already-delivered link points at a dropped column.';

-- ---------------------------------------------------------------------------
-- 4. The lists that described the old model
-- ---------------------------------------------------------------------------
--
-- campaign_activity_type described a table that no longer exists. call_outcome
-- and webinar_outcome are kept and re-pointed: the vocabulary is still right for
-- an activity of type LOG or EVENT, and administrators may already have added
-- their own values to them.

delete from picklist_value where "picklistKey" = 'campaign_activity_type';
delete from picklist where key = 'campaign_activity_type';

update picklist
   set description = 'How a campaign call went. Used when logging a call activity.'
 where key = 'call_outcome';

update picklist
   set description = 'Whether somebody turned up. Used when recording an event activity.'
 where key = 'webinar_outcome';
