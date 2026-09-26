-- The opportunity is priced by its lines, and the lines set the project.
--
-- Before this, a deal carried one product, one price book and six cost fields,
-- and two unrelated totals: "amount", which somebody typed and commission paid
-- on, and "totalAmount", calculated from the costs. A deal could read 10 and
-- calculate 0. Implementation and training costs flowed UP from project tasks
-- into the deal, so a project manager's estimate, made after the sale, was
-- setting the sale price.
--
-- Now the direction is one way:
--
--   price book entry  ->  opportunity line  ->  opportunity amount
--                                          ->  (won) project task, in hours
--
-- What was sold decides what is delivered, never the other way round.

-- ---------------------------------------------------------------------------
-- 1. Line items gain the four costs, and compute their own total
-- ---------------------------------------------------------------------------

alter table opportunity_product
  alter column id set default gen_random_uuid(),
  alter column "updatedAt" set default now();

alter table opportunity_product
  add column if not exists "priceBookEntryId" uuid
    references price_book_entry (id) on delete set null,
  add column if not exists "licenseCost"     decimal(18,2) not null default 0 check ("licenseCost" >= 0),
  add column if not exists "maintenanceCost" decimal(18,2) not null default 0 check ("maintenanceCost" >= 0),
  add column if not exists "cloudCost"       decimal(18,2) not null default 0 check ("cloudCost" >= 0),
  add column if not exists "aiCost"          decimal(18,2) not null default 0 check ("aiCost" >= 0),
  -- The tax rate AS IT WAS when the line was priced. Reading the live rate
  -- would let a change to GST quietly re-price every open deal.
  add column if not exists "taxPercent" decimal(8,4) not null default 0 check ("taxPercent" >= 0);

alter table opportunity_product
  drop constraint if exists opportunity_product_amounts_check;
alter table opportunity_product
  add constraint opportunity_product_amounts_check check (
    quantity >= 0 and "unitPrice" >= 0
    and coalesce("discountPercent", 0) between 0 and 100
  );

-- The agreed formula:
--
--   base      = quantity x unit price + licence + maintenance + cloud + AI
--   net       = base less discount %
--   line total = net plus tax %
--
-- Generated, so a line's total cannot disagree with its own fields. Net is kept
-- as well because it is the figure BEFORE tax - the one anybody asking "what
-- did we sell" actually means.
alter table opportunity_product drop column if exists "lineTotal";

alter table opportunity_product
  add column "netTotal" decimal(18,2) generated always as (
    round(
      (quantity * "unitPrice" + "licenseCost" + "maintenanceCost" + "cloudCost" + "aiCost")
      * (1 - coalesce("discountPercent", 0) / 100),
    2)
  ) stored,
  add column "lineTotal" decimal(18,2) generated always as (
    round(
      (quantity * "unitPrice" + "licenseCost" + "maintenanceCost" + "cloudCost" + "aiCost")
      * (1 - coalesce("discountPercent", 0) / 100)
      * (1 + "taxPercent" / 100),
    2)
  ) stored;

create index if not exists opportunity_product_opp_idx on opportunity_product ("opportunityId");
create index if not exists opportunity_product_entry_idx on opportunity_product ("priceBookEntryId");

-- ---------------------------------------------------------------------------
-- 2. Line rules: tax snapshot, and one price book per deal
-- ---------------------------------------------------------------------------

create or replace function opportunity_line_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book  uuid;
  v_entry_book uuid;
