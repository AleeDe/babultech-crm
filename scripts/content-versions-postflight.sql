select exists(select 1 from supabase_migrations.schema_migrations where version='20260918000008') as "migrationApplied",
 has_table_privilege('authenticated','content_version','UPDATE') as "directVersionUpdateAllowed",
 has_table_privilege('authenticated','content_review','INSERT') as "directReviewInsertAllowed",
 has_table_privilege('authenticated','content_publication','INSERT') as "directPublicationInsertAllowed",
 (select count(*) from project where "projectNumber"='CONTENT-TEST') as "testProjectsRemaining";
