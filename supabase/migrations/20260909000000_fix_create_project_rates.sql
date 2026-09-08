-- Creating a project failed with "permission denied for table app_user".
--
-- 20260902000000_hide_rate_columns.sql revoked table-wide SELECT on app_user
-- and re-granted an explicit column list that deliberately excludes costRate
-- and defaultBillingRate — those are readable only through the service role,
-- behind an application permission check.
--
-- create_project reads exactly those two columns, to snapshot the manager's
-- rates onto their project_member row. It is plain `language plpgsql` with no
-- security clause, so it runs as the signed-in user, who no longer holds that
-- privilege. Every project create has failed since that migration.
--
-- The snapshot itself is not optional and cannot simply be dropped: without it
-- the manager's time books at zero cost, which quietly overstates the margin on
-- every project they touch. That is the reason the read is there.
--
-- SECURITY DEFINER is the fix, scoped as tightly as it can be:
--
--   * The function reads two columns for ONE user id, already supplied as the
--     project manager, and writes them to a row it is creating in the same
--     call. It cannot be used to enumerate anyone's rates — the values are
--     never returned to the caller, they go straight into project_member.
--
--   * `set search_path = public` pins name resolution, so the definer's rights
--     cannot be turned against it by a caller-controlled search_path. This is
--     the standard precaution for a definer function and the reason the other
--     definer functions in this schema carry it too.
--
--   * Authorisation is unchanged and still enforced above: createProject() in
--     src/server/projects.ts requires PERMISSIONS.PROJECT_WRITE before this is
--     ever called, and the RLS policy on project still governs the insert.
--
-- The body is otherwise identical to 20260815000019.

create or replace function create_project(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project    jsonb;
  v_project_id uuid;
  v_manager    uuid := (p_payload->>'projectManagerId')::uuid;
  v_cost       numeric;
  v_billing    numeric;
begin
  v_project := create_record('project', p_payload, 'projectNumber', 'Project');
  v_project_id := (v_project->>'id')::uuid;

  select "costRate", "defaultBillingRate" into v_cost, v_billing
  from app_user where id = v_manager;

  if not found then
    raise exception 'That project manager no longer exists.'
      using errcode = 'no_data_found';
  end if;

  insert into project_member (
    id, "projectId", "userId", "projectRole", "allocationPercent",
    "startDate", "endDate", "billingRate", "costRate", active,
    "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), v_project_id, v_manager, 'Project Manager', 50,
    nullif(p_payload->>'startDate', '')::date,
    nullif(p_payload->>'plannedEndDate', '')::date,
    v_billing, v_cost, true, now(), now()
  );

  return v_project;
end;
$$;
