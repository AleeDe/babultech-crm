-- Make write policies respect data scope, not just "is internal".
--
-- app_can_write() asks only whether the caller is an internal user with a
-- scope at all. That let an OWN-scope sales executive update a record owned by
-- someone else: the SELECT policy hid it from their lists, but an UPDATE
-- naming its id went straight through.
--
-- It mattered less when every edit came from a detail page the reader had to
-- reach first. Bulk actions changed that — a single request now carries up to
-- 200 ids straight from the browser, so the ids cannot be trusted and the
-- database has to be the thing that says no.
--
-- The rule mirrors the SELECT policies already in place: ALL scope writes
-- anything, everyone else writes what they can see.

-- Whether the caller may write a row owned by this user.
create or replace function app_can_write_owned("ownerUserId" uuid)
returns boolean
language sql
stable
as $$
  select app_is_internal()
     and app_current_scope() is not null
     and (
       app_current_scope() = 'ALL'
       -- A row with no owner is shared reference data rather than anyone's.
       or "ownerUserId" is null
       or "ownerUserId" in (select app_visible_owner_ids())
     );
$$;

-- Records that carry an owner directly.
drop policy if exists lead_internal_write on lead;
create policy lead_internal_write on lead
  for all
  using (app_can_write_owned("ownerUserId"))
  with check (app_can_write_owned("ownerUserId"));

drop policy if exists opportunity_internal_write on opportunity;
create policy opportunity_internal_write on opportunity
  for all
  using (app_can_write_owned("ownerUserId"))
  with check (app_can_write_owned("ownerUserId"));

drop policy if exists account_internal_write on account;
create policy account_internal_write on account
  for all
  using (app_can_write_owned("ownerUserId"))
  with check (app_can_write_owned("ownerUserId"));

-- support_case owns rows through ownerUserId too, but a case may be assigned
-- to a team rather than a person, and an unassigned case has to stay editable
-- or nobody can pick it up.
drop policy if exists support_case_internal_write on support_case;
create policy support_case_internal_write on support_case
  for all
  using (app_can_write_owned("ownerUserId"))
  with check (app_can_write_owned("ownerUserId"));

-- contract and project follow their owner and manager respectively.
drop policy if exists contract_internal_write on contract;
create policy contract_internal_write on contract
  for all
  using (app_can_write_owned("ownerUserId"))
  with check (app_can_write_owned("ownerUserId"));

drop policy if exists project_internal_write on project;
create policy project_internal_write on project
  for all
  using (app_can_write_owned("projectManagerId"))
  with check (app_can_write_owned("projectManagerId"));
