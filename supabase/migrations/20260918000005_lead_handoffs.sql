-- Explicit, participant-scoped handoffs. No account or opportunity is created here.
create table lead_handoff (
 id uuid primary key,
 "leadId" uuid not null references lead(id),
 "senderId" uuid not null references app_user(id),
 "recipientId" uuid not null references app_user(id),
 "leadLabel" text not null, "senderName" text not null, "recipientName" text not null,
 qualification jsonb not null,
 "followUpAt" timestamptz not null,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','REJECTED','CANCELLED')),
 reason text, "createdAt" timestamptz not null default now(), "decidedAt" timestamptz, "acceptedFollowUpAt" timestamptz,
 check("senderId" <> "recipientId")
);
create unique index lead_handoff_pending on lead_handoff("leadId") where status='PENDING';
create index lead_handoff_recipient on lead_handoff("recipientId","createdAt" desc);
create index lead_handoff_sender on lead_handoff("senderId","createdAt" desc);
alter table lead_handoff enable row level security;
revoke all on lead_handoff from public, anon, authenticated;
grant select on lead_handoff to authenticated;
create policy handoff_participants on lead_handoff for select to authenticated using (
 app_is_internal() and app_has_permission('lead:read') and
 ("senderId"=app_current_user_id() or "recipientId"=app_current_user_id())
);

-- Private helper: only active internal staff with every required grant qualify.
create function handoff_user_allowed(p_user uuid, p_permissions text[]) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from app_user u join security_role r on r.id=u."roleId"
 where u.id=p_user and u.status='ACTIVE' and u."deletedAt" is null and u."partnerId" is null and r.active
 and not exists(select 1 from unnest(p_permissions) p where not (
   coalesce(r.permissions,'{}'::text[]) && array['*',p,split_part(p,':',1)||':*','*:'||split_part(p,':',2)])));
$$;
revoke all on function handoff_user_allowed(uuid,text[]) from public, anon, authenticated;

create function lead_handoff_recipients() returns table(id uuid, "fullName" text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not handoff_user_allowed(app_current_user_id(),array['lead:read','lead:write']) then
   raise exception 'Lead access required' using errcode='42501'; end if;
 return query select u.id,u."fullName"::text from app_user u where u.id<>app_current_user_id()
 and handoff_user_allowed(u.id,array['lead:read','lead:write','opportunity:write']) order by u."fullName";
end $$;
revoke all on function lead_handoff_recipients() from public,anon;
grant execute on function lead_handoff_recipients() to authenticated;

create function request_lead_handoff(p_id uuid,p_lead uuid,p_recipient uuid,p_qualification jsonb,p_follow_up timestamptz)
returns uuid language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare l lead%rowtype; h lead_handoff%rowtype; k text; actor uuid:=app_current_user_id();
begin
 if not handoff_user_allowed(actor,array['lead:read','lead:write']) then raise exception 'Lead access required' using errcode='42501'; end if;
 select * into l from lead where id=p_lead for update;
 if not found then raise exception 'Lead unavailable' using errcode='42501'; end if;
 select * into h from lead_handoff where id=p_id;
 if found then
   if h."senderId"=actor and h."leadId"=p_lead and h."recipientId"=p_recipient
     and h.qualification=p_qualification and h."followUpAt"=p_follow_up then return h.id; end if;
   raise exception 'Request ID conflict' using errcode='23505';
 end if;
 if l."ownerUserId"<>actor or l."deletedAt" is not null then raise exception 'Only the current owner may hand off this lead' using errcode='42501'; end if;
 if p_id is null or p_recipient is null or p_recipient=actor or not handoff_user_allowed(p_recipient,array['lead:read','lead:write','opportunity:write']) then
   raise exception 'Choose an active sales recipient' using errcode='22023'; end if;
 if l.status in ('CONVERTED','DISQUALIFIED') or l."convertedAt" is not null or p_follow_up is null or p_follow_up<=now()
   or p_qualification is null or jsonb_typeof(p_qualification)<>'object' then raise exception 'Open lead, qualification and future next action required' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_qualification))<>6 then raise exception 'Invalid qualification fields' using errcode='22023'; end if;
 foreach k in array array['serviceInterest','need','authority','budget','timing','nextAction'] loop
   if jsonb_typeof(p_qualification->k) is distinct from 'string' or length(trim(p_qualification->>k)) not between 1 and 2000 then
     raise exception 'Complete the qualification checklist; use Unknown where appropriate' using errcode='22023'; end if;
 end loop;
 if exists(select 1 from lead_handoff where "leadId"=p_lead and status='PENDING') then raise exception 'A handoff is already pending' using errcode='23505'; end if;
 update lead set status='QUALIFIED',"nextFollowUpAt"=p_follow_up,"updatedAt"=now() where id=p_lead;
 insert into lead_handoff(id,"leadId","senderId","recipientId","leadLabel","senderName","recipientName",qualification,"followUpAt")
 values(p_id,p_lead,actor,p_recipient,l."leadNumber"||' · '||l."firstName"||' '||l."lastName"||coalesce(' · '||l."companyName",''),
 (select "fullName" from app_user where id=actor),(select "fullName" from app_user where id=p_recipient),p_qualification,p_follow_up);
 return p_id;
