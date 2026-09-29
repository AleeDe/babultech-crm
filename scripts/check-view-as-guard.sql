-- Tables that lack the View as read-only trigger (20260929000002).
-- Run: node scripts/access-sql.mjs read scripts/check-view-as-guard.sql
-- Anything listed can be written to during a View as session through row
-- security alone; add the trigger in the migration that created the table.
select coalesce(json_agg(t.table_name order by t.table_name), '[]'::json) as tables_without_guard
  from information_schema.tables t
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
   and not exists (
     select 1 from information_schema.triggers g
      where g.event_object_schema = 'public' and g.event_object_table = t.table_name
        and g.trigger_name = 'view_as_read_only'
   );
