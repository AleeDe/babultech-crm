-- Lead scoring.
--
-- A lead's score is points from rules an administrator sets: so many for each
-- kind of campaign touch in the last 90 days (each kind counted at most five
-- times, so one keen clicker cannot swamp it), so many when a field such as
-- the job title contains a word, and points off when nothing has happened for
-- a while. It is recalculated whenever the lead is touched, and every night.
--
-- When a lead's score first reaches the threshold its owner is told (a "hot
-- lead" notification), and - if the setting is on - a Prospect is moved to New
-- so it joins the sales queue by itself.

alter table lead
  add column if not exists score integer not null default 0,
  add column if not exists "scoredAt" timestamp(3);

create index if not exists lead_score_idx on lead (score desc) where "deletedAt" is null and "convertedAt" is null;

create table if not exists lead_score_rule (
  id uuid primary key default gen_random_uuid(),
  name varchar(150) not null,
  "ruleType" varchar(10) not null check ("ruleType" in ('TOUCH', 'FIELD', 'INACTIVE')),
  -- TOUCH: which kind of campaign touch.
  "interactionType" varchar(30),
  -- FIELD: which lead field, and the text it must contain.
  field varchar(30) check (field in ('jobTitle', 'companySize', 'industry', 'businessType', 'country', 'city', 'leadSource', 'email')),
  "matchText" varchar(100),
  -- INACTIVE: after how many days without a touch.
  days integer check (days is null or days between 1 and 3650),
  points integer not null check (points between -100 and 100),
  active boolean not null default true,
  "sortOrder" integer not null default 0,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now(),
  constraint lead_score_rule_shape check (
    ("ruleType" = 'TOUCH' and "interactionType" is not null)
    or ("ruleType" = 'FIELD' and field is not null and nullif(btrim("matchText"), '') is not null)
    or ("ruleType" = 'INACTIVE' and days is not null)
  )
);

create table if not exists lead_score_setting (
  id boolean primary key default true check (id),
  threshold integer not null default 50 check (threshold between 1 and 1000),
  "autoQualify" boolean not null default false,
  "updatedAt" timestamp(3) not null default now()
);
insert into lead_score_setting (id) values (true) on conflict do nothing;

alter table lead_score_rule enable row level security;
alter table lead_score_setting enable row level security;

drop policy if exists lead_score_rule_read on lead_score_rule;
create policy lead_score_rule_read on lead_score_rule for select to authenticated using (app_is_internal());
drop policy if exists lead_score_rule_write on lead_score_rule;
create policy lead_score_rule_write on lead_score_rule for all to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'))
  with check (app_is_internal() and app_has_permission('admin:settings'));

drop policy if exists lead_score_setting_read on lead_score_setting;
create policy lead_score_setting_read on lead_score_setting for select to authenticated using (app_is_internal());
drop policy if exists lead_score_setting_write on lead_score_setting;
create policy lead_score_setting_write on lead_score_setting for update to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'))
  with check (app_is_internal() and app_has_permission('admin:settings'));

drop trigger if exists view_as_read_only on lead_score_rule;
create trigger view_as_read_only before insert or update or delete on lead_score_rule
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists view_as_read_only on lead_score_setting;
create trigger view_as_read_only before insert or update or delete on lead_score_setting
  for each statement execute function app_refuse_view_as_writes();

-- A starting set, to be changed on Campaigns › Lead scoring.
insert into lead_score_rule (name, "ruleType", "interactionType", field, "matchText", days, points, "sortOrder")
select * from (values
  ('Submitted a website form', 'TOUCH', 'FORM_SUBMIT', null, null, null::integer, 20, 10),
  ('Clicked an email', 'TOUCH', 'EMAIL_CLICK', null, null, null, 10, 20),
  ('Opened an email', 'TOUCH', 'EMAIL_OPEN', null, null, null, 3, 30),
  ('Attended an event', 'TOUCH', 'EVENT_ATTENDED', null, null, null, 15, 40),
  ('Attended a webinar', 'TOUCH', 'WEBINAR_ATTENDED', null, null, null, 15, 50),
  ('Had a meeting', 'TOUCH', 'MEETING', null, null, null, 20, 60),
  ('Job title says Director', 'FIELD', null, 'jobTitle', 'Director', null, 10, 70),
  ('Job title says CEO', 'FIELD', null, 'jobTitle', 'CEO', null, 10, 80),
  ('Job title says Manager', 'FIELD', null, 'jobTitle', 'Manager', null, 5, 90),
  ('Nothing for 30 days', 'INACTIVE', null, null, null, 30, -10, 100)
) v(name, "ruleType", "interactionType", field, "matchText", days, points, "sortOrder")
where not exists (select 1 from lead_score_rule);

