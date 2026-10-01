-- Customers and partners: project view, deliverables, portal roles, teams.
--
-- 1. Customers see their company's projects in the support portal - phases,
--    milestones, progress - and the deliverables our team hands over, which
--    they approve or send back with a comment. Approving is for the company's
--    portal Admin; anyone at the company can see them.
--
-- 2. Every portal login is an Admin or a User. An Admin manages the other
--    logins at their own company: who is an Admin, who is switched off, and
--    inviting colleagues. A partner's commission is for its Admins only.
--    Every login that existed before today is an Admin, so nobody loses
--    anything they could see yesterday.
--
-- 3. Knowledge base articles are numbered KB-…; the sequence is made here if
--    it does not exist yet.

insert into number_sequence (id, "entityType", prefix, "nextValue", "paddingLength", "includeYear", "updatedAt")
select gen_random_uuid(), 'KnowledgeArticle', 'KB', 1, 5, false, now()
where not exists (select 1 from number_sequence where "entityType" = 'KnowledgeArticle');

-- ---------------------------------------------------------------------------
-- Portal roles
-- ---------------------------------------------------------------------------

alter table app_user add column if not exists "portalRole" varchar(10) not null default 'USER'
  check ("portalRole" in ('ADMIN', 'USER'));
update app_user set "portalRole" = 'ADMIN' where "userType" in ('PARTNER', 'CUSTOMER') and "portalRole" = 'USER';

create or replace function app_current_portal_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select "portalRole" from app_user where id = app_current_user_id();
$$;

-- A partner's commission is for its Admins.
drop policy if exists partner_commission_partner_read on partner_commission;
create policy partner_commission_partner_read on partner_commission
  for select to authenticated
  using ("partnerId" = app_current_partner_id() and app_current_portal_role() = 'ADMIN');

