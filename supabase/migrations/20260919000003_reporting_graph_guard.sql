-- Serialize staff graph mutations before checking ancestry. A real row write
-- also raises serialization_failure under stale REPEATABLE READ snapshots.
create table public.staff_graph_mutex (
  id boolean primary key default true check (id),
  revision bigint not null default 0
);
insert into public.staff_graph_mutex(id) values(true);
revoke all on public.staff_graph_mutex from public, anon, authenticated;
alter table public.staff_graph_mutex enable row level security;

create function public.lock_staff_graph() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.staff_graph_mutex set revision = revision + 1 where id;
  return null;
end $$;
revoke all on function public.lock_staff_graph() from public, anon, authenticated;
create trigger staff_graph_statement_lock before insert or update or delete
on public.app_user for each statement execute function public.lock_staff_graph();

create function public.validate_staff_manager() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cursor_id uuid; seen uuid[]; manager_row record;
begin
  if TG_OP = 'UPDATE' and new."managerUserId" is not distinct from old."managerUserId" then return new; end if;
  if new."managerUserId" is null then return new; end if;
  if new."partnerId" is not null then
    raise exception 'External users cannot have an internal reporting manager.' using errcode = '23514';
  end if;
  cursor_id := new."managerUserId";
  seen := array[new.id];
  while cursor_id is not null loop
    if cursor_id = any(seen) then
      raise exception 'This reporting assignment creates or joins a reporting cycle.' using errcode = '23514';
    end if;
    if cardinality(seen) > 100 then
      raise exception 'Reporting line is too deep.' using errcode = '23514';
    end if;
    select id, "managerUserId", status, "deletedAt", "partnerId" into manager_row
      from public.app_user where id = cursor_id;
    if not found then raise exception 'Reporting manager does not exist.' using errcode = '23514'; end if;
    if cursor_id = new."managerUserId" and
      (manager_row.status <> 'ACTIVE' or manager_row."deletedAt" is not null or manager_row."partnerId" is not null) then
      raise exception 'Choose an active internal reporting manager.' using errcode = '23514';
    end if;
    seen := array_append(seen, cursor_id);
    cursor_id := manager_row."managerUserId";
  end loop;
  return new;
end $$;
revoke all on function public.validate_staff_manager() from public, anon, authenticated;
create trigger staff_manager_guard before insert or update on public.app_user
for each row execute function public.validate_staff_manager();
