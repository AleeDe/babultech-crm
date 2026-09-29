-- Sign-in history, and viewing the CRM as someone else sees it.
--
-- login_event records every sign-in, failed sign-in and sign-out, with where
-- it came from, and the start and end of every View as session. People see
-- their own; administrators see everyone's.
--
-- View as. An administrator troubleshooting "I can't see that deal" opens the
-- CRM, or a portal, exactly as that person sees it: their permissions, their
-- data scope, their records. It is read-only, it needs a reason, it ends after
-- 30 minutes, and it never works on an administrator. The app runs the
-- session on a short-lived sign-in issued for that person - no password is
-- seen or changed - and records it here.
--
-- Read-only is enforced twice. The app refuses every change while a View as
-- session is open. And the database refuses any insert, update or delete made
-- on a View as session's token, on every table, whatever the policies say:
-- app_refuse_view_as_writes() below runs before each statement and looks the
-- token's session up in view_as_session. Service-role work carries no session
-- and is unaffected.

create table if not exists login_event (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid references app_user(id) on delete set null,
  email varchar(255),
  "eventType" varchar(20) not null
    check ("eventType" in ('SIGN_IN', 'SIGN_IN_FAILED', 'SIGN_OUT', 'VIEW_AS_START', 'VIEW_AS_END')),
  -- For View as: whose view it was.
  "targetUserId" uuid references app_user(id) on delete set null,
  reason text,
  ip varchar(64),
  "userAgent" varchar(500),
  detail varchar(300),
  "createdAt" timestamp(3) not null default now()
);

create index if not exists login_event_user_idx on login_event ("userId", "createdAt" desc);
create index if not exists login_event_created_idx on login_event ("createdAt" desc);

create table if not exists view_as_session (
  id uuid primary key default gen_random_uuid(),
  "adminUserId" uuid not null references app_user(id),
  "targetUserId" uuid not null references app_user(id),
  reason text not null,
  -- The Supabase Auth session issued for the view, from its token. Every
  -- change made on it is refused, before and after it ends.
  "sessionId" uuid not null unique,
  "startedAt" timestamp(3) not null default now(),
  "expiresAt" timestamp(3) not null,
  "endedAt" timestamp(3)
);

create index if not exists view_as_session_admin_idx on view_as_session ("adminUserId", "startedAt" desc);

alter table login_event enable row level security;
alter table view_as_session enable row level security;

drop policy if exists login_event_read on login_event;
create policy login_event_read on login_event for select to authenticated
  using (
    app_is_internal()
    and ("userId" = app_current_user_id() or app_has_permission('admin:users'))
  );

drop policy if exists view_as_session_read on view_as_session;
create policy view_as_session_read on view_as_session for select to authenticated
  using (app_is_internal() and app_has_permission('admin:users'));

-- Whether this request is on a View as session's token.
create or replace function app_in_view_as()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
begin
  if v_session is null then
    return false;
  end if;
  return exists (select 1 from view_as_session where "sessionId" = v_session::uuid);
end $$;

create or replace function app_refuse_view_as_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_in_view_as() then
    raise exception 'You are viewing as someone else, so nothing can be changed.' using errcode = '42501';
  end if;
  return null;
end $$;

-- On every table. A table added later needs the same trigger; the check
-- script scripts/check-view-as-guard.sql lists any that lack it.
do $$
declare
  v_table text;
begin
  for v_table in
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists view_as_read_only on %I', v_table);
    execute format(
      'create trigger view_as_read_only before insert or update or delete on %I for each statement execute function app_refuse_view_as_writes()',
      v_table
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
