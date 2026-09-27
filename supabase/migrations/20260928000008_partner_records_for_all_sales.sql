-- Every salesperson sees, and works, every partner's records.
--
-- Our team's visibility follows a record's owner: a salesperson sees their own
-- records and their team's (their data scope), and a partner's records are
-- owned by that partner's manager - so only the manager's team saw them.
-- Partners are our sales channel, and their leads, customers and deals are
-- the whole sales team's to work. So now:
--
--   - anyone who may read leads reads every partner's leads, whoever owns them;
--     and the same for accounts, their contacts, and deals;
--   - anyone who may write them works on them exactly as on their own;
--   - quotes, activities and a deal's products and services follow the
--     records they belong to.
--
-- A record is a partner's when it is credited to one: a lead's
-- referredByPartnerId, an account's or a deal's sourcePartnerId, and a
-- contact's own sourcePartnerId or its account's.
--
-- Money is untouched: commission, invoices and payments keep their own
-- permissions and scopes, and nothing here widens them.

-- ---------------------------------------------------------------------------
-- 1. Who may see and work partners' records
-- ---------------------------------------------------------------------------

create or replace function app_sees_partner_records(p_permission text)
returns boolean
language sql
stable
as $$
  select app_is_internal() and app_current_scope() is not null and app_has_permission(p_permission);
$$;

revoke all on function app_sees_partner_records(text) from public, anon;
grant execute on function app_sees_partner_records(text) to authenticated;

create or replace function app_works_partner_records(p_permission text)
returns boolean
language sql
stable
as $$
  select app_can_write() and app_has_permission(p_permission);
$$;

revoke all on function app_works_partner_records(text) from public, anon;
grant execute on function app_works_partner_records(text) to authenticated;

-- Accounts credited to a partner, whose people are the partner's too.
create or replace function app_partner_sourced_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id from account a where a."sourcePartnerId" is not null and a."deletedAt" is null;
$$;

revoke all on function app_partner_sourced_account_ids() from public, anon;
grant execute on function app_partner_sourced_account_ids() to authenticated;

-- Every partner record the reader may see, by type - what an activity is
-- matched against. One set per query, rather than a look-up per activity.
create or replace function app_visible_partner_records()
returns table (entity_type text, entity_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select 'Lead'::text, l.id from lead l
  where l."referredByPartnerId" is not null and app_sees_partner_records('lead:read')
  union all
  select 'Account'::text, a.id from account a
  where a."sourcePartnerId" is not null and app_sees_partner_records('account:read')
  union all
  select 'Contact'::text, c.id from contact c left join account a on a.id = c."accountId"
  where (c."sourcePartnerId" is not null or a."sourcePartnerId" is not null)
    and app_sees_partner_records('account:read')
  union all
  select 'Opportunity'::text, o.id from opportunity o
  where o."sourcePartnerId" is not null and app_sees_partner_records('opportunity:read');
$$;

revoke all on function app_visible_partner_records() from public, anon;
grant execute on function app_visible_partner_records() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Leads, accounts, contacts, deals
-- ---------------------------------------------------------------------------

drop policy if exists lead_internal_read on lead;
create policy lead_internal_read on lead
  for select
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
      or ("referredByPartnerId" is not null and (select app_sees_partner_records('lead:read')))
    )
  );

drop policy if exists lead_internal_write on lead;
create policy lead_internal_write on lead
  for all
  using (
    app_can_write_owned("ownerUserId")
    or ("referredByPartnerId" is not null and (select app_works_partner_records('lead:write')))
  )
  with check (
    app_can_write_owned("ownerUserId")
    or ("referredByPartnerId" is not null and (select app_works_partner_records('lead:write')))
  );

drop policy if exists account_internal_read on account;
create policy account_internal_read on account
  for select
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
      or ("sourcePartnerId" is not null and (select app_sees_partner_records('account:read')))
    )
  );

