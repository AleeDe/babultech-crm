-- Read-only confirmation that the client review link landed and no fixtures remain.
select
  (select count(*) from pg_tables where schemaname='public' and tablename='client_review_link') as link_table,
  (select count(*) from pg_proc where proname in
     ('issue_client_review_link','revoke_client_review_link','client_review_context','submit_client_review')) as functions,
  (select count(*) from information_schema.columns where table_name='content_review' and column_name='viaLinkId') as via_link_column,
  -- anon may call only the two functions a client needs, and nothing else here.
  (select count(*) from information_schema.role_routine_grants
     where grantee='anon' and routine_name in ('client_review_context','submit_client_review')) as anon_grants,
  (select count(*) from information_schema.role_routine_grants
     where grantee='anon' and routine_name in ('issue_client_review_link','revoke_client_review_link')) as anon_must_be_zero,
  -- anon must hold no table privilege on the link table at all.
  (select count(*) from information_schema.role_table_grants
     where grantee='anon' and table_name='client_review_link') as anon_table_grants,
  (select count(*) from pg_policies where schemaname='public' and tablename='client_review_link') as link_policies,
  (select count(*) from client_review_link) as links_total,
  (select count(*) from app_user where email like '%@example.invalid') as leftover_test_users,
  (select count(*) from security_role where name like 'CRL test%' or name like 'QA cr %') as leftover_test_roles,
  (select count(*) from project where "projectNumber" like 'QACR-%' or "projectNumber" like 'CRL-%') as leftover_test_projects;
