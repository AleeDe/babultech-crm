-- Only the Super Admin deletes, and can delete anything; a CRM Admin can do
-- everything else.
--
-- Agreed 10 October 2026:
--
--   * record:delete is the one permission that deletes (and restores and
--     erases) records of every kind. Only Super Admin holds it, through '*'.
--     The per-kind delete grants (lead:delete, account:delete ...) are gone.
--   * A delete still goes to the recycle bin, whatever the record's status or
--     stage. The only rules left are about the books: nothing dated in a
--     closed month, and nothing a payment allocation still ties together.
--     They are recycle_hard_blocker() below.
--   * role:manage is the permission to change roles and to give the Super
--     Admin or CRM Admin role. Only Super Admin holds it.
--   * CRM Admin holds 'all:except-delete': every permission except those two.
--     It is a grant of its own rather than a list, so a permission added later
--     reaches CRM Admins without anyone remembering to add it.

-- ---------------------------------------------------------------------------
-- The CRM Admin grant, understood by the database's own permission checks
-- ---------------------------------------------------------------------------

create or replace function app_grant_covers(p_permissions text[], p_permission text)
returns boolean
language sql
immutable
as $$
  select
    '*' = any(p_permissions)
    or p_permission = any(p_permissions)
    or (split_part(p_permission, ':', 1) || ':*') = any(p_permissions)
    or ('*:' || split_part(p_permission, ':', 2)) = any(p_permissions)
    or ('all:except-delete' = any(p_permissions) and p_permission not in ('record:delete', 'role:manage'));
$$;

create or replace function app_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from app_user u
    join security_role r on r.id = u."roleId"
    where u.id = app_current_user_id()
      and app_grant_covers(r.permissions, p_permission)
  );
$$;

create or replace function app_users_holding(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from app_user u
    join security_role r on r.id = u."roleId"
   where u.status = 'ACTIVE' and u."deletedAt" is null
     and coalesce(u."userType", 'INTERNAL') = 'INTERNAL' and u."partnerId" is null
     and app_grant_covers(r.permissions, p_permission);
$$;
revoke all on function app_users_holding(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What still holds a Super Admin's delete back: the books
-- ---------------------------------------------------------------------------

create or replace function recycle_hard_blocker(p_entity_type text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_entity_type = 'Invoice' then
    if exists (select 1 from invoice where id = p_id and period_is_locked("invoiceDate")) then
      return 'Its month is closed. Reopen the month under Finance › Periods first.';
    end if;
    if exists (select 1 from payment_allocation where "invoiceId" = p_id) then
      return 'Payments are allocated to it. Remove the allocations first, so no payment is left pointing at a deleted invoice.';
    end if;
  elsif p_entity_type = 'Payment' then
    if exists (select 1 from payment where id = p_id and period_is_locked("paymentDate")) then
      return 'Its month is closed. Reopen the month under Finance › Periods first.';
    end if;
    if exists (select 1 from payment_allocation where "paymentId" = p_id) then
      return 'It is allocated to invoices. Remove the allocations first.';
    end if;
  elsif p_entity_type = 'Expense' then
    if exists (select 1 from expense where id = p_id and period_is_locked("expenseDate")) then
      return 'Its month is closed. Reopen the month under Finance › Periods first.';
    end if;
  elsif recycle_table(p_entity_type) is null then
    return 'That kind of record cannot be deleted here.';
  end if;
  return null;
end $$;
revoke all on function recycle_hard_blocker(text, uuid) from public, anon, authenticated;
grant execute on function recycle_hard_blocker(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Nobody but Super Admin keeps a delete grant.
update security_role
   set permissions = array(select p from unnest(permissions) p
                            where p not in ('lead:delete', 'account:delete', 'opportunity:delete', 'case:delete',
                                            'campaign:delete', 'contract:delete', 'record:delete', 'role:manage')),
       "updatedAt" = now()
 where not ('*' = any(permissions))
   and permissions && array['lead:delete', 'account:delete', 'opportunity:delete', 'case:delete',
                            'campaign:delete', 'contract:delete', 'record:delete', 'role:manage'];

insert into security_role (id, name, description, permissions, "dataScope", "isSystem", active, "updatedAt")
select gen_random_uuid(), 'CRM Admin',
       'Runs the CRM: every screen, setting, approval and correction, users, HR and the vault. Cannot delete records, change roles, or give anyone the Super Admin or CRM Admin role.',
       array['all:except-delete'], 'ALL', true, true, now()
where not exists (select 1 from security_role where name = 'CRM Admin');

notify pgrst, 'reload schema';
