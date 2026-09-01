-- Close the change stream to the people it was reading out to.
--
-- audit_history had no row-level security at all. The dashboard's "Change
-- stream" panel renders it, and getRecentChanges() gated on nothing more than
-- requireUser() — so every signed-in user, whatever their role, read every edit
-- to every record in the system: expense approvals with amounts, user accounts
-- being deactivated, deal and invoice changes.
--
-- Hiding the panel in React would not have fixed it. The table is in the
-- supabase_realtime publication (20260817000000) and the panel subscribes to it
-- from the browser with the anon key, so any user could read the whole audit
-- trail directly through PostgREST or the socket regardless of what the page
-- chose to draw. The boundary has to be in the database.
--
-- What a reader may now see is the audit trail for the modules they can already
-- read. That keeps the panel useful — a project manager still watches delivery
-- change under them — without it being a side channel around every other
-- permission in the app.
--
-- 'User' rows are deliberately admin-only. Who was deactivated, who changed
-- role and when, is administration's business and is exactly the kind of record
-- an attacker reads first.

-- ---------------------------------------------------------------- helper
--
-- Permission matching in SQL, mirroring can() in src/lib/authz.ts: an exact
-- grant, a bare '*', an entity wildcard 'entity:*', or an action wildcard
-- '*:action'. Kept in step with that function — if the two disagree, this one
-- wins and the stream silently loses rows.
create or replace function app_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from app_user u
    join security_role r on r.id = u."roleId"
    where u.id = app_current_user_id()
      and (
        '*' = any(r.permissions)
        or p_permission = any(r.permissions)
        or (split_part(p_permission, ':', 1) || ':*') = any(r.permissions)
        or ('*:' || split_part(p_permission, ':', 2)) = any(r.permissions)
      )
  );
$$;

-- The permission that governs each audited entity type. Anything not listed is
-- refused rather than allowed, so a new entity type added later is invisible
-- until it is placed here on purpose — the safe direction for a default.
create or replace function app_can_read_audit(p_entity_type text)
returns boolean
language sql
stable
as $$
  select case p_entity_type
    when 'Lead'        then app_has_permission('lead:read')
    when 'Campaign'    then app_has_permission('lead:read')
    when 'Account'     then app_has_permission('account:read')
    when 'Contact'     then app_has_permission('account:read')
    when 'Opportunity' then app_has_permission('opportunity:read')
    when 'Quotation'   then app_has_permission('quotation:read')
    when 'Contract'    then app_has_permission('contract:read')
    when 'Product'     then app_has_permission('opportunity:read')
    when 'Partner'     then app_has_permission('partner:read')
    when 'Commission'  then app_has_permission('commission:read')
    when 'Case'        then app_has_permission('case:read')
    -- Both spellings appear: entityHref in src/lib/utils.ts maps SupportCase
    -- alongside Case, so the policy accepts either rather than silently
    -- dropping whichever the writer used.
    when 'SupportCase' then app_has_permission('case:read')
    when 'Project'     then app_has_permission('project:read')
    when 'Task'        then app_has_permission('project:read')
    when 'Timesheet'   then app_has_permission('project:read')
    when 'Invoice'     then app_has_permission('invoice:read')
    when 'Payment'     then app_has_permission('invoice:read')
    when 'VendorBill'  then app_has_permission('invoice:read')
    when 'Expense'     then app_has_permission('expense:read')
    -- Account administration: who was deactivated, who was given which role.
    when 'User'        then app_has_permission('admin:*')
    else false
  end;
$$;

-- ---------------------------------------------------------------- policy
alter table audit_history enable row level security;
alter table audit_history force row level security;

drop policy if exists audit_history_internal_read on audit_history;

-- Internal staff only, and only for the modules they can read.
--
-- Partner portal logins get nothing: the portal has its own screens, and the
-- internal audit trail is not among them.
--
-- Expenses carry an extra row-level condition. Entity-type access is not row
-- access: holding expense:read opens the expense module, but that module only
-- shows a claimant their own claims, so a feed of every approval in the company
-- would hand them through the side door exactly what the list screen scopes
-- away. An approver sees all of them, which is the job.
create policy audit_history_internal_read on audit_history
  for select
  using (
    app_is_internal()
    and app_can_read_audit("entityType")
    and (
      "entityType" <> 'Expense'
      or app_has_permission('expense:approve')
      or exists (
        select 1
        from expense e
        where e.id = audit_history."entityId"
          and e."employeeUserId" = app_current_user_id()
      )
    )
  );

-- Writes stay with the application, which inserts through the service role.
-- No insert/update/delete policy is created, so nothing else can write here.

create index if not exists audit_history_entity_type_idx on audit_history ("entityType");
create index if not exists audit_history_changed_at_idx on audit_history ("changedAt" desc);
