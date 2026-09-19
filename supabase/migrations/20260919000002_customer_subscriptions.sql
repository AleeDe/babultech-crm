-- What a customer actually agreed to, as opposed to what the catalogue costs.
--
-- Product plans priced the catalogue. Contracts drove recurring billing. The
-- layer between them was missing: a customer's own agreement to a plan, at a
-- negotiated price, for a quantity, with its own dates and renewal terms.
--
-- Without it, "BabulPOS, per user, per month" lived only on a quotation. If the
-- customer went from ten users to fifteen, or paused for two months, nothing
-- recorded it and nothing billed it.
--
-- WHY THE PLAN IS COPIED, NOT REFERENCED
--
-- The plan is stored as a snapshot. A catalogue price change must never rewrite
-- what an existing customer is paying; that is the whole reason a customer
-- agreement exists separately from a price list.
--
-- WHOLE PERIODS, NOT PRORATION
--
-- A period bills the quantity in force on the day it started. Adding users
-- mid-month takes effect from the next period. Quantity changes are recorded
-- with their effective date so the history is intact if proration is ever
-- agreed, but nothing here charges a part period: a wrong proration asks the
-- customer for the wrong money, which is worse than not prorating at all.

create table if not exists customer_subscription (
  id uuid primary key,
  "subscriptionNumber" text not null unique,
  "accountId" uuid not null references account(id),
  "productId" uuid not null references product(id),
  -- The agreed plan as it stood, not a pointer to today's catalogue.
  plan jsonb not null,
  quantity integer not null check (quantity between 1 and 100000),
  "unitPrice" numeric(18,2) not null check ("unitPrice" >= 0),
  "currencyCode" char(3) not null references currency(code),
  "billingFrequency" text not null check ("billingFrequency" in ('MONTHLY','QUARTERLY','ANNUAL')),
  "startDate" date not null,
  -- Null runs until somebody cancels it.
  "endDate" date,
  "autoRenew" boolean not null default true,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','ACTIVE','PAUSED','CANCELLED','ENDED')),
  -- The last period start that has been invoiced. Null means nothing yet.
  "billedThrough" date,
  notes text,
  "createdById" uuid not null references app_user(id),
  "createdAt" timestamptz not null default now(),
  "updatedById" uuid references app_user(id),
  "updatedAt" timestamptz not null default now(),
  "deletedAt" timestamptz,
  constraint subscription_dates check ("endDate" is null or "endDate" >= "startDate")
);

create index if not exists subscription_account on customer_subscription("accountId", status);
create index if not exists subscription_due on customer_subscription(status, "billedThrough")
  where "deletedAt" is null;

-- Quantity over time. Each row is what the quantity became, and when.
create table if not exists subscription_quantity_change (
  id uuid primary key,
  "subscriptionId" uuid not null references customer_subscription(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 100000),
  "effectiveFrom" date not null,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  "changedById" uuid not null references app_user(id),
  "createdAt" timestamptz not null default now(),
  -- One change per subscription per date: two answers for the same day would
  -- make the billed quantity ambiguous.
  unique ("subscriptionId", "effectiveFrom")
);

-- Status over time, so a pause or cancellation says who and why.
create table if not exists subscription_status_change (
  id uuid primary key,
  "subscriptionId" uuid not null references customer_subscription(id) on delete cascade,
  "fromStatus" text not null,
  "toStatus" text not null,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  "changedById" uuid not null references app_user(id),
  "createdAt" timestamptz not null default now()
);

create index if not exists subscription_status_history on subscription_status_change("subscriptionId", "createdAt" desc);

-- The invoice covers a subscription period. Alongside the unique index below,
-- this is what stops a retried billing run charging the same period twice.
alter table invoice add column if not exists "subscriptionId" uuid references customer_subscription(id);

create unique index if not exists invoice_subscription_period
  on invoice("subscriptionId", "periodStart")
  where "subscriptionId" is not null and "periodStart" is not null
    and "deletedAt" is null and status <> 'CANCELLED';

-- ------------------------------------------------------------------ access

alter table customer_subscription enable row level security;
alter table subscription_quantity_change enable row level security;
alter table subscription_status_change enable row level security;

revoke all on customer_subscription, subscription_quantity_change, subscription_status_change
  from public, anon, authenticated;
grant select on customer_subscription, subscription_quantity_change, subscription_status_change
  to authenticated;

-- A subscription is commercial customer data: it follows account visibility,
-- the same way contracts and invoices do.
drop policy if exists subscription_read on customer_subscription;
create policy subscription_read on customer_subscription for select to authenticated
  using (
    app_is_internal() and (
      app_current_scope() = 'ALL'
      or "accountId" in (select app_visible_account_ids())
    )
  );

