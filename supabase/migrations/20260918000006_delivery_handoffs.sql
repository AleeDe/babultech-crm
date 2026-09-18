create table delivery_handoff (
 id uuid primary key, "projectId" uuid not null references project(id), "opportunityId" uuid not null references opportunity(id),
 "quotationId" uuid not null references quotation(id), "senderId" uuid not null references app_user(id), "recipientId" uuid not null references app_user(id),
 "projectName" text not null, "senderName" text not null, "recipientName" text not null,
 "quoteSnapshot" jsonb not null, checklist jsonb not null, "paymentState" text not null check("paymentState" in ('PENDING','VERIFIED','NOT_REQUIRED')),
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','RETURNED','CANCELLED')),
 reason text, "kickoffAt" timestamptz, "createdAt" timestamptz not null default clock_timestamp(), "decidedAt" timestamptz
);
create unique index delivery_handoff_pending on delivery_handoff("projectId") where status='PENDING';
create index delivery_handoff_project on delivery_handoff("projectId","createdAt" desc);
alter table delivery_handoff enable row level security;
revoke all on delivery_handoff from public,anon,authenticated;
grant select on delivery_handoff to authenticated;
create policy delivery_participants on delivery_handoff for select to authenticated using(app_is_internal() and
 (("senderId"=app_current_user_id() and app_has_permission('opportunity:read')) or
 ("recipientId"=app_current_user_id() and app_has_permission('project:manage'))));

-- Detect changes to commercial fields AND line items, including direct edits.
create function delivery_quote_fingerprint(p_quote uuid) returns text language sql stable security definer set search_path=public as $$
 select md5(to_jsonb(q)::text || coalesce((select jsonb_agg(to_jsonb(l) order by l.id)::text from quote_line l where l."quotationId"=q.id),'[]')) from quotation q where q.id=p_quote;
$$;
revoke all on function delivery_quote_fingerprint(uuid) from public,anon,authenticated;

create function delivery_handoff_options(p_opportunity uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not handoff_user_allowed(app_current_user_id(),array['opportunity:read','opportunity:write']) or not exists(
 select 1 from opportunity where id=p_opportunity and "ownerUserId"=app_current_user_id() and stage='CLOSED_WON' and "deletedAt" is null)
 then raise exception 'Own won opportunity required' using errcode='42501'; end if;
 return jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'manager',u."fullName"))
 from project p join app_user u on u.id=p."projectManagerId" join opportunity o on o.id=p_opportunity
 where p."opportunityId"=o.id and p."accountId"=o."accountId" and p."deletedAt" is null and p.status in ('DRAFT','PLANNING')
 and handoff_user_allowed(u.id,array['project:read','project:manage'])),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'number',q."quoteNumber",'version',q."versionNumber")) from quotation q
 join opportunity o on o.id=p_opportunity where q."opportunityId"=o.id and q."accountId"=o."accountId" and q.status='ACCEPTED' and q."deletedAt" is null),'[]'::jsonb));
end $$;
revoke all on function delivery_handoff_options(uuid) from public,anon;
grant execute on function delivery_handoff_options(uuid) to authenticated;

create function submit_delivery_handoff(p_id uuid,p_project uuid,p_quote uuid,p_checklist jsonb,p_payment text) returns uuid
language plpgsql security definer set search_path=public as $$
declare p project%rowtype; o opportunity%rowtype; q quotation%rowtype; h delivery_handoff%rowtype; k text; actor uuid:=app_current_user_id();
begin
 if not handoff_user_allowed(actor,array['opportunity:read','opportunity:write']) then raise exception 'Sales access required' using errcode='42501'; end if;
 select * into p from project where id=p_project for update;
 select * into o from opportunity where id=p."opportunityId";
 if o.id is null or o."ownerUserId"<>actor then raise exception 'Own opportunity required' using errcode='42501'; end if;
 select * into h from delivery_handoff where id=p_id;
 if found then
 if h."senderId"=actor and h."projectId"=p_project and h."quotationId"=p_quote and h.checklist=p_checklist and h."paymentState"=p_payment then return h.id; end if;
 raise exception 'Request conflict' using errcode='23505'; end if;
 select * into q from quotation where id=p_quote;
 if p_id is null or p."deletedAt" is not null or p.status not in ('DRAFT','PLANNING') or p."accountId" is distinct from o."accountId"
 or o."deletedAt" is not null or o.stage<>'CLOSED_WON' or q.id is null or q."deletedAt" is not null or q.status<>'ACCEPTED'
 or q."opportunityId"<>o.id or q."accountId"<>o."accountId" or not handoff_user_allowed(p."projectManagerId",array['project:read','project:manage']) then
 raise exception 'Linked planning project, active PM, won deal and accepted quotation required' using errcode='22023'; end if;
 if p_payment is null or p_payment not in ('PENDING','VERIFIED','NOT_REQUIRED') or p_checklist is null or jsonb_typeof(p_checklist)<>'object' then raise exception 'Checklist required' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_checklist))<>10 then raise exception 'Complete all checklist fields' using errcode='22023'; end if;
 foreach k in array array['contact','scope','deliverables','exclusions','dates','billing','paymentEvidence','acceptance','revisions','promises'] loop
 if jsonb_typeof(p_checklist->k) is distinct from 'string' or length(trim(p_checklist->>k)) not between 1 and 4000 then raise exception 'Complete all checklist fields' using errcode='22023'; end if;
 end loop;
 insert into delivery_handoff(id,"projectId","opportunityId","quotationId","senderId","recipientId","projectName","senderName","recipientName","quoteSnapshot",checklist,"paymentState")
 values(p_id,p.id,o.id,q.id,actor,p."projectManagerId",p.name,(select "fullName" from app_user where id=actor),(select "fullName" from app_user where id=p."projectManagerId"),
 jsonb_build_object('number',q."quoteNumber",'version',q."versionNumber",'amount',q."totalAmount",'currency',q."currencyCode",'updatedAt',q."updatedAt",'fingerprint',delivery_quote_fingerprint(q.id)),p_checklist,p_payment);
 return p_id;
