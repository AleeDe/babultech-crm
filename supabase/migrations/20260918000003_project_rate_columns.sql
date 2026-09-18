-- Rate confidentiality requires column privileges, not hidden UI controls.
-- Values stay in place; qualified server readers recheck RLS-visible IDs before
-- using the service client. Normal authenticated clients cannot SELECT rates.
do $$ declare t text; cols text; begin
  foreach t in array array['project_member','time_log'] loop
    execute format('revoke select on public.%I from anon, authenticated',t);
    execute format('revoke select ("costRate","billingRate") on public.%I from anon, authenticated',t);
    select string_agg(format('%I',column_name),',' order by ordinal_position) into cols
      from information_schema.columns where table_schema='public' and table_name=t
      and column_name not in ('costRate','billingRate');
    execute format('grant select (%s) on public.%I to authenticated',cols,t);
  end loop;
end $$;

-- Generic writes must not RETURNING * (which either leaks rates or fails the
-- new column privileges). Preserve existing behavior for all other tables.
do $$ declare body text; begin
  select pg_get_functiondef('public.create_record(text,jsonb,text,text)'::regprocedure) into body;
  if position('returning to_jsonb(%I.*)' in body)=0 then raise exception 'Unexpected create_record definition; review required'; end if;
  body:=replace(body, 'returning to_jsonb(%I.*)', 'returning %s');
  body:=replace(body, 'p_table, v_cols, v_cols, p_table, p_table',
    'p_table, v_cols, v_cols, p_table, case when p_table in (''project_member'',''time_log'') then ''jsonb_build_object(''''id'''',id,''''projectId'''',"projectId")'' else format(''to_jsonb(%I.*)'',p_table) end');
  execute body;
  select pg_get_functiondef('public.update_record(text,uuid,jsonb,text,uuid)'::regprocedure) into body;
  body:=replace(body, E'begin\n', E'begin\n  if p_table in (''project_member'',''time_log'') then raise exception ''Use the scoped member/time update endpoint.'' using errcode=''42501''; end if;\n');
  execute body;
end $$;

create or replace function guard_project_member_rates() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('postgres','service_role') then return new; end if;
  if (new."costRate" is distinct from old."costRate" or new."billingRate" is distinct from old."billingRate")
    and not app_has_permission('project:rates') then
    raise exception 'Rate changes require project:rates.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger project_member_rate_guard before update on project_member for each row execute function guard_project_member_rates();

create or replace function snapshot_project_member_rates() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_cost numeric; v_billing numeric;
begin
  select "costRate","defaultBillingRate" into v_cost,v_billing from app_user
    where id=new."userId" and status='ACTIVE' and "deletedAt" is null and "partnerId" is null;
  if not found then raise exception 'An active internal resource is required.' using errcode='23514'; end if;
  if not app_has_permission('project:rates') then
    new."costRate":=v_cost; new."billingRate":=v_billing;
  else
    new."costRate":=coalesce(new."costRate",v_cost);
    new."billingRate":=coalesce(new."billingRate",v_billing);
  end if;
  return new;
end $$;
create trigger project_member_rate_snapshot before insert on project_member for each row execute function snapshot_project_member_rates();
