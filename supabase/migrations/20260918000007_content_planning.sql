-- Planning metadata extends existing tasks; no parallel assignment/progress store.
create table project_content_plan (
 "taskId" uuid primary key references project_task(id) on delete cascade,
 channel text not null check(channel in ('FACEBOOK','INSTAGRAM','LINKEDIN','TIKTOK','YOUTUBE','WEBSITE','EMAIL','OTHER')),
 format text not null check(format in ('POST','CAROUSEL','SHORT_VIDEO','VIDEO','ARTICLE','EMAIL','OTHER')),
 objective text not null check(length(trim(objective)) between 1 and 2000),
 audience text not null check(length(trim(audience)) between 1 and 2000),
 brief text not null check(length(trim(brief)) between 1 and 8000),
 "plannedPublishAt" timestamptz not null, "clientApprovalRequired" boolean not null default true,
 revision integer not null default 1, "updatedById" uuid not null references app_user(id),
 "updatedAt" timestamptz not null default now()
);
create index content_plan_date on project_content_plan("plannedPublishAt","taskId");
alter table project_content_plan enable row level security;
revoke all on project_content_plan from public,anon,authenticated;
grant select on project_content_plan to authenticated;
create policy content_project_read on project_content_plan for select to authenticated using (
 exists(select 1 from project_task t where t.id="taskId" and app_project_access(t."projectId"))
);
create function save_content_plan(p_task uuid,p_expected_revision integer,p_plan jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare t project_task%rowtype; old_plan project_content_plan%rowtype; rev integer; k text; pub timestamptz;
begin
 select * into t from project_task where id=p_task for update;
 if t.id is null or not coalesce(app_project_access(t."projectId",true),false) then raise exception 'Project management access required' using errcode='42501'; end if;
 if t.status in ('COMPLETED','CANCELLED') then raise exception 'Choose an open task' using errcode='22023'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_expected_revision is null or p_expected_revision<0 then raise exception 'Valid plan required' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_plan))<>7 then raise exception 'Invalid plan fields' using errcode='22023'; end if;
 foreach k in array array['channel','format','objective','audience','brief','plannedPublishAt'] loop
 if jsonb_typeof(p_plan->k) is distinct from 'string' or length(trim(p_plan->>k))=0 then raise exception 'Complete the content brief' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(p_plan->'clientApprovalRequired') is distinct from 'boolean' then raise exception 'Choose client approval requirement' using errcode='22023'; end if;
 pub:=(p_plan->>'plannedPublishAt')::timestamptz;
 if not isfinite(pub) then raise exception 'Valid publication time required' using errcode='22023'; end if;
 select * into old_plan from project_content_plan where "taskId"=p_task;
 if coalesce(old_plan.revision,0)<>p_expected_revision then raise exception 'Plan changed; refresh before editing' using errcode='40001'; end if;
 rev:=coalesce(old_plan.revision,0)+1;
 insert into project_content_plan("taskId",channel,format,objective,audience,brief,"plannedPublishAt","clientApprovalRequired",revision,"updatedById","updatedAt")
 values(p_task,p_plan->>'channel',p_plan->>'format',trim(p_plan->>'objective'),trim(p_plan->>'audience'),trim(p_plan->>'brief'),pub,(p_plan->>'clientApprovalRequired')::boolean,rev,app_current_user_id(),now())
 on conflict("taskId") do update set channel=excluded.channel,format=excluded.format,objective=excluded.objective,audience=excluded.audience,brief=excluded.brief,
 "plannedPublishAt"=excluded."plannedPublishAt","clientApprovalRequired"=excluded."clientApprovalRequired",revision=excluded.revision,"updatedById"=excluded."updatedById","updatedAt"=excluded."updatedAt";
 return rev;
end $$;
revoke all on function save_content_plan(uuid,integer,jsonb) from public,anon;
grant execute on function save_content_plan(uuid,integer,jsonb) to authenticated;
