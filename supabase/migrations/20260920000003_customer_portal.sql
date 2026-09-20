-- Customers get logins of their own, alongside employees and partners.
--
-- One identity table, three kinds of login. Partners already worked this way -
-- a partner user is an app_user row with partnerId set - and customers follow
-- the same shape rather than bringing a second authentication system with
-- their own sessions, their own policies and their own ways to get a boundary
-- wrong.
--
--   INTERNAL  an employee. No partner, no contact.
--   PARTNER   acts for a partner company, through partnerId.
--   CUSTOMER  a contact who may sign in, through contactId. The contact's
--             account is what their access is scoped to.
--
-- userType is explicit rather than inferred from which link is null, so a
-- policy reads one column and a wrong row is visibly wrong. The CHECK keeps
-- the column and the links from disagreeing.

alter table app_user
  add column if not exists "userType" text not null default 'INTERNAL',
  add column if not exists "contactId" uuid references contact(id) on delete restrict,
  -- Whether a customer login sees their own tickets or their company's. Most
  -- companies want colleagues to see each other's; a few do not.
  add column if not exists "portalScope" text not null default 'ACCOUNT';

update app_user set "userType" = 'PARTNER' where "partnerId" is not null and "userType" <> 'PARTNER';

alter table app_user drop constraint if exists app_user_type_links_check;
alter table app_user add constraint app_user_type_links_check check (
  ("userType" = 'INTERNAL' and "partnerId" is null and "contactId" is null)
  or ("userType" = 'PARTNER' and "partnerId" is not null and "contactId" is null)
  or ("userType" = 'CUSTOMER' and "contactId" is not null and "partnerId" is null)
);
alter table app_user drop constraint if exists app_user_portal_scope_check;
alter table app_user add constraint app_user_portal_scope_check check ("portalScope" in ('OWN', 'ACCOUNT'));

-- One login per contact: two rows pointing at the same person is how "who is
-- this?" becomes unanswerable.
create unique index if not exists app_user_contact_key on app_user("contactId") where "contactId" is not null;

-- ---------------------------------------------------------------------------
-- Who the caller is
-- ---------------------------------------------------------------------------

create or replace function app_current_user_type()
returns text language sql stable security definer set search_path = public as $$
  select u."userType" from app_user u
  where u.id = app_current_user_id() and u."deletedAt" is null and u.status = 'ACTIVE';
$$;

create or replace function app_current_contact_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u."contactId" from app_user u
  where u.id = app_current_user_id() and u."deletedAt" is null and u.status = 'ACTIVE';
$$;

/** The account a customer login belongs to, through their contact. */
create or replace function app_current_customer_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c."accountId"
  from app_user u
  join contact c on c.id = u."contactId"
  where u.id = app_current_user_id()
    and u."userType" = 'CUSTOMER'
    and u."deletedAt" is null and u.status = 'ACTIVE'
    and c."deletedAt" is null;
$$;

/** True when the caller's own tickets only, rather than their company's. */
create or replace function app_customer_sees_own_only()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u."portalScope" = 'OWN' from app_user u
                   where u.id = app_current_user_id()), false);
$$;

-- THE boundary. Every internal policy in this database is built on it, and a
-- customer login has a null partnerId, so without the userType test they would
-- have read the whole CRM.
create or replace function app_is_internal()
returns boolean language sql stable as $$
  select app_current_user_id() is not null
     and app_current_partner_id() is null
     and app_current_scope() is not null
     and app_current_user_type() = 'INTERNAL';
$$;

-- ---------------------------------------------------------------------------
-- What a customer may read
-- ---------------------------------------------------------------------------

/** The cases a customer login may see: their company's, or only their own. */
create or replace function app_customer_can_see_case(p_account uuid, p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_current_user_type() = 'CUSTOMER'
     and p_account is not null
     and p_account = app_current_customer_account_id()
     and (not app_customer_sees_own_only() or p_contact = app_current_contact_id());
$$;

drop policy if exists support_case_customer_read on support_case;
create policy support_case_customer_read on support_case for select to authenticated
  using ("deletedAt" is null and app_customer_can_see_case("accountId", "contactId"));

-- Only what was written for the customer to read. Internal notes on a case are
-- the whole reason isPublic exists.
drop policy if exists case_comment_customer_read on case_comment;
create policy case_comment_customer_read on case_comment for select to authenticated
  using (
    "isPublic"
    and "commentType" <> 'INTERNAL_NOTE'
    and exists (
      select 1 from support_case c
      where c.id = case_comment."caseId"
        and c."deletedAt" is null
        and app_customer_can_see_case(c."accountId", c."contactId")
    )
  );

-- Published articles marked for the customer portal, and nothing else.
drop policy if exists knowledge_article_customer_read on knowledge_article;
create policy knowledge_article_customer_read on knowledge_article for select to authenticated
  using (
    app_current_user_type() = 'CUSTOMER'
    and status = 'PUBLISHED'
    and visibility = 'CUSTOMER_PORTAL'
    and "deletedAt" is null
  );

-- Their own company, and their own contact record: the portal names them.
drop policy if exists account_customer_read on account;
create policy account_customer_read on account for select to authenticated
  using (id = app_current_customer_account_id() and "deletedAt" is null);

drop policy if exists contact_customer_read on contact;
create policy contact_customer_read on contact for select to authenticated
  using (id = app_current_contact_id() and "deletedAt" is null);

-- ---------------------------------------------------------------------------
-- The role a customer login holds
-- ---------------------------------------------------------------------------
--
-- Deliberately no permissions: the internal app's permission checks are not
-- what keeps customers out - userType is - and an empty list means a customer
-- role can never be edited into an internal one by accident.
insert into security_role (id, name, description, permissions, "dataScope", "isSystem", active, "updatedAt")
select gen_random_uuid(), 'Customer',
       'A customer contact signing in to raise and follow their own support tickets.',
       array[]::text[], 'OWN', true, true, now()
where not exists (select 1 from security_role where name = 'Customer');

-- ---------------------------------------------------------------------------
-- Round-robin assignment
-- ---------------------------------------------------------------------------

/**
 * The support person who should take the next case.
 *
 * Least-loaded rather than strict rotation: a strict rotation keeps handing
 * work to whoever is on leave or already buried, and self-corrects only when
 * someone notices. Ties break on who was assigned least recently, so a quiet
 * queue still shares out evenly.
 *
 * Returns null when nobody is in the Support department, which leaves the case
 * unassigned in the queue rather than inventing an owner.
 */
create or replace function next_support_assignee()
returns uuid language sql stable security definer set search_path = public as $$
  select u.id
  from app_user u
  join department d on d.id = u."departmentId"
  left join support_case c
    on c."ownerUserId" = u.id
   and c."deletedAt" is null
   and c.status not in ('RESOLVED', 'CLOSED', 'CANCELLED')
  where u."userType" = 'INTERNAL'
    and u.status = 'ACTIVE'
    and u."deletedAt" is null
    and lower(d.name) = 'support'
  group by u.id
  order by count(c.id), max(c."createdAt") nulls first, u.id
  limit 1;
$$;

revoke all on function next_support_assignee() from public, anon;
grant execute on function next_support_assignee() to authenticated;
grant execute on function app_current_user_type(), app_current_contact_id(),
  app_current_customer_account_id(), app_customer_sees_own_only(),
  app_customer_can_see_case(uuid, uuid) to authenticated;
