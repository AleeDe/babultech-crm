-- Move Prisma's client-side defaults into the database.
--
-- Prisma fills @default(...) and @updatedAt in the CLIENT, so the generated
-- SQL leaves those columns NOT NULL with no DEFAULT. That is fine while Prisma
-- is the only writer, but supabase-js talks to PostgREST directly: every insert
-- that omits such a column fails with
--   null value in column "..." violates not-null constraint
--
-- The schema has ~265 @default declarations, so patching call sites one by one
-- is not viable. Instead give the columns real database defaults. Prisma keeps
-- working unchanged (it still sends explicit values); supabase-js can now omit
-- them.
--
-- Generated defensively: only columns that are NOT NULL and currently have no
-- default are touched, so this is safe to re-run.

do $$
declare
  r record;
begin
  -- id: uuid primary keys
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'id'
      and c.data_type = 'uuid'
      and c.is_nullable = 'NO'
      and c.column_default is null
  loop
    execute format('alter table %I alter column %I set default gen_random_uuid()',
                   r.table_name, r.column_name);
  end loop;

  -- createdAt / updatedAt timestamps
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('createdAt', 'updatedAt')
      and c.is_nullable = 'NO'
      and c.column_default is null
  loop
    execute format('alter table %I alter column %I set default now()',
                   r.table_name, r.column_name);
  end loop;

  -- Booleans default to false unless the schema says otherwise. Matches
  -- Prisma's @default(false), which is the overwhelmingly common case.
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.data_type = 'boolean'
      and c.is_nullable = 'NO'
      and c.column_default is null
  loop
    execute format('alter table %I alter column %I set default false',
                   r.table_name, r.column_name);
  end loop;
end $$;

-- updatedAt must also advance on UPDATE, which Prisma's @updatedAt did in the
-- client. Without this a supabase-js update leaves the timestamp stale.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" := now();
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'updatedAt'
  loop
    execute format('drop trigger if exists set_updated_at on %I', r.table_name);
    execute format(
      'create trigger set_updated_at before update on %I
         for each row execute function set_updated_at()',
      r.table_name);
  end loop;
end $$;
