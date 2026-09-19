-- All identities and records below are synthetic and rolled back by the runner.
create temp table sub_fixture(k text primary key, id uuid);
grant select on sub_fixture to authenticated;
insert into sub_fixture
select k, gen_random_uuid() from unnest(array[
  'sales_role','finance_role','outsider_role','sales','finance','outsider',
  'account','product','sub','change','invoice'
]) k;

insert into security_role(id, name, permissions, "dataScope", "updatedAt") values
((select id from sub_fixture where k='sales_role'), 'Sub test sales',
  array['opportunity:read','opportunity:write','account:read','invoice:read'], 'ALL', now()),
((select id from sub_fixture where k='finance_role'), 'Sub test finance',
  array['invoice:read','invoice:write','invoice:issue','account:read'], 'ALL', now()),
((select id from sub_fixture where k='outsider_role'), 'Sub test outsider',
  array['project:read'], 'ALL', now());

insert into app_user(id, "fullName", email, "roleId", status, "updatedAt")
select f.id, 'Sub test '||f.k, f.id::text||'@example.invalid',
  (select id from sub_fixture where k = f.k||'_role'), 'ACTIVE', now()
from sub_fixture f where f.k in ('sales','finance','outsider');

insert into account(id, "accountNumber", name, "accountType", "ownerUserId", "updatedAt")
select id, 'SUBT-'||left(id::text,17), 'Sub test account', 'CUSTOMER', (select id from sub_fixture where k='sales'), now()
from sub_fixture where k='account';

insert into product(id, "productCode", name, "productType", "billingType", "standardPrice", active, "updatedAt")
select id, 'SUBT-P-'||left(id::text,12), 'Sub test product', 'SUBSCRIPTION', 'MONTHLY', 500, true, now()
from sub_fixture where k='product';

-- ------------------------------------ only commercial authority may create one
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='outsider'), true);
set local role authenticated;
do $$
declare denied boolean;
begin
  denied := false;
  begin perform save_customer_subscription(
    (select id from sub_fixture where k='sub'), (select id from sub_fixture where k='account'),
    (select id from sub_fixture where k='product'),
    jsonb_build_object('id', gen_random_uuid(), 'name', 'Pro Monthly', 'billingType', 'MONTHLY', 'unitOfMeasure', 'user'),
    10, 500, 'PKR', 'MONTHLY', (current_date - interval '2 months')::date, null::date, true, null);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Someone without commercial authority created a subscription'; end if;
end $$;
reset role;

-- ----------------------------------------------- sales creates and activates one
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='sales'), true);
set local role authenticated;
do $$
declare denied boolean;
  sub uuid := (select id from sub_fixture where k='sub');
  acct uuid := (select id from sub_fixture where k='account');
  prod uuid := (select id from sub_fixture where k='product');
  plan jsonb := jsonb_build_object('id', gen_random_uuid(), 'name', 'Pro Monthly', 'billingType', 'MONTHLY', 'unitOfMeasure', 'user');
  start_on date := date_trunc('month', current_date - interval '2 months')::date;
begin
  -- Validation applies before anything is written.
  denied := false;
  begin perform save_customer_subscription(gen_random_uuid(), acct, prod, plan, 0, 500, 'PKR', 'MONTHLY', start_on, null, true, null);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A zero quantity was accepted'; end if;

  denied := false;
  begin perform save_customer_subscription(gen_random_uuid(), acct, prod, plan, 10, 500, 'PKR', 'ONE_TIME', start_on, null, true, null);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A one-off frequency was accepted as a subscription'; end if;

  denied := false;
  begin perform save_customer_subscription(gen_random_uuid(), acct, prod, plan, 10, 500, 'PKR', 'MONTHLY', start_on, start_on - 1, true, null);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'An end date before the start was accepted'; end if;

  perform save_customer_subscription(sub, acct, prod, plan, 10, 500, 'PKR', 'MONTHLY', start_on, null, true, 'Sub test');
  if not exists (select 1 from customer_subscription where id = sub and status = 'DRAFT') then
    raise exception 'The subscription was not created as a draft';
  end if;
  if not exists (select 1 from customer_subscription where id = sub and "subscriptionNumber" like 'SUB-%') then
    raise exception 'No subscription number was assigned';
  end if;

  -- Writing to the table directly is refused even for sales.
  denied := false;
  begin update customer_subscription set quantity = 999 where id = sub;
  exception when insufficient_privilege then denied := true; end;
  if exists (select 1 from customer_subscription where id = sub and quantity = 999) then
    raise exception 'A subscription was edited directly, bypassing the checks';
  end if;

  -- A draft cannot skip straight to paused.
  denied := false;
  begin perform set_subscription_status(sub, 'PAUSED', 'Straight to paused');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A draft was paused without being activated'; end if;

  perform set_subscription_status(sub, 'ACTIVE', 'Customer signed');
  if not exists (select 1 from customer_subscription where id = sub and status = 'ACTIVE') then
    raise exception 'The subscription was not activated';
  end if;
  if not exists (select 1 from subscription_status_change
                 where "subscriptionId" = sub and "fromStatus" = 'DRAFT' and "toStatus" = 'ACTIVE') then
    raise exception 'The status change was not recorded';
  end if;

  -- Once live, the commercial terms are what the customer agreed to.
  denied := false;
  begin perform save_customer_subscription(sub, acct, prod, plan, 20, 900, 'PKR', 'MONTHLY', start_on, null, true, null);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'An active subscription had its price edited'; end if;