drop policy if exists subscription_quantity_read on subscription_quantity_change;
create policy subscription_quantity_read on subscription_quantity_change for select to authenticated
  using (exists (select 1 from customer_subscription s where s.id = "subscriptionId"));

drop policy if exists subscription_status_read on subscription_status_change;
create policy subscription_status_read on subscription_status_change for select to authenticated
  using (exists (select 1 from customer_subscription s where s.id = "subscriptionId"));

-- No write policies. Every change goes through the functions below, which check
-- authority and keep the history rows in step with the subscription.

-- ------------------------------------------------------------------ writing

-- Managing customer agreements is a commercial act, so it follows the
-- opportunity/quotation authority rather than the receivables one.
create or replace function app_can_manage_subscriptions()
returns boolean
language sql stable security definer set search_path = public as $$
  select app_is_internal() and app_has_permission('opportunity:write');
$$;
revoke all on function app_can_manage_subscriptions() from public, anon;
grant execute on function app_can_manage_subscriptions() to authenticated;

create or replace function save_customer_subscription(
  p_id uuid, p_account uuid, p_product uuid, p_plan jsonb, p_quantity integer,
  p_unit_price numeric, p_currency char(3), p_frequency text,
  p_start date, p_end date, p_auto_renew boolean, p_notes text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare existing customer_subscription%rowtype; actor uuid := app_current_user_id(); seq text;
begin
  if actor is null or not app_can_manage_subscriptions() then
    raise exception 'Managing customer subscriptions requires commercial authority' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'A subscription covers at least one unit' using errcode = '22023'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'Enter the agreed price' using errcode = '22023'; end if;
  if p_frequency is null or p_frequency not in ('MONTHLY','QUARTERLY','ANNUAL') then
    raise exception 'Choose a recurring billing frequency' using errcode = '22023';
  end if;
  if p_start is null then raise exception 'Choose a start date' using errcode = '22023'; end if;
  if p_end is not null and p_end < p_start then raise exception 'A subscription cannot end before it starts' using errcode = '22023'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or coalesce(trim(p_plan->>'name'),'') = '' then
    raise exception 'Choose the plan the customer agreed to' using errcode = '22023';
  end if;
  if not exists (select 1 from account where id = p_account and "deletedAt" is null) then
    raise exception 'That customer no longer exists' using errcode = '22023';
  end if;

  select * into existing from customer_subscription where id = p_id for update;
  if found then
    -- Commercial terms are what the customer agreed to. Once it is live they
    -- change through a quantity change or a new agreement, not by editing.
    if existing.status <> 'DRAFT' then
      raise exception 'Only a draft subscription can be edited. Record a quantity change instead.' using errcode = '22023';
    end if;
    update customer_subscription set
      "accountId" = p_account, "productId" = p_product, plan = p_plan, quantity = p_quantity,
      "unitPrice" = p_unit_price, "currencyCode" = p_currency, "billingFrequency" = p_frequency,
      "startDate" = p_start, "endDate" = p_end, "autoRenew" = coalesce(p_auto_renew, true),
      notes = nullif(trim(coalesce(p_notes,'')),''), "updatedById" = actor, "updatedAt" = now()
    where id = p_id;
    return p_id;
  end if;

  seq := 'SUB-' || to_char(now(), 'YYYY') || '-' || lpad((
    coalesce((select max(substring("subscriptionNumber" from '\d+$')::int)
              from customer_subscription
              where "subscriptionNumber" like 'SUB-' || to_char(now(), 'YYYY') || '-%'), 0) + 1
  )::text, 5, '0');

  insert into customer_subscription(
    id, "subscriptionNumber", "accountId", "productId", plan, quantity, "unitPrice",
    "currencyCode", "billingFrequency", "startDate", "endDate", "autoRenew", notes, "createdById")
  values (p_id, seq, p_account, p_product, p_plan, p_quantity, p_unit_price,
    p_currency, p_frequency, p_start, p_end, coalesce(p_auto_renew, true),
    nullif(trim(coalesce(p_notes,'')),''), actor);
  return p_id;
end $$;
revoke all on function save_customer_subscription(uuid,uuid,uuid,jsonb,integer,numeric,char,text,date,date,boolean,text) from public, anon;
grant execute on function save_customer_subscription(uuid,uuid,uuid,jsonb,integer,numeric,char,text,date,date,boolean,text) to authenticated;

create or replace function change_subscription_quantity(
  p_id uuid, p_subscription uuid, p_quantity integer, p_effective date, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s customer_subscription%rowtype; actor uuid := app_current_user_id();
begin
  if actor is null or not app_can_manage_subscriptions() then
    raise exception 'Changing a subscription requires commercial authority' using errcode = '42501';
  end if;
  select * into s from customer_subscription where id = p_subscription for update;
  if not found or s."deletedAt" is not null then raise exception 'That subscription no longer exists' using errcode = '22023'; end if;
  if s.status in ('CANCELLED','ENDED') then
    raise exception 'A closed subscription cannot change quantity' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'A subscription covers at least one unit' using errcode = '22023'; end if;
  if p_effective is null or p_effective < s."startDate" then
    raise exception 'A change cannot take effect before the subscription starts' using errcode = '22023';
  end if;
  if s."endDate" is not null and p_effective > s."endDate" then
    raise exception 'A change cannot take effect after the subscription ends' using errcode = '22023';
  end if;
  -- Changing a period already invoiced would make the invoice wrong after the
  -- fact. Credit or re-issue that invoice instead.
  if s."billedThrough" is not null and p_effective <= s."billedThrough" then
    raise exception 'That period has already been invoiced. Apply the change from a later date.' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Say why the quantity is changing' using errcode = '22023'; end if;

  insert into subscription_quantity_change(id, "subscriptionId", quantity, "effectiveFrom", reason, "changedById")
  values (p_id, p_subscription, p_quantity, p_effective, trim(p_reason), actor)
  on conflict ("subscriptionId", "effectiveFrom") do update
    set quantity = excluded.quantity, reason = excluded.reason,
        "changedById" = excluded."changedById", "createdAt" = now();
  return p_id;
end $$;
revoke all on function change_subscription_quantity(uuid,uuid,integer,date,text) from public, anon;
grant execute on function change_subscription_quantity(uuid,uuid,integer,date,text) to authenticated;

create or replace function set_subscription_status(p_subscription uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare s customer_subscription%rowtype; actor uuid := app_current_user_id(); allowed text[];
begin
  if actor is null or not app_can_manage_subscriptions() then
    raise exception 'Changing a subscription requires commercial authority' using errcode = '42501';
  end if;
  select * into s from customer_subscription where id = p_subscription for update;
  if not found or s."deletedAt" is not null then raise exception 'That subscription no longer exists' using errcode = '22023'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Say why' using errcode = '22023'; end if;

  allowed := case s.status
    when 'DRAFT' then array['ACTIVE','CANCELLED']
    when 'ACTIVE' then array['PAUSED','CANCELLED','ENDED']
    when 'PAUSED' then array['ACTIVE','CANCELLED','ENDED']
    else array[]::text[] end;

  if not (p_status = any(allowed)) then
    raise exception 'A % subscription cannot become %', lower(s.status), lower(coalesce(p_status,'nothing')) using errcode = '22023';
  end if;

  insert into subscription_status_change(id, "subscriptionId", "fromStatus", "toStatus", reason, "changedById")
  values (gen_random_uuid(), p_subscription, s.status, p_status, trim(p_reason), actor);

  update customer_subscription
  set status = p_status, "updatedById" = actor, "updatedAt" = now()
  where id = p_subscription;
end $$;
revoke all on function set_subscription_status(uuid,text,text) from public, anon;
grant execute on function set_subscription_status(uuid,text,text) to authenticated;

-- Billing marks periods as invoiced. Separate from the drafting itself so the
-- application cannot advance the marker without an invoice existing.
create or replace function mark_subscription_billed(p_subscription uuid, p_period_start date)
returns void
language plpgsql security definer set search_path = public as $$
declare s customer_subscription%rowtype;
begin
  if not app_is_internal() or not app_has_permission('invoice:write') then
    raise exception 'Billing requires invoice drafting authority' using errcode = '42501';
  end if;
  select * into s from customer_subscription where id = p_subscription for update;
  if not found then raise exception 'That subscription no longer exists' using errcode = '22023'; end if;
  if not exists (
    select 1 from invoice
    where "subscriptionId" = p_subscription and "periodStart" = p_period_start
      and "deletedAt" is null and status <> 'CANCELLED'
  ) then
    raise exception 'No live invoice exists for that period' using errcode = '22023';
  end if;
  -- Only ever moves forward, so a late run cannot rewind the marker and
  -- re-bill periods that are already invoiced.
  update customer_subscription
  set "billedThrough" = greatest(coalesce("billedThrough", p_period_start), p_period_start),
      "updatedAt" = now()
  where id = p_subscription;
end $$;
revoke all on function mark_subscription_billed(uuid,date) from public, anon;
grant execute on function mark_subscription_billed(uuid,date) to authenticated;

NOTIFY pgrst, 'reload schema';
