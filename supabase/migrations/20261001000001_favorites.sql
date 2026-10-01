-- Favourite records: a person's own short list of the records they keep going
-- back to, shown in the search box and on My work.

create table if not exists favorite_record (
  "userId" uuid not null default app_current_user_id() references app_user (id) on delete cascade,
  "entityType" varchar(40) not null,
  "entityId" uuid not null,
  label varchar(300) not null,
  "createdAt" timestamp(3) not null default now(),
  primary key ("userId", "entityType", "entityId")
);

alter table favorite_record enable row level security;
drop policy if exists favorite_record_own on favorite_record;
create policy favorite_record_own on favorite_record for all to authenticated
  using (app_is_internal() and "userId" = app_current_user_id())
  with check (app_is_internal() and "userId" = app_current_user_id());
grant select, insert, update, delete on favorite_record to authenticated;

-- A merge carries favourites across to the record kept.
create or replace function merge_move_polymorphic(p_type text, p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_total integer := 0;
  v_table text;
begin
  foreach v_table in array array['activity', 'email', 'note', 'document', 'approval_request'] loop
    execute format('update %I set "relatedEntityId" = $1 where "relatedEntityType" = $2 and "relatedEntityId" = $3', v_table)
      using p_to, p_type, p_from;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  insert into record_follow ("userId", "entityType", "entityId", "createdAt")
  select f."userId", f."entityType", p_to, f."createdAt" from record_follow f
  where f."entityType" = p_type and f."entityId" = p_from
  on conflict do nothing;
  delete from record_follow where "entityType" = p_type and "entityId" = p_from;

  insert into favorite_record ("userId", "entityType", "entityId", label, "createdAt")
  select f."userId", f."entityType", p_to, f.label, f."createdAt" from favorite_record f
  where f."entityType" = p_type and f."entityId" = p_from
  on conflict do nothing;
  delete from favorite_record where "entityType" = p_type and "entityId" = p_from;

  delete from recent_record where "entityType" = p_type and "entityId" = p_from;
  return v_total;
end $$;

revoke all on function merge_move_polymorphic(text, uuid, uuid) from public, anon, authenticated;
