SELECT tablename, policyname, cmd, permissive, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
AND tablename IN ('project','project_member','project_task','project_phase','milestone','time_log','note','document','app_user','team_member')
ORDER BY tablename, policyname;
