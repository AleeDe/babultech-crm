-- Atomic parent-with-children insert.
--
-- Ports the `lines: { create: [...] }` nested writes Prisma did in one
-- statement (invoices, quotations, vendor bills, opportunity products).
--
-- Through PostgREST these would be two round trips: insert the parent, then
-- insert the children. A failure between them leaves an invoice with a total
-- but no line items — it looks payable, and reconciling it against nothing is
-- how billing disputes start.
--
-- Line totals are computed by the caller (the tax/discount rules live in
-- TypeScript next to their tests); this only guarantees both writes land.

create or replace function create_with_lines(
  p_table        text,
  p_payload      jsonb,
  p_line_table   text,
  p_lines        jsonb,
  p_parent_field text,
  p_number_field text default null,
  p_sequence     text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_parent   jsonb;
  v_parent_id uuid;
  v_line     jsonb;
  v_row      jsonb;
  v_index    integer := 0;
begin
  v_parent := create_record(p_table, p_payload, p_number_field, p_sequence);
  v_parent_id := (v_parent->>'id')::uuid;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_row := v_line
      || jsonb_build_object(p_parent_field, v_parent_id)
      || jsonb_build_object('sortOrder', v_index);

    perform create_record(p_line_table, v_row);
    v_index := v_index + 1;
  end loop;

  return v_parent;
end;
$$;

/**
 * Replace a parent's line items wholesale, then update the parent totals.
 *
 * Prisma expressed this as `lines: { deleteMany: {}, create: [...] }` inside a
 * transaction. Split apart, a failure after the delete leaves the document with
 * no lines at all.
 */
create or replace function update_with_lines(
  p_table        text,
  p_id           uuid,
  p_payload      jsonb,
  p_line_table   text,
  p_lines        jsonb,
  p_parent_field text,
  p_entity_type  text,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_line   jsonb;
  v_row    jsonb;
  v_index  integer := 0;
begin
  execute format('delete from %I where %I = $1', p_line_table, p_parent_field)
    using p_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_row := v_line
      || jsonb_build_object(p_parent_field, p_id)
      || jsonb_build_object('sortOrder', v_index);

    perform create_record(p_line_table, v_row);
    v_index := v_index + 1;
  end loop;

  v_result := update_record(p_table, p_id, p_payload, p_entity_type, p_actor_id);
  return v_result;
end;
$$;
