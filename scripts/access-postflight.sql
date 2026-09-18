SELECT jsonb_build_object(
  'appliedMigrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version in ('20260918000002','20260918000003')),
  'activeUsers',(select count(*) from app_user where status='ACTIVE' and "deletedAt" is null),
  'testProjectsRemaining',(select count(*) from project where name='Access verification' and "projectNumber" like 'ACL-%'),
  'authenticatedCanReadMemberCost',has_column_privilege('authenticated','public.project_member','costRate','SELECT'),
  'authenticatedCanReadTimeRate',has_column_privilege('authenticated','public.time_log','billingRate','SELECT'),
  'authenticatedCanReadHours',has_column_privilege('authenticated','public.time_log','hours','SELECT'),
  'storageReadPolicies',(select coalesce(jsonb_agg(jsonb_build_object('name',policyname,'using',qual)), '[]'::jsonb) from pg_policies where schemaname='storage' and cmd in ('SELECT','ALL'))
) as verification;
