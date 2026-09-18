select exists(select 1 from supabase_migrations.schema_migrations where version='20260918000006') as "migrationApplied",
 exists(select 1 from pg_trigger where tgname='project_delivery_kickoff' and not tgisinternal) as "activationGuardPresent",
 has_table_privilege('authenticated','delivery_handoff','UPDATE') as "directUpdateAllowed",
 has_table_privilege('authenticated','delivery_handoff','INSERT') as "directInsertAllowed",
 (select count(*) from app_user where email like '%@example.invalid' and "fullName" like 'Delivery test %') as "testUsersRemaining",
 (select count(*) from project where "projectNumber"='DH-TEST-PROJECT') as "testProjectsRemaining";
