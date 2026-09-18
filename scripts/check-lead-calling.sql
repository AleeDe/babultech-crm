-- Transactional fixtures: access-sql check rolls back; apply uses a savepoint.
create temp table calling_fixture(k text primary key, id uuid);
grant select on calling_fixture to authenticated;
insert into calling_fixture select 'admin',u.id from app_user u join security_role r on r.id=u."roleId" where r.name='Administrator' and u.status='ACTIVE' and u."deletedAt" is null limit 1;
insert into calling_fixture select 'other',u.id from app_user u join security_role r on r.id=u."roleId" where r.name='Consultant' and u.status='ACTIVE' and u."deletedAt" is null limit 1;
insert into calling_fixture values ('lead',gen_random_uuid()),('foreign',gen_random_uuid()),('call',gen_random_uuid());
do $$ begin if (select count(*) from calling_fixture)<>5 then raise exception 'Missing calling fixtures'; end if; end $$;
insert into lead(id,"leadNumber","firstName","lastName","ownerUserId","updatedAt")
select id,'CALLTEST-'||left(id::text,20),'Calling','Verification',(select id from calling_fixture where k=case when f.k='lead' then 'admin' else 'other' end),now() from calling_fixture f where k in ('lead','foreign');
select set_config('request.jwt.claim.sub',(select id::text from calling_fixture where k='admin'),true);
set local role authenticated;
do $$ declare lid uuid := (select id from calling_fixture where k='lead'); cid uuid := (select id from calling_fixture where k='call'); follow timestamptz := now()+interval '2 days'; denied boolean; begin
  perform log_lead_call(cid,lid,'CONNECTED','Test conversation',follow);
  if not exists(select 1 from activity where id=cid and status='COMPLETED' and "followUpAt"=follow and "dueAt" is null) then raise exception 'Call not recorded correctly'; end if;
  if not exists(select 1 from lead where id=lid and status='NEW' and "nextFollowUpAt"=follow::timestamp(3)) then raise exception 'Lead follow-up/status mismatch'; end if;
  perform log_lead_call(cid,lid,'CONNECTED','Test conversation',follow);
  if (select count(*) from audit_history where "entityId"=lid and "fieldName"='nextFollowUpAt')<>1 then raise exception 'Retry duplicated audit'; end if;
  denied:=false;
  begin perform log_lead_call(cid,lid,'NO_ANSWER','Changed payload',follow); exception when unique_violation then denied:=true; end;
  if not denied then raise exception 'Request conflict accepted'; end if;
  denied:=false;
  begin perform log_lead_call(gen_random_uuid(),(select id from calling_fixture where k='foreign'),'CONNECTED','Wrong owner',follow); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Foreign lead accepted'; end if;
  denied:=false;
  begin perform log_lead_call(gen_random_uuid(),lid,'CONNECTED','Past time',now()-interval '1 day'); exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Past follow-up accepted'; end if;
  update lead set status='DISQUALIFIED' where id=lid;
  denied:=false;
  begin perform log_lead_call(gen_random_uuid(),lid,'CONNECTED','Closed lead',follow); exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Closed lead accepted'; end if;
  if (select count(*) from activity where "relatedEntityId"=lid)<>1 then raise exception 'Failed call left partial writes'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from calling_fixture where k='other'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
  begin perform log_lead_call(gen_random_uuid(),(select id from calling_fixture where k='foreign'),'CONNECTED','Permission check',now()+interval '1 day'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Non-sales role recorded call'; end if;
end $$;
reset role;
select 'Calling ownership, retry, validation and atomicity checks passed' as result;
