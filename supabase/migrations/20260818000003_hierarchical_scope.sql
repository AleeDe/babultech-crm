-- Make DEPARTMENT scope follow the reporting line instead of being flat.
--
-- The old rule was "same departmentId", which is peer-visible: every member of
-- a department could read every other member's records, in both directions. In
-- a department of one that is invisible; in a real one it means a junior sees
-- the head of department's pipeline, which is exactly backwards.
--
-- The rule this replaces it with is hierarchical, and it is the one people
-- expect from an org chart:
--
--   a manager sees themselves, their direct reports, and everyone beneath them
--   a person with no reports sees only themselves
--
-- Authority flows down the tree, never up and never sideways. Two people
-- reporting to the same manager cannot see each other; the manager sees both.
--
-- app_user.managerUserId already exists and is editable on the user form — it
-- was simply never consulted for access. This is what starts consulting it.
--
--
-- Why recursive rather than one level
--
-- A head of department must see the whole department, not just the people who
-- happen to report to them directly. Walking the tree means an org three levels
-- deep works without anyone maintaining a second structure alongside it.
--
-- The CTE is cycle-safe. `managerUserId` is only guarded in the application
-- (server/users.ts refuses to set a user as their own manager), so a cycle
-- introduced by a direct database edit would otherwise loop forever. Tracking
-- the visited path and stopping when an id repeats makes that terminate.
--
--
-- Departments still matter
--
-- departmentId is not dropped. It stays as the grouping the department head is
-- attached to, and `department.managerUserId` names that head. The hierarchy is
-- what grants visibility; the department is what the hierarchy is drawn inside.
-- Anyone whose managerUserId is unset falls back to seeing only themselves,
-- which is the safe direction to fail.

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
    -- Self plus the whole sub-tree beneath us, following managerUserId down.
    --
    -- `path` carries the ids already walked so a manager loop (a -> b -> a)
    -- terminates instead of recursing forever.
    return query
      with recursive reports as (
        select
          u.id,
          array[u.id] as path
        from app_user u
        where u.id = v_user_id

        union all

        select
          child.id,
          parent.path || child.id
        from app_user child
        join reports parent on child."managerUserId" = parent.id
        where child."deletedAt" is null
          and not child.id = any(parent.path)
      )
      select distinct reports.id from reports;
    return;
  end if;

  -- 'ALL' is not handled here. Callers must check app_current_scope() = 'ALL'
  -- separately, because "unrestricted" cannot be expressed as a finite id set.
  return;
end;
$$;
