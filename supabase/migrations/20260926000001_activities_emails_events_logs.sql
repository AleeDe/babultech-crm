-- Activities become Email, Event and Log, against any record.
--
-- The activity table already carried a polymorphic link -
-- ("relatedEntityType", "relatedEntityId") - so an activity could already point
-- at anything. What it lacked was the right vocabulary and anywhere to put the
-- result of an email.
--
-- One table, not three. Lead activities, customer activities and partner
-- activities differ only in what they point at; three tables would mean three
-- schemas, three sets of policies and three places to fix every bug, and would
-- make "everything we did with this partner" and "every email sent this month"
-- two unrelated queries instead of one.
--
-- The old types are kept rather than replaced. TASK, CALL, MEETING and REMINDER
-- are in use elsewhere in the app - My Work, the account health panel, the
-- dashboard stream - and dropping them would break those for the sake of
-- tidiness. EMAIL, EVENT and LOG join them.

-- ---------------------------------------------------------------------------
-- 1. The three new types
-- ---------------------------------------------------------------------------
--
-- Postgres will not add an enum value inside a transaction that then uses it,
-- and this file runs as one transaction - so the column moves to text against a
-- check constraint instead. That also matches how the newer tables in this
-- schema do it, and means the next channel is a constraint change rather than
-- an enum rewrite with dependent views to rebuild.

alter table activity
  alter column "activityType" type varchar(30)
  using "activityType"::text;

alter table activity
  add constraint activity_type_check check ("activityType" in (
    'EMAIL', 'EVENT', 'LOG',
    -- Still in use: My Work, account health, the dashboard activity stream.
    'TASK', 'CALL', 'MEETING', 'REMINDER'
  ));

-- ---------------------------------------------------------------------------
-- 2. What an email activity needs to record
-- ---------------------------------------------------------------------------
--
-- Timestamps rather than one status, because these are not a sequence that can
-- be collapsed: a message can be delivered, opened, and then complained about,
-- and the last event is not the whole story. Counted as well as dated - a mail
-- client that pre-fetches images registers exactly one open, while somebody who
-- keeps coming back registers several, and the count is the honest number.

alter table activity
  add column if not exists "batchId"            uuid,
  add column if not exists "toAddress"          varchar(255),
  add column if not exists "providerMessageId"  varchar(200),
  add column if not exists "sentAt"             timestamp(3),
  add column if not exists "deliveredAt"        timestamp(3),
  add column if not exists "openedAt"           timestamp(3),
  add column if not exists "clickedAt"          timestamp(3),
  add column if not exists "bouncedAt"          timestamp(3),
  add column if not exists "complainedAt"       timestamp(3),
  add column if not exists "unsubscribedAt"     timestamp(3),
  add column if not exists "openCount"          integer not null default 0,
  add column if not exists "clickCount"         integer not null default 0,
  add column if not exists "failReason"         varchar(500);

create index if not exists "activity_provider_idx"
  on activity ("providerMessageId") where "providerMessageId" is not null;
create index if not exists "activity_batch_idx"
  on activity ("batchId") where "batchId" is not null;

-- ---------------------------------------------------------------------------
-- 3. The scorecard: one row per send
-- ---------------------------------------------------------------------------
--
-- Without this, a mass email to two hundred leads is two hundred unrelated
-- activity rows and there is no page that can say how that email performed.
-- The batch is only a header - the activities remain the per-person records, so
-- nothing like the old activity/member junction comes back.
--
-- Every figure is counted from the activities at read time rather than kept on
-- the batch. A stored total and the rows it came from disagree eventually, and
-- when they do the stored one is believed.

