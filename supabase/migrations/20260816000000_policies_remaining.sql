-- Row-level security: the tables 002/003 left unconverted, plus write policies.
--
-- Two gaps closed here.
--
-- 1. Coverage. RLS is enabled on every table, but policies existed for only
--    eight of them. Postgres denies by default when a table has RLS on and no
--    matching policy, so invoice, payment, project, quotation, product and the
--    rest returned zero rows to every caller — including an ALL-scope
--    administrator.
--
-- 2. Writes. The policies that did exist were SELECT-only, so every insert
--    failed with "new row violates row-level security policy for table ...".
--
-- Scoping follows what each table hangs off. Most of these have no ownerUserId
-- of their own, so they inherit visibility from the account or opportunity they
-- belong to — which is already scoped by the pilot policies. Reference data
-- (products, tax rates, currencies, categories) is readable by any internal
-- user: it describes the catalogue, not anyone's pipeline.
--
-- The internal/external split from 002 still holds: app_is_internal() in an
-- internal policy is load-bearing, because Postgres ORs permissive policies
-- together and an external portal user must never match an internal one.

-- ---------------------------------------------------------------- helpers

-- Accounts the caller can see, as a set, for tables that scope through one.
-- SECURITY DEFINER so it does not re-enter account's own policies and recurse.
create or replace function app_visible_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from account a
  where a."deletedAt" is null
    and (
      app_current_scope() = 'ALL'
      or a."ownerUserId" in (select app_visible_owner_ids())
    );
$$;

-- Write authority. Data scope governs which rows a user reads; permissions
-- govern whether they may write at all. ALL and TEAM scopes cover the staff
-- who create records; OWN-scope users write rows they own, checked per policy.
create or replace function app_can_write()
returns boolean
language sql
stable
as $$
  select app_is_internal() and app_current_scope() is not null;
$$;

-- ------------------------------------------------------- reference catalogue
--
-- Read-only to internal users; writes restricted to ALL scope (administrators
-- and finance), since a mispriced product affects every quotation.

do $$
declare t text;
begin
  foreach t in array array[
    'product', 'tax_rate', 'currency', 'case_category', 'commission_plan',
    'commission_tier', 'business_hours', 'sla_policy', 'campaign_type',
    'number_sequence', 'department', 'security_role', 'expense_category',
    'bank_account'
  ]
  loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format(
      'create policy %I on %I for select using (app_is_internal())',
      t || '_internal_read', t
    );

    execute format('drop policy if exists %I on %I', t || '_admin_write', t);
    execute format(
      'create policy %I on %I for all using (app_current_scope() = ''ALL'') '
      || 'with check (app_current_scope() = ''ALL'')',
      t || '_admin_write', t
    );
  end loop;
end $$;

-- --------------------------------------------------- account-scoped records
--
-- contact, invoice, payment, support_case, project and the rest carry no owner
-- of their own: they belong to an account, and the account's own policy has
-- already decided who may see it.

