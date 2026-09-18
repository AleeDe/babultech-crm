create temp table delivery_fixture(k text primary key,id uuid);
grant select on delivery_fixture to authenticated;
insert into delivery_fixture select k,gen_random_uuid() from unnest(array['sales_role','pm_role','sales','pm','outsider','account','opportunity','quote','project','handoff','second','third']) k;
insert into security_role(id,name,permissions,"dataScope","updatedAt") values
((select id from delivery_fixture where k='sales_role'),'Delivery test sales',array['opportunity:*'],'OWN',now()),
((select id from delivery_fixture where k='pm_role'),'Delivery test PM',array['project:*'],'OWN',now());
insert into app_user(id,"fullName",email,"roleId","updatedAt") select id,'Delivery test '||k,id::text||'@example.invalid',
(select id from delivery_fixture where k=case when f.k='sales' then 'sales_role' else 'pm_role' end),now() from delivery_fixture f where k in ('sales','pm','outsider');
insert into account(id,"accountNumber",name,"ownerUserId","updatedAt") values((select id from delivery_fixture where k='account'),'DH-TEST-ACCOUNT','Delivery test',(select id from delivery_fixture where k='sales'),now());
insert into opportunity(id,"opportunityNumber",name,"accountId","ownerUserId",stage,amount,"expectedCloseDate","updatedAt") values
((select id from delivery_fixture where k='opportunity'),'DH-TEST-OPP','Delivery test',(select id from delivery_fixture where k='account'),(select id from delivery_fixture where k='sales'),'CLOSED_WON',5000,current_date,now());
insert into quotation(id,"quoteNumber","opportunityId","accountId",status,"quoteDate","expiryDate","currencyCode","updatedAt") values
((select id from delivery_fixture where k='quote'),'DH-TEST-QUOTE',(select id from delivery_fixture where k='opportunity'),(select id from delivery_fixture where k='account'),'ACCEPTED',current_date,current_date+30,'PKR',now());
insert into project(id,"projectNumber",name,"accountId","opportunityId","projectManagerId",status,"billingType","projectType","updatedAt") values
((select id from delivery_fixture where k='project'),'DH-TEST-PROJECT','Delivery test',(select id from delivery_fixture where k='account'),(select id from delivery_fixture where k='opportunity'),(select id from delivery_fixture where k='pm'),'PLANNING','FIXED','CUSTOMER',now());
create temp table delivery_brief as select jsonb_object_agg(k,'Agreed '||k) as brief from unnest(array['contact','scope','deliverables','exclusions','dates','billing','paymentEvidence','acceptance','revisions','promises']) k;
grant select on delivery_brief to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='sales'),true);
set local role authenticated;
do $$ declare h uuid:=(select id from delivery_fixture where k='handoff'); p uuid:=(select id from delivery_fixture where k='project'); q uuid:=(select id from delivery_fixture where k='quote'); b jsonb:=(select brief from delivery_brief); denied boolean; begin
 if jsonb_array_length(delivery_handoff_options((select id from delivery_fixture where k='opportunity'))->'projects')<>1 then raise exception 'Planning project missing'; end if;
 denied:=false; begin perform submit_delivery_handoff(h,p,q,b-'billing','VERIFIED'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Incomplete brief accepted'; end if;
 perform submit_delivery_handoff(h,p,q,b,'PENDING'); perform submit_delivery_handoff(h,p,q,b,'PENDING');
 if (select count(*) from delivery_handoff where id=h)<>1 then raise exception 'Duplicate handoff'; end if;
 denied:=false; begin perform decide_delivery_handoff(h,'ACCEPTED','Sales bypass',now()+interval '1 day'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Sales accepted PM review'; end if;
 denied:=false; begin update delivery_handoff set status='ACCEPTED' where id=h; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Direct mutation allowed'; end if;
 denied:=false; begin perform update_record('delivery_handoff',h,'{"status":"ACCEPTED"}'::jsonb,'Project',app_current_user_id()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Generic RPC mutation allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='outsider'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 if exists(select 1 from delivery_handoff where id in(select id from delivery_fixture)) then raise exception 'Unrelated PM reads handoff'; end if;
 begin perform decide_delivery_handoff((select id from delivery_fixture where k='handoff'),'RETURNED','Unrelated decision'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unrelated review'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='pm'),true);
set local role authenticated;
do $$ declare denied boolean; h uuid:=(select id from delivery_fixture where k='handoff'); begin
 denied:=false; begin perform decide_delivery_handoff(h,'ACCEPTED','Payment not ready',now()+interval '1 day'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Pending payment accepted'; end if;
 denied:=false; begin update project set status='ACTIVE' where id=(select id from delivery_fixture where k='project'); exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Pending activation bypass'; end if;
 perform decide_delivery_handoff(h,'RETURNED','Payment evidence needed');
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='sales'),true);
set local role authenticated;
select submit_delivery_handoff((select id from delivery_fixture where k='second'),(select id from delivery_fixture where k='project'),(select id from delivery_fixture where k='quote'),(select brief from delivery_brief),'VERIFIED');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='pm'),true);
set local role authenticated;
do $$ declare h uuid:=(select id from delivery_fixture where k='second'); denied boolean:=false; begin
 begin perform decide_delivery_handoff(h,'ACCEPTED','Past kickoff',now()-interval '1 day'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Past kickoff accepted'; end if;
 perform decide_delivery_handoff(h,'ACCEPTED','Capacity and brief reviewed',now()+interval '1 day');
 perform decide_delivery_handoff(h,'ACCEPTED','Capacity and brief reviewed',now()+interval '1 day');
 if not exists(select 1 from project where id=(select id from delivery_fixture where k='project') and status='PLANNING') then raise exception 'Acceptance auto activated project'; end if;
 update project set status='ACTIVE' where id=(select id from delivery_fixture where k='project');
 if not found then raise exception 'PM could not activate accepted project'; end if;
 update project set status='ON_HOLD' where id=(select id from delivery_fixture where k='project');
end $$;
reset role;
update quotation set "versionNumber"="versionNumber"+1 where id=(select id from delivery_fixture where k='quote');
select set_config('request.jwt.claim.sub',(select id::text from delivery_fixture where k='pm'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 begin update project set status='ACTIVE' where id=(select id from delivery_fixture where k='project'); exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Changed quotation reused accepted review'; end if;
end $$;
reset role;
do $$ declare before_hash text; begin
 before_hash:=delivery_quote_fingerprint((select id from delivery_fixture where k='quote'));
 insert into quote_line(id,"quotationId",description,quantity,"unitPrice","lineTotal","updatedAt") values(gen_random_uuid(),(select id from delivery_fixture where k='quote'),'Changed deliverable',1,100,100,now());
 if before_hash=delivery_quote_fingerprint((select id from delivery_fixture where k='quote')) then raise exception 'Line change not detected'; end if;
end $$;
update app_user set status='INACTIVE' where id=(select id from delivery_fixture where k='pm');
set local role authenticated;
do $$ declare denied boolean:=false; begin
 if exists(select 1 from delivery_handoff where id in(select id from delivery_fixture)) then raise exception 'Inactive PM sees handoffs'; end if;
 begin perform decide_delivery_handoff((select id from delivery_fixture where k='second'),'ACCEPTED','Capacity and brief reviewed',now()+interval '1 day'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Inactive PM decision allowed'; end if;
end $$;
reset role;
select 'Delivery scope, payment gate, PM review, retries and project activation checks passed' as result;