create table if not exists email_batch (
  id uuid primary key,
  subject   varchar(300) not null,
  "bodyText" text not null,
  "fromName" varchar(120),
  "replyTo"  varchar(255),

  -- What this send was part of, where it was part of anything. Null for an
  -- ad-hoc send to a handful of leads, which is a real and common case.
  "campaignId" uuid references campaign (id) on delete set null,

  -- Lead, Contact, Partner. One send goes to one kind of record, because the
  -- merge fields differ and a template written for leads reads wrongly to a
  -- partner.
  "audienceType" varchar(50) not null,

  "sentById" uuid references app_user (id) on delete set null,
  "sentAt"   timestamp(3) not null default current_timestamp,

  -- How many were skipped before sending - unsubscribed, bounced before, no
  -- address. Kept because it cannot be recovered afterwards: a person skipped
  -- has no activity row to count.
  "skippedCount"  integer not null default 0,
  "skippedReasons" jsonb,

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

create index if not exists "email_batch_campaign_idx" on email_batch ("campaignId");
create index if not exists "email_batch_sentAt_idx" on email_batch ("sentAt" desc);

alter table activity
  add constraint activity_batch_fkey
  foreign key ("batchId") references email_batch (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Suppression, keyed on the address
-- ---------------------------------------------------------------------------
--
-- This is the piece that makes duplicate leads safe to live with.
--
-- The same person at a webinar and a trade show becomes two leads. If consent
-- lived on the lead row, unsubscribing one would leave the other mailable, and
-- the next send would reach somebody who had already said stop - before anybody
-- got round to merging them.
--
-- So suppression is keyed on the ADDRESS. One unsubscribe, one hard bounce or
-- one spam complaint stops mail to that address everywhere, at once, however
-- many records hold it.
create table if not exists email_suppression (
  email varchar(255) primary key,
  -- UNSUBSCRIBED  they asked us to stop
  -- BOUNCED       the mailbox does not exist
  -- COMPLAINED    they reported it as spam
  reason varchar(20) not null check (reason in ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED')),
  notes varchar(255),
  -- Where it came from, for answering "why am I not getting these".
  "sourceActivityId" uuid references activity (id) on delete set null,
  "suppressedAt" timestamp(3) not null default current_timestamp
);

comment on table email_suppression is
  'Addresses that must not receive bulk mail. Keyed on the address rather than a record, so one unsubscribe covers every duplicate of a person.';

-- Lowercase on the way in, so a lookup never has to remember to fold case and
-- an address cannot be suppressed twice in different capitalisations.
create or replace function email_suppression_normalise()
returns trigger language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end $$;

drop trigger if exists email_suppression_normalise_trg on email_suppression;
create trigger email_suppression_normalise_trg
  before insert or update on email_suppression
  for each row execute function email_suppression_normalise();

-- ---------------------------------------------------------------------------
-- 5. Who may see and change all this
-- ---------------------------------------------------------------------------

alter table email_batch enable row level security;
alter table email_batch force row level security;
alter table email_suppression enable row level security;
alter table email_suppression force row level security;

drop policy if exists email_batch_read on email_batch;
create policy email_batch_read on email_batch
  for select using (
    app_is_internal() and app_current_scope() is not null and app_has_permission('lead:read')
  );

drop policy if exists email_batch_write on email_batch;
create policy email_batch_write on email_batch
  for all using (app_can_write() and app_has_permission('lead:write'))
  with check (app_can_write() and app_has_permission('lead:write'));

-- Readable by anyone internal who can read leads, because "why did this person
-- not get the email" is a question the person sending it has to be able to
-- answer for themselves.
drop policy if exists email_suppression_read on email_suppression;
create policy email_suppression_read on email_suppression
  for select using (app_is_internal() and app_current_scope() is not null);

-- Removing somebody from the suppression list is undoing their decision, so it
-- takes lead:write and leaves an audit trail through the normal write path.
drop policy if exists email_suppression_write on email_suppression;
create policy email_suppression_write on email_suppression
  for all using (app_can_write() and app_has_permission('lead:write'))
  with check (app_can_write() and app_has_permission('lead:write'));

grant select, insert, update, delete on email_batch to authenticated;
grant select, insert, update, delete on email_suppression to authenticated;
grant all on email_batch, email_suppression to service_role;

-- ---------------------------------------------------------------------------
-- 6. Unsubscribing from a link
-- ---------------------------------------------------------------------------
--
-- Called with no session at all: whoever clicked has a token from an email and
-- nothing else. So it takes the token and only the token, and returns the same
-- answer whether or not it matched - a "not found" tells somebody guessing that
-- their next guess might work.
--
-- The token is the activity's own id. It identifies one send to one person,
-- which is exactly the scope of the link, and it means no extra column to keep.
create or replace function unsubscribe_activity(p_activity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(btrim("toAddress")) into v_email
  from activity
  where id = p_activity and "toAddress" is not null and "deletedAt" is null;

  if v_email is null then
    return jsonb_build_object('done', true);
  end if;

  insert into email_suppression (email, reason, notes, "sourceActivityId")
  values (v_email, 'UNSUBSCRIBED', 'Unsubscribed from an email', p_activity)
  on conflict (email) do nothing;

  -- Stamp every send to that address, not just this one: the person is telling
  -- us about themselves, and a later report should not show them as a happy
  -- recipient of the other four.
  update activity set
    "unsubscribedAt" = coalesce("unsubscribedAt", now()),
    "updatedAt" = now()
  where lower(btrim("toAddress")) = v_email
    and "sentAt" is not null
    and "unsubscribedAt" is null;

  return jsonb_build_object('done', true);
end $$;

revoke all on function unsubscribe_activity(uuid) from public;
grant execute on function unsubscribe_activity(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The activity type list
-- ---------------------------------------------------------------------------

insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values
  ('activity_type', 'Activity type', 'Sales', null, false,
   'What kind of activity was carried out against a lead, customer or partner.', 260),
  ('activity_log_kind', 'Log kind', 'Sales', null, false,
   'What a logged activity records - a call made, a meeting held, a note taken.', 270)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values
  ('activity_type', 'EMAIL', 'Email', 10),
  ('activity_type', 'EVENT', 'Event', 20),
  ('activity_type', 'LOG',   'Log',   30),

  ('activity_log_kind', 'CALL_MADE',     'Call made',      10),
  ('activity_log_kind', 'CALL_RECEIVED', 'Call received',  20),
  ('activity_log_kind', 'MEETING',       'Meeting held',   30),
  ('activity_log_kind', 'WHATSAPP',      'WhatsApp',       40),
  ('activity_log_kind', 'SITE_VISIT',    'Site visit',     50),
  ('activity_log_kind', 'NOTE',          'Note',           60)
on conflict ("picklistKey", value) do nothing;
