-- Runs after check-project-access.sql in the SAME rollback/savepoint scope.
update app_user set status='ACTIVE' where id=(select id from access_fixture where k='contributor');
update project_member set active=true where "projectId"=(select id from access_fixture where k='project') and "userId"=(select id from access_fixture where k='contributor');
select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='contributor'),true);
set local role authenticated;
do $$ declare denied boolean; result jsonb; n integer; begin
  denied:=false;
  begin perform "costRate" from project_member where "projectId"=(select id from access_fixture where k='project');
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Member cost readable'; end if;
  denied:=false;
  begin perform "billingRate" from time_log where "userId"=app_current_user_id();
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Time billing rate readable'; end if;
  denied:=false;
  begin perform t.* from time_log t where "userId"=app_current_user_id();
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Wildcard leaks snapshots'; end if;
  result:=create_record('time_log',jsonb_build_object(
    'userId',app_current_user_id(),'projectId',(select id from access_fixture where k='project'),
    'projectTaskId',(select id from access_fixture where k='task'),'workDate',current_date,
    'hours',1,'description','Rate check','approvalStatus','DRAFT','costRate',999999,'billingRate',999999
  ));
  if result->>'id' is null or result ? 'costRate' or result ? 'billingRate' then raise exception 'Generic create leaks rate data'; end if;
  select count(*) into n from time_log where id=(result->>'id')::uuid and hours=1;
  if n<>1 then raise exception 'Time logging broken by column grants'; end if;
  update time_log set description='Own edit' where id=(result->>'id')::uuid;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Time editing broken'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from time_log where description='Own edit' and "projectId"=(select id from access_fixture where k='project')
    and ("costRate"=999999 or "billingRate"=999999)) then raise exception 'Submitted rate tampering persisted'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='manager'),true);
set local role authenticated;
do $$ declare result jsonb; begin
  result:=create_record('project_member',jsonb_build_object('projectId',(select id from access_fixture where k='project'),
    'userId',(select id from access_fixture where k='admin'),'projectRole','Reviewer','active',true));
  if result->>'id' is null or result ? 'costRate' or result ? 'billingRate' then raise exception 'Member creation projection failed'; end if;
end $$;
reset role;
select 'Rate confidentiality, safe create responses and time snapshots verified' as result;