end $$;
reset role;

-- ------------------------------------------------------------ quantity changes
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='sales'), true);
set local role authenticated;
do $$
declare denied boolean;
  sub uuid := (select id from sub_fixture where k='sub');
  start_on date := (select "startDate" from customer_subscription where id = sub);
begin
  denied := false;
  begin perform change_subscription_quantity(gen_random_uuid(), sub, 15, start_on - 10, 'Before it started');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A change took effect before the subscription started'; end if;

  denied := false;
  begin perform change_subscription_quantity(gen_random_uuid(), sub, 15, start_on + 5, '   ');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A quantity change was accepted with no reason'; end if;

  perform change_subscription_quantity((select id from sub_fixture where k='change'), sub, 15, start_on + 40, 'Added five staff');
  if not exists (select 1 from subscription_quantity_change where "subscriptionId" = sub and quantity = 15) then
    raise exception 'The quantity change was not recorded';
  end if;

  -- Re-sending the same effective date corrects it rather than creating two
  -- answers for the same day.
  perform change_subscription_quantity(gen_random_uuid(), sub, 16, start_on + 40, 'Corrected to six');
  if (select count(*) from subscription_quantity_change where "subscriptionId" = sub and "effectiveFrom" = start_on + 40) <> 1 then
    raise exception 'Two quantity changes exist for the same date';
  end if;
  if not exists (select 1 from subscription_quantity_change
                 where "subscriptionId" = sub and "effectiveFrom" = start_on + 40 and quantity = 16) then
    raise exception 'The correction did not take';
  end if;
end $$;
reset role;

-- ------------------------------------------ billing marks periods, once only
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='finance'), true);
set local role authenticated;
do $$
declare denied boolean;
  sub uuid := (select id from sub_fixture where k='sub');
  inv uuid := (select id from sub_fixture where k='invoice');
  acct uuid := (select id from sub_fixture where k='account');
  start_on date := (select "startDate" from customer_subscription where id = sub);
begin
  -- The marker cannot move without an invoice to back it.
  denied := false;
  begin perform mark_subscription_billed(sub, start_on);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A period was marked billed with no invoice'; end if;

  insert into invoice(id, "invoiceNumber", "accountId", "subscriptionId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
    "periodStart", "periodEnd", "updatedAt")
  values (inv, 'SUBT-INV', acct, sub, current_date, current_date + 30, 'DRAFT',
    'PKR', 5000, 0, 0, 5000, 0, 5000, start_on, (start_on + interval '1 month - 1 day')::date, now());

  -- The same subscription period must not be invoiced twice.
  denied := false;
  begin
    insert into invoice(id, "invoiceNumber", "accountId", "subscriptionId", "invoiceDate", "dueDate", status,
      "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
      "periodStart", "periodEnd", "updatedAt")
    values (gen_random_uuid(), 'SUBT-INV-DUP', acct, sub, current_date, current_date + 30, 'DRAFT',
      'PKR', 5000, 0, 0, 5000, 0, 5000, start_on, (start_on + interval '1 month - 1 day')::date, now());
  exception when unique_violation then denied := true; end;
  if not denied then raise exception 'The same subscription period was billed twice'; end if;

  perform mark_subscription_billed(sub, start_on);
  if (select "billedThrough" from customer_subscription where id = sub) <> start_on then
    raise exception 'The billed marker did not advance';
  end if;

  -- A late run must not rewind the marker.
  perform mark_subscription_billed(sub, start_on);
  if (select "billedThrough" from customer_subscription where id = sub) <> start_on then
    raise exception 'The billed marker moved backwards';
  end if;
end $$;
reset role;

-- ------------------------- a billed period cannot have its quantity rewritten
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='sales'), true);
set local role authenticated;
do $$
declare denied boolean;
  sub uuid := (select id from sub_fixture where k='sub');
  billed date := (select "billedThrough" from customer_subscription where id = sub);
begin
  denied := false;
  begin perform change_subscription_quantity(gen_random_uuid(), sub, 30, billed, 'Rewriting an invoiced period');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A quantity change rewrote an already invoiced period'; end if;
end $$;
reset role;

-- --------------------------------------------- pausing, ending, and finality
select set_config('request.jwt.claim.sub', (select id::text from sub_fixture where k='sales'), true);
set local role authenticated;
do $$
declare denied boolean; sub uuid := (select id from sub_fixture where k='sub');
begin
  perform set_subscription_status(sub, 'PAUSED', 'Customer asked to pause');
  perform set_subscription_status(sub, 'ACTIVE', 'Customer resumed');
  perform set_subscription_status(sub, 'CANCELLED', 'Customer left');

  denied := false;
  begin perform set_subscription_status(sub, 'ACTIVE', 'Bringing it back');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A cancelled subscription was reactivated'; end if;

  denied := false;
  begin perform change_subscription_quantity(gen_random_uuid(), sub, 25, current_date + 60, 'After cancellation');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A cancelled subscription had its quantity changed'; end if;

  -- The history survives the cancellation.
  if (select count(*) from subscription_status_change where "subscriptionId" = sub) < 4 then
    raise exception 'The status history is incomplete';
  end if;
end $$;
reset role;

select 'customer subscriptions verified' as result;
