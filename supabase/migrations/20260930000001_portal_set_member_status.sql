-- portal_set_member assigned text to app_user.status, which is the "UserStatus"
-- enum, so every change from the portal's team page failed. Cast it.

-- An Admin changes a colleague's role or switches their login off or on.
create or replace function portal_set_member(p_user uuid, p_role text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me app_user%rowtype;
  v_target app_user%rowtype;
  v_admins integer;
begin
  select * into v_me from app_user where id = app_current_user_id();
  if v_me.id is null or v_me."portalRole" <> 'ADMIN' or v_me.status <> 'ACTIVE' then
    raise exception 'Only an Admin can change your company''s logins.' using errcode = '42501';
  end if;
  if not exists (select 1 from portal_team() t where t.id = p_user) then
    raise exception 'That person is not at your company.' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'USER') then
    raise exception 'A login is an Admin or a User.' using errcode = '23514';
  end if;
  select * into v_target from app_user where id = p_user;

  -- Someone has to be left to manage the logins.
  select count(*) into v_admins from portal_team() t
   where t."portalRole" = 'ADMIN' and t.status = 'ACTIVE' and t.id <> p_user;
  if v_admins = 0 and (p_role <> 'ADMIN' or not p_active) then
    raise exception 'Keep at least one active Admin, or nobody can manage your logins.' using errcode = '23514';
  end if;

  update app_user set
    "portalRole" = p_role,
    status = (case when p_active then 'ACTIVE' else 'INACTIVE' end)::"UserStatus",
    "updatedAt" = now()
  where id = p_user;

  insert into audit_history (id, "entityType", "entityId", "fieldName", "oldValue", "newValue", "changedById", source, "changedAt")
  values (gen_random_uuid(), 'User', p_user, 'portalRole/status',
          v_target."portalRole" || '/' || v_target.status, p_role || '/' || case when p_active then 'ACTIVE' else 'INACTIVE' end,
          v_me.id, 'portal', now());
end $$;

revoke all on function portal_set_member(uuid, text, boolean) from public, anon;
grant execute on function portal_set_member(uuid, text, boolean) to authenticated;
