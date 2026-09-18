create table content_version (
 id uuid primary key, "taskId" uuid not null references project_task(id), "versionNumber" integer not null,
 "planRevision" integer not null, "planSnapshot" jsonb not null, copy text not null,
 "assetUrl" text, "assetSha256" text, "createdById" uuid not null references app_user(id), "createdAt" timestamptz not null default clock_timestamp(),
 unique("taskId","versionNumber")
);
create table content_review (
 id uuid primary key, "versionId" uuid not null references content_version(id), stage text not null check(stage in ('INTERNAL','CLIENT')),
 decision text not null check(decision in ('APPROVED','CHANGES_REQUESTED')), evidence text not null,
 "clientApprover" text, "reviewedById" uuid not null references app_user(id), "createdAt" timestamptz not null default clock_timestamp(),
 unique("versionId",stage)
);
create table content_publication (
 id uuid primary key, "versionId" uuid not null unique references content_version(id), "liveUrl" text not null,
 "publishedAt" timestamptz not null, "recordedById" uuid not null references app_user(id), "createdAt" timestamptz not null default clock_timestamp()
);
alter table content_version enable row level security;
alter table content_review enable row level security;
alter table content_publication enable row level security;
revoke all on content_version,content_review,content_publication from public,anon,authenticated;
grant select on content_version,content_review,content_publication to authenticated;
create policy version_project_read on content_version for select to authenticated using(exists(select 1 from project_task t where t.id="taskId" and app_project_access(t."projectId")));
create policy review_project_read on content_review for select to authenticated using(exists(select 1 from content_version v where v.id="versionId"));
create policy publication_project_read on content_publication for select to authenticated using(exists(select 1 from content_version v where v.id="versionId"));

