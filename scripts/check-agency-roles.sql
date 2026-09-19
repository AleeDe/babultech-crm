create temp table role_fixture(k text primary key,id uuid);
insert into role_fixture select k,gen_random_uuid() from unnest(array['editor','writer','project','other','task','version']) k;
grant select on role_fixture to authenticated;
insert into app_user(id,"fullName",email,"roleId",status,"updatedAt")
select f.id,'QA role '||f.k,f.id||'@example.com',r.id,'ACTIVE',now() from role_fixture f cross join security_role r where f.k in ('editor','writer') and r.name='Content Editor';
insert into project(id,"projectNumber",name,"projectManagerId","projectType","billingType",status,"updatedAt")
select id,'QA-'||left(id::text,20),'QA editor project',(select id from role_fixture where k='writer'),'INTERNAL','FIXED','PLANNING',now() from role_fixture where k in ('project','other');
insert into project_member("projectId","userId","projectRole",active,"updatedAt") values((select id from role_fixture where k='project'),(select id from role_fixture where k='editor'),'Editor',true,now());
insert into project_task(id,"projectId",name,"updatedAt") values((select id from role_fixture where k='task'),(select id from role_fixture where k='project'),'QA review',now());
insert into project_content_plan("taskId",channel,format,objective,audience,brief,"plannedPublishAt","updatedById") values((select id from role_fixture where k='task'),'WEBSITE','ARTICLE','QA','QA','QA',now(),(select id from role_fixture where k='writer'));
insert into content_version(id,"taskId","versionNumber","planRevision","planSnapshot",copy,"createdById") values((select id from role_fixture where k='version'),(select id from role_fixture where k='task'),1,1,'{}','QA copy',(select id from role_fixture where k='writer'));
select set_config('request.jwt.claim.sub',(select id::text from role_fixture where k='editor'),true);
set local role authenticated;
do $$ declare denied boolean:=false; p uuid:=(select id from role_fixture where k='project'); v uuid:=(select id from role_fixture where k='version'); begin
 if not app_content_review_access(p) then raise exception 'Assigned editor denied'; end if;
 if app_project_access(p,true) or app_has_permission('project:rates') then raise exception 'Editor gained management or rates'; end if;
 if app_content_review_access((select id from role_fixture where k='other')) then raise exception 'Unrelated project visible'; end if;
 perform review_content_version(gen_random_uuid(),v,'INTERNAL','APPROVED','Copy checked',null);
 begin perform review_content_version(gen_random_uuid(),v,'CLIENT','APPROVED','Email','Client'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Editor recorded client approval'; end if;
end $$;
reset role;
update project_member set active=false where "userId"=(select id from role_fixture where k='editor');
set local role authenticated;
do $$ begin if app_content_review_access((select id from role_fixture where k='project')) then raise exception 'Revoked editor retained access'; end if; end $$;
reset role;
do $$ begin
 if (select count(*) from security_role where name in ('SDR / Cold Caller','Marketing Executive','Content Editor') and "dataScope"='OWN' and active)<>3 then raise exception 'Presets missing'; end if;
 if exists(select 1 from security_role r,unnest(r.permissions) p where r.name in ('SDR / Cold Caller','Marketing Executive','Content Editor') and p in ('*','admin:*','invoice:write','invoice:approve','project:manage','project:rates','opportunity:write')) then raise exception 'Overbroad preset'; end if;
end $$;
select 'Agency role scope and internal-review checks passed' as result;
