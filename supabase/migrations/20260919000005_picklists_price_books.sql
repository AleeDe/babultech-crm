-- Configurable dropdowns, product price books, and deal/project costing.
--
-- 1. picklist / picklist_value
--    Every dropdown in the app now reads its values from here, so an
--    administrator can add, rename, reorder and retire them from Settings.
--    Lists come in two kinds:
--      * open lists   - values can be added and removed freely.
--      * locked lists - workflow values the code branches on (stages, statuses).
--                       They can be renamed, reordered and hidden, but not added
--                       to or deleted, because a value the code does not know
--                       would have no rules behind it.
--    A list backed by a Postgres enum records the enum's name; adding a value to
--    it extends the enum through add_picklist_value(), so the column accepts it.
--
-- 2. price_book
--    A product's priced offer: licence, maintenance, cloud and AI cost. One
--    product can have many (Standard, Premium, 2026 rates...) and old books stay
--    on the deals that used them.
--
-- 3. Opportunity costing
--    A deal picks a product and a price book. The book's four costs are copied
--    onto the deal (so later price changes do not rewrite old deals), the
--    implementation and training costs come from the deal's project, and
--    totalAmount = (sum of the six) less Discount %.
--
-- 4. Project costing
--    Tasks carry a type, a category (Implementation / Training), hours, a rate
--    and a discount. The project's implementationTotal and trainingTotal are
--    the sums of hours x rate - discount per category, kept by trigger, and flow
--    onto the opportunity's implementationCost / trainingCost.

-- ---------------------------------------------------------------------------
-- 1. Picklists
-- ---------------------------------------------------------------------------

create table public.picklist (
  key          text primary key,
  label        text not null,
  "groupName"  text not null,
  "enumType"   text,
  locked       boolean not null default false,
  description  text,
  "sortOrder"  integer not null default 0
);

create table public.picklist_value (
  id            uuid primary key default gen_random_uuid(),
  "picklistKey" text not null references public.picklist(key) on delete cascade,
  value         text not null check (value = btrim(value) and length(value) between 1 and 100),
  label         text not null check (label = btrim(label) and length(label) between 1 and 100),
  "sortOrder"   integer not null default 0,
  active        boolean not null default true,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now(),
  unique ("picklistKey", value)
);
create index picklist_value_list_idx on public.picklist_value ("picklistKey", "sortOrder");

alter table public.picklist enable row level security;
alter table public.picklist_value enable row level security;
create policy picklist_read on public.picklist for select to authenticated using (app_is_internal());
create policy picklist_value_read on public.picklist_value for select to authenticated using (app_is_internal());
-- Edits go through the admin-checked functions below; direct updates are
-- allowed to administrators only (rename / reorder / hide).
create policy picklist_value_admin_update on public.picklist_value for update to authenticated
  using (app_is_internal() and app_has_permission('admin:*'))
  with check (app_is_internal() and app_has_permission('admin:*'));
grant select on public.picklist to authenticated;
grant select, update on public.picklist_value to authenticated;
grant all on public.picklist, public.picklist_value to service_role;