create function add_content_version(p_id uuid,p_task uuid,p_expected integer,p_plan_revision integer,p_copy text,p_asset_url text default null,p_asset_sha text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare t project_task%rowtype; p project_content_plan%rowtype; v content_version%rowtype; latest integer; actor uuid:=app_current_user_id();
begin
 select * into t from project_task where id=p_task for update;
 if t.id is null or not coalesce(app_project_access(t."projectId"),false) or not coalesce((app_project_access(t."projectId",true) or t."assignedUserId"=actor),false) then
 raise exception 'Assigned contributor or project manager required' using errcode='42501'; end if;
 select * into v from content_version where id=p_id;
 if found then
 if v."taskId"=p_task and v."createdById"=actor and v."versionNumber"=p_expected+1 and v.copy=trim(p_copy) and v."assetUrl" is not distinct from nullif(trim(p_asset_url),'')
 and v."assetSha256" is not distinct from nullif(lower(trim(p_asset_sha)),'') and v."planRevision"=p_plan_revision then return v.id; end if;
 raise exception 'Request conflict' using errcode='23505'; end if;
 select * into p from project_content_plan where "taskId"=p_task;
 if p."taskId" is null or t.status in ('COMPLETED','CANCELLED') then raise exception 'An open planned task is required' using errcode='22023'; end if;
 select coalesce(max("versionNumber"),0) into latest from content_version where "taskId"=p_task;
 if p_expected is null or latest<>p_expected or p_plan_revision is distinct from p.revision then raise exception 'Content or plan changed; refresh' using errcode='40001'; end if;
 if p_id is null or p_copy is null or length(trim(p_copy)) not between 1 and 20000 then raise exception 'Copy/script required, maximum 20000 characters' using errcode='22023'; end if;
 p_asset_url:=nullif(trim(p_asset_url),''); p_asset_sha:=nullif(lower(trim(p_asset_sha)),'');
 if (p_asset_url is null)<>(p_asset_sha is null) or (p_asset_url is not null and (p_asset_url !~ '^https?://[^[:space:]/?#]+[^[:space:]]*$' or length(p_asset_url)>2048 or p_asset_sha !~ '^[0-9a-f]{64}$')) then
 raise exception 'Asset requires an HTTP(S) version reference and SHA-256' using errcode='22023'; end if;
 insert into content_version(id,"taskId","versionNumber","planRevision","planSnapshot",copy,"assetUrl","assetSha256","createdById")
 values(p_id,p_task,latest+1,p.revision,to_jsonb(p),trim(p_copy),p_asset_url,p_asset_sha,actor);
 return p_id;
end $$;
revoke all on function add_content_version(uuid,uuid,integer,integer,text,text,text) from public,anon;
grant execute on function add_content_version(uuid,uuid,integer,integer,text,text,text) to authenticated;

create function review_content_version(p_id uuid,p_version uuid,p_stage text,p_decision text,p_evidence text,p_client text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare v content_version%rowtype; t project_task%rowtype; p project_content_plan%rowtype; r content_review%rowtype; tid uuid; actor uuid:=app_current_user_id();
begin
 select "taskId" into tid from content_version where id=p_version;
 select * into t from project_task where id=tid for update;
 if t.id is null or not coalesce(app_project_access(t."projectId",true),false) then raise exception 'Project reviewer access required' using errcode='42501'; end if;
 select * into v from content_version where id=p_version;
 if v."createdById"=actor then raise exception 'Author cannot approve/review their own version' using errcode='42501'; end if;
 select * into r from content_review where id=p_id;
 if found then
 if r."versionId"=p_version and r.stage=p_stage and r.decision=p_decision and r.evidence=trim(p_evidence) and r."reviewedById"=actor and r."clientApprover" is not distinct from nullif(trim(p_client),'') then return r.id; end if;
 raise exception 'Request conflict' using errcode='23505'; end if;
 select * into p from project_content_plan where "taskId"=tid;
 if t.status in ('COMPLETED','CANCELLED') or p.revision is distinct from v."planRevision" or exists(select 1 from content_version where "taskId"=tid and "versionNumber">v."versionNumber") then raise exception 'Review the latest version of the current plan' using errcode='40001'; end if;
 if p_id is null or p_stage is null or p_stage not in ('INTERNAL','CLIENT') or p_decision is null or p_decision not in ('APPROVED','CHANGES_REQUESTED') or p_evidence is null or length(trim(p_evidence)) not between 1 and 4000 then raise exception 'Review decision and evidence required' using errcode='22023'; end if;
 if p_stage='CLIENT' and (not p."clientApprovalRequired" or p_client is null or length(trim(p_client)) not between 1 and 200 or not exists(select 1 from content_review where "versionId"=v.id and stage='INTERNAL' and decision='APPROVED')) then raise exception 'Internal approval and client approver evidence required' using errcode='22023'; end if;
 if p_stage='INTERNAL' and nullif(trim(p_client),'') is not null then raise exception 'Client name is only for client review' using errcode='22023'; end if;
 insert into content_review(id,"versionId",stage,decision,evidence,"clientApprover","reviewedById") values(p_id,v.id,p_stage,p_decision,trim(p_evidence),nullif(trim(p_client),''),actor);
 return p_id;
end $$;
revoke all on function review_content_version(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function review_content_version(uuid,uuid,text,text,text,text) to authenticated;

create function record_content_publication(p_id uuid,p_version uuid,p_url text,p_published timestamptz) returns uuid
language plpgsql security definer set search_path=public as $$
declare v content_version%rowtype; t project_task%rowtype; p project_content_plan%rowtype; saved content_publication%rowtype; tid uuid; actor uuid:=app_current_user_id();
begin
 select "taskId" into tid from content_version where id=p_version;
 select * into t from project_task where id=tid for update;
 if t.id is null or not coalesce(app_project_access(t."projectId"),false) or not coalesce((app_project_access(t."projectId",true) or t."assignedUserId"=actor),false) then raise exception 'Assigned publisher or project manager required' using errcode='42501'; end if;
 select * into saved from content_publication where id=p_id;
 if found then
 if saved."versionId"=p_version and saved."liveUrl"=trim(p_url) and saved."publishedAt"=p_published and saved."recordedById"=actor then return saved.id; end if;
 raise exception 'Request conflict' using errcode='23505'; end if;
 select * into v from content_version where id=p_version;
 select * into p from project_content_plan where "taskId"=tid;
 if t.status='CANCELLED' or p.revision is distinct from v."planRevision" or exists(select 1 from content_version where "taskId"=tid and "versionNumber">v."versionNumber")
 or not exists(select 1 from content_review where "versionId"=v.id and stage='INTERNAL' and decision='APPROVED')
 or (p."clientApprovalRequired" and not exists(select 1 from content_review where "versionId"=v.id and stage='CLIENT' and decision='APPROVED')) then raise exception 'Current version and required approvals needed' using errcode='22023'; end if;
 if p_id is null or p_url is null or trim(p_url) !~ '^https?://[^[:space:]/?#]+[^[:space:]]*$' or length(p_url)>2048 or p_published is null or not isfinite(p_published) or p_published>clock_timestamp()
 or p_published<(select max("createdAt") from content_review where "versionId"=v.id and decision='APPROVED') then
 raise exception 'Live HTTP(S) URL and actual publication time after recorded approvals required' using errcode='22023'; end if;
 insert into content_publication(id,"versionId","liveUrl","publishedAt","recordedById") values(p_id,v.id,trim(p_url),p_published,actor);
 return p_id;
end $$;
revoke all on function record_content_publication(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function record_content_publication(uuid,uuid,text,timestamptz) to authenticated;