end $$;
revoke all on function request_lead_handoff(uuid,uuid,uuid,jsonb,timestamptz) from public,anon;
grant execute on function request_lead_handoff(uuid,uuid,uuid,jsonb,timestamptz) to authenticated;

create function decide_lead_handoff(p_id uuid,p_decision text,p_reason text,p_follow_up timestamptz default null)
returns uuid language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare h lead_handoff%rowtype; l lead%rowtype; lid uuid; actor uuid:=app_current_user_id();
begin
 if not handoff_user_allowed(actor,array['lead:read','lead:write']) then raise exception 'Lead access required' using errcode='42501'; end if;
 select "leadId" into lid from lead_handoff where id=p_id and actor in ("senderId","recipientId");
 if lid is null then raise exception 'Handoff unavailable' using errcode='42501'; end if;
 -- Every path locks lead before handoff, including concurrent requests/decisions.
 select * into l from lead where id=lid for update;
 select * into h from lead_handoff where id=p_id for update;
 if p_decision is null or p_decision not in ('ACCEPTED','REJECTED','CANCELLED') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then
 raise exception 'Decision and reason required' using errcode='22023'; end if;
 if (p_decision='CANCELLED' and actor<>h."senderId") or (p_decision<>'CANCELLED' and
 (actor<>h."recipientId" or not handoff_user_allowed(actor,array['opportunity:write']))) then
 raise exception 'Only the designated participant may decide' using errcode='42501'; end if;
 if h.status=p_decision and h.reason=trim(p_reason)
 and (p_decision<>'ACCEPTED' or h."acceptedFollowUpAt"=p_follow_up) then return lid; end if;
 if h.status<>'PENDING' then raise exception 'Handoff already decided' using errcode='22023'; end if;
 if l."ownerUserId"<>h."senderId" or l."deletedAt" is not null or l."convertedAt" is not null or l.status in ('CONVERTED','DISQUALIFIED') then
 raise exception 'Lead changed; handoff cannot proceed' using errcode='22023'; end if;
 if p_decision='ACCEPTED' and (p_follow_up is null or p_follow_up<=now()) then raise exception 'Future next action required' using errcode='22023'; end if;
 update lead_handoff set status=p_decision,reason=trim(p_reason),"decidedAt"=now(),
 "acceptedFollowUpAt"=case when p_decision='ACCEPTED' then p_follow_up else null end where id=p_id;
 if p_decision='ACCEPTED' then
   update lead set "ownerUserId"=actor,"nextFollowUpAt"=p_follow_up,"updatedAt"=now() where id=lid;
   insert into audit_history("entityType","entityId","fieldName","oldValue","newValue","changedById",source,"changedAt")
   values('Lead',lid,'ownerUserId',h."senderId"::text,actor::text,actor,'UI',now());
 end if;
 return lid;
end $$;
revoke all on function decide_lead_handoff(uuid,text,text,timestamptz) from public,anon;
grant execute on function decide_lead_handoff(uuid,text,text,timestamptz) to authenticated;

create function guard_pending_lead_handoff() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new."ownerUserId" is distinct from old."ownerUserId" or new.status is distinct from old.status
 or new."convertedAt" is distinct from old."convertedAt" or new."deletedAt" is distinct from old."deletedAt")
 and exists(select 1 from lead_handoff where "leadId"=old.id and status='PENDING') then
 raise exception 'Resolve or cancel the pending sales handoff before changing ownership or status' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function guard_pending_lead_handoff() from public,anon,authenticated;
create trigger lead_pending_handoff before update on lead for each row execute function guard_pending_lead_handoff();
