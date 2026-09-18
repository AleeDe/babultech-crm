select exists(select 1 from supabase_migrations.schema_migrations where version='20260918000007') as "migrationApplied",
 has_table_privilege('authenticated','project_content_plan','UPDATE') as "directUpdateAllowed",
 has_table_privilege('authenticated','project_content_plan','INSERT') as "directInsertAllowed",
 (select count(*) from project where "projectNumber"='CONTENT-TEST') as "testProjectsRemaining";
