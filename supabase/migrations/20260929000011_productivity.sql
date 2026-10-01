-- Productivity: approval rules, automatic rules, and scheduled reports.
--
-- 1. Approval rules. An administrator sets limits - a quote total above an
--    amount, or any line discounted more than a percentage - and a quote over
--    a limit goes to Approvals before it can be sent. Our own quotes needed no
--    approval until now; partners' still always do. The rule is enforced here,
--    on the quote itself, so no screen can send one round it. Changing an
--    approved quote's lines or total sends it back for approval.
--
-- 2. Automatic rules, each switched on or off by an administrator and each
--    logging what it did:
--      LEAD_ROUND_ROBIN       website-form leads shared out in turn among chosen people
--      LEAD_NO_FOLLOW_UP      the owner is told about an open lead with no follow-up date
--      DEAL_STALE             the owner is told about an open deal that has not moved
--      CASE_RESPONSE_WARNING  the owner is told a case's first-response deadline is near
--
-- 3. Scheduled reports. Anyone can ask for a report weekly or monthly; on the
--    day, they get a notification (and an email) linking to it. The email
--    carries the link, not the figures, so what they see is still decided by
--    their own access when they open it.

-- ---------------------------------------------------------------------------
-- 1. Approval rules
-- ---------------------------------------------------------------------------

create table if not exists approval_rule (
  id uuid primary key default gen_random_uuid(),
  name varchar(150) not null,
  entity varchar(30) not null default 'Quotation' check (entity in ('Quotation')),
  "minTotal" numeric(18, 2),
  "maxLineDiscountPercent" numeric(5, 2),
  active boolean not null default true,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now(),
  constraint approval_rule_has_limit check ("minTotal" is not null or "maxLineDiscountPercent" is not null)
);

alter table approval_rule enable row level security;
drop policy if exists approval_rule_read on approval_rule;
create policy approval_rule_read on approval_rule for select to authenticated using (app_is_internal());
drop policy if exists approval_rule_write on approval_rule;
create policy approval_rule_write on approval_rule for all to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'))
  with check (app_is_internal() and app_has_permission('admin:settings'));
drop trigger if exists view_as_read_only on approval_rule;
create trigger view_as_read_only before insert or update or delete on approval_rule
  for each statement execute function app_refuse_view_as_writes();