end $$;
revoke all on function submit_delivery_handoff(uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function submit_delivery_handoff(uuid,uuid,uuid,jsonb,text) to authenticated;

create function decide_delivery_handoff(p_id uuid,p_decision text,p_reason text,p_kickoff timestamptz default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare h delivery_handoff%rowtype; p project%rowtype; pid uuid; actor uuid:=app_current_user_id();
begin
 if not app_is_internal() then raise exception 'Internal access required' using errcode='42501'; end if;
 select "projectId" into pid from delivery_handoff where id=p_id and actor in ("senderId","recipientId");
 if pid is null then raise exception 'Handoff unavailable' using errcode='42501'; end if;
 select * into p from project where id=pid for update;
 select * into h from delivery_handoff where id=p_id for update;
 if p_decision is null or p_decision not in ('ACCEPTED','RETURNED','CANCELLED') or p_reason is null or length(trim(p_reason)) not between 1 and 4000 then raise exception 'Decision and reason required' using errcode='22023'; end if;
 if (p_decision='CANCELLED' and (actor<>h."senderId" or not handoff_user_allowed(actor,array['opportunity:write']))) or
 (p_decision<>'CANCELLED' and (actor<>h."recipientId" or p."projectManagerId"<>actor or not handoff_user_allowed(actor,array['project:read','project:manage']))) then raise exception 'Designated participant required' using errcode='42501'; end if;
 if h.status=p_decision and h.reason=trim(p_reason) and (p_decision<>'ACCEPTED' or h."kickoffAt"=p_kickoff) then return pid; end if;
 if h.status<>'PENDING' then raise exception 'Already decided' using errcode='22023'; end if;
 if p_decision='ACCEPTED' then
 if p."deletedAt" is not null or p.status not in ('DRAFT','PLANNING') or p."opportunityId" is distinct from h."opportunityId" or h."paymentState"='PENDING' or p_kickoff is null or p_kickoff<=now()
 or not exists(select 1 from opportunity o join quotation q on q.id=h."quotationId" where o.id=h."opportunityId" and o.stage='CLOSED_WON' and o."deletedAt" is null
 and o."accountId"=p."accountId" and q.status='ACCEPTED' and q."deletedAt" is null and delivery_quote_fingerprint(q.id)=h."quoteSnapshot"->>'fingerprint') then
 raise exception 'Resolve payment, source changes and kickoff date before acceptance' using errcode='22023'; end if;
 end if;
 update delivery_handoff set status=p_decision,reason=trim(p_reason),"decidedAt"=now(),"kickoffAt"=case when p_decision='ACCEPTED' then p_kickoff end where id=p_id;
 return pid;
end $$;
revoke all on function decide_delivery_handoff(uuid,text,text,timestamptz) from public,anon;
grant execute on function decide_delivery_handoff(uuid,text,text,timestamptz) to authenticated;

-- Existing projects without a handoff keep their current workflow.
create function guard_delivery_kickoff() returns trigger language plpgsql security definer set search_path=public as $$
declare h delivery_handoff%rowtype;
begin
 if new.status in ('ACTIVE','AT_RISK','COMPLETED') and old.status not in ('ACTIVE','AT_RISK','COMPLETED') then
 select * into h from delivery_handoff where "projectId"=old.id order by "createdAt" desc,id desc limit 1;
 if found and (h.status<>'ACCEPTED' or new."projectManagerId"<>h."recipientId" or new."opportunityId" is distinct from h."opportunityId"
 or not exists(select 1 from opportunity o join quotation q on q.id=h."quotationId" where o.id=h."opportunityId" and o."accountId"=new."accountId" and o.stage='CLOSED_WON' and o."deletedAt" is null
 and q.status='ACCEPTED' and q."deletedAt" is null and delivery_quote_fingerprint(q.id)=h."quoteSnapshot"->>'fingerprint')) then
 raise exception 'Current delivery handoff must be accepted before project activation' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function guard_delivery_kickoff() from public,anon,authenticated;
create trigger project_delivery_kickoff before update on project for each row execute function guard_delivery_kickoff();
