-- create_record, corrected.
--
-- The first version built the row with
--   insert into <t> select * from json_populate_record(null::<t>, $1)
-- which expands to EVERY column: keys absent from the payload become NULL, and
-- an explicit NULL overrides a column DEFAULT. So the defaults added in
-- 011/019 never took effect, and any insert omitting a NOT NULL column with a
-- default failed — first seen on invoice."discountAmount".
--
-- This version names only the columns actually present in the payload, so
-- omitted columns fall through to their defaults, which is what Prisma's
-- client-side defaults did.

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
  v_row    jsonb := p_payload;
  v_number text;
  v_result jsonb;
  v_cols   text;
begin
  if p_sequence is not null and p_number_field is not null then
    v_number := next_sequence_number(p_sequence);
    v_row := v_row || jsonb_build_object(p_number_field, v_number);
  end if;

  if not (v_row ? 'id') then
    v_row := v_row || jsonb_build_object('id', gen_random_uuid());
  end if;

  -- Only columns that exist on the table AND are present in the payload.
  -- Unknown keys are dropped rather than erroring, so a caller passing an
  -- embedded relation by accident does not break the insert.
  select string_agg(format('%I', c.column_name), ', ')
    into v_cols
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and v_row ? c.column_name;

  if v_cols is null then
    raise exception 'No matching columns for table % in payload', p_table;
  end if;

  execute format(
    'insert into %I (%s) select %s from json_populate_record(null::%I, $1) returning to_jsonb(%I.*)',
    p_table, v_cols, v_cols, p_table, p_table
  )
  using v_row::json
  into v_result;

  return v_result;
end;
$$;