drop policy if exists account_internal_write on account;
create policy account_internal_write on account
  for all
  using (
    app_can_write_owned("ownerUserId")
    or ("sourcePartnerId" is not null and (select app_works_partner_records('account:write')))
  )
  with check (
    app_can_write_owned("ownerUserId")
    or ("sourcePartnerId" is not null and (select app_works_partner_records('account:write')))
  );

-- Contacts are read under the account permission, as their screens are.
drop policy if exists contact_internal_read on contact;
create policy contact_internal_read on contact
  for select
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "accountId" is null
      or "accountId" in (select app_visible_account_ids())
      or (
        ("sourcePartnerId" is not null or "accountId" in (select app_partner_sourced_account_ids()))
        and (select app_sees_partner_records('account:read'))
      )
    )
  );

drop policy if exists opportunity_internal_read on opportunity;
create policy opportunity_internal_read on opportunity
  for select
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
      or ("sourcePartnerId" is not null and (select app_sees_partner_records('opportunity:read')))
    )
  );

drop policy if exists opportunity_internal_write on opportunity;
create policy opportunity_internal_write on opportunity
  for all
  using (
    app_can_write_owned("ownerUserId")
    or ("sourcePartnerId" is not null and (select app_works_partner_records('opportunity:write')))
  )
  with check (
    app_can_write_owned("ownerUserId")
    or ("sourcePartnerId" is not null and (select app_works_partner_records('opportunity:write')))
  );

-- ---------------------------------------------------------------------------
-- 3. What follows the deal: its quotes
-- ---------------------------------------------------------------------------
--
-- Quotes are read through the deals the reader can see (quotation_internal_read),
-- and approving one asks the same question (decide_quotation_approval), so
-- both follow from widening this one set.

create or replace function app_internal_visible_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from opportunity o
  where o."ownerUserId" in (select app_visible_owner_ids())
     or (o."sourcePartnerId" is not null and (select app_sees_partner_records('opportunity:read')));
$$;

-- ---------------------------------------------------------------------------
-- 4. Activities on partners' records
-- ---------------------------------------------------------------------------
--
-- Including the calls, meetings and emails the partner logged themselves in
-- the portal, which are owned by the partner's login and so were visible to
-- nobody on our side but an administrator.

drop policy if exists activity_internal_read on activity;
create policy activity_internal_read on activity
  for select
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
      or ("relatedEntityType", "relatedEntityId") in (
        select entity_type, entity_id from app_visible_partner_records()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Pricing a partner's deal, and accepting its quote
-- ---------------------------------------------------------------------------
--
-- Both check the deal's own write rule before writing, so both take the new
-- one: the owner's rule, or the deal is a partner's and the reader may work
-- deals.

create or replace function save_opportunity_lines(
  p_opportunity uuid,
  p_price_book  uuid,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_partner uuid;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select "ownerUserId", "sourcePartnerId" into v_owner, v_partner from opportunity
  where id = p_opportunity and "deletedAt" is null;
  if not found then
    raise exception 'That opportunity no longer exists.';
  end if;
  -- EXACTLY the rule the opportunity's own write policy applies.
  if not (app_can_write_owned(v_owner)
          or (v_partner is not null and (select app_works_partner_records('opportunity:write')))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  return write_opportunity_lines(p_opportunity, p_price_book, p_lines);
end $$;

revoke all on function save_opportunity_lines(uuid, uuid, jsonb) from public, anon;
grant execute on function save_opportunity_lines(uuid, uuid, jsonb) to authenticated;

create or replace function accept_quotation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_partner uuid;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select o."ownerUserId", o."sourcePartnerId" into v_owner, v_partner
  from quotation q join opportunity o on o.id = q."opportunityId"
  where q.id = p_id and q."deletedAt" is null;
  if not found then
    raise exception 'Quote not found.';
  end if;
  -- The deal's own write rule, as saving its lines uses.
  if not (app_can_write_owned(v_owner)
          or (v_partner is not null and (select app_works_partner_records('opportunity:write')))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  return apply_accepted_quotation(p_id);
end $$;

revoke all on function accept_quotation(uuid) from public, anon;
grant execute on function accept_quotation(uuid) to authenticated;

notify pgrst, 'reload schema';