-- Why a quote needs approval before it is sent, or null.
create or replace function quotation_approval_reason(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q quotation%rowtype;
  v_rule approval_rule%rowtype;
  v_max numeric;
begin
  select * into v_q from quotation where id = p_id;
  if not found then
    return null;
  end if;
  select max(coalesce("discountPercent", 0)) into v_max from quote_line where "quotationId" = p_id;
  for v_rule in select * from approval_rule where active and entity = 'Quotation' order by "createdAt" loop
    if v_rule."minTotal" is not null and coalesce(v_q."totalAmount", 0) > v_rule."minTotal" then
      return format('%s: the total is over %s %s.', v_rule.name, v_q."currencyCode", to_char(v_rule."minTotal", 'FM999,999,999,990.00'));
    end if;
    if v_rule."maxLineDiscountPercent" is not null and coalesce(v_max, 0) > v_rule."maxLineDiscountPercent" then
      return format('%s: a line is discounted more than %s%%.', v_rule.name, trim(to_char(v_rule."maxLineDiscountPercent", 'FM990.##')));
    end if;
  end loop;
  return null;
end $$;

grant execute on function quotation_approval_reason(uuid) to authenticated;

-- A quote cannot be sent over a limit without approval.
create or replace function quotation_rule_guard()
returns trigger
language plpgsql
as $$
declare
  v_reason text;
begin
  if new.status = 'SENT' and old.status is distinct from 'SENT' and new."approvalStatus" is distinct from 'APPROVED' then
    v_reason := quotation_approval_reason(new.id);
    if v_reason is not null then
      raise exception '% needs approval before it is sent. %', new."quoteNumber", v_reason using errcode = '23514';
    end if;
  end if;

  -- An approved quote whose total changes goes back for approval.
  if old."approvalStatus" = 'APPROVED' and new."approvalStatus" = 'APPROVED'
     and old.status = 'APPROVED' and new.status = 'APPROVED'
     and new."totalAmount" is distinct from old."totalAmount" then
    new."approvalStatus" := 'NOT_REQUIRED';
    new.status := 'DRAFT';
    new."approvalDecidedAt" := null;
    new."approvalDecidedById" := null;
  end if;
  return new;
end $$;

drop trigger if exists quotation_rule_guard on quotation;
create trigger quotation_rule_guard before update on quotation
  for each row execute function quotation_rule_guard();

-- Our team asks for approval of a quote over a limit.
create or replace function request_quotation_approval(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q quotation%rowtype;
  v_actor uuid := app_current_user_id();
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  select * into v_q from quotation where id = p_id and "deletedAt" is null for update;
  if not found or not (app_current_scope() = 'ALL' or v_q."opportunityId" in (select app_internal_visible_opportunity_ids())) then
    raise exception 'Quote not found.' using errcode = '42501';
  end if;
  if v_q.status not in ('DRAFT', 'APPROVED') then
    raise exception '% cannot be sent for approval now.', v_q."quoteNumber" using errcode = '23514';
  end if;
  perform update_record('quotation', p_id, jsonb_build_object(
    'status', 'UNDER_REVIEW',
    'approvalStatus', 'PENDING',
    'approvalRequestedAt', now(),
    'approvalDecidedAt', null,
    'approvalDecidedById', null
  ), 'Quotation', v_actor);
  return jsonb_build_object('status', 'UNDER_REVIEW');
end $$;

revoke all on function request_quotation_approval(uuid) from public, anon;
grant execute on function request_quotation_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Automatic rules
-- ---------------------------------------------------------------------------

create table if not exists automation_rule (
  key varchar(40) primary key,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  "updatedAt" timestamp(3) not null default now(),
  "updatedById" uuid references app_user(id) on delete set null
);

insert into automation_rule (key, config) values
  ('LEAD_ROUND_ROBIN', '{"userIds": [], "next": 0}'),
  ('LEAD_NO_FOLLOW_UP', '{"days": 3}'),
  ('DEAL_STALE', '{"days": 14}'),
  ('CASE_RESPONSE_WARNING', '{"minutes": 60}')
on conflict (key) do nothing;

create table if not exists automation_log (
  id uuid primary key default gen_random_uuid(),
  "ruleKey" varchar(40) not null,
  "entityType" varchar(40),
  "entityId" uuid,
  -- One action per record per period, however often the rule runs.
  "periodKey" varchar(60),
  action text not null,
  "createdAt" timestamp(3) not null default now()
);
create index if not exists automation_log_rule_idx on automation_log ("ruleKey", "createdAt" desc);
create unique index if not exists automation_log_once_idx on automation_log ("ruleKey", "entityId", "periodKey") where "periodKey" is not null;

alter table automation_rule enable row level security;
alter table automation_log enable row level security;
drop policy if exists automation_rule_read on automation_rule;
create policy automation_rule_read on automation_rule for select to authenticated using (app_is_internal());
drop policy if exists automation_rule_write on automation_rule;
create policy automation_rule_write on automation_rule for update to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'))
  with check (app_is_internal() and app_has_permission('admin:settings'));
drop policy if exists automation_log_read on automation_log;
create policy automation_log_read on automation_log for select to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'));
drop trigger if exists view_as_read_only on automation_rule;
create trigger view_as_read_only before insert or update or delete on automation_rule
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists view_as_read_only on automation_log;
create trigger view_as_read_only before insert or update or delete on automation_log
  for each statement execute function app_refuse_view_as_writes();

-- Website-form leads (made with no one signed in) go to the next person in
-- the chosen list, in turn.
create or replace function lead_round_robin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule automation_rule%rowtype;
  v_pool uuid[];
  v_next integer;
  v_owner uuid;
begin
  if app_current_user_id() is not null or new."leadSource" is distinct from 'Website' then
    return new;
  end if;
  select * into v_rule from automation_rule where key = 'LEAD_ROUND_ROBIN' and enabled for update;
  if not found then
    return new;
  end if;
  select array_agg(u.id order by ord) into v_pool
    from jsonb_array_elements_text(v_rule.config -> 'userIds') with ordinality as p(uid, ord)
    join app_user u on u.id = p.uid::uuid and u.status = 'ACTIVE' and u."deletedAt" is null;
  if v_pool is null or cardinality(v_pool) = 0 then
    return new;
  end if;
  v_next := coalesce((v_rule.config ->> 'next')::integer, 0) % cardinality(v_pool);
  v_owner := v_pool[v_next + 1];
  new."ownerUserId" := v_owner;
  update automation_rule set config = config || jsonb_build_object('next', v_next + 1) where key = 'LEAD_ROUND_ROBIN';
  insert into automation_log ("ruleKey", "entityType", "entityId", action)
  values ('LEAD_ROUND_ROBIN', 'Lead', new.id,
          'Assigned to ' || coalesce((select "fullName" from app_user where id = v_owner), 'someone'));
  return new;
end $$;

drop trigger if exists lead_round_robin on lead;
create trigger lead_round_robin before insert on lead
  for each row execute function lead_round_robin();

-- The rules that watch the clock. Every ten minutes.
create or replace function automation_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule automation_rule%rowtype;
  v_row record;
  v_count integer := 0;
  v_days integer;
  v_minutes integer;
  v_logged uuid;
begin
  -- Leads with nobody's next step written down.
  select * into v_rule from automation_rule where key = 'LEAD_NO_FOLLOW_UP' and enabled;
  if found then
    v_days := greatest(coalesce((v_rule.config ->> 'days')::integer, 3), 1);
    for v_row in
      select id, "ownerUserId", btrim("firstName" || ' ' || coalesce(nullif("lastName", '-'), '')) as name
        from lead
       where "deletedAt" is null and "convertedAt" is null and "nextFollowUpAt" is null
         and status not in ('PROSPECT', 'CONVERTED', 'DISQUALIFIED')
         and "createdAt" < now() - make_interval(days => v_days)
       limit 500
    loop
      insert into automation_log ("ruleKey", "entityType", "entityId", "periodKey", action)
      values ('LEAD_NO_FOLLOW_UP', 'Lead', v_row.id, to_char(now(), 'IYYY-IW'), 'Reminded the owner: no follow-up date')
      on conflict do nothing returning id into v_logged;
      if v_logged is not null then
        perform notify_user(v_row."ownerUserId", 'AUTOMATION', 'No follow-up set: ' || v_row.name,
          'Open lead with no next step. Set a follow-up date or move it on.', '/leads/' || v_row.id, 'Lead', v_row.id);
        v_count := v_count + 1;
      end if;
      v_logged := null;
    end loop;
  end if;

  -- Deals that have not moved.
  select * into v_rule from automation_rule where key = 'DEAL_STALE' and enabled;
  if found then
    v_days := greatest(coalesce((v_rule.config ->> 'days')::integer, 14), 1);
    for v_row in
      select id, "ownerUserId", name from opportunity
       where "deletedAt" is null and stage not in ('CLOSED_WON', 'CLOSED_LOST')
         and "updatedAt" < now() - make_interval(days => v_days)
       limit 500
    loop
      insert into automation_log ("ruleKey", "entityType", "entityId", "periodKey", action)
      values ('DEAL_STALE', 'Opportunity', v_row.id,
              floor(extract(epoch from now()) / (v_days * 86400))::text, 'Reminded the owner: no movement for ' || v_days || ' days')
      on conflict do nothing returning id into v_logged;
      if v_logged is not null then
        perform notify_user(v_row."ownerUserId", 'AUTOMATION', 'Deal has not moved: ' || v_row.name,
          'Nothing has changed on it for ' || v_days || ' days.', '/opportunities/' || v_row.id, 'Opportunity', v_row.id);
        v_count := v_count + 1;
      end if;
      v_logged := null;
    end loop;
  end if;

  -- Cases close to their first-response deadline.
  select * into v_rule from automation_rule where key = 'CASE_RESPONSE_WARNING' and enabled;
  if found then
    v_minutes := greatest(coalesce((v_rule.config ->> 'minutes')::integer, 60), 5);
    for v_row in
      select id, "ownerUserId", "caseNumber", subject, "firstResponseDueAt" from support_case
       where "deletedAt" is null and "firstRespondedAt" is null
         and status not in ('RESOLVED', 'CLOSED', 'CANCELLED')
         and "firstResponseDueAt" between now() and now() + make_interval(mins => v_minutes)
       limit 500
    loop
      insert into automation_log ("ruleKey", "entityType", "entityId", "periodKey", action)
      values ('CASE_RESPONSE_WARNING', 'SupportCase', v_row.id, 'first-response', 'Warned the owner: first response due soon')
      on conflict do nothing returning id into v_logged;
      if v_logged is not null then
        perform notify_user(v_row."ownerUserId", 'AUTOMATION', 'First response due soon: ' || v_row."caseNumber",
          v_row.subject || ' - due ' || to_char(v_row."firstResponseDueAt" at time zone 'UTC' at time zone 'Asia/Karachi', 'HH24:MI'),
          '/cases/' || v_row.id, 'SupportCase', v_row.id);
        v_count := v_count + 1;
      end if;
      v_logged := null;
    end loop;
  end if;

  delete from automation_log where "createdAt" < now() - interval '90 days';
  return v_count;
end $$;

revoke all on function automation_tick() from public, anon, authenticated;
grant execute on function automation_tick() to service_role;

select cron.schedule('babultech-automation', '*/10 * * * *', 'select public.automation_tick()');

-- ---------------------------------------------------------------------------
-- 3. Scheduled reports
-- ---------------------------------------------------------------------------

create table if not exists report_schedule (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references app_user(id) on delete cascade,
  "reportKey" varchar(40) not null,
  title varchar(200) not null,
  -- The report's address with its filters, e.g. /reports/pipeline?owner=…
  link varchar(1000) not null,
  frequency varchar(10) not null check (frequency in ('WEEKLY', 'MONTHLY')),
  "nextRunAt" timestamp(3) not null,
  "lastSentAt" timestamp(3),
  "createdAt" timestamp(3) not null default now()
);
create index if not exists report_schedule_due_idx on report_schedule ("nextRunAt");

alter table report_schedule enable row level security;
drop policy if exists report_schedule_own on report_schedule;
create policy report_schedule_own on report_schedule for all to authenticated
  using ("userId" = app_current_user_id() and app_is_internal())
  with check ("userId" = app_current_user_id() and app_is_internal());
drop trigger if exists view_as_read_only on report_schedule;
create trigger view_as_read_only before insert or update or delete on report_schedule
  for each statement execute function app_refuse_view_as_writes();

-- Reports someone scheduled are emailed unless they turn that off.
create or replace function notification_email_by_default(p_kind text)
returns boolean language sql immutable as $$
  select p_kind in ('ASSIGNED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'REPORT_READY');
$$;

create or replace function report_schedules_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row report_schedule%rowtype;
  v_count integer := 0;
begin
  for v_row in select * from report_schedule where "nextRunAt" <= now() for update skip locked loop
    perform notify_user(v_row."userId", 'REPORT_READY', 'Your ' || lower(v_row.frequency) || ' report: ' || v_row.title,
      'Open it for the latest figures.', v_row.link, 'Report', v_row.id,
      'report:' || v_row.id || ':' || to_char(now(), 'YYYY-MM-DD'));
    update report_schedule set
      "lastSentAt" = now(),
      "nextRunAt" = case frequency when 'WEEKLY' then "nextRunAt" + interval '7 days' else "nextRunAt" + interval '1 month' end
    where id = v_row.id;
    -- A schedule far behind (the scheduler was off) catches up to the next date, not every missed one.
    update report_schedule set "nextRunAt" = now() + case frequency when 'WEEKLY' then interval '7 days' else interval '1 month' end
     where id = v_row.id and "nextRunAt" <= now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function report_schedules_tick() from public, anon, authenticated;
grant execute on function report_schedules_tick() to service_role;

-- 07:00 in Karachi.
select cron.schedule('babultech-report-schedules', '0 2 * * *', 'select public.report_schedules_tick()');

notify pgrst, 'reload schema';