create or replace function lead_compute_score(p_lead_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lead lead%rowtype;
  v_rule lead_score_rule%rowtype;
  v_score integer := 0;
  v_count integer;
  v_value text;
begin
  select * into v_lead from lead where id = p_lead_id;
  if not found then
    return 0;
  end if;
  for v_rule in select * from lead_score_rule where active loop
    if v_rule."ruleType" = 'TOUCH' then
      select count(*) into v_count from campaign_interaction
       where "leadId" = p_lead_id and "interactionType" = v_rule."interactionType"
         and "occurredAt" > now() - interval '90 days';
      v_score := v_score + v_rule.points * least(v_count, 5);
    elsif v_rule."ruleType" = 'FIELD' then
      v_value := case v_rule.field
        when 'jobTitle' then v_lead."jobTitle" when 'companySize' then v_lead."companySize"
        when 'industry' then v_lead.industry when 'businessType' then v_lead."businessType"
        when 'country' then v_lead.country when 'city' then v_lead.city
        when 'leadSource' then v_lead."leadSource" when 'email' then v_lead.email
      end;
      if v_value ilike '%' || v_rule."matchText" || '%' then
        v_score := v_score + v_rule.points;
      end if;
    elsif v_rule."ruleType" = 'INACTIVE' then
      if coalesce(v_lead."latestTouchAt", v_lead."createdAt") < now() - make_interval(days => v_rule.days) then
        v_score := v_score + v_rule.points;
      end if;
    end if;
  end loop;
  return greatest(v_score, 0);
end $$;

create or replace function lead_rescore(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_status text;
  v_owner uuid;
  v_name text;
  v_new integer;
  v_setting lead_score_setting%rowtype;
begin
  select score, status::text, "ownerUserId", btrim("firstName" || ' ' || coalesce(nullif("lastName", '-'), ''))
    into v_old, v_status, v_owner, v_name
    from lead where id = p_lead_id and "deletedAt" is null and "convertedAt" is null;
  if not found then
    return null;
  end if;
  v_new := lead_compute_score(p_lead_id);
  select * into v_setting from lead_score_setting limit 1;

  update lead set score = v_new, "scoredAt" = now() where id = p_lead_id and score is distinct from v_new;

  if v_old < v_setting.threshold and v_new >= v_setting.threshold
     and v_status in ('PROSPECT', 'NEW', 'ASSIGNED', 'ATTEMPTED_CONTACT', 'CONTACTED', 'NURTURING') then
    if v_setting."autoQualify" and v_status = 'PROSPECT' then
      update lead set status = 'NEW', "updatedAt" = now() where id = p_lead_id;
    end if;
    perform notify_user(v_owner, 'HOT_LEAD', 'Hot lead: ' || v_name || ' scored ' || v_new,
      case when v_setting."autoQualify" and v_status = 'PROSPECT' then 'Moved from Prospect to New.' end,
      '/leads/' || p_lead_id, 'Lead', p_lead_id, 'hot:' || p_lead_id || ':' || to_char(now(), 'YYYY-MM'));
  end if;
  return v_new;
end $$;

revoke all on function lead_compute_score(uuid) from public, anon, authenticated;
revoke all on function lead_rescore(uuid) from public, anon, authenticated;
grant execute on function lead_rescore(uuid) to service_role;

create or replace function lead_rescore_on_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new."leadId" is not null then
      perform lead_rescore(new."leadId");
    end if;
  exception when others then
    raise warning 'lead_rescore_on_touch: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists campaign_interaction_rescore on campaign_interaction;
create trigger campaign_interaction_rescore after insert on campaign_interaction
  for each row execute function lead_rescore_on_touch();

create or replace function lead_rescore_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform lead_rescore(new.id);
  exception when others then
    raise warning 'lead_rescore_on_change: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists lead_rescore_on_change on lead;
create trigger lead_rescore_on_change after insert or update of "jobTitle", "companySize", industry, "businessType", country, city, "leadSource", email on lead
  for each row execute function lead_rescore_on_change();

-- Every open lead, nightly: inactivity only shows with time passing, and
-- rules change.
create or replace function lead_rescore_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in select id from lead where "deletedAt" is null and "convertedAt" is null loop
    perform lead_rescore(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function lead_rescore_all() from public, anon, authenticated;
grant execute on function lead_rescore_all() to service_role;

-- Today's scores for the leads already here, quietly: nobody is told a lead
-- is hot just because scoring was switched on.
update lead set score = lead_compute_score(id), "scoredAt" = now()
 where "deletedAt" is null and "convertedAt" is null;

-- 04:00 in Karachi.
select cron.schedule('babultech-lead-rescore', '0 23 * * *', 'select public.lead_rescore_all()');

notify pgrst, 'reload schema';
