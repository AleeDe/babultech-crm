-- Let numbering run for every user, not just administrators.
--
-- next_sequence_number() increments number_sequence, and number_sequence is
-- reference data whose write policy requires ALL scope. For anyone else the
-- UPDATE matched no visible row, NOT FOUND was set, and the function raised
-- "No number sequence configured" — pointing at missing seed data when the
-- sequence was there all along and RLS had simply hidden it.
--
-- SECURITY DEFINER is the right tool here rather than a broader write policy:
-- allocating the next number is exactly what this function is for, and the
-- only column it touches is the counter. Widening the table's own policy would
-- let any user rewrite prefixes and padding.
--
-- search_path is pinned so the definer rights cannot be redirected at a
-- attacker-supplied schema.

create or replace function next_sequence_number(p_entity_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix   text;
  v_padding  integer;
  v_year     boolean;
  v_value    integer;
begin
  -- UPDATE ... RETURNING takes the row lock and increments in one statement,
  -- so concurrent callers cannot collide on a number.
  update number_sequence
  set "nextValue" = "nextValue" + 1
  where "entityType" = p_entity_type
  returning "nextValue" - 1, prefix, "paddingLength", "includeYear"
  into v_value, v_prefix, v_padding, v_year;

  if not found then
    -- Prisma is gone; the sequences are seeded by scripts/seed-cloud.mjs.
    raise exception
      'No number sequence configured for "%". Add a number_sequence row for it (see scripts/seed-cloud.mjs).',
      p_entity_type using errcode = 'no_data_found';
  end if;

  if v_year then
    return format('%s-%s-%s', v_prefix, extract(year from current_date)::int,
                  lpad(v_value::text, v_padding, '0'));
  end if;

  return format('%s-%s', v_prefix, lpad(v_value::text, v_padding, '0'));
end;
$$;
