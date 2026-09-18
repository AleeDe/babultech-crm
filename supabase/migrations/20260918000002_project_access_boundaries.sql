-- Phase 1: database-enforced assignment boundaries and contributor writes.
-- No user/role reassignment. Definer helpers use verified request identity.
create or replace function app_project_access(p_id uuid, p_manage boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_internal() and app_current_scope() is not null
    and app_has_permission(case when p_manage then 'project:manage' else 'project:read' end)
    and exists (
      select 1 from project p where p.id = p_id and p."deletedAt" is null and (
        app_current_scope() = 'ALL'
        or p."projectManagerId" = app_current_user_id()
        or (app_has_permission('project:manage') and p."projectManagerId" in (select app_visible_owner_ids()))
        or (not p_manage and exists (
          select 1 from project_member m where m."projectId" = p.id
            and m."userId" = app_current_user_id() and m.active
        ))
      )
    );
$$;

create or replace function app_project_create(p_manager uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_internal() and app_current_scope() is not null and app_has_permission('project:manage')
    and exists(select 1 from app_user u where u.id = p_manager and u.status = 'ACTIVE'
      and u."deletedAt" is null and u."partnerId" is null)
    and (app_current_scope() = 'ALL' or p_manager in (select app_visible_owner_ids()));
$$;

-- Membership/role tampering would defeat every project boundary. Administrative
-- server actions already require admin:*; make direct table/RPC access agree.
do $$ declare t text; begin
  foreach t in array array['app_user','security_role','team','team_member','department'] loop
    execute format('create policy access_admin_insert on %I as restrictive for insert with check (app_is_internal() and app_has_permission(''admin:*''))', t);
    execute format('create policy access_admin_update on %I as restrictive for update using (app_is_internal() and app_has_permission(''admin:*'')) with check (app_is_internal() and app_has_permission(''admin:*''))', t);
    execute format('create policy access_admin_delete on %I as restrictive for delete using (app_is_internal() and app_has_permission(''admin:*''))', t);
  end loop;
end $$;

-- Replace legacy permissive policies, including FOR ALL policies that granted
-- reads through write predicates. Child reads inherit the project's boundary.
do $$ declare t text; p record; begin
  foreach t in array array['project','project_member','project_phase','milestone','project_task','project_risk','project_issue','change_request','time_log'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy project_access_read on project for select using (app_project_access(id));
create policy project_access_insert on project for insert with check (app_project_create("projectManagerId"));
create policy project_access_update on project for update using (app_project_access(id, true))
  with check (app_project_create("projectManagerId"));
create policy project_access_delete on project for delete using (app_project_access(id, true));

do $$ declare t text; begin
  foreach t in array array['project_member','project_phase','milestone','project_risk','project_issue','change_request'] loop
    execute format('create policy project_access_read on %I for select using (app_project_access("projectId"))', t);
    execute format('create policy project_access_insert on %I for insert with check (app_project_access("projectId", true))', t);
    execute format('create policy project_access_update on %I for update using (app_project_access("projectId", true)) with check (app_project_access("projectId", true))', t);
    execute format('create policy project_access_delete on %I for delete using (app_project_access("projectId", true))', t);
  end loop;
end $$;

create policy project_access_read on project_task for select using (app_project_access("projectId"));
create policy project_access_insert on project_task for insert with check (app_project_access("projectId", true));
create policy project_access_delete on project_task for delete using (app_project_access("projectId", true));
create policy project_access_update on project_task for update
  using (app_project_access("projectId", true) or (app_project_access("projectId") and "assignedUserId"=app_current_user_id()))
  with check (app_project_access("projectId", true) or (app_project_access("projectId") and "assignedUserId"=app_current_user_id()));

create or replace function guard_project_task_update() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('postgres','service_role') then return new; end if;
  if not app_project_access(old."projectId", true) then
    if old."assignedUserId" is distinct from app_current_user_id()
      or (to_jsonb(new) - array['status','completionPercent','completedDate','updatedAt'])
        is distinct from (to_jsonb(old) - array['status','completionPercent','completedDate','updatedAt']) then
      raise exception 'Contributors may only update progress on their assigned tasks.' using errcode='42501';
    end if;
    if new."completionPercent" not between 0 and 100 or new.status='CANCELLED' then
      raise exception 'Invalid contributor progress.' using errcode='23514';
    end if;
    if new.status='COMPLETED' then new."completionPercent":=100; end if;
  end if;
  return new;
end $$;
create trigger project_task_progress_guard before update on project_task for each row execute function guard_project_task_update();

-- Time entries remain visible to their author after removal from a project.
-- New bookings require active membership; old entries do not grant project access.
create or replace function app_time_context(p_project uuid, p_case uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select app_is_internal() and app_current_scope() is not null and (
    (p_project is not null and app_project_access(p_project) and exists (
      select 1 from project_member m where m."projectId"=p_project and m."userId"=app_current_user_id() and m.active
    )) or (p_project is null and p_case is not null and exists (
      select 1 from support_case c where c.id=p_case and c."deletedAt" is null
        and (c."ownerUserId"=app_current_user_id() or app_current_scope()='ALL')
    ))
  );
$$;
create or replace function app_time_review(p_project uuid, p_case uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select app_is_internal() and app_current_scope() is not null and app_has_permission('time:approve')
  and (app_current_scope()='ALL' or (p_project is not null and app_project_access(p_project, true))
    or (p_project is null and p_case is not null and exists (
      select 1 from support_case c where c.id=p_case and c."ownerUserId" in (select app_visible_owner_ids())
    )));
$$;
create policy time_access_read on time_log for select using (
  app_is_internal() and app_current_scope() is not null and (
    "userId"=app_current_user_id() or app_project_access("projectId") or app_time_review("projectId","caseId")
  )
);
create policy time_access_insert on time_log for insert with check (
  "userId"=app_current_user_id() and app_time_context("projectId","caseId") and "approvalStatus"='DRAFT'
);
create policy time_access_update on time_log for update using (
  app_is_internal() and app_current_scope() is not null and (
    ("userId"=app_current_user_id() and "approvalStatus"<>'APPROVED' and "invoiceLineId" is null)
    or ("userId"<>app_current_user_id() and app_time_review("projectId","caseId"))
  )
) with check (app_is_internal() and app_current_scope() is not null);
create policy time_access_delete on time_log for delete using (
  app_is_internal() and app_current_scope() is not null and "userId"=app_current_user_id()
  and "approvalStatus"<>'APPROVED' and "invoiceLineId" is null
);

create or replace function guard_time_log_update() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('postgres','service_role') then return new; end if;
  if new."userId" is distinct from old."userId" or new."projectId" is distinct from old."projectId"
    or new."projectTaskId" is distinct from old."projectTaskId" or new."caseId" is distinct from old."caseId"
    or new."costRate" is distinct from old."costRate" or new."billingRate" is distinct from old."billingRate" then
    raise exception 'Time ownership, context and rate snapshots are immutable.' using errcode='42501';
  end if;
  -- Billing links are maintained by the invoice workflow, without changing work.
  if new."invoiceLineId" is distinct from old."invoiceLineId" then
    if not app_has_permission('invoice:write') or
      (to_jsonb(new)-array['invoiceLineId','updatedAt']) is distinct from (to_jsonb(old)-array['invoiceLineId','updatedAt']) then
      raise exception 'Only billing may link an invoice.' using errcode='42501';
    end if;
    return new;
  end if;
  if old."userId"=app_current_user_id() then
    if old."approvalStatus"='APPROVED' or old."invoiceLineId" is not null
      or new."approvalStatus" not in ('DRAFT','SUBMITTED')
      or new."approvedById" is distinct from old."approvedById" or new."approvedAt" is distinct from old."approvedAt" then
      raise exception 'You cannot approve or alter approved time.' using errcode='42501';
    end if;
  else
    -- The existing UI appends a visible rejection explanation after transition.
    -- Permit only that append, never replacement of the author's description.
    if old."approvalStatus"='REJECTED' and new."approvalStatus"='REJECTED'
      and app_time_review(old."projectId",old."caseId") and old."invoiceLineId" is null
      and (to_jsonb(new)-array['description','updatedAt'])=(to_jsonb(old)-array['description','updatedAt'])
      and starts_with(new.description, old.description || E'\n\n[Rejected by ' ||
        (select u."fullName" from app_user u where u.id=app_current_user_id()) || ': ')
      and right(new.description,1)=']' then return new; end if;
    if not app_time_review(old."projectId",old."caseId") or old."invoiceLineId" is not null
      or new."approvalStatus" not in ('APPROVED','REJECTED')
      or old."approvalStatus" not in ('SUBMITTED','APPROVED')
      or (to_jsonb(new)-array['approvalStatus','approvedById','approvedAt','updatedAt'])
        is distinct from (to_jsonb(old)-array['approvalStatus','approvedById','approvedAt','updatedAt']) then
      raise exception 'Only the assigned approver may review submitted time.' using errcode='42501';
    end if;
    new."approvedById":=app_current_user_id(); new."approvedAt":=now();
  end if;
  return new;
end $$;
create trigger time_log_update_guard before update on time_log for each row execute function guard_time_log_update();

-- Rate snapshots are database-owned. A caller cannot submit a cheaper cost or
-- higher billing rate, forge approval stamps, or book a task from another project.
create or replace function snapshot_time_log_rates() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new."projectTaskId" is not null and not exists(select 1 from project_task t
    where t.id=new."projectTaskId" and t."projectId"=new."projectId") then
    raise exception 'The task must belong to the selected project.' using errcode='23514';
  end if;
  if new."projectId" is not null then
    select m."billingRate",m."costRate" into new."billingRate",new."costRate"
      from project_member m where m."projectId"=new."projectId" and m."userId"=new."userId" and m.active;
    if not found then raise exception 'Active project membership is required.' using errcode='42501'; end if;
    if exists(select 1 from project p where p.id=new."projectId" and p."projectType"='INTERNAL') then new.billable:=false; end if;
  else
    select u."defaultBillingRate",u."costRate" into new."billingRate",new."costRate" from app_user u where u.id=new."userId";
  end if;
  new."approvedById":=null; new."approvedAt":=null; new."invoiceLineId":=null;
  return new;
end $$;
create trigger time_log_rate_snapshot before insert on time_log for each row execute function snapshot_time_log_rates();

-- Preserve the invoicing workflow without letting it alter work or rates.
create policy time_billing_read on time_log for select using (
  app_is_internal() and app_current_scope() is not null and app_has_permission('invoice:write')
  and exists(select 1 from project p where p.id="projectId" and p."accountId" is not null)
);
create policy time_billing_update on time_log for update using (
  app_is_internal() and app_current_scope() is not null and app_has_permission('invoice:write')
  and "approvalStatus"='APPROVED' and exists(select 1 from project p where p.id="projectId" and p."accountId" is not null)
) with check (app_is_internal() and app_has_permission('invoice:write'));

-- Polymorphic project attachments and audit records must obey the same parent
-- boundary even when fetched by a guessed ID without visiting the project page.
create or replace function app_project_attachment_access(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when p_type='Project' then app_project_access(p_id)
    when p_type in ('ProjectTask','Task') then exists(select 1 from project_task t where t.id=p_id and app_project_access(t."projectId"))
    else true end;
$$;
do $$ declare t text; begin
  foreach t in array array['note','document'] loop
    execute format('create policy project_parent_boundary on %I as restrictive for all using (app_project_attachment_access("relatedEntityType","relatedEntityId")) with check (app_project_attachment_access("relatedEntityType","relatedEntityId"))',t);
  end loop;
  foreach t in array array['note_attachment','note_mention'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy project_note_boundary on %I as restrictive for all using (exists(select 1 from note n where n.id="noteId")) with check (exists(select 1 from note n where n.id="noteId"))',t);
    end if;
  end loop;
end $$;
create policy project_audit_boundary on audit_history as restrictive for select
  using (app_project_attachment_access("entityType","entityId"));

-- The old SECURITY DEFINER create_project bypassed its table's RLS. Explicitly
-- authorize before using its privileged rate snapshot and manager enrollment.
create or replace function create_project(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_project jsonb; v_manager uuid:=(p_payload->>'projectManagerId')::uuid;
begin
  if not coalesce(app_project_create(v_manager),false) then
    raise exception 'Not permitted to create this project.' using errcode='42501';
  end if;
  v_project:=create_record('project',p_payload,'projectNumber','Project');
  insert into project_member(id,"projectId","userId","projectRole","allocationPercent","startDate","endDate","billingRate","costRate",active,"createdAt","updatedAt")
    select gen_random_uuid(),(v_project->>'id')::uuid,v_manager,'Project Manager',50,
      nullif(p_payload->>'startDate','')::date,nullif(p_payload->>'plannedEndDate','')::date,
      u."defaultBillingRate",u."costRate",true,now(),now() from app_user u where u.id=v_manager;
  return v_project;
end $$;
revoke all on function create_project(jsonb) from public, anon;
grant execute on function create_project(jsonb) to authenticated;