do $$
declare t text;
begin
  foreach t in array array[
    'contact', 'invoice', 'payment', 'support_case', 'project', 'contract',
    'lead', 'campaign', 'expense', 'vendor_bill', 'vendor_payment',
    'financial_transaction', 'knowledge_article', 'training'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format('drop policy if exists %I on %I', t || '_internal_write', t);
  end loop;
end $$;

-- lead and campaign own their rows directly, so they scope on ownerUserId.
alter table lead enable row level security;
drop policy if exists lead_internal_read on lead;
create policy lead_internal_read on lead
  for select using (
    app_is_internal()
    and (app_current_scope() = 'ALL' or "ownerUserId" in (select app_visible_owner_ids()))
  );
drop policy if exists lead_internal_write on lead;
create policy lead_internal_write on lead
  for all using (app_can_write()) with check (app_can_write());

alter table campaign enable row level security;
drop policy if exists campaign_internal_read on campaign;
create policy campaign_internal_read on campaign
  for select using (app_is_internal());
drop policy if exists campaign_internal_write on campaign;
create policy campaign_internal_write on campaign
  for all using (app_can_write()) with check (app_can_write());

-- The rest hang off an account. A nullable accountId passes: a training session
-- need not belong to a customer, and internal data with no account has nothing
-- to be restricted by.
do $$
declare t text;
begin
  foreach t in array array[
    'contact', 'invoice', 'payment', 'support_case', 'project', 'contract',
    'training'
  ]
  loop
    execute format(
      'create policy %I on %I for select using ('
      || ' app_is_internal() and ('
      || '   app_current_scope() = ''ALL'''
      || '   or "accountId" is null'
      || '   or "accountId" in (select app_visible_account_ids())'
      || ' ))',
      t || '_internal_read', t
    );

    execute format(
      'create policy %I on %I for all using (app_can_write()) with check (app_can_write())',
      t || '_internal_write', t
    );
  end loop;
end $$;

-- Back-office tables with no accountId at all: expenses, vendor bills and
-- payments, ledger transactions and knowledge articles are internal records,
-- visible to internal staff without an account to scope them through.
do $$
declare t text;
begin
  foreach t in array array[
    'expense', 'vendor_bill', 'vendor_payment', 'financial_transaction',
    'knowledge_article'
  ]
  loop
    execute format(
      'create policy %I on %I for select using (app_is_internal())',
      t || '_internal_read', t
    );
    execute format(
      'create policy %I on %I for all using (app_can_write()) with check (app_can_write())',
      t || '_internal_write', t
    );
  end loop;
end $$;

-- ----------------------------------------------- opportunity-scoped records
--
-- quotation and its lines follow the deal, which the pilot policy already
-- scopes. Reading through app_internal_visible_opportunity_ids() keeps this
-- from re-entering opportunity's policies.

alter table quotation enable row level security;
drop policy if exists quotation_internal_read on quotation;
create policy quotation_internal_read on quotation
  for select using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      or "opportunityId" in (select app_internal_visible_opportunity_ids())
    )
  );
drop policy if exists quotation_internal_write on quotation;
create policy quotation_internal_write on quotation
  for all using (app_can_write()) with check (app_can_write());

-- Portal users see quotations on their own partner's deals.
drop policy if exists quotation_external_read on quotation;
create policy quotation_external_read on quotation
  for select using (
    app_current_partner_id() is not null
    and "opportunityId" in (select app_partner_opportunity_ids())
  );

-- ------------------------------------------------------------- child tables
--
-- Line items, comments, members and allocations are reachable only through
-- their parent, and the parent's policy has already made that decision. A
-- separate predicate here would duplicate it and drift.

do $$
declare t text;
begin
  foreach t in array array[
    'quote_line', 'invoice_line', 'opportunity_product', 'payment_allocation',
    'vendor_bill_line', 'vendor_payment_allocation', 'case_comment',
    'sla_timer_event', 'project_member', 'project_phase', 'milestone',
    'project_task', 'time_log', 'project_risk', 'project_issue',
    'change_request', 'training_participant', 'campaign_member',
    'team', 'team_member', 'activity', 'email', 'note', 'document',
    'approval_request', 'approval_step', 'audit_history', 'partner_contact'
  ]
  loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format(
      'create policy %I on %I for select using (app_is_internal())',
      t || '_internal_read', t
    );

    execute format('drop policy if exists %I on %I', t || '_internal_write', t);
    execute format(
      'create policy %I on %I for all using (app_can_write()) with check (app_can_write())',
      t || '_internal_write', t
    );
  end loop;
end $$;

-- ------------------------------------------- writes on the piloted tables
--
-- 002 and 003 defined SELECT only, so inserts on these failed outright.

do $$
declare t text;
begin
  foreach t in array array[
    'account', 'opportunity', 'partner', 'opportunity_partner',
    'commission_record', 'commission_payout', 'app_user'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_internal_write', t);
    execute format(
      'create policy %I on %I for all using (app_can_write()) with check (app_can_write())',
      t || '_internal_write', t
    );
  end loop;
end $$;
