-- Generic atomic write helpers.
--
-- Most of the prisma.$transaction blocks in src/server/* are one of two shapes:
--
--   create: allocate a sequence number, then insert
--   update: read the row, update it, then write one audit row per changed field
--
-- Both must be atomic. A create whose number allocation succeeded but whose
-- insert failed burns a number; an update whose audit insert failed loses the
-- change history that §13 of the spec requires. supabase-js cannot express
-- either, so they live here.
--
-- These are generic rather than one pair per entity: 64 tables would otherwise
-- need 128 near-identical functions.
--
-- SECURITY INVOKER: the caller's RLS applies. Permission checks
-- (requirePermission) stay in the application.

-- Fields worth a history row. Mirrors AUDITED_FIELDS in src/lib/audit.ts —
-- keep the two in step.
create or replace function audited_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'status','stage','priority','amount','totalAmount','contractValue',
    'commissionAmount','netPayableAmount','ownerUserId','assignedUserId',
    'projectManagerId','approvalStatus','expectedCloseDate','dueDate',
    'startDate','endDate','paidAmount','outstandingAmount','accountType',
    'partnerType','tier','revenueSharePercent','commissionPercentOverride'
  ];
$$;

/**
 * Insert a row, allocating a human-readable number in the same transaction.
 *
 * p_payload is the row as JSON. p_number_field/p_sequence are optional: when
 * given, next_sequence_number() is called and the result merged into the
 * payload before insert.
 */
create or replace function create_record(
  p_table        text,
  p_payload      jsonb,
  p_number_field text default null,
  p_sequence     text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_row     jsonb := p_payload;
  v_number  text;
  v_result  jsonb;
  v_cols    text;
  v_vals    text;
begin
  if p_sequence is not null and p_number_field is not null then
    v_number := next_sequence_number(p_sequence);
    v_row := v_row || jsonb_build_object(p_number_field, v_number);
  end if;

  -- Defaults the database now supplies (see 011_db_defaults.sql) are only
  -- applied for keys the payload omits.
  if not (v_row ? 'id') then
    v_row := v_row || jsonb_build_object('id', gen_random_uuid());
  end if;
  v_row := v_row || jsonb_build_object('updatedAt', now());
  if not (v_row ? 'createdAt') then
    v_row := v_row || jsonb_build_object('createdAt', now());
  end if;

  select string_agg(format('%I', key), ', '),
         string_agg(format('$1->>%L', key), ', ')
    into v_cols, v_vals
  from jsonb_object_keys(v_row) as key;

  -- json_populate_record casts each JSON value to the column's real type, so
  -- enums, numerics and timestamps land correctly without per-column casts.
  execute format(
    'insert into %I select * from json_populate_record(null::%I, $1) returning to_jsonb(%I.*)',
    p_table, p_table, p_table
  )
  using v_row::json
  into v_result;

  return v_result;
end;
$$;

/**
 * Update a row and record the change history in one transaction.
 *
 * Returns the updated row. Writes one audit_history row per changed field that
 * appears in audited_fields().
 */
create or replace function update_record(
  p_table       text,
  p_id          uuid,
  p_payload     jsonb,
  p_entity_type text,
  p_actor_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb := p_payload || jsonb_build_object('updatedAt', now());
  v_key    text;
  v_old    text;
  v_new    text;
begin
  execute format('select to_jsonb(t.*) from %I t where t.id = $1 for update', p_table)
    using p_id into v_before;

  if v_before is null then
    raise exception '% % not found', p_table, p_id using errcode = 'no_data_found';
  end if;

  -- Merge onto the existing row so json_populate_record does not null out
  -- columns the caller did not send.
  execute format(
    'update %I set (%s) = (select %s from json_populate_record(null::%I, $1)) where id = $2 returning to_jsonb(%I.*)',
    p_table,
    (select string_agg(format('%I', key), ', ') from jsonb_object_keys(v_row) key),
    (select string_agg(format('%I', key), ', ') from jsonb_object_keys(v_row) key),
    p_table, p_table
  )
  using v_row::json, p_id
  into v_after;

  foreach v_key in array audited_fields() loop
    if v_before ? v_key then
      v_old := v_before ->> v_key;
      v_new := v_after ->> v_key;

      if v_old is distinct from v_new then
        insert into audit_history (
          id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
          "changedById", source, "changedAt"
        ) values (
          gen_random_uuid(), p_entity_type, p_id, v_key, v_old, v_new,
          p_actor_id, 'UI', now()
        );
      end if;
    end if;
  end loop;

  return v_after;
end;
$$;
