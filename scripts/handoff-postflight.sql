select exists(select 1 from supabase_migrations.schema_migrations where version='20260918000005') as "migrationApplied",
 exists(select 1 from pg_trigger where tgname='lead_pending_handoff' and not tgisinternal) as "pendingGuardPresent",
 has_table_privilege('authenticated','lead_handoff','UPDATE') as "directUpdateAllowed",
 has_table_privilege('authenticated','lead_handoff','INSERT') as "directInsertAllowed",
 (select count(*) from app_user where email like '%@example.invalid' and "fullName" like 'Handoff test %') as "testUsersRemaining",
 (select count(*) from lead where "leadNumber" like 'HFTEST-%') as "testLeadsRemaining";
