-- Saved list views, and recently opened records.
--
-- A list's filters already live in its address - /leads?status=NEW&campaignId=…
-- - so a saved view is a name for one of those addresses. Each person keeps
-- their own, can make one the default that opens when they arrive at the
-- list, and administrators can share a view with everyone.
--
-- Recent records are the last thirty records a person opened, for the search
-- box and My work. What each is called is stored with it, so the list can be
-- shown without reading every record again; a record the person can no
-- longer see simply fails to open, as any link would.

create table if not exists saved_view (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references app_user(id) on delete cascade,
  entity varchar(40) not null,
  name varchar(120) not null,
  -- The list's query string, without the leading "?".
  query varchar(2000) not null default '',
  "isDefault" boolean not null default false,
  shared boolean not null default false,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

create index if not exists saved_view_user_idx on saved_view ("userId", entity);
create index if not exists saved_view_shared_idx on saved_view (entity) where shared;
-- One default per person per list.
create unique index if not exists saved_view_one_default_idx on saved_view ("userId", entity) where "isDefault";

alter table saved_view enable row level security;

drop policy if exists saved_view_read on saved_view;
create policy saved_view_read on saved_view for select to authenticated
  using (app_is_internal() and ("userId" = app_current_user_id() or shared));

drop policy if exists saved_view_write on saved_view;
create policy saved_view_write on saved_view for all to authenticated
  using (app_is_internal() and "userId" = app_current_user_id())
  with check (
    app_is_internal() and "userId" = app_current_user_id()
    and (not shared or app_has_permission('admin:settings'))
  );

create table if not exists recent_record (
  "userId" uuid not null references app_user(id) on delete cascade,
  "entityType" varchar(40) not null,
  "entityId" uuid not null,
  label varchar(300) not null,
  "viewedAt" timestamp(3) not null default now(),
  primary key ("userId", "entityType", "entityId")
);

create index if not exists recent_record_user_idx on recent_record ("userId", "viewedAt" desc);

alter table recent_record enable row level security;

drop policy if exists recent_record_own on recent_record;
create policy recent_record_own on recent_record for all to authenticated
  using ("userId" = app_current_user_id() and app_is_internal())
  with check ("userId" = app_current_user_id() and app_is_internal());

-- Records one visit and keeps the list to thirty.
create or replace function note_recent_record(p_entity_type text, p_entity_id uuid, p_label text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := app_current_user_id();
begin
  if v_user is null or not app_is_internal() then
    return;
  end if;
  insert into recent_record ("userId", "entityType", "entityId", label, "viewedAt")
  values (v_user, p_entity_type, p_entity_id, left(p_label, 300), now())
  on conflict ("userId", "entityType", "entityId")
  do update set label = excluded.label, "viewedAt" = excluded."viewedAt";

  delete from recent_record
   where "userId" = v_user
     and ("entityType", "entityId") not in (
       select "entityType", "entityId" from recent_record
        where "userId" = v_user order by "viewedAt" desc limit 30
     );
end $$;

revoke all on function note_recent_record(text, uuid, text) from public, anon;
grant execute on function note_recent_record(text, uuid, text) to authenticated;

-- The View as guard (20260929000002) covers every table; these are new.
drop trigger if exists view_as_read_only on saved_view;
create trigger view_as_read_only before insert or update or delete on saved_view
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists view_as_read_only on recent_record;
create trigger view_as_read_only before insert or update or delete on recent_record
  for each statement execute function app_refuse_view_as_writes();

notify pgrst, 'reload schema';