-- The lists. Order here is the order they appear in Settings.
insert into public.picklist (key, label, "groupName", "enumType", locked, description, "sortOrder") values
  ('lead_status',       'Lead status',        'Sales',     'LeadStatus',       true,  'Where a lead stands. Converted is set only by conversion.', 10),
  ('lead_rating',       'Lead rating',        'Sales',     'LeadRating',       false, 'How warm a lead is.', 20),
  ('lead_source',       'Lead source',        'Sales',     null,               false, 'Where leads and deals come from.', 30),
  ('industry',          'Industry',           'Sales',     null,               false, 'Industry of accounts and leads.', 40),
  ('account_type',      'Account type',       'Sales',     'AccountType',      false, 'What an account is to the business.', 50),
  ('customer_status',   'Customer status',    'Sales',     'CustomerStatus',   true,  'Lifecycle of a customer account.', 60),
  ('health_status',     'Health',             'Sales',     'HealthStatus',     true,  'Account and project health.', 70),
  ('preferred_channel', 'Preferred channel',  'Sales',     'PreferredChannel', false, 'How a contact prefers to be reached.', 80),
  ('opportunity_stage', 'Opportunity stage',  'Sales',     'OpportunityStage', true,  'The sales pipeline stages.', 90),
  ('opportunity_type',  'Opportunity type',   'Sales',     'OpportunityType',  false, 'New business or expansion.', 100),
  ('campaign_status',   'Campaign status',    'Sales',     'CampaignStatus',   true,  'Where a campaign stands.', 110),
  ('activity_type',     'Activity type',      'Sales',     'ActivityType',     false, 'Calls, meetings, tasks and so on.', 120),
  ('activity_status',   'Activity status',    'Sales',     'ActivityStatus',   true,  'Open, done or cancelled.', 130),
  ('priority',          'Priority',           'General',   'Priority',         true,  'Used on cases, activities and tasks. SLA policies key off it.', 140),
  ('case_type',         'Case type',          'Service',   'CaseType',         false, 'What kind of support case it is.', 200),
  ('case_source',       'Case source',        'Service',   'CaseSource',       false, 'How a case reached support.', 210),
  ('case_status',       'Case status',        'Service',   'CaseStatus',       true,  'Where a case stands.', 220),
  ('contract_status',   'Contract status',    'Contracts', 'ContractStatus',   true,  'Where a contract stands.', 300),
  ('billing_frequency', 'Billing frequency',  'Contracts', 'BillingFrequency', true,  'How often a contract bills.', 310),
  ('renewal_type',      'Renewal type',       'Contracts', 'RenewalType',      true,  'Manual or automatic renewal.', 320),
  ('project_status',    'Project status',     'Projects',  'ProjectStatus',    true,  'Where a project stands.', 400),
  ('billing_type',      'Billing type',       'Projects',  'BillingType',      true,  'How products and projects are charged.', 410),
  ('task_status',       'Task status',        'Projects',  'TaskStatus',       true,  'Where a task stands.', 420),
  ('task_type',         'Task type',          'Projects',  null,               false, 'The kind of work a project task is.', 430),
  ('task_category',     'Task category',      'Projects',  null,               true,  'Implementation or Training. Drives the project and deal cost totals.', 440),
  ('risk_level',        'Risk level',         'Projects',  'RiskLevel',        true,  'Probability and impact of project risks.', 450),
  ('payment_method',    'Payment method',     'Finance',   'PaymentMethod',    false, 'How money is paid or received.', 500),
  ('user_status',       'User status',        'People',    'UserStatus',       true,  'Whether a user can sign in.', 600);

-- Enum-backed lists are seeded from the enum itself, in its declared order,
-- labelled the way the app's humanize() prints them.
insert into public.picklist_value ("picklistKey", value, label, "sortOrder")
select p.key, e.enumlabel, initcap(replace(lower(e.enumlabel), '_', ' ')), (e.enumsortorder * 10)::int
from public.picklist p
join pg_type t on t.typname = p."enumType" and t.typnamespace = 'public'::regnamespace
join pg_enum e on e.enumtypid = t.oid
where p."enumType" is not null;

-- Text-backed lists: the values the forms used to hard-code.
insert into public.picklist_value ("picklistKey", value, label, "sortOrder")
select list, v, v, ord * 10
from (values
  ('lead_source', array['Website','Referral','Partner','Campaign','Cold Call','Trade Show','Social Media','Inbound Email','Other']),
  ('industry',    array['Manufacturing','Textiles','Retail','Logistics','Healthcare','Education','Financial Services','Government','IT Services','Other']),
  ('task_type',   array['Installation','Configuration','Customization','Data Migration','Testing','Deployment','Training','Support'])
) as s(list, vals),
lateral unnest(vals) with ordinality as u(v, ord);

