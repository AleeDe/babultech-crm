-- Invoked after the migration inside access-sql.mjs check's rollback transaction.
-- Uses temporary fixtures, never changes real assignments. No sensitive values
-- are emitted. Actual authenticated-role RLS and direct RPC paths are exercised.
create temp table access_fixture(k text primary key, id uuid);
grant select on access_fixture to authenticated;
insert into access_fixture select 'contributor',u.id from app_user u join security_role r on r.id=u."roleId"
  where u.status='ACTIVE' and u."deletedAt" is null and r.name='Consultant' limit 1;
insert into access_fixture select 'manager',u.id from app_user u join security_role r on r.id=u."roleId"
  where u.status='ACTIVE' and u."deletedAt" is null and r.name='Project Manager' limit 1;
insert into access_fixture select 'admin',u.id from app_user u join security_role r on r.id=u."roleId"
  where u.status='ACTIVE' and u."deletedAt" is null and r.name='Administrator' limit 1;
insert into access_fixture values ('project',gen_random_uuid()),('hidden',gen_random_uuid()),('task',gen_random_uuid()),('other_task',gen_random_uuid()),('time',gen_random_uuid());
do $$ begin
  if (select count(*) from access_fixture)<>8 then raise exception 'Required role fixtures unavailable'; end if;
end $$;
insert into project(id,"projectNumber",name,"projectManagerId","billingType","projectType","updatedAt")
  select id,'ACL-'||left(id::text,20),'Access verification',(select id from access_fixture where k='manager'),'FIXED','INTERNAL',now()
  from access_fixture where k in ('project','hidden');
insert into project_member("projectId","userId","projectRole",active,"updatedAt")
  values ((select id from access_fixture where k='project'),(select id from access_fixture where k='contributor'),'Contributor',true,now());
insert into project_task(id,"projectId",name,"assignedUserId","updatedAt")
  select f.id,(select id from access_fixture where k='project'),'Access task',
    (select id from access_fixture where k=case when f.k='task' then 'contributor' else 'manager' end),now()
  from access_fixture f where f.k in ('task','other_task');
insert into time_log(id,"userId","projectId","projectTaskId","workDate",hours,description,"approvalStatus","updatedAt")
  values ((select id from access_fixture where k='time'),(select id from access_fixture where k='contributor'),
    (select id from access_fixture where k='project'),(select id from access_fixture where k='task'),current_date,1,'Access verification','DRAFT',now());
insert into note(content,"relatedEntityType","relatedEntityId","createdById","updatedAt")
  select 'Access test','Project',id,(select id from access_fixture where k='manager'),now() from access_fixture where k in ('project','hidden');
insert into document("fileName","storageUrl","mimeType","fileSizeBytes","relatedEntityType","relatedEntityId","uploadedById","updatedAt")
  select 'access-test.txt','access-test/not-an-object','text/plain',0,'Project',id,
    (select id from access_fixture where k='manager'),now() from access_fixture where k in ('project','hidden');

select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='contributor'),true);
set local role authenticated;
do $$ declare n integer; denied boolean; begin
  if not app_project_access((select id from access_fixture where k='project')) then raise exception 'Member denied'; end if;
  if app_project_access((select id from access_fixture where k='hidden')) then raise exception 'Unassigned project visible'; end if;
  select count(*) into n from project where id in(select id from access_fixture where k in ('project','hidden'));
  if n<>1 then raise exception 'Project RLS read mismatch'; end if;
  select count(*) into n from note where "relatedEntityId" in(select id from access_fixture where k in ('project','hidden'));
  if n<>1 then raise exception 'Project note isolation failed'; end if;
  select count(*) into n from document where "relatedEntityId" in(select id from access_fixture where k in ('project','hidden'));
  if n<>1 then raise exception 'Project document isolation failed'; end if;
  update project_task set "completionPercent"=50 where id=(select id from access_fixture where k='task');
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Own progress broken'; end if;
  update project_task set "completionPercent"=50 where id=(select id from access_fixture where k='other_task');
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Colleague progress writable'; end if;
  denied:=false;
  begin update project_task set name='Unauthorized' where id=(select id from access_fixture where k='task');
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Task-field escalation allowed'; end if;
  denied:=false;
  begin perform update_record('project_task',(select id from access_fixture where k='task'),'{"name":"RPC bypass"}'::jsonb,'ProjectTask',app_current_user_id());
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Generic RPC task escalation allowed'; end if;
  denied:=false;
  begin insert into project_member("projectId","userId","projectRole","updatedAt") values
    ((select id from access_fixture where k='hidden'),app_current_user_id(),'Escalation',now());
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Self-enrollment allowed'; end if;
  update app_user set "jobTitle"='Unauthorized' where id=app_current_user_id();
  get diagnostics n=row_count;
  if n<>0 then raise exception 'User escalation allowed'; end if;
  denied:=false;
  begin perform create_project(jsonb_build_object('projectManagerId',app_current_user_id()));
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Definer RPC bypass allowed'; end if;
  denied:=false;
  begin update time_log set "approvalStatus"='APPROVED' where id=(select id from access_fixture where k='time');
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Self approval allowed'; end if;
  denied:=false;
  begin update time_log set "costRate"=999 where id=(select id from access_fixture where k='time');
    exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Rate snapshot tampering allowed'; end if;
  update time_log set "approvalStatus"='SUBMITTED' where id=(select id from access_fixture where k='time');
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Own submission broken'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='manager'),true);
set local role authenticated;
do $$ declare n integer; begin
  if not app_project_access((select id from access_fixture where k='project'),true) then raise exception 'Manager denied'; end if;
  update project_task set name='Manager edit' where id=(select id from access_fixture where k='task');
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Manager edit broken'; end if;
  perform transition_time_logs(array[(select id from access_fixture where k='time')],array['SUBMITTED'],'APPROVED',app_current_user_id(),true);
  if not exists(select 1 from time_log where id=(select id from access_fixture where k='time') and "approvalStatus"='APPROVED' and "approvedById"=app_current_user_id()) then
    raise exception 'Manager approval broken';
  end if;
end $$;
reset role;
update project_member set active=false where "projectId"=(select id from access_fixture where k='project') and "userId"=(select id from access_fixture where k='contributor');
select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='contributor'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from project where id=(select id from access_fixture where k='project')) then raise exception 'Removed member still sees project'; end if;
  if exists(select 1 from project_task where id=(select id from access_fixture where k='task')) then raise exception 'Removed member still sees task'; end if;
  if not exists(select 1 from time_log where id=(select id from access_fixture where k='time')) then raise exception 'Own history lost'; end if;
end $$;
reset role;
-- Revocation takes effect immediately, including within an existing identity.
update app_user set status='INACTIVE' where id=(select id from access_fixture where k='contributor');
select set_config('request.jwt.claim.sub',(select id::text from access_fixture where k='contributor'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from time_log where id=(select id from access_fixture where k='time')) then raise exception 'Inactive user retained history access'; end if;
end $$;
reset role;
select 'Project access checks passed; fixtures will be rolled back' as result;
