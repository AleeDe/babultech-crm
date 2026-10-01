-- Webhooks and the integration log.
--
-- An administrator points a webhook at a URL and picks events: a deal won, a
-- lead created, a case created or resolved, a quote accepted. When one happens,
-- a trigger writes a PENDING delivery to integration_log for every active
-- webhook listening; the background runner posts it, signed with the webhook's
-- secret, and retries with backoff. Every attempt's outcome stays in the log,
-- which is also where any future integration records what it sent and got back.
--
-- Both tables are read and written only through the service role, after the
-- app has checked the person is an administrator: a webhook's secret is never
-- readable from the browser.

create table if not exists webhook (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  url varchar(1000) not null check (url ~ '^https?://'),
  secret varchar(200) not null,
  events text[] not null default '{}',
  active boolean not null default true,
  "createdById" uuid references app_user (id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

create table if not exists integration_log (
  id uuid primary key default gen_random_uuid(),
  integration varchar(40) not null default 'WEBHOOK',
  direction varchar(3) not null default 'OUT' check (direction in ('IN', 'OUT')),
  "webhookId" uuid references webhook (id) on delete set null,
  event varchar(60) not null,
  endpoint varchar(1000),
  "relatedEntityType" varchar(40),
  "relatedEntityId" uuid,
  payload jsonb not null default '{}'::jsonb,
  status varchar(10) not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SUCCESS', 'FAILED', 'GAVE_UP')),
  "httpStatus" integer,
  "errorMessage" text,
  "responseBody" text,
  attempts integer not null default 0,
  "nextAttemptAt" timestamp(3) default now(),
  "requestAt" timestamp(3),
  "responseAt" timestamp(3),
  "durationMs" integer,
  "createdAt" timestamp(3) not null default now()
);
create index if not exists integration_log_due_idx on integration_log ("nextAttemptAt") where status in ('PENDING', 'FAILED');
create index if not exists integration_log_created_idx on integration_log ("createdAt" desc);

alter table webhook enable row level security;
alter table integration_log enable row level security;
-- No policies: the service role only.

-- Queues one event for every active webhook listening for it.
create or replace function queue_webhook_event(p_event text, p_entity_type text, p_entity_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into integration_log (integration, direction, "webhookId", event, endpoint, "relatedEntityType", "relatedEntityId", payload)
  select 'WEBHOOK', 'OUT', w.id, p_event, w.url, p_entity_type, p_entity_id,
         jsonb_build_object('event', p_event, 'occurredAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'data', p_data)
  from webhook w
  where w.active and p_event = any(w.events);
end $$;

revoke all on function queue_webhook_event(text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function webhook_events_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nothing to look up when nobody is listening, which is the usual case.
  if not exists (select 1 from webhook where active) then
    return new;
  end if;

  if tg_table_name = 'opportunity' then
    if new.stage::text = 'CLOSED_WON' and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
      perform queue_webhook_event('opportunity.won', 'Opportunity', new.id, jsonb_build_object(
        'id', new.id, 'number', new."opportunityNumber", 'name', new.name, 'accountId', new."accountId",
        'amount', new.amount, 'currency', new."currencyCode", 'closedOn', new."actualCloseDate"));
    elsif new.stage::text = 'CLOSED_LOST' and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
      perform queue_webhook_event('opportunity.lost', 'Opportunity', new.id, jsonb_build_object(
        'id', new.id, 'number', new."opportunityNumber", 'name', new.name, 'accountId', new."accountId", 'reason', new."lossReason"));
    end if;
  elsif tg_table_name = 'lead' and tg_op = 'INSERT' then
    perform queue_webhook_event('lead.created', 'Lead', new.id, jsonb_build_object(
      'id', new.id, 'number', new."leadNumber", 'firstName', new."firstName", 'lastName', new."lastName",
      'company', new."companyName", 'email', new.email, 'phone', new.phone, 'source', new."leadSource"));
  elsif tg_table_name = 'support_case' then
    if tg_op = 'INSERT' then
      perform queue_webhook_event('case.created', 'SupportCase', new.id, jsonb_build_object(
        'id', new.id, 'number', new."caseNumber", 'subject', new.subject, 'priority', new.priority, 'accountId', new."accountId", 'source', new.source));
    elsif new.status::text = 'RESOLVED' and old.status is distinct from new.status then
      perform queue_webhook_event('case.resolved', 'SupportCase', new.id, jsonb_build_object(
        'id', new.id, 'number', new."caseNumber", 'subject', new.subject, 'resolution', new.resolution));
    end if;
  elsif tg_table_name = 'quotation' and tg_op = 'UPDATE' and new.status::text = 'ACCEPTED' and old.status is distinct from new.status then
    perform queue_webhook_event('quote.accepted', 'Quotation', new.id, jsonb_build_object(
      'id', new.id, 'number', new."quoteNumber", 'opportunityId', new."opportunityId", 'accountId', new."accountId",
      'total', new."totalAmount", 'currency', new."currencyCode"));
  end if;
  return new;
end $$;

drop trigger if exists opportunity_webhooks on opportunity;
create trigger opportunity_webhooks after insert or update of stage on opportunity for each row execute function webhook_events_trigger();
drop trigger if exists lead_webhooks on lead;
create trigger lead_webhooks after insert on lead for each row execute function webhook_events_trigger();
drop trigger if exists support_case_webhooks on support_case;
create trigger support_case_webhooks after insert or update of status on support_case for each row execute function webhook_events_trigger();
drop trigger if exists quotation_webhooks on quotation;
create trigger quotation_webhooks after update of status on quotation for each row execute function webhook_events_trigger();

-- The runner claims due deliveries in batches, so two runs never post one twice.
create or replace function claim_webhook_deliveries(p_limit integer)
returns setof integration_log
language sql
security definer
set search_path = public
as $$
  update integration_log l set status = 'SENDING', attempts = l.attempts + 1, "requestAt" = now()
  where l.id in (
    select id from integration_log
    where integration = 'WEBHOOK' and direction = 'OUT' and status in ('PENDING', 'FAILED') and "nextAttemptAt" <= now()
    order by "nextAttemptAt"
    limit p_limit
    for update skip locked
  )
  returning l.*;
$$;

revoke all on function claim_webhook_deliveries(integer) from public, anon, authenticated;

-- Wake the runner for due deliveries too.
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
  ) or exists (select 1 from notification where "emailStatus" = 'PENDING')
    or exists (select 1 from integration_log where status in ('PENDING', 'FAILED') and "nextAttemptAt" <= now());
$$;

revoke all on function jobs_work_waiting() from public, anon, authenticated;

-- The log is kept for 90 days.
create or replace function integration_log_housekeeping()
returns void
language sql
security definer
set search_path = public
as $$
  delete from integration_log where "createdAt" < now() - interval '90 days' and status in ('SUCCESS', 'GAVE_UP');
$$;

revoke all on function integration_log_housekeeping() from public, anon, authenticated;
select cron.schedule('babultech-integration-log-housekeeping', '30 22 * * *', 'select public.integration_log_housekeeping()');
