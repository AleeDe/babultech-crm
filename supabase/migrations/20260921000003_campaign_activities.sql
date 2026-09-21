-- Campaign activities: the outreach itself, and how each person responded.
--
-- Two tables, because "campaign activity" is two things at once. The activity
-- is what you run - an email, a round of calls, a webinar. The junction row is
-- one person's outcome within it. One table could hold either, never both: a
-- single row per person has no place to put the subject line, and a single row
-- per activity has no place to put who opened it.
--
--   campaign
--      └── campaign_activity              "Q4 intro email", "October webinar"
--              └── campaign_activity_member    one row per person per activity
--
-- Membership of a campaign comes from these rows rather than a column on the
-- member. A person is in a campaign because something was sent to them.

-- ---------------------------------------------------------------------------
-- The activity
-- ---------------------------------------------------------------------------

create table campaign_activity (
  id uuid primary key,
  "campaignId" uuid not null references campaign (id) on delete cascade,

  name varchar(200) not null,
  -- CALL, EMAIL, WEBINAR, EVENT. Text against an open picklist rather than an
  -- enum: the outcomes below branch on it, but adding a channel should not
  -- need a migration.
  "activityType" varchar(30) not null,

  -- DRAFT      being prepared, audience still being chosen
  -- SCHEDULED  audience fixed, waiting for its date
  -- RUNNING    an email send in progress
  -- COMPLETED  finished; outcomes may still be recorded for calls and webinars
  -- CANCELLED  abandoned, kept for the record
  status varchar(20) not null default 'DRAFT'
    check (status in ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')),

  "scheduledAt" timestamp(3),
  "startedAt"   timestamp(3),
  "completedAt" timestamp(3),

  "ownerUserId" uuid references app_user (id) on delete set null,

  -- Email only -------------------------------------------------------------
  subject    varchar(300),
  "bodyHtml" text,
  "bodyText" text,
  "fromName" varchar(120),
  "replyTo"  varchar(255),

  description text,

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "deletedAt" timestamp(3)
);

create index "campaign_activity_campaign_idx" on campaign_activity ("campaignId");
create index "campaign_activity_status_idx" on campaign_activity (status);
create index "campaign_activity_scheduled_idx" on campaign_activity ("scheduledAt");

-- ---------------------------------------------------------------------------
-- The junction: one person in one activity
-- ---------------------------------------------------------------------------

create table campaign_activity_member (
  id uuid primary key,
  "activityId" uuid not null references campaign_activity (id) on delete cascade,
  "memberId"   uuid not null references campaign_member (id) on delete cascade,

  -- What happened to this person. The vocabulary depends on the activity type
  -- - ATTENDED for a call, OPENED for an email - and lives in a picklist per
  -- type rather than one enum trying to cover all of them.
  outcome varchar(40),
  "outcomeNotes" text,
  "recordedById" uuid references app_user (id) on delete set null,
  "recordedAt"   timestamp(3),

  -- Email delivery, written by the provider's webhook ----------------------
  --
  -- Separate timestamps rather than one status, because these are not a
  -- sequence that can be collapsed: a message can be delivered, opened, and
  -- then complained about, and the last event is not the whole story.
  "providerMessageId" varchar(200),
  "sentAt"         timestamp(3),
  "deliveredAt"    timestamp(3),
  "openedAt"       timestamp(3),
  "clickedAt"      timestamp(3),
  "bouncedAt"      timestamp(3),
  "complainedAt"   timestamp(3),
  "unsubscribedAt" timestamp(3),
  -- An open is counted as well as dated: a mail client that pre-fetches images
  -- registers exactly one, while somebody who keeps coming back registers
  -- several. The count is the more honest of the two numbers.
  "openCount"  integer not null default 0,
  "clickCount" integer not null default 0,
  "failReason" varchar(500),

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

-- One row per person per activity. Adding the same person to an audience twice
-- would mail them twice and count them twice.
create unique index "campaign_activity_member_key"
  on campaign_activity_member ("activityId", "memberId");
create index "campaign_activity_member_member_idx" on campaign_activity_member ("memberId");
create index "campaign_activity_member_provider_idx"
  on campaign_activity_member ("providerMessageId")
  where "providerMessageId" is not null;

-- ---------------------------------------------------------------------------
-- Unsubscribe token
-- ---------------------------------------------------------------------------
--
-- Every marketing email must carry a working unsubscribe link, and the link is
-- opened by somebody with no session. A random token per person is what makes
-- that safe: it identifies them without exposing an id that could be guessed
-- or walked, and one token per person means a single click removes them from
-- everything rather than from one send.
alter table campaign_member
  add column if not exists "unsubscribeToken" uuid not null default gen_random_uuid();

create unique index if not exists "campaign_member_unsubscribe_token_key"
  on campaign_member ("unsubscribeToken");

-- ---------------------------------------------------------------------------
-- Who may see and change them
-- ---------------------------------------------------------------------------

alter table campaign_activity enable row level security;
alter table campaign_activity force row level security;
alter table campaign_activity_member enable row level security;
alter table campaign_activity_member force row level security;

drop policy if exists campaign_activity_read on campaign_activity;
create policy campaign_activity_read on campaign_activity
  for select using (
    app_is_internal() and app_current_scope() is not null and app_has_permission('lead:read')
  );

drop policy if exists campaign_activity_write on campaign_activity;
create policy campaign_activity_write on campaign_activity
  for all using (app_can_write() and app_has_permission('lead:write'))
  with check (app_can_write() and app_has_permission('lead:write'));

drop policy if exists campaign_activity_member_read on campaign_activity_member;
create policy campaign_activity_member_read on campaign_activity_member
  for select using (
    app_is_internal() and app_current_scope() is not null and app_has_permission('lead:read')
  );

drop policy if exists campaign_activity_member_write on campaign_activity_member;
create policy campaign_activity_member_write on campaign_activity_member
  for all using (app_can_write() and app_has_permission('lead:write'))
  with check (app_can_write() and app_has_permission('lead:write'));

grant select, insert, update, delete on campaign_activity to authenticated;
grant select, insert, update, delete on campaign_activity_member to authenticated;
grant all on campaign_activity, campaign_activity_member to service_role;

-- ---------------------------------------------------------------------------
-- The lists
-- ---------------------------------------------------------------------------

insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values
  ('campaign_activity_type', 'Campaign activity type', 'Marketing', null, false,
   'How a campaign reaches people. Outcomes are recorded per type.', 230),
  ('call_outcome', 'Call outcome', 'Marketing', null, false,
   'How a campaign call went.', 240),
  ('webinar_outcome', 'Webinar outcome', 'Marketing', null, false,
   'Whether somebody turned up to a webinar or event.', 250)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values
  ('campaign_activity_type', 'EMAIL',   'Mass email', 10),
  ('campaign_activity_type', 'CALL',    'Phone calls', 20),
  ('campaign_activity_type', 'WEBINAR', 'Webinar',     30),
  ('campaign_activity_type', 'EVENT',   'Event',       40),

  ('call_outcome', 'ATTENDED',     'Answered',       10),
  ('call_outcome', 'NOT_ATTENDED', 'No answer',      20),
  ('call_outcome', 'DROPPED',      'Dropped',        30),
  ('call_outcome', 'WRONG_NUMBER', 'Wrong number',   40),
  ('call_outcome', 'CALL_BACK',    'Call back later', 50),
  ('call_outcome', 'NOT_INTERESTED', 'Not interested', 60),

  ('webinar_outcome', 'REGISTERED', 'Registered', 10),
  ('webinar_outcome', 'ATTENDED',   'Attended',   20),
  ('webinar_outcome', 'NO_SHOW',    'No show',    30)
on conflict ("picklistKey", value) do nothing;

-- ---------------------------------------------------------------------------
-- Adding people to an audience
-- ---------------------------------------------------------------------------
--
-- Returns how many were added and how many were already there, so the screen
-- can say so rather than silently doing nothing on a second click.
create or replace function add_members_to_activity(p_activity uuid, p_members uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_added  integer := 0;
  v_already integer := 0;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select status into v_status from campaign_activity
  where id = p_activity and "deletedAt" is null;

  if v_status is null then
    raise exception 'That activity no longer exists.';
  end if;
  -- Once something has gone out, the audience is a record of who it went to.
  if v_status in ('RUNNING', 'COMPLETED') then
    raise exception 'This activity has already run, so its audience cannot change.';
  end if;

  select count(*) into v_already
  from campaign_activity_member
  where "activityId" = p_activity and "memberId" = any(p_members);

  insert into campaign_activity_member (id, "activityId", "memberId", "createdAt", "updatedAt")
  select gen_random_uuid(), p_activity, m, now(), now()
  from unnest(p_members) as m
  where exists (select 1 from campaign_member cm where cm.id = m and cm."deletedAt" is null)
  on conflict ("activityId", "memberId") do nothing;

  get diagnostics v_added = row_count;

  return jsonb_build_object('added', v_added, 'alreadyThere', v_already);
end $$;

-- ---------------------------------------------------------------------------
-- Marking an activity as run
-- ---------------------------------------------------------------------------
--
-- Stamps every member in the audience with when a campaign last reached them,
-- which is what the audience builder shows next time so nobody is mailed three
-- weeks running. Counted as well as dated, because "contacted four times" is a
-- different conversation from "contacted in March".
create or replace function mark_activity_run(p_activity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign uuid;
  v_touched  integer;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select "campaignId" into v_campaign
  from campaign_activity where id = p_activity and "deletedAt" is null;

  if v_campaign is null then
    raise exception 'That activity no longer exists.';
  end if;

  update campaign_member cm set
    "lastCampaignRunAt" = now(),
    "lastCampaignId"    = v_campaign,
    "campaignCount"     = cm."campaignCount" + 1,
    "updatedAt"         = now()
  from campaign_activity_member am
  where am."activityId" = p_activity and am."memberId" = cm.id;

  get diagnostics v_touched = row_count;

  update campaign_activity set
    status = 'COMPLETED',
    "startedAt" = coalesce("startedAt", now()),
    "completedAt" = now(),
    "updatedAt" = now()
  where id = p_activity;

  return jsonb_build_object('touched', v_touched);
end $$;

-- ---------------------------------------------------------------------------
-- Unsubscribing from a link
-- ---------------------------------------------------------------------------
--
-- Called with no session at all: the person clicking has a token from an email
-- and nothing else. It therefore takes the token and only the token, does one
-- thing with it, and returns nothing that would let somebody holding a random
-- token learn who it belongs to.
create or replace function unsubscribe_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from campaign_member
  where "unsubscribeToken" = p_token and "deletedAt" is null;

  if v_id is null then
    -- Deliberately the same answer as success. A token that reports "not
    -- found" tells whoever is guessing that their next guess might work.
    return jsonb_build_object('done', true);
  end if;

  update campaign_member set
    "emailOptOut" = true,
    "emailOptOutAt" = coalesce("emailOptOutAt", now()),
    "emailOptOutReason" = coalesce("emailOptOutReason", 'Unsubscribed from an email'),
    "updatedAt" = now()
  where id = v_id;

  update campaign_activity_member set
    "unsubscribedAt" = coalesce("unsubscribedAt", now()),
    "updatedAt" = now()
  where "memberId" = v_id and "sentAt" is not null and "unsubscribedAt" is null;

  return jsonb_build_object('done', true);
end $$;

revoke all on function add_members_to_activity(uuid, uuid[]) from public, anon;
revoke all on function mark_activity_run(uuid) from public, anon;
revoke all on function unsubscribe_by_token(uuid) from public;

grant execute on function add_members_to_activity(uuid, uuid[]) to authenticated;
grant execute on function mark_activity_run(uuid) to authenticated;
-- The only function an unauthenticated visitor may call, because the
-- unsubscribe link has to work for somebody with no account.
grant execute on function unsubscribe_by_token(uuid) to anon, authenticated;
