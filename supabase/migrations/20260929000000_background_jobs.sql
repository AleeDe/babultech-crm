-- Background jobs.
--
-- Some work is too long to do while somebody waits for the page: a mass email
-- to a few thousand leads, a large import, the alerts that go out when a deal
-- is won. Until now all of it ran inside the request, so a big send could time
-- out half way with no record of how far it got.
--
-- A job is a row. The app queues it and returns at once; a runner picks it up,
-- works through it in batches and records progress and errors on the row, so
-- the person who started it can watch it finish.
--
-- The runner is the app itself, at /api/jobs/run. Supabase's scheduler
-- (pg_cron) calls it every minute through pg_net, but only when there is
-- something to do, so an idle system makes no calls at all. The call carries a
-- key kept in the Supabase vault; the route checks it before doing anything.
-- Keeping the work in the app means one codebase, the same email code and the
-- same rules, rather than a second copy in an edge function.
--
-- The app's public address is a company setting, so the scheduler knows where
-- to call. Until an administrator sets it the scheduler does nothing, and jobs
-- still start straight away from the request that queued them.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table company_setting add column if not exists "publicAppUrl" varchar(300);

create table if not exists job (
  id uuid primary key default gen_random_uuid(),
  "jobType" varchar(60) not null,
  status varchar(20) not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  title varchar(300) not null,
  payload jsonb not null default '{}'::jsonb,
  -- Where a resumable job has got to, so a job cut off by a time limit picks
  -- up from the next item rather than starting again.
  cursor jsonb not null default '{}'::jsonb,
  "progressDone" integer not null default 0,
  "progressTotal" integer,
  result jsonb,
  errors jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  "createdById" uuid references app_user(id),
  "createdAt" timestamp(3) not null default now(),
  "startedAt" timestamp(3),
  "finishedAt" timestamp(3),
  -- A runner holds a job until this time. One that dies mid-batch lets go of
  -- it when this passes, and the next run carries on.
  "lockedUntil" timestamp(3),
  "updatedAt" timestamp(3) not null default now()
);

create index if not exists job_waiting_idx on job ("createdAt") where status in ('QUEUED', 'RUNNING');
create index if not exists job_creator_idx on job ("createdById", "createdAt" desc);

-- A short log of the runner's own visits, for the settings screen: when it last
-- ran and whether it is keeping up.
create table if not exists job_runner_run (
  id uuid primary key default gen_random_uuid(),
  "startedAt" timestamp(3) not null default now(),
  "finishedAt" timestamp(3),
  processed integer not null default 0,
  trigger varchar(20) not null default 'SCHEDULER',
  error text
);
create index if not exists job_runner_run_started_idx on job_runner_run ("startedAt" desc);

alter table job enable row level security;
alter table job_runner_run enable row level security;

-- People see the jobs they started; administrators see every job. Nobody
-- writes a job through the API: the app queues and updates them with the
-- service role, after checking the person may do the work the job does.
drop policy if exists job_read on job;
create policy job_read on job for select to authenticated
  using (app_is_internal() and ("createdById" = app_current_user_id() or app_has_permission('admin:settings')));

drop policy if exists job_runner_run_read on job_runner_run;
create policy job_runner_run_read on job_runner_run for select to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'));

-- Claims up to p_limit jobs for one runner. SKIP LOCKED lets two runners that
-- overlap - the scheduler and a request that just queued a job - share the
-- queue without both taking the same job.
create or replace function claim_jobs(p_limit integer, p_lease_seconds integer default 120)
returns setof job
language sql
security definer
set search_path = public
as $$
  update job j
     set status = 'RUNNING',
         "startedAt" = coalesce(j."startedAt", now()),
         "lockedUntil" = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         "updatedAt" = now()
   where j.id in (
     select id from job
      where status = 'QUEUED'
         or (status = 'RUNNING' and "lockedUntil" < now())
      order by "createdAt"
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;

revoke all on function claim_jobs(integer, integer) from public, anon, authenticated;
grant execute on function claim_jobs(integer, integer) to service_role;

-- The runner's key. Made once and kept in the vault; nothing outside the
-- database ever reads it back except through the check below.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'jobs_runner_key') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'jobs_runner_key',
      'Presented by the scheduler to /api/jobs/run'
    );
  end if;
end $$;

create or replace function jobs_key_matches(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_key, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'jobs_runner_key' and decrypted_secret = p_key);
$$;

revoke all on function jobs_key_matches(text) from public, anon, authenticated;
grant execute on function jobs_key_matches(text) to service_role;

-- Whether the runner has anything to do. Redefined as other kinds of waiting
-- work are added, so the scheduler only calls the app when it is needed.
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
  );
$$;

revoke all on function jobs_work_waiting() from public, anon, authenticated;

create or replace function jobs_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_key text;
begin
  select nullif(btrim("publicAppUrl"), '') into v_url from company_setting limit 1;
  if v_url is null or not jobs_work_waiting() then
    return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'jobs_runner_key';
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/jobs/run',
    headers := jsonb_build_object('content-type', 'application/json', 'x-jobs-key', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end $$;

revoke all on function jobs_tick() from public, anon, authenticated;

-- Housekeeping: finished jobs are kept for 90 days, the runner's own log for 7.
create or replace function jobs_housekeeping()
returns void
language sql
security definer
set search_path = public
as $$
  delete from job where status in ('DONE', 'FAILED', 'CANCELLED') and "finishedAt" < now() - interval '90 days';
  delete from job_runner_run where "startedAt" < now() - interval '7 days';
$$;

revoke all on function jobs_housekeeping() from public, anon, authenticated;

select cron.schedule('babultech-jobs-tick', '* * * * *', 'select public.jobs_tick()');
-- 03:15 in Karachi.
select cron.schedule('babultech-jobs-housekeeping', '15 22 * * *', 'select public.jobs_housekeeping()');

notify pgrst, 'reload schema';
