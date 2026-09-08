-- Project creation and ordered-child inserts.
--
-- Ports the transactions in src/server/projects.ts.

/**
 * Create a project and enrol its manager as a member.
 *
 * Both writes together: a project whose manager is not a member cannot have
 * time logged against it by the person running it, and the rate snapshot on
 * that membership is what stops their time booking at zero cost and quietly
 * overstating the margin.
 */
create or replace function create_project(
  p_payload jsonb
)
returns jsonb
language plpgsql
-- Definer because it reads app_user."costRate"/"defaultBillingRate", which
-- 20260902000000_hide_rate_columns.sql revoked from authenticated. It reads two
-- columns for one already-named user and writes them straight into the
-- project_member row it is creating; the values never reach the caller.
-- See 20260909000000_fix_create_project_rates.sql.
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

/**
 * Insert a child row with the next sequence number for its parent.
 *
 * Reading "the current maximum" and inserting as two requests is a race: two
 * concurrent phase or task creates both read the same maximum and collide on
 * the number. Locking the parent project serialises them.
 *
 * p_seq_field is the ordering column ("sequenceNumber" for phases,
 * "sortOrder" for tasks).
 */
create or replace function create_ordered_child(
  p_table       text,
  p_payload     jsonb,
  p_parent_field text,
  p_parent_id   uuid,
  p_seq_field   text
)
returns jsonb
language plpgsql
as $$
declare
  v_next integer;
  v_row  jsonb;
begin
  -- Serialise on the project so two concurrent inserts cannot pick the same
  -- number. The lock is on `project` even for tasks, which may hang off a
  -- phase or milestone — the project is the common ancestor.
  perform 1 from project where id = p_parent_id for update;

  execute format(
    'select coalesce(max(%I), 0) + 1 from %I where %I = $1',
    p_seq_field, p_table, p_parent_field
  )
  using p_parent_id
  into v_next;

  v_row := p_payload || jsonb_build_object(p_seq_field, v_next);

  return create_record(p_table, v_row);
end;
$$;