-- The logins at the caller's own company: their partner, or their customer account.
create or replace function portal_team()
returns table (id uuid, "fullName" text, email text, "portalRole" text, status text, "lastLoginAt" timestamp, "isMe" boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me app_user%rowtype;
  v_account uuid;
begin
  select * into v_me from app_user where app_user.id = app_current_user_id();
  if v_me."userType" = 'PARTNER' and v_me."partnerId" is not null then
    return query
      select u.id, u."fullName"::text, u.email::text, u."portalRole"::text, u.status::text, u."lastLoginAt", u.id = v_me.id
        from app_user u
       where u."partnerId" = v_me."partnerId" and u."deletedAt" is null
       order by u."fullName";
  elsif v_me."userType" = 'CUSTOMER' then
    v_account := app_current_customer_account_id();
    return query
      select u.id, u."fullName"::text, u.email::text, u."portalRole"::text, u.status::text, u."lastLoginAt", u.id = v_me.id
        from app_user u join contact c on c.id = u."contactId"
       where u."userType" = 'CUSTOMER' and c."accountId" = v_account and u."deletedAt" is null
       order by u."fullName";
  end if;
end $$;

revoke all on function portal_team() from public, anon;
grant execute on function portal_team() to authenticated;

-- An Admin changes a colleague's role or switches their login off or on.
create or replace function portal_set_member(p_user uuid, p_role text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me app_user%rowtype;
  v_target app_user%rowtype;
  v_admins integer;
begin
  select * into v_me from app_user where id = app_current_user_id();
  if v_me.id is null or v_me."portalRole" <> 'ADMIN' or v_me.status <> 'ACTIVE' then
    raise exception 'Only an Admin can change your company''s logins.' using errcode = '42501';
  end if;
  if not exists (select 1 from portal_team() t where t.id = p_user) then
    raise exception 'That person is not at your company.' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'USER') then
    raise exception 'A login is an Admin or a User.' using errcode = '23514';
  end if;
  select * into v_target from app_user where id = p_user;

  -- Someone has to be left to manage the logins.
  select count(*) into v_admins from portal_team() t
   where t."portalRole" = 'ADMIN' and t.status = 'ACTIVE' and t.id <> p_user;
  if v_admins = 0 and (p_role <> 'ADMIN' or not p_active) then
    raise exception 'Keep at least one active Admin, or nobody can manage your logins.' using errcode = '23514';
  end if;

  update app_user set
    "portalRole" = p_role,
    status = (case when p_active then 'ACTIVE' else 'INACTIVE' end)::"UserStatus",
    "updatedAt" = now()
  where id = p_user;

  insert into audit_history (id, "entityType", "entityId", "fieldName", "oldValue", "newValue", "changedById", source, "changedAt")
  values (gen_random_uuid(), 'User', p_user, 'portalRole/status',
          v_target."portalRole" || '/' || v_target.status, p_role || '/' || case when p_active then 'ACTIVE' else 'INACTIVE' end,
          v_me.id, 'portal', now());
end $$;

revoke all on function portal_set_member(uuid, text, boolean) from public, anon;
grant execute on function portal_set_member(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Customers see their projects
-- ---------------------------------------------------------------------------

drop policy if exists project_customer_read on project;
create policy project_customer_read on project for select to authenticated
  using (app_current_user_type() = 'CUSTOMER' and "accountId" = app_current_customer_account_id() and "deletedAt" is null);

drop policy if exists project_phase_customer_read on project_phase;
create policy project_phase_customer_read on project_phase for select to authenticated
  using (app_current_user_type() = 'CUSTOMER' and exists (select 1 from project p where p.id = "projectId"));

drop policy if exists milestone_customer_read on milestone;
create policy milestone_customer_read on milestone for select to authenticated
  using (app_current_user_type() = 'CUSTOMER' and exists (select 1 from project p where p.id = "projectId"));

-- ---------------------------------------------------------------------------
-- Deliverables
-- ---------------------------------------------------------------------------

create table if not exists deliverable (
  id uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references project(id) on delete cascade,
  "milestoneId" uuid references milestone(id) on delete set null,
  name varchar(200) not null,
  description text,
  -- Where the customer finds it: a link to the document, site or build.
  link varchar(1000),
  "dueDate" date,
  status varchar(20) not null default 'PLANNED'
    check (status in ('PLANNED', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED')),
  "submittedAt" timestamp(3),
  "submittedById" uuid references app_user(id) on delete set null,
  "decidedAt" timestamp(3),
  "decidedByUserId" uuid references app_user(id) on delete set null,
  "customerComment" text,
  "createdById" uuid references app_user(id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);
create index if not exists deliverable_project_idx on deliverable ("projectId");

alter table deliverable enable row level security;

drop policy if exists deliverable_internal_read on deliverable;
create policy deliverable_internal_read on deliverable for select to authenticated
  using (app_is_internal() and exists (select 1 from project p where p.id = "projectId"));
drop policy if exists deliverable_internal_write on deliverable;
create policy deliverable_internal_write on deliverable for all to authenticated
  using (app_is_internal() and app_has_permission('project:manage') and exists (select 1 from project p where p.id = "projectId"))
  with check (app_is_internal() and app_has_permission('project:manage') and exists (select 1 from project p where p.id = "projectId"));
-- Customers see what has been handed to them; plans stay ours.
drop policy if exists deliverable_customer_read on deliverable;
create policy deliverable_customer_read on deliverable for select to authenticated
  using (app_current_user_type() = 'CUSTOMER' and status <> 'PLANNED' and exists (select 1 from project p where p.id = "projectId"));

drop trigger if exists view_as_read_only on deliverable;
create trigger view_as_read_only before insert or update or delete on deliverable
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists set_updated_at on deliverable;

-- The customer's Admin approves a deliverable or sends it back.
create or replace function customer_decide_deliverable(p_id uuid, p_approve boolean, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d deliverable%rowtype;
  v_project project%rowtype;
  v_me app_user%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_me from app_user where id = app_current_user_id();
  if v_me."userType" is distinct from 'CUSTOMER' or v_me.status <> 'ACTIVE' then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_me."portalRole" <> 'ADMIN' then
    raise exception 'Only your company''s portal Admin can approve deliverables.' using errcode = '42501';
  end if;
  select * into v_d from deliverable where id = p_id for update;
  select * into v_project from project where id = v_d."projectId";
  if v_d.id is null or v_project."accountId" is distinct from app_current_customer_account_id() then
    raise exception 'That deliverable could not be found.' using errcode = '42501';
  end if;
  if v_d.status <> 'SUBMITTED' then
    raise exception 'That deliverable is not waiting for your decision.' using errcode = '23514';
  end if;
  if not p_approve and v_comment is null then
    raise exception 'Say what needs to change.' using errcode = '23514';
  end if;

  update deliverable set
    status = case when p_approve then 'APPROVED' else 'CHANGES_REQUESTED' end,
    "decidedAt" = now(),
    "decidedByUserId" = v_me.id,
    "customerComment" = v_comment,
    "updatedAt" = now()
  where id = p_id;

  insert into audit_history (id, "entityType", "entityId", "fieldName", "oldValue", "newValue", "changedById", source, "changedAt")
  values (gen_random_uuid(), 'Deliverable', p_id, 'status', 'SUBMITTED',
          case when p_approve then 'APPROVED' else 'CHANGES_REQUESTED' end, v_me.id, 'portal', now());

  perform notify_user(v_project."projectManagerId", 'APPROVAL_DECIDED',
    case when p_approve then 'Customer approved: ' else 'Customer asked for changes: ' end || v_d.name,
    coalesce(v_comment, v_project.name), '/projects/' || v_project.id, 'Project', v_project.id);
end $$;

revoke all on function customer_decide_deliverable(uuid, boolean, text) from public, anon;
grant execute on function customer_decide_deliverable(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
