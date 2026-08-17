-- Realtime for the dashboard.
--
-- Supabase streams changes from the `supabase_realtime` publication only. A
-- table not in it produces no notifications, and the client's subscribe() call
-- still succeeds — the socket connects and simply stays silent, which is the
-- failure mode this migration exists to prevent.
--
-- Row security still applies on top: a subscriber is only told about rows they
-- could have selected, so an OWN-scope rep sees their own deals change and not
-- the company's. Adding a table here does NOT widen what anyone can read.
--
-- Only tables the dashboard actually reacts to are published. Every extra one
-- costs a WAL decode and a broadcast for writes nobody is watching.

do $$
declare
  t text;
  watched text[] := array[
    'opportunity',
    'invoice',
    'payment',
    'support_case',
    'lead',
    'quotation',
    'project',
    'commission_record',
    'audit_history'
  ];
begin
  -- The publication exists on every Supabase project, but a local stack that
  -- has never had realtime enabled will not have it.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array watched loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      raise notice 'skipping %: table does not exist', t;
      continue;
    end if;

    -- add table is not idempotent; it errors if the table is already a member.
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'published %', t;
    end if;
  end loop;
end $$;

-- UPDATE and DELETE payloads carry only the primary key unless the table has a
-- replica identity that says otherwise. The dashboard only needs to know THAT
-- something changed, so the default is sufficient and FULL would double the
-- WAL volume for no gain.
--
-- audit_history is the exception: the stream renders the row itself, and an
-- INSERT payload is complete regardless of replica identity, so it needs
-- nothing extra either.
