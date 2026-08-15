-- Row-level security: scope helper functions.
--
-- These reproduce src/lib/authz.ts scopeFilter() inside the database, so the
-- same rules hold no matter which client issues the query.
--
-- Design note (see docs/SUPABASE-MIGRATION.md): membership is read from the
-- tables on every check rather than from JWT claims. Claims are faster but go
-- stale for the life of a session, so a user moved between teams would keep
-- their old visibility for up to 8 hours. Today's behaviour is immediate, and
-- silently regressing that in an access-control path is not worth the lookup.
--
-- All functions are STABLE (not IMMUTABLE): results depend on table contents
-- within a statement, which lets Postgres cache them per-statement.

-- The current app user's id. Set per request by the application via
--   SELECT set_config('app.user_id', $1, true)
-- inside the same transaction as the query. Returns NULL when unset, and every
-- policy below denies on NULL, so an unconfigured connection sees nothing.
create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- The signed-in user's data scope: OWN | TEAM | DEPARTMENT | ALL.
-- Mirrors SecurityRole.dataScope. Inactive or soft-deleted users resolve to
-- NULL, which denies everywhere -- matching requireUser()'s "Account is not
-- active." refusal.
create or replace function app_current_scope()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r."dataScope"
  from app_user u
  join security_role r on r.id = u."roleId"
  where u.id = app_current_user_id()
    and u.status = 'ACTIVE'
    and u."deletedAt" is null;
$$;

-- The partner this user acts for, or NULL for internal staff.
-- Per the schema comment on User.partnerId, a non-null value is what makes a
-- user external. This is the discriminator between the two policy families.
create or replace function app_current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u."partnerId"
  from app_user u
  where u.id = app_current_user_id()
    and u.status = 'ACTIVE'
    and u."deletedAt" is null;
$$;

-- The set of owner-user-ids the current user may see, for internal staff.
--
-- Deliberately mirrors scopeFilter()'s fallbacks: a TEAM user on no team, and a
-- DEPARTMENT user with no department, both collapse to OWN rather than opening
-- up. Those two fallbacks are asserted by test/authz-scope.test.ts.
create or replace function app_visible_owner_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := app_current_user_id();
  v_scope   text := app_current_scope();
  v_dept    uuid;
begin
  if v_user_id is null or v_scope is null then
    return;  -- no rows: unknown or inactive user sees nothing
  end if;

  if v_scope = 'OWN' then
    return query select v_user_id;
    return;
  end if;

  if v_scope = 'TEAM' then
    -- Self, plus everyone sharing any team with us. If we are on no team this
    -- yields just self, matching the application fallback.
    return query
      select distinct m2."userId"
      from team_member m1
      join team_member m2 on m2."teamId" = m1."teamId"
      where m1."userId" = v_user_id
      union
      select v_user_id;
    return;
  end if;

  if v_scope = 'DEPARTMENT' then
    select u."departmentId" into v_dept from app_user u where u.id = v_user_id;

    if v_dept is null then
      return query select v_user_id;  -- fallback to OWN
    else
      return query
        select u.id from app_user u where u."departmentId" = v_dept;
    end if;
    return;
  end if;

  -- 'ALL' is not handled here. Callers must check app_current_scope() = 'ALL'
  -- separately, because "unrestricted" cannot be expressed as a finite id set.
  return;
end;
$$;

-- The opportunity ids the current partner is linked to.
--
-- MUST be SECURITY DEFINER. The external policy on `opportunity` needs to look
-- at `opportunity_partner`, and that table's own policies look back at
-- `opportunity` -- a cycle Postgres reports as "infinite recursion detected in
-- policy for relation". Resolving the link set inside a definer function
-- bypasses RLS for this lookup and breaks the loop.
--
-- Caught by the probe in docs/SUPABASE-MIGRATION.md: the pilot passed only
-- because opportunity_partner had no RLS yet.
create or replace function app_partner_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select op."opportunityId"
  from opportunity_partner op
  where app_current_partner_id() is not null
    and op."partnerId" = app_current_partner_id();
$$;

-- The commission-visible opportunity ids for internal staff, resolved without
-- re-entering the `opportunity` policies. Same recursion reason as above.
create or replace function app_internal_visible_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from opportunity o
  where o."ownerUserId" in (select app_visible_owner_ids());
$$;

-- True when the current user is internal staff (not a partner portal login).
create or replace function app_is_internal()
returns boolean
language sql
stable
as $$
  select app_current_user_id() is not null
     and app_current_partner_id() is null
     and app_current_scope() is not null;
$$;

-- Indexes supporting the per-check lookups above.
create index if not exists team_member_user_idx on team_member ("userId");
create index if not exists team_member_team_idx on team_member ("teamId");
create index if not exists app_user_department_idx on app_user ("departmentId");
