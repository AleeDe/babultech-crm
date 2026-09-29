-- Notifications, alert settings and following a record.
--
-- The bell. Something happens - a lead is assigned to you, a customer replies
-- on your case, a quote you are waiting on is accepted - and a row lands here
-- for you. The app shows it under the bell; the background runner emails it
-- if you asked for that kind by email.
--
-- The rows are written by triggers on the records themselves, not by the
-- screens. A lead can be assigned from its page, from a bulk action, by a
-- partner in the portal or by a database function; a trigger sees all of
-- them, where a screen would see only its own. A trigger that fails to
-- notify never fails the change it is watching: each one catches its own
-- errors and lets the write through.
--
-- Nobody is told about what they did themselves. Only employees are told:
-- partners and customers have their own portals, which do not show the bell.
--
-- Following. Owners follow their records automatically, and anyone can follow
-- a lead, account, contact, deal, case or project from its page. Followers
-- hear about the changes that matter - stage, status, owner, a new note, a
-- customer's reply - and not about every field edit.

create table if not exists notification (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references app_user(id) on delete cascade,
  kind varchar(40) not null,
  title varchar(300) not null,
  body text,
  link varchar(500),
  "entityType" varchar(40),
  "entityId" uuid,
  "actorId" uuid references app_user(id) on delete set null,
  -- Whether it shows under the bell. A kind someone takes by email only is
  -- still written, so the email has a row to be sent from.
  "inApp" boolean not null default true,
  -- One reminder per task per day, however often the daily check runs.
  "dedupeKey" varchar(200),
  "createdAt" timestamp(3) not null default now(),
  "readAt" timestamp(3),
  "emailStatus" varchar(12) check ("emailStatus" in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  "emailedAt" timestamp(3),
  "emailError" text
);

create index if not exists notification_user_idx on notification ("userId", "createdAt" desc);
create index if not exists notification_unread_idx on notification ("userId") where "readAt" is null and "inApp";
create index if not exists notification_email_idx on notification ("createdAt") where "emailStatus" = 'PENDING';
create unique index if not exists notification_dedupe_idx on notification ("userId", "dedupeKey") where "dedupeKey" is not null;

create table if not exists notification_preference (
  "userId" uuid not null references app_user(id) on delete cascade,
  kind varchar(40) not null,
  "inApp" boolean not null default true,
  email boolean not null default false,
  "updatedAt" timestamp(3) not null default now(),
  primary key ("userId", kind)
);

create table if not exists record_follow (
  "userId" uuid not null references app_user(id) on delete cascade,
  "entityType" varchar(40) not null,
  "entityId" uuid not null,
  "createdAt" timestamp(3) not null default now(),
  primary key ("userId", "entityType", "entityId")
);
create index if not exists record_follow_entity_idx on record_follow ("entityType", "entityId");

alter table notification enable row level security;
alter table notification_preference enable row level security;
alter table record_follow enable row level security;

-- Your own notifications, preferences and follows, and nobody else's.
drop policy if exists notification_read on notification;
create policy notification_read on notification for select to authenticated
  using ("userId" = app_current_user_id());

drop policy if exists notification_preference_own on notification_preference;
create policy notification_preference_own on notification_preference for all to authenticated
  using ("userId" = app_current_user_id() and app_is_internal())
  with check ("userId" = app_current_user_id() and app_is_internal());

drop policy if exists record_follow_read on record_follow;
create policy record_follow_read on record_follow for select to authenticated
  using ("userId" = app_current_user_id());
drop policy if exists record_follow_delete on record_follow;
create policy record_follow_delete on record_follow for delete to authenticated
  using ("userId" = app_current_user_id());
-- Following is added through follow_record() below, which checks the person can
-- see the record first; there is no insert policy.

-- ---------------------------------------------------------------------------
-- Sending one
-- ---------------------------------------------------------------------------

-- The kinds that go by email unless someone turns them off: being given work,
-- and approvals. Everything else is the bell only unless someone turns email on.
create or replace function notification_email_by_default(p_kind text)
returns boolean language sql immutable as $$
  select p_kind in ('ASSIGNED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED');
$$;

create or replace function notify_user(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe text default null,
  -- False where the same news already goes by email another way (expense
  -- decisions, mentions), so nobody gets it twice.
  p_allow_email boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := app_current_user_id();
  v_in_app boolean;
  v_email boolean;
begin
  if p_user is null or p_user = v_actor then
    return;
  end if;
  if not exists (
    select 1 from app_user
     where id = p_user and status = 'ACTIVE' and "deletedAt" is null
       and coalesce("userType", 'INTERNAL') = 'INTERNAL' and "partnerId" is null
  ) then
    return;
  end if;

  select "inApp", email into v_in_app, v_email
    from notification_preference where "userId" = p_user and kind = p_kind;
  v_in_app := coalesce(v_in_app, true);
  v_email := coalesce(v_email, notification_email_by_default(p_kind)) and p_allow_email;
  if not v_in_app and not v_email then
    return;
  end if;

  insert into notification ("userId", kind, title, body, link, "entityType", "entityId", "actorId", "inApp", "dedupeKey", "emailStatus")
  values (p_user, p_kind, left(p_title, 300), p_body, p_link, p_entity_type, p_entity_id, v_actor, v_in_app, p_dedupe,
          case when v_email then 'PENDING' end)
  on conflict ("userId", "dedupeKey") where "dedupeKey" is not null do nothing;
end $$;

revoke all on function notify_user(uuid, text, text, text, text, text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function notify_user(uuid, text, text, text, text, text, uuid, text, boolean) to service_role;

-- Everyone following a record, except the people named.
create or replace function notify_followers(
  p_entity_type text,
  p_entity_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text,
  p_except uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  for v_user in
    select "userId" from record_follow
     where "entityType" = p_entity_type and "entityId" = p_entity_id
       and not ("userId" = any(coalesce(p_except, '{}')))
  loop
    perform notify_user(v_user, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id);
  end loop;
end $$;

revoke all on function notify_followers(text, uuid, text, text, text, text, uuid[]) from public, anon, authenticated;

-- Internal people whose role holds a permission. Mirrors app_has_permission().
create or replace function app_users_holding(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from app_user u
    join security_role r on r.id = u."roleId"
   where u.status = 'ACTIVE' and u."deletedAt" is null
     and coalesce(u."userType", 'INTERNAL') = 'INTERNAL' and u."partnerId" is null
     and (
       '*' = any(r.permissions)
       or p_permission = any(r.permissions)
       or (split_part(p_permission, ':', 1) || ':*') = any(r.permissions)
       or ('*:' || split_part(p_permission, ':', 2)) = any(r.permissions)
     );
$$;

revoke all on function app_users_holding(text) from public, anon, authenticated;

-- A follow written on someone's behalf: an owner, automatically.
create or replace function follow_for(p_user uuid, p_entity_type text, p_entity_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into record_follow ("userId", "entityType", "entityId")
  select p_user, p_entity_type, p_entity_id
   where p_user is not null
     and exists (select 1 from app_user where id = p_user and coalesce("userType", 'INTERNAL') = 'INTERNAL' and "partnerId" is null)
  on conflict do nothing;
$$;

revoke all on function follow_for(uuid, text, uuid) from public, anon, authenticated;

-- Following from a record's page. The record has to be one the person can see:
-- the visibility check runs as them, through row security.
create or replace function follow_record(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table text := case p_entity_type
    when 'Lead' then 'lead' when 'Account' then 'account' when 'Contact' then 'contact'
    when 'Opportunity' then 'opportunity' when 'SupportCase' then 'support_case' when 'Project' then 'project'
  end;
  v_seen boolean;
begin
  if not app_is_internal() then
    raise exception 'Only employees can follow records.' using errcode = '42501';
  end if;
  if v_table is null then
    raise exception 'That kind of record cannot be followed.' using errcode = '22023';
  end if;
  execute format('select exists (select 1 from %I where id = $1)', v_table) into v_seen using p_entity_id;
  if not v_seen then
    raise exception 'That record could not be found.' using errcode = '42501';
  end if;
  perform follow_for(app_current_user_id(), p_entity_type, p_entity_id);
end $$;

revoke all on function follow_record(text, uuid) from public, anon;
grant execute on function follow_record(text, uuid) to authenticated;

create or replace function mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update notification
     set "readAt" = now()
   where "userId" = app_current_user_id()
     and "readAt" is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function mark_notifications_read(uuid[]) from public, anon;
grant execute on function mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- What sends them
-- ---------------------------------------------------------------------------

create or replace function notification_words(p_value text)
returns text language sql immutable as $$
  select initcap(replace(lower(coalesce(p_value, '')), '_', ' '));
$$;

create or replace function notify_on_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(new."firstName", '') || ' ' || coalesce(new."lastName", ''))
                 || coalesce(' (' || nullif(new."companyName", '') || ')', '');
  v_link text := '/leads/' || new.id;
  v_actor uuid := app_current_user_id();
  v_partner record;
begin
  begin
    if tg_op = 'INSERT' or new."ownerUserId" is distinct from old."ownerUserId" then
      perform follow_for(new."ownerUserId", 'Lead', new.id);
      perform notify_user(new."ownerUserId", 'ASSIGNED', 'Lead assigned to you: ' || v_name, null, v_link, 'Lead', new.id);
      if tg_op = 'UPDATE' then
        perform notify_followers('Lead', new.id, 'FOLLOWED_CHANGE', 'Lead reassigned: ' || v_name,
          'Now owned by ' || coalesce((select "fullName" from app_user where id = new."ownerUserId"), 'nobody') || '.',
          v_link, array[new."ownerUserId"]);
      end if;
    end if;

    -- A lead a partner registered in the portal: their partner manager hears of it.
    if tg_op = 'INSERT' and new."referredByPartnerId" is not null and app_current_partner_id() is not null then
      select "displayName", "partnerManagerId" into v_partner from partner where id = new."referredByPartnerId";
      perform notify_user(v_partner."partnerManagerId", 'PARTNER_LEAD',
        'New lead from ' || coalesce(v_partner."displayName", 'a partner') || ': ' || v_name, null, v_link, 'Lead', new.id);
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform notify_followers('Lead', new.id, 'FOLLOWED_CHANGE', v_name || ' is now ' || notification_words(new.status::text),
        null, v_link, array[v_actor]);
    end if;
  exception when others then
    raise warning 'notify_on_lead: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists lead_notify on lead;
create trigger lead_notify after insert or update of "ownerUserId", status on lead
  for each row execute function notify_on_lead();

create or replace function notify_on_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text := '/accounts/' || new.id;
begin
  begin
    if tg_op = 'INSERT' or new."ownerUserId" is distinct from old."ownerUserId" then
      perform follow_for(new."ownerUserId", 'Account', new.id);
      perform notify_user(new."ownerUserId", 'ASSIGNED', 'Account assigned to you: ' || new.name, null, v_link, 'Account', new.id);
      if tg_op = 'UPDATE' then
        perform notify_followers('Account', new.id, 'FOLLOWED_CHANGE', 'Account reassigned: ' || new.name,
          'Now owned by ' || coalesce((select "fullName" from app_user where id = new."ownerUserId"), 'nobody') || '.',
          v_link, array[new."ownerUserId"]);
      end if;
    end if;
  exception when others then
    raise warning 'notify_on_account: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists account_notify on account;
create trigger account_notify after insert or update of "ownerUserId" on account
  for each row execute function notify_on_account();

create or replace function notify_on_opportunity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text := '/opportunities/' || new.id;
  v_actor uuid := app_current_user_id();
begin
  begin
    if tg_op = 'INSERT' or new."ownerUserId" is distinct from old."ownerUserId" then
      perform follow_for(new."ownerUserId", 'Opportunity', new.id);
      perform notify_user(new."ownerUserId", 'ASSIGNED', 'Deal assigned to you: ' || new.name, null, v_link, 'Opportunity', new.id);
      if tg_op = 'UPDATE' then
        perform notify_followers('Opportunity', new.id, 'FOLLOWED_CHANGE', 'Deal reassigned: ' || new.name,
          'Now owned by ' || coalesce((select "fullName" from app_user where id = new."ownerUserId"), 'nobody') || '.',
          v_link, array[new."ownerUserId"]);
      end if;
    end if;

    if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
      if new.stage = 'CLOSED_WON' then
        perform notify_followers('Opportunity', new.id, 'DEAL_WON', 'Deal won: ' || new.name, null, v_link, array[v_actor]);
      else
        perform notify_followers('Opportunity', new.id, 'FOLLOWED_CHANGE',
          new.name || ' moved to ' || notification_words(new.stage::text), null, v_link, array[v_actor]);
      end if;
    end if;
  exception when others then
    raise warning 'notify_on_opportunity: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists opportunity_notify on opportunity;
create trigger opportunity_notify after insert or update of "ownerUserId", stage on opportunity
  for each row execute function notify_on_opportunity();

create or replace function notify_on_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := new."caseNumber" || ': ' || new.subject;
  v_link text := '/cases/' || new.id;
  v_actor uuid := app_current_user_id();
begin
  begin
    if tg_op = 'INSERT' or new."ownerUserId" is distinct from old."ownerUserId" then
      perform follow_for(new."ownerUserId", 'SupportCase', new.id);
      perform notify_user(new."ownerUserId", 'ASSIGNED', 'Case assigned to you: ' || v_title, null, v_link, 'SupportCase', new.id);
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform notify_followers('SupportCase', new.id, 'FOLLOWED_CHANGE',
        'Case ' || new."caseNumber" || ' is now ' || notification_words(new.status::text), new.subject, v_link, array[v_actor]);
    end if;
  exception when others then
    raise warning 'notify_on_case: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists support_case_notify on support_case;
create trigger support_case_notify after insert or update of "ownerUserId", status on support_case
  for each row execute function notify_on_case();

create or replace function notify_on_case_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case record;
begin
  begin
    if new."commentType" = 'CUSTOMER_COMMENT' then
      select id, "caseNumber", subject, "ownerUserId" into v_case from support_case where id = new."caseId";
      perform notify_user(v_case."ownerUserId", 'CASE_CUSTOMER_REPLY', 'Customer replied on ' || v_case."caseNumber",
        left(new.body, 300), '/cases/' || v_case.id, 'SupportCase', v_case.id);
      perform notify_followers('SupportCase', v_case.id, 'CASE_CUSTOMER_REPLY', 'Customer replied on ' || v_case."caseNumber",
        left(new.body, 300), '/cases/' || v_case.id, array[v_case."ownerUserId"]);
    end if;
  exception when others then
    raise warning 'notify_on_case_comment: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists case_comment_notify on case_comment;
create trigger case_comment_notify after insert on case_comment
  for each row execute function notify_on_case_comment();

create or replace function notify_on_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text := '/projects/' || new.id;
  v_actor uuid := app_current_user_id();
begin
  begin
    if tg_op = 'INSERT' or new."projectManagerId" is distinct from old."projectManagerId" then
      perform follow_for(new."projectManagerId", 'Project', new.id);
      perform notify_user(new."projectManagerId", 'ASSIGNED', 'You are project manager on ' || new.name, null, v_link, 'Project', new.id);
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform notify_followers('Project', new.id, 'FOLLOWED_CHANGE',
        new.name || ' is now ' || notification_words(new.status::text), null, v_link, array[v_actor]);
    end if;
  exception when others then
    raise warning 'notify_on_project: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists project_notify on project;
create trigger project_notify after insert or update of "projectManagerId", status on project
  for each row execute function notify_on_project();

create or replace function notify_on_project_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' or new."assignedUserId" is distinct from old."assignedUserId" then
      perform notify_user(new."assignedUserId", 'ASSIGNED',
        'Task assigned to you: ' || new.name,
        (select 'On ' || name from project where id = new."projectId"),
        '/projects/' || new."projectId" || '/tasks/' || new.id, 'ProjectTask', new.id);
    end if;
  exception when others then
    raise warning 'notify_on_project_task: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists project_task_notify on project_task;
create trigger project_task_notify after insert or update of "assignedUserId" on project_task
  for each row execute function notify_on_project_task();

-- Tasks, calls, meetings and reminders someone else gave you. Emails sent from
-- a mass send are activities too, and are left out.
create or replace function notify_on_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new."activityType"::text in ('TASK', 'CALL', 'MEETING', 'REMINDER') and new."batchId" is null
       and new."deletedAt" is null
       and (tg_op = 'INSERT' or new."ownerUserId" is distinct from old."ownerUserId") then
      perform notify_user(new."ownerUserId", 'ASSIGNED',
        notification_words(new."activityType"::text) || ' for you: ' || new.subject,
        case when new."dueAt" is not null then 'Due ' || to_char(new."dueAt" at time zone 'UTC' at time zone 'Asia/Karachi', 'DD Mon YYYY HH24:MI') end,
        '/activities/' || new.id, 'Activity', new.id);
    end if;
  exception when others then
    raise warning 'notify_on_activity: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists activity_notify on activity;
create trigger activity_notify after insert or update of "ownerUserId" on activity
  for each row execute function notify_on_activity();

-- Where a record type's page lives, for notes and mentions on it.
create or replace function notification_record_link(p_entity_type text, p_entity_id uuid)
returns text language sql immutable as $$
  select case p_entity_type
    when 'Lead' then '/leads/' when 'Account' then '/accounts/' when 'Contact' then '/contacts/'
    when 'Opportunity' then '/opportunities/' when 'SupportCase' then '/cases/' when 'Project' then '/projects/'
    when 'Quotation' then '/quotations/' when 'Contract' then '/contracts/' when 'Invoice' then '/invoices/'
    when 'Partner' then '/partners/' when 'Campaign' then '/campaigns/' when 'Product' then '/products/'
    when 'Expense' then '/expenses/' when 'VendorBill' then '/vendor-bills/' when 'Payment' then '/payments/'
  end || p_entity_id;
$$;

create or replace function notify_on_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.visibility <> 'PRIVATE' and new."deletedAt" is null then
      perform notify_followers(new."relatedEntityType", new."relatedEntityId", 'FOLLOWED_CHANGE',
        coalesce((select "fullName" from app_user where id = new."createdById"), 'Someone') || ' added a note',
        coalesce(nullif(new.title, ''), left(regexp_replace(new.content, '@\[([^\]]+)\]\([^)]*\)', '@\1', 'g'), 200)),
        notification_record_link(new."relatedEntityType", new."relatedEntityId"),
        array[new."createdById"]);
    end if;
  exception when others then
    raise warning 'notify_on_note: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists note_notify on note;
create trigger note_notify after insert on note
  for each row execute function notify_on_note();

-- Mentions are already emailed by the note screen, so here they are the bell only.
create or replace function notify_on_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note record;
begin
  begin
    select n."relatedEntityType", n."relatedEntityId", n.content, u."fullName"
      into v_note from note n left join app_user u on u.id = n."createdById" where n.id = new."noteId";
    perform notify_user(new."userId", 'MENTION', coalesce(v_note."fullName", 'Someone') || ' mentioned you',
      left(regexp_replace(v_note.content, '@\[([^\]]+)\]\([^)]*\)', '@\1', 'g'), 300),
      notification_record_link(v_note."relatedEntityType", v_note."relatedEntityId"),
      v_note."relatedEntityType", v_note."relatedEntityId", null, false);
  exception when others then
    raise warning 'notify_on_mention: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists note_mention_notify on note_mention;
create trigger note_mention_notify after insert on note_mention
  for each row execute function notify_on_mention();

create or replace function notify_on_quotation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal record;
  v_link text := '/quotations/' || new.id;
  v_actor uuid := app_current_user_id();
  v_user uuid;
begin
  begin
    select id, name, "ownerUserId" into v_deal from opportunity where id = new."opportunityId";

    if new.status = 'ACCEPTED' and old.status is distinct from 'ACCEPTED' then
      perform notify_user(v_deal."ownerUserId", 'QUOTE_ACCEPTED', 'Quote accepted: ' || new."quoteNumber", v_deal.name, v_link, 'Quotation', new.id);
      perform notify_followers('Opportunity', v_deal.id, 'QUOTE_ACCEPTED', 'Quote accepted: ' || new."quoteNumber",
        v_deal.name, v_link, array[v_deal."ownerUserId", v_actor]);
    end if;

    if new."approvalStatus" = 'PENDING' and old."approvalStatus" is distinct from 'PENDING' then
      for v_user in select * from app_users_holding('quotation:approve') loop
        perform notify_user(v_user, 'APPROVAL_REQUESTED', 'Quote to approve: ' || new."quoteNumber", v_deal.name, '/approvals', 'Quotation', new.id);
      end loop;
    end if;

    if old."approvalStatus" = 'PENDING' and new."approvalStatus" in ('APPROVED', 'REJECTED') then
      perform notify_user(v_deal."ownerUserId", 'APPROVAL_DECIDED',
        'Quote ' || new."quoteNumber" || ' ' || lower(new."approvalStatus"::text), new."approvalNote", v_link, 'Quotation', new.id);
    end if;
  exception when others then
    raise warning 'notify_on_quotation: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists quotation_notify on quotation;
create trigger quotation_notify after update of status, "approvalStatus" on quotation
  for each row execute function notify_on_quotation();

-- Expense claims already email the approvers and the claimant, so these are
-- the bell only.
create or replace function notify_on_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_link text := '/expenses/' || new.id;
begin
  begin
    if new."approvalStatus" = 'SUBMITTED' and old."approvalStatus" is distinct from 'SUBMITTED' then
      for v_user in select * from app_users_holding('expense:approve') loop
        perform notify_user(v_user, 'APPROVAL_REQUESTED', 'Expense to approve: ' || new."expenseNumber", null, '/approvals', 'Expense', new.id, null, false);
      end loop;
    elsif new."approvalStatus" in ('APPROVED', 'REJECTED') and old."approvalStatus" = 'SUBMITTED' then
      perform notify_user(new."employeeUserId", 'APPROVAL_DECIDED',
        'Expense ' || new."expenseNumber" || ' ' || lower(new."approvalStatus"::text), null, v_link, 'Expense', new.id, null, false);
    end if;
  exception when others then
    raise warning 'notify_on_expense: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists expense_notify on expense;
create trigger expense_notify after update of "approvalStatus" on expense
  for each row execute function notify_on_expense();

create or replace function notify_on_approval_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' or new."currentApproverId" is distinct from old."currentApproverId" then
      if new.status = 'PENDING' then
        perform notify_user(new."currentApproverId", 'APPROVAL_REQUESTED',
          'Approval needed: ' || notification_words(new."approvalType"), new.comments, '/approvals', new."relatedEntityType", new."relatedEntityId");
      end if;
    end if;
    if tg_op = 'UPDATE' and old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
      perform notify_user(new."requestedById", 'APPROVAL_DECIDED',
        notification_words(new."approvalType") || ' ' || lower(new.status::text), new.comments,
        notification_record_link(new."relatedEntityType", new."relatedEntityId"), new."relatedEntityType", new."relatedEntityId");
    end if;
  exception when others then
    raise warning 'notify_on_approval_request: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists approval_request_notify on approval_request;
create trigger approval_request_notify after insert or update of "currentApproverId", status on approval_request
  for each row execute function notify_on_approval_request();

-- ---------------------------------------------------------------------------
-- Daily reminders
-- ---------------------------------------------------------------------------

-- 08:00 in Karachi: what is due tomorrow, and what went overdue. Each task is
-- mentioned once per reminder, however many times this runs.
create or replace function notify_due_work()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id, subject, "ownerUserId", ("dueAt" at time zone 'UTC' at time zone 'Asia/Karachi')::date as due
      from activity
     where status = 'OPEN' and "deletedAt" is null and "batchId" is null and "dueAt" is not null
       and ("dueAt" at time zone 'UTC' at time zone 'Asia/Karachi')::date between v_today - 30 and v_today + 1
  loop
    if v_row.due = v_today + 1 then
      perform notify_user(v_row."ownerUserId", 'TASK_DUE', 'Due tomorrow: ' || v_row.subject, null,
        '/activities/' || v_row.id, 'Activity', v_row.id, 'due:' || v_row.id || ':' || v_row.due);
    elsif v_row.due < v_today then
      perform notify_user(v_row."ownerUserId", 'TASK_DUE', 'Overdue: ' || v_row.subject, null,
        '/activities/' || v_row.id, 'Activity', v_row.id, 'overdue:' || v_row.id);
    end if;
    v_count := v_count + 1;
  end loop;

  for v_row in
    select t.id, t.name, t."assignedUserId", t."dueDate" as due, t."projectId", p.name as project
      from project_task t join project p on p.id = t."projectId"
     where t.status not in ('COMPLETED', 'CANCELLED') and t."dueDate" is not null
       and t."dueDate" between v_today - 30 and v_today + 1 and p."deletedAt" is null
  loop
    if v_row.due = v_today + 1 then
      perform notify_user(v_row."assignedUserId", 'TASK_DUE', 'Due tomorrow: ' || v_row.name, 'On ' || v_row.project,
        '/projects/' || v_row."projectId" || '/tasks/' || v_row.id, 'ProjectTask', v_row.id, 'due:' || v_row.id || ':' || v_row.due);
    elsif v_row.due < v_today then
      perform notify_user(v_row."assignedUserId", 'TASK_DUE', 'Overdue: ' || v_row.name, 'On ' || v_row.project,
        '/projects/' || v_row."projectId" || '/tasks/' || v_row.id, 'ProjectTask', v_row.id, 'overdue:' || v_row.id);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function notify_due_work() from public, anon, authenticated;

select cron.schedule('babultech-due-reminders', '0 3 * * *', 'select public.notify_due_work()');

-- Notifications are kept for 90 days.
create or replace function jobs_housekeeping()
returns void
language sql
security definer
set search_path = public
as $$
  delete from job where status in ('DONE', 'FAILED', 'CANCELLED') and "finishedAt" < now() - interval '90 days';
  delete from job_runner_run where "startedAt" < now() - interval '7 days';
  delete from notification where "createdAt" < now() - interval '90 days';
$$;

-- The runner now also has notification emails to send.
create or replace function jobs_work_waiting()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from job
     where status = 'QUEUED' or (status = 'RUNNING' and "lockedUntil" < now())
  ) or exists (select 1 from notification where "emailStatus" = 'PENDING');
$$;

notify pgrst, 'reload schema';
