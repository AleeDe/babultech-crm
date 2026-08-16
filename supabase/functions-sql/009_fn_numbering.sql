-- Human-readable record numbers, ported from src/lib/numbering.ts.
--
-- Must live in the database once writes move to supabase-js: the TypeScript
-- version relies on running inside a Prisma transaction with the surrounding
-- insert, and supabase-js cannot provide that.
--
-- SECURITY DEFINER: number_sequence is reference data whose write policy
-- requires ALL scope, but every user needs to allocate a number. See
-- migrations/20260816000001_numbering_definer.sql.
--
-- entity_type matches NumberSequence.entityType exactly — the values in
-- SEQUENCES in src/lib/numbering.ts, e.g. 'CommissionRecord', not 'COMMISSION'.

-- SECURITY DEFINER: number_sequence is reference data whose write policy
-- requires ALL scope, but every user needs to allocate a number. See
-- migrations/20260816000001_numbering_definer.sql.
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
  -- so concurrent callers cannot collide on a number. Mirrors the atomic
  -- increment in the Prisma version.
  update number_sequence
  set "nextValue" = "nextValue" + 1
  where "entityType" = p_entity_type
  returning "nextValue" - 1, prefix, "paddingLength", "includeYear"
  into v_value, v_prefix, v_padding, v_year;

  if not found then
    raise exception 'No number sequence configured for "%". Add a number_sequence row for it (see scripts/seed-cloud.mjs).',
      p_entity_type using errcode = 'no_data_found';
  end if;

  if v_year then
    return format('%s-%s-%s', v_prefix, extract(year from current_date)::int,
                  lpad(v_value::text, v_padding, '0'));
  end if;

  return format('%s-%s', v_prefix, lpad(v_value::text, v_padding, '0'));
end;
$$;