begin
  -- Snapshot the rate whenever the tax chosen changes.
  if tg_op = 'INSERT' or new."taxRateId" is distinct from old."taxRateId" then
    select coalesce(("ratePercent"), 0) into new."taxPercent"
    from tax_rate where id = new."taxRateId";
    new."taxPercent" := coalesce(new."taxPercent", 0);
  end if;

  -- A line priced from a book must be priced from THIS deal's book. Two books
  -- on one deal would make its prices a mix of two years' rates.
  if new."priceBookEntryId" is not null then
    select "priceBookId" into v_entry_book from price_book_entry where id = new."priceBookEntryId";
    select "priceBookId" into v_book from opportunity where id = new."opportunityId";

    if v_book is null then
      update opportunity set "priceBookId" = v_entry_book, "updatedAt" = now()
      where id = new."opportunityId";
    elsif v_book <> v_entry_book then
      raise exception
        'This deal is priced from a different price book. One price book per deal.'
        using errcode = '23514';
    end if;
  end if;

  -- Only active items can be sold. An inactive one already on a deal stays -
  -- this only stops new lines, and changing a line's product to one.
  if (tg_op = 'INSERT' or new."productId" is distinct from old."productId")
     and not exists (select 1 from product where id = new."productId" and active and "deletedAt" is null) then
    raise exception 'That product or service is not active.' using errcode = '23514';
  end if;

  new."updatedAt" := now();
  return new;
end $$;

revoke all on function opportunity_line_guard() from public, anon, authenticated;

drop trigger if exists opportunity_line_guard_trg on opportunity_product;
create trigger opportunity_line_guard_trg
  before insert or update on opportunity_product
  for each row execute function opportunity_line_guard();

-- The book is locked while the deal has lines. To change books, remove the
-- lines first, so no deal ends up priced partly from each.
create or replace function opportunity_book_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new."priceBookId" is distinct from old."priceBookId"
     and exists (select 1 from opportunity_product where "opportunityId" = new.id) then
    raise exception
      'This deal already has products priced from its price book. Remove them before choosing a different book.'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists opportunity_book_locked_trg on opportunity;
create trigger opportunity_book_locked_trg
  before update of "priceBookId" on opportunity
  for each row execute function opportunity_book_locked();

-- ---------------------------------------------------------------------------
-- 3. The deal's amount is the sum of its lines
-- ---------------------------------------------------------------------------
--
-- "amount" is kept as THE figure, because commission, the pipeline and the
-- partner portal all read it. It becomes derived: once a deal has lines, it is
-- their total and nothing else. netAmount and taxAmount sit beside it so the
-- figure before tax is always available.

alter table opportunity
  add column if not exists "netAmount" decimal(18,2) not null default 0,
  add column if not exists "taxAmount" decimal(18,2) not null default 0,
  -- Set the first time a line is added, and never cleared. Inferring it from
  -- the totals would get it wrong for a deal whose lines were all priced at
  -- zero: removing the last one would bring back an amount typed long ago.
  add column if not exists "pricedByLines" boolean not null default false;

