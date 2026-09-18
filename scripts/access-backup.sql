SELECT 'policy' AS kind, tablename AS object_name, policyname AS name,
  jsonb_build_object('roles',roles,'cmd',cmd,'permissive',permissive,'qual',qual,'with_check',with_check) AS definition
FROM pg_policies WHERE schemaname='public' AND tablename IN (
 'project','project_member','project_phase','milestone','project_task','project_risk','project_issue','change_request','time_log',
 'app_user','security_role','team','team_member','department','note','document','note_attachment','note_mention','audit_history'
)
UNION ALL
SELECT 'function', n.nspname,p.proname,to_jsonb(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('create_project','transition_time_logs','create_record','update_record');