insert into public.picklist_value ("picklistKey", value, label, "sortOrder") values
  ('task_category', 'IMPLEMENTATION', 'Implementation', 10),
  ('task_category', 'TRAINING',       'Training',       20);

-- Values already in use on records but not in the default lists, so nothing
-- that exists today disappears from its own dropdown.
insert into public.picklist_value ("picklistKey", value, label, "sortOrder")
select 'lead_source', s, s, 900 from (
  select distinct btrim("leadSource") s from public.lead where nullif(btrim("leadSource"), '') is not null
  union
  select distinct btrim("leadSource") from public.opportunity where nullif(btrim("leadSource"), '') is not null
) x where length(s) <= 100
on conflict ("picklistKey", value) do nothing;

insert into public.picklist_value ("picklistKey", value, label, "sortOrder")
select 'industry', s, s, 900 from (
  select distinct btrim(industry) s from public.account where nullif(btrim(industry), '') is not null
  union
  select distinct btrim(industry) from public.lead where nullif(btrim(industry), '') is not null
) x where length(s) <= 100
on conflict ("picklistKey", value) do nothing;

/**
 * Adds a value to an open list. For an enum-backed list the enum is extended
 * too, so the column accepts the new value. Administrators only.
 */
create or replace function add_picklist_value(p_list text, p_value text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_list picklist%rowtype;
  v_value text := btrim(p_value);
  v_label text := btrim(p_label);
  v_row picklist_value%rowtype;
begin
  if not (app_is_internal() and app_has_permission('admin:*')) then
    raise exception 'Only an administrator can change dropdown values.' using errcode = '42501';
  end if;

  select * into v_list from picklist where key = p_list;
  if not found then raise exception 'Unknown list.'; end if;
  if v_list.locked then
    raise exception '% is a workflow list. Its values can be renamed or hidden, but not added.', v_list.label;
  end if;
  if coalesce(v_value, '') = '' or coalesce(v_label, '') = '' then
    raise exception 'Give the value a name.';
  end if;

  if v_list."enumType" is not null then
    -- Enum values are codes: upper case with underscores.
    v_value := upper(regexp_replace(v_value, '[^A-Za-z0-9]+', '_', 'g'));
    v_value := btrim(v_value, '_');
    if v_value = '' then raise exception 'Give the value a name.'; end if;
    execute format('alter type %I add value if not exists %L', v_list."enumType", v_value);
  end if;

  insert into picklist_value ("picklistKey", value, label, "sortOrder")
  values (p_list, v_value, v_label,
          coalesce((select max("sortOrder") from picklist_value where "picklistKey" = p_list), 0) + 10)
  on conflict ("picklistKey", value) do update set active = true, label = excluded.label, "updatedAt" = now()
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

/**
 * Removes a value from an open list. Records already using it keep it; it just
 * stops being offered. Postgres cannot drop an enum value, so for an
 * enum-backed list this removes it from the dropdown only.
 */
create or replace function delete_picklist_value(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_locked boolean;
begin
  if not (app_is_internal() and app_has_permission('admin:*')) then
    raise exception 'Only an administrator can change dropdown values.' using errcode = '42501';
  end if;
  select p.locked into v_locked from picklist_value v join picklist p on p.key = v."picklistKey" where v.id = p_id;
  if v_locked then
    raise exception 'Workflow values cannot be deleted. Hide it instead.';
  end if;
  delete from picklist_value where id = p_id;
end $$;

revoke all on function add_picklist_value(text, text, text) from public, anon;
revoke all on function delete_picklist_value(uuid) from public, anon;
grant execute on function add_picklist_value(text, text, text) to authenticated;
grant execute on function delete_picklist_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Price books
-- ---------------------------------------------------------------------------

create table public.price_book (
  id                uuid primary key default gen_random_uuid(),
  "productId"       uuid not null references public.product(id) on delete cascade,
  name              varchar(100) not null check (name = btrim(name) and length(name) >= 1),
  description       text,
  "currencyCode"    char(3) not null default 'PKR' references public.currency(code),
  "licenseCost"     decimal(18,2) not null default 0 check ("licenseCost" >= 0),
  "maintenanceCost" decimal(18,2) not null default 0 check ("maintenanceCost" >= 0),
  "cloudCost"       decimal(18,2) not null default 0 check ("cloudCost" >= 0),
  "aiCost"          decimal(18,2) not null default 0 check ("aiCost" >= 0),
  "validFrom"       date,
  "validTo"         date,
  active            boolean not null default true,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now(),
  "deletedAt"       timestamptz,
  check ("validTo" is null or "validFrom" is null or "validTo" >= "validFrom")
);
create unique index price_book_product_name_key on public.price_book ("productId", lower(name)) where "deletedAt" is null;
create index price_book_product_idx on public.price_book ("productId");

alter table public.price_book enable row level security;
create policy price_book_read on public.price_book for select to authenticated using (app_is_internal());
create policy price_book_write on public.price_book for all to authenticated
  using (app_can_write() and app_has_permission('opportunity:write'))
  with check (app_can_write() and app_has_permission('opportunity:write'));
grant select, insert, update, delete on public.price_book to authenticated;
grant all on public.price_book to service_role;

-- ---------------------------------------------------------------------------
-- 3. Opportunity costing
-- ---------------------------------------------------------------------------

alter table public.opportunity
  add column "productId"          uuid references public.product(id) on delete set null,
  add column "priceBookId"        uuid references public.price_book(id) on delete set null,
  add column "licenseCost"        decimal(18,2) not null default 0,
  add column "maintenanceCost"    decimal(18,2) not null default 0,
  add column "cloudCost"          decimal(18,2) not null default 0,
  add column "aiCost"             decimal(18,2) not null default 0,
  add column "implementationCost" decimal(18,2) not null default 0,
  add column "trainingCost"       decimal(18,2) not null default 0,
  add column "discountPercent"    decimal(5,2)  not null default 0
    check ("discountPercent" >= 0 and "discountPercent" <= 100);

alter table public.opportunity
  add column "totalAmount" decimal(18,2) generated always as (
    round(
      ("licenseCost" + "maintenanceCost" + "cloudCost" + "aiCost" + "implementationCost" + "trainingCost")
      * (1 - "discountPercent" / 100), 2)
  ) stored;
create index opportunity_product_id_idx on public.opportunity ("productId");
create index opportunity_price_book_idx on public.opportunity ("priceBookId");

-- ---------------------------------------------------------------------------
-- 4. Project and task costing
-- ---------------------------------------------------------------------------

alter table public.project_task
  add column "taskType"       varchar(100),
  add column "taskCategory"   varchar(30),
  add column rate             decimal(18,2) check (rate is null or rate >= 0),
  add column "discountAmount" decimal(18,2) check ("discountAmount" is null or "discountAmount" >= 0);

alter table public.project_task
  add column "lineTotal" decimal(18,2) generated always as (
    round(coalesce("estimatedHours", 0) * coalesce(rate, 0) - coalesce("discountAmount", 0), 2)
  ) stored;

alter table public.project
  add column "implementationTotal" decimal(18,2) not null default 0,
  add column "trainingTotal"       decimal(18,2) not null default 0;

/** Re-sums one project's category totals from its tasks. Cancelled work is not charged. */
create or replace function recalc_project_cost_totals(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_project is null then return; end if;
  update project p set
    "implementationTotal" = coalesce((select sum(t."lineTotal") from project_task t
        where t."projectId" = p_project and t."taskCategory" = 'IMPLEMENTATION' and t.status <> 'CANCELLED'), 0),
    "trainingTotal" = coalesce((select sum(t."lineTotal") from project_task t
        where t."projectId" = p_project and t."taskCategory" = 'TRAINING' and t.status <> 'CANCELLED'), 0)
  where p.id = p_project;
end $$;

/** Copies the totals of every live project on a deal onto the deal. */
create or replace function recalc_opportunity_project_costs(p_opportunity uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_opportunity is null then return; end if;
  update opportunity o set
    "implementationCost" = coalesce((select sum(p."implementationTotal") from project p
        where p."opportunityId" = p_opportunity and p."deletedAt" is null), 0),
    "trainingCost" = coalesce((select sum(p."trainingTotal") from project p
        where p."opportunityId" = p_opportunity and p."deletedAt" is null), 0),
    "updatedAt" = now()
  where o.id = p_opportunity;
end $$;

create or replace function project_task_cost_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform recalc_project_cost_totals(old."projectId");
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new."projectId" is distinct from old."projectId") then
    perform recalc_project_cost_totals(new."projectId");
  end if;
  return null;
end $$;

create trigger project_task_cost_totals
  after insert or delete or update of "estimatedHours", rate, "discountAmount", "taskCategory", status, "projectId"
  on public.project_task
  for each row execute function project_task_cost_trigger();

create or replace function project_cost_to_opportunity_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform recalc_opportunity_project_costs(old."opportunityId");
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new."opportunityId" is distinct from old."opportunityId") then
    perform recalc_opportunity_project_costs(new."opportunityId");
  end if;
  return null;
end $$;

create trigger project_cost_to_opportunity
  after insert or delete or update of "implementationTotal", "trainingTotal", "opportunityId", "deletedAt"
  on public.project
  for each row execute function project_cost_to_opportunity_trigger();

revoke all on function recalc_project_cost_totals(uuid) from public, anon, authenticated;
revoke all on function recalc_opportunity_project_costs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Project from a won deal
-- ---------------------------------------------------------------------------

/**
 * Creates the delivery project for a won deal that sold a product.
 *
 * Security definer because the person closing a deal is usually in sales and
 * does not hold project:manage - the project should exist anyway. It is only
 * ever created from a deal the caller can already write, that is Closed Won,
 * has a product, and has no live project yet. Returns null when there is
 * nothing to do.
 */
create or replace function create_project_for_won_opportunity(p_opportunity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_opp opportunity%rowtype;
  v_project jsonb;
begin
  if not (app_is_internal() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or v_opp.stage <> 'CLOSED_WON' or v_opp."productId" is null then
    return null;
  end if;
  if exists (select 1 from project where "opportunityId" = p_opportunity and "deletedAt" is null) then
    return null;
  end if;

  v_project := create_record('project', jsonb_build_object(
    'name', v_opp.name,
    'projectType', 'CUSTOMER',
    'accountId', v_opp."accountId",
    'opportunityId', v_opp.id,
    'productId', v_opp."productId",
    'projectManagerId', v_opp."ownerUserId",
    'status', 'PLANNING',
    'health', 'GREEN',
    'billingType', 'FIXED',
    'contractValue', v_opp."totalAmount",
    'currencyCode', v_opp."currencyCode",
    'startDate', current_date,
    'updatedAt', now()
  ), 'projectNumber', 'Project');

  -- The deal owner starts as project manager, as create_project does, so the
  -- project has someone who can open it and book the team.
  insert into project_member(id,"projectId","userId","projectRole","allocationPercent","startDate","billingRate","costRate",active,"createdAt","updatedAt")
  select gen_random_uuid(), (v_project->>'id')::uuid, u.id, 'Project Manager', 50, current_date,
         u."defaultBillingRate", u."costRate", true, now(), now()
  from app_user u where u.id = v_opp."ownerUserId";

  return v_project;
end $$;

revoke all on function create_project_for_won_opportunity(uuid) from public, anon;
grant execute on function create_project_for_won_opportunity(uuid) to authenticated;