create or replace function recalc_opportunity_amount(p_opportunity uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines integer;
  v_net   numeric;
  v_total numeric;
begin
  if p_opportunity is null then return; end if;

  select count(*), coalesce(sum("netTotal"), 0), coalesce(sum("lineTotal"), 0)
    into v_lines, v_net, v_total
  from opportunity_product where "opportunityId" = p_opportunity;

  -- A deal that has never had lines keeps whatever amount was entered. Once it
  -- has lines, the lines are the only source - including going back to zero
  -- when the last one is removed.
  update opportunity set
    amount      = case when v_lines > 0 or "pricedByLines" then v_total else amount end,
    "pricedByLines" = "pricedByLines" or v_lines > 0,
    "netAmount" = v_net,
    "taxAmount" = v_total - v_net,
    "updatedAt" = now()
  where id = p_opportunity;
end $$;

revoke all on function recalc_opportunity_amount(uuid) from public, anon, authenticated;

create or replace function opportunity_line_totals_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform recalc_opportunity_amount(old."opportunityId");
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform recalc_opportunity_amount(new."opportunityId");
  end if;
  return null;
end $$;

revoke all on function opportunity_line_totals_trigger() from public, anon, authenticated;

drop trigger if exists opportunity_line_totals on opportunity_product;
create trigger opportunity_line_totals
  after insert or update or delete on opportunity_product
  for each row execute function opportunity_line_totals_trigger();

-- ---------------------------------------------------------------------------
-- 4. The old pricing, removed
-- ---------------------------------------------------------------------------
--
-- Every function that read these has been found by searching function bodies,
-- which dependency tracking does not cover; the four that did are replaced or
-- dropped below.

drop trigger if exists project_task_cost_totals on project_task;
drop trigger if exists project_cost_to_opportunity on project;
drop function if exists project_task_cost_trigger();
drop function if exists project_cost_to_opportunity_trigger();
drop function if exists recalc_project_cost_totals(uuid);
drop function if exists recalc_opportunity_project_costs(uuid);

drop index if exists opportunity_product_id_idx;

alter table opportunity
  drop column if exists "totalAmount",
  drop column if exists "productId",
  drop column if exists "licenseCost",
  drop column if exists "maintenanceCost",
  drop column if exists "cloudCost",
  drop column if exists "aiCost",
  drop column if exists "implementationCost",
  drop column if exists "trainingCost",
  drop column if exists "discountPercent";

alter table project_task
  drop column if exists "lineTotal",
  drop column if exists rate,
  drop column if exists "discountAmount",
  drop column if exists "taskCategory";

alter table project
  drop column if exists "implementationTotal",
  drop column if exists "trainingTotal";

-- The category list described the flow that has gone.
delete from picklist_value where "picklistKey" = 'task_category';
delete from picklist where key = 'task_category';

-- ---------------------------------------------------------------------------
-- 5. Tasks remember what was sold
-- ---------------------------------------------------------------------------

alter table project_task
  add column if not exists "opportunityProductId" uuid
    references opportunity_product (id) on delete set null,
  -- The hours the customer bought. Kept apart from estimatedHours, which is
  -- the project manager's plan and may change; this one is the contract.
  add column if not exists "soldHours" decimal(18,2) check ("soldHours" is null or "soldHours" >= 0),
  -- The rate the customer agreed. Time on this task is billed at it.
  add column if not exists "soldRate" decimal(18,2) check ("soldRate" is null or "soldRate" >= 0);

-- One task per sold line, so a sync can never create the same task twice.
create unique index if not exists project_task_sold_line_key
  on project_task ("opportunityProductId") where "opportunityProductId" is not null;

-- ---------------------------------------------------------------------------
-- 6. A won deal needs something on it
-- ---------------------------------------------------------------------------

create or replace function guard_won_deal_has_product()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage = 'CLOSED_WON'
     and coalesce(old.stage::text, '') <> 'CLOSED_WON'
     and not exists (select 1 from opportunity_product where "opportunityId" = new.id) then
    raise exception
      'A won deal needs at least one product or service. Add what is being sold, then close it - the delivery project and its tasks are created from those lines.'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Tasks from the lines
-- ---------------------------------------------------------------------------
--
-- A line becomes a task when its item is a SERVICE flagged Add in Task. Its
-- quantity is then a number of hours - which is exactly what the flag means,
-- and why it can never be set on a product.
--
-- Shared by project creation and by Sync from deal. It only ever ADDS: a line
-- that already has a task is skipped, and nothing a project manager changed on
-- an existing task is touched.
create or replace function add_tasks_from_opportunity_lines(p_project uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp   uuid;
  v_added integer;
begin
  select "opportunityId" into v_opp from project where id = p_project and "deletedAt" is null;
  if v_opp is null then return 0; end if;

  insert into project_task (
    id, "projectId", name, description, status, priority,
    "estimatedHours", "soldHours", "soldRate", "taskType",
    "opportunityProductId", billable, "sortOrder", "createdAt", "updatedAt"
  )
  select
    gen_random_uuid(), p_project, pr.name,
    coalesce(nullif(btrim(l.description), ''), 'Sold on the deal as ' || trim(to_char(l.quantity, 'FM999999990.##')) || ' hours.'),
    'NOT_STARTED', 'MEDIUM',
    l.quantity, l.quantity, l."unitPrice",
    -- The task type where the service's name is one of the listed types -
    -- Installation, Deployment, Training - and left blank otherwise, rather
    -- than guessed.
    (select v.value from picklist_value v
      where v."picklistKey" = 'task_type' and lower(v.label) = lower(pr.name) limit 1),
    l.id, true, l."sortOrder", now(), now()
  from opportunity_product l
  join product pr on pr.id = l."productId"
  where l."opportunityId" = v_opp
    and pr."productType" = 'SERVICE'
    and pr."addInTask"
    and not exists (select 1 from project_task t where t."opportunityProductId" = l.id);

  get diagnostics v_added = row_count;

  -- The project's budget is what was sold, across every task that came from
  -- the deal.
  update project set
    "approvedHours" = coalesce((
      select sum(t."soldHours") from project_task t
      where t."projectId" = p_project and t."soldHours" is not null
    ), 0),
    "updatedAt" = now()
  where id = p_project;

  return v_added;
end $$;

revoke all on function add_tasks_from_opportunity_lines(uuid) from public, anon, authenticated;

create or replace function create_project_for_won_opportunity(p_opportunity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp opportunity%rowtype;
  v_project jsonb;
  v_first_product uuid;
begin
  if not (app_is_internal() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or v_opp.stage <> 'CLOSED_WON' then
    return null;
  end if;
  if not exists (select 1 from opportunity_product where "opportunityId" = p_opportunity) then
    return null;
  end if;
  if exists (select 1 from project where "opportunityId" = p_opportunity and "deletedAt" is null) then
    return null;
  end if;

  select "productId" into v_first_product
  from opportunity_product where "opportunityId" = p_opportunity
  order by "sortOrder", "createdAt" limit 1;

  v_project := create_record('project', jsonb_build_object(
    -- Named so a project that came from a sale reads as one in every list.
    'name', 'Project-' || v_opp.name,
    'projectType', 'CUSTOMER',
    'accountId', v_opp."accountId",
    'opportunityId', v_opp.id,
    'productId', v_first_product,
    'projectManagerId', v_opp."ownerUserId",
    'status', 'PLANNING',
    'health', 'GREEN',
    'billingType', 'FIXED',
    'contractValue', v_opp.amount,
    'currencyCode', v_opp."currencyCode",
    'startDate', current_date,
    'updatedAt', now()
  ), 'projectNumber', 'Project');

  insert into project_member(id,"projectId","userId","projectRole","allocationPercent","startDate","billingRate","costRate",active,"createdAt","updatedAt")
  select gen_random_uuid(), (v_project->>'id')::uuid, u.id, 'Project Manager', 50, current_date,
         u."defaultBillingRate", u."costRate", true, now(), now()
  from app_user u where u.id = v_opp."ownerUserId";

  perform add_tasks_from_opportunity_lines((v_project->>'id')::uuid);

  return v_project;
end $$;

revoke all on function create_project_for_won_opportunity(uuid) from public, anon;
grant execute on function create_project_for_won_opportunity(uuid) to authenticated;

-- Sync from deal: for lines added after the win.
create or replace function sync_project_from_opportunity(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_added integer;
begin
  if not (app_is_internal() and (app_has_permission('project:manage') or app_has_permission('opportunity:write'))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  v_added := add_tasks_from_opportunity_lines(p_project);
  return jsonb_build_object('added', v_added);
end $$;

revoke all on function sync_project_from_opportunity(uuid) from public, anon;
grant execute on function sync_project_from_opportunity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Time on a sold task is billed at the sold rate
-- ---------------------------------------------------------------------------
--
-- The customer agreed a rate for Training on the deal. Billing that time at
-- whoever-did-it's own rate would put a figure on the invoice nobody agreed to.
-- Cost rate is unchanged: what the work cost us is still the person's rate.
create or replace function snapshot_time_log_rates() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sold numeric;
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
    if new."projectTaskId" is not null then
      select "soldRate" into v_sold from project_task where id = new."projectTaskId";
      if v_sold is not null then new."billingRate" := v_sold; end if;
    end if;
  else
    select u."defaultBillingRate",u."costRate" into new."billingRate",new."costRate" from app_user u where u.id=new."userId";
  end if;
  new."approvedById":=null; new."approvedAt":=null; new."invoiceLineId":=null;
  return new;
end $$;
