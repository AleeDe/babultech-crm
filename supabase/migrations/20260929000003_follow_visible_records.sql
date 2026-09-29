-- Following from a record's page.
--
-- follow_record() (20260929000001) checked the record was visible and then
-- called follow_for(), which people are rightly not allowed to call - it
-- follows on anyone's behalf - so following from a page failed.
--
-- Now a follow is an ordinary insert under a policy: your own, as an employee,
-- of a record you can see. The visibility check runs as you, through the
-- record's own row security, so nobody can follow - and so be told the name
-- of - a record they could not open.

create or replace function app_record_visible(p_entity_type text, p_entity_id uuid)
returns boolean
language plpgsql
stable
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
  if v_table is null then
    return false;
  end if;
  execute format('select exists (select 1 from %I where id = $1)', v_table) into v_seen using p_entity_id;
  return v_seen;
end $$;

drop policy if exists record_follow_insert on record_follow;
create policy record_follow_insert on record_follow for insert to authenticated
  with check (
    "userId" = app_current_user_id()
    and app_is_internal()
    and app_record_visible("entityType", "entityId")
  );

create or replace function follow_record(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not app_is_internal() then
    raise exception 'Only employees can follow records.' using errcode = '42501';
  end if;
  if not app_record_visible(p_entity_type, p_entity_id) then
    raise exception 'That record could not be found.' using errcode = '42501';
  end if;
  insert into record_follow ("userId", "entityType", "entityId")
  values (app_current_user_id(), p_entity_type, p_entity_id)
  on conflict do nothing;
end $$;

notify pgrst, 'reload schema';
