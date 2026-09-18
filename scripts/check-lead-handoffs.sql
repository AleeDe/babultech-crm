-- All identities and records below are synthetic and rolled back by the runner.
create temp table handoff_fixture(k text primary key,id uuid);
grant select on handoff_fixture to authenticated;
insert into handoff_fixture select k,gen_random_uuid() from unnest(array['sender_role','sales_role','sender','sales','outsider','lead','reject_lead','cancel_lead','handoff','rejected','cancelled']) k;
insert into security_role(id,name,permissions,"dataScope","updatedAt") values
((select id from handoff_fixture where k='sender_role'),'Handoff test caller',array['lead:read','lead:write'],'OWN',now()),
((select id from handoff_fixture where k='sales_role'),'Handoff test sales',array['lead:read','lead:write','opportunity:write'],'OWN',now());
insert into app_user(id,"fullName",email,"roleId","updatedAt") select id,'Handoff test '||k,id::text||'@example.invalid',
(select id from handoff_fixture where k=case when f.k='sender' then 'sender_role' else 'sales_role' end),now() from handoff_fixture f where k in ('sender','sales','outsider');
insert into lead(id,"leadNumber","firstName","lastName","ownerUserId","updatedAt") select id,'HFTEST-'||left(id::text,20),'Handoff','Test',(select id from handoff_fixture where k='sender'),now() from handoff_fixture where k in ('lead','reject_lead','cancel_lead');
select set_config('request.jwt.claim.sub',(select id::text from handoff_fixture where k='sender'),true);
set local role authenticated;
do $$ declare q jsonb:='{"serviceInterest":"Software","need":"Inventory control","authority":"Unknown","budget":"Unknown","timing":"Next month","nextAction":"Discovery call"}';
 lid uuid:=(select id from handoff_fixture where k='lead'); hid uuid:=(select id from handoff_fixture where k='handoff'); sid uuid:=(select id from handoff_fixture where k='sales'); denied boolean; n int;
begin
 if not exists(select 1 from lead_handoff_recipients() where id=sid) then raise exception 'Sales recipient missing'; end if;
 denied:=false; begin perform request_lead_handoff(gen_random_uuid(),lid,sid,q-'budget',now()+interval '2 days'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Incomplete qualification accepted'; end if;
 denied:=false; begin perform request_lead_handoff(gen_random_uuid(),lid,app_current_user_id(),q,now()+interval '2 days'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Self handoff accepted'; end if;
 perform request_lead_handoff(hid,lid,sid,q,now()+interval '2 days');
 perform request_lead_handoff(hid,lid,sid,q,now()+interval '2 days');
 if (select count(*) from lead_handoff where id=hid)<>1 then raise exception 'Retry duplicate'; end if;
 if not exists(select 1 from lead where id=lid and status='QUALIFIED' and "ownerUserId"=app_current_user_id()) then raise exception 'Premature transfer or missing qualification'; end if;
 denied:=false; begin perform request_lead_handoff(gen_random_uuid(),lid,sid,q,now()+interval '2 days'); exception when unique_violation then denied:=true; end;
 if not denied then raise exception 'Second pending handoff accepted'; end if;
 denied:=false; begin update lead set status='CONVERTED' where id=lid; exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Pending conversion bypass'; end if;
 denied:=false; begin update lead set "ownerUserId"=sid where id=lid; exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Pending reassignment bypass'; end if;
 denied:=false; begin update lead_handoff set status='ACCEPTED' where id=hid; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Direct handoff tampering'; end if;
 denied:=false; begin perform update_record('lead_handoff',hid,'{"status":"ACCEPTED"}'::jsonb,'Lead',app_current_user_id()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Generic RPC handoff tampering'; end if;
 denied:=false; begin perform decide_lead_handoff(hid,'ACCEPTED','Self approval',now()+interval '3 days'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Sender accepted own handoff'; end if;
 perform request_lead_handoff((select id from handoff_fixture where k='rejected'),(select id from handoff_fixture where k='reject_lead'),sid,q,now()+interval '2 days');
 perform request_lead_handoff((select id from handoff_fixture where k='cancelled'),(select id from handoff_fixture where k='cancel_lead'),sid,q,now()+interval '2 days');
 perform decide_lead_handoff((select id from handoff_fixture where k='cancelled'),'CANCELLED','Correcting requirements');
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from handoff_fixture where k='outsider'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 if exists(select 1 from lead_handoff where id in(select id from handoff_fixture)) then raise exception 'Unrelated sales user sees handoffs'; end if;
 begin perform decide_lead_handoff((select id from handoff_fixture where k='handoff'),'ACCEPTED','Not my handoff',now()+interval '2 days'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unrelated acceptance'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from handoff_fixture where k='sales'),true);
set local role authenticated;
do $$ declare hid uuid:=(select id from handoff_fixture where k='handoff'); lid uuid:=(select id from handoff_fixture where k='lead'); denied boolean; begin
 if (select count(*) from lead_handoff where id in(select id from handoff_fixture))<>3 then raise exception 'Receiver cannot review snapshot'; end if;
 if exists(select 1 from lead where id=lid) then raise exception 'OWN recipient sees lead before acceptance'; end if;
 denied:=false; begin perform decide_lead_handoff(hid,'ACCEPTED','Missing next action'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Undated acceptance'; end if;
 perform decide_lead_handoff(hid,'ACCEPTED','Schedule discovery',now()+interval '3 days');
 perform decide_lead_handoff(hid,'ACCEPTED','Schedule discovery',now()+interval '3 days');
 if not exists(select 1 from lead where id=lid and "ownerUserId"=app_current_user_id() and status='QUALIFIED') then raise exception 'Transfer or OWN read failed'; end if;
 if (select count(*) from audit_history where "entityId"=lid and "fieldName"='ownerUserId')<>1 then raise exception 'Duplicate ownership audit'; end if;
 denied:=false; begin perform decide_lead_handoff(hid,'REJECTED','Conflicting decision'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Decision overwritten'; end if;
 perform decide_lead_handoff((select id from handoff_fixture where k='rejected'),'REJECTED','Need a clearer brief');
end $$;
reset role;
do $$ begin
 if not exists(select 1 from lead where id=(select id from handoff_fixture where k='reject_lead') and "ownerUserId"=(select id from handoff_fixture where k='sender')) then raise exception 'Rejection changed owner'; end if;
 if exists(select 1 from lead where id in(select id from handoff_fixture) and ("convertedAccountId" is not null or "convertedOpportunityId" is not null)) then raise exception 'Handoff unexpectedly converted lead'; end if;
end $$;
update app_user set status='INACTIVE' where id=(select id from handoff_fixture where k='sales');
set local role authenticated;
do $$ declare denied boolean:=false; begin
 if exists(select 1 from lead_handoff where id in(select id from handoff_fixture)) then raise exception 'Inactive user reads handoff'; end if;
 begin perform decide_lead_handoff((select id from handoff_fixture where k='handoff'),'ACCEPTED','Inactive retry',now()+interval '3 days'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Inactive decision accepted'; end if;
end $$;
reset role;
select 'Handoff scope, qualification, ownership, decisions, revocation and retry checks passed' as result;
