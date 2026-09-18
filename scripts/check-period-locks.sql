-- All identities and records below are synthetic and rolled back by the runner.
create temp table per_fixture(k text primary key, id uuid);
grant select on per_fixture to authenticated;
insert into per_fixture
select k, gen_random_uuid() from unnest(array[
  'operator_role','approver_role','operator','approver',
  'account','contract','open_invoice','closed_invoice','prior_invoice','line','payment','category','expense'
]) k;

insert into security_role(id, name, permissions, "dataScope", "updatedAt") values
((select id from per_fixture where k='operator_role'), 'Period test operator', array['invoice:read','invoice:write','payment:write','expense:write','account:read'], 'ALL', now()),
((select id from per_fixture where k='approver_role'), 'Period test approver', array['invoice:read','invoice:write','invoice:approve','payment:write','expense:write','account:read'], 'ALL', now());

insert into app_user(id, "fullName", email, "roleId", status, "updatedAt")
select f.id, 'Period test '||f.k, f.id::text||'@example.invalid',
  (select id from per_fixture where k = f.k||'_role'), 'ACTIVE', now()
from per_fixture f where f.k in ('operator','approver');

insert into account(id, "accountNumber", name, "ownerUserId", "updatedAt")
select id, 'PERTEST-'||left(id::text,16), 'Period test account', (select id from per_fixture where k='approver'), now()
from per_fixture where k='account';

insert into contract(id, "contractNumber", name, "accountId", "ownerUserId", "contractType", status,
  "startDate", "endDate", "contractValue", "currencyCode", "billingFrequency", "updatedAt")
select id, 'PERTEST-C-'||left(id::text,14), 'Period test contract', (select id from per_fixture where k='account'),
  (select id from per_fixture where k='approver'), 'Retainer', 'ACTIVE',
  date_trunc('month', current_date - interval '4 months')::date,
  date_trunc('month', current_date + interval '8 months')::date, 12000, 'PKR', 'MONTHLY', now()
from per_fixture where k='contract';

-- ------------------------------------------- one invoice per contract period
select set_config('request.jwt.claim.sub', (select id::text from per_fixture where k='operator'), true);
set local role authenticated;
do $$
declare denied boolean;
  acct uuid := (select id from per_fixture where k='account');
  ctr uuid := (select id from per_fixture where k='contract');
  inv uuid := (select id from per_fixture where k='open_invoice');
  period date := date_trunc('month', current_date - interval '1 month')::date;
begin
  insert into invoice(id, "invoiceNumber", "accountId", "contractId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
    "periodStart", "periodEnd", "updatedAt")
  values (inv, 'PERTEST-INV1', acct, ctr, current_date, current_date + 30, 'DRAFT',
    'PKR', 1000, 0, 0, 1000, 0, 1000, period, (period + interval '1 month - 1 day')::date, now());

  -- The same contract period must not be raised twice.
  denied := false;
  begin
    insert into invoice(id, "invoiceNumber", "accountId", "contractId", "invoiceDate", "dueDate", status,
      "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
      "periodStart", "periodEnd", "updatedAt")
    values (gen_random_uuid(), 'PERTEST-INV-DUP', acct, ctr, current_date, current_date + 30, 'DRAFT',
      'PKR', 1000, 0, 0, 1000, 0, 1000, period, (period + interval '1 month - 1 day')::date, now());
  exception when unique_violation then denied := true; end;
  if not denied then raise exception 'The same contract period was billed twice'; end if;

  -- A different period is fine.
  insert into invoice(id, "invoiceNumber", "accountId", "contractId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
    "periodStart", "periodEnd", "updatedAt")
  values (gen_random_uuid(), 'PERTEST-INV2', acct, ctr, current_date, current_date + 30, 'DRAFT',
    'PKR', 1000, 0, 0, 1000, 0, 1000, (period - interval '1 month')::date, (period - interval '1 day')::date, now());

  -- A cancelled invoice frees its period, which is the point of cancelling one.
  update invoice set status = 'CANCELLED', "updatedAt" = now() where id = inv;
  insert into invoice(id, "invoiceNumber", "accountId", "contractId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount",
    "periodStart", "periodEnd", "updatedAt")
  values (gen_random_uuid(), 'PERTEST-INV-REDO', acct, ctr, current_date, current_date + 30, 'DRAFT',
    'PKR', 1000, 0, 0, 1000, 0, 1000, period, (period + interval '1 month - 1 day')::date, now());
end $$;
reset role;

-- ------------------------------------------- only an approver may close a month
select set_config('request.jwt.claim.sub', (select id::text from per_fixture where k='operator'), true);
set local role authenticated;
do $$
declare denied boolean; period date := date_trunc('month', current_date - interval '2 months')::date;
begin
  denied := false;
  begin perform close_accounting_period(period, 'Operator attempt');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'An operator without invoice:approve closed a period'; end if;

  denied := false;
  begin insert into accounting_period_lock("periodStart", "closedById", note)
    values (period, app_current_user_id(), 'Direct insert');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'A period lock was written directly'; end if;
end $$;
reset role;

-- ------------------------------------------------ an approver closes last month
select set_config('request.jwt.claim.sub', (select id::text from per_fixture where k='approver'), true);
set local role authenticated;
do $$
declare denied boolean;
  closed date := date_trunc('month', current_date - interval '2 months')::date;
  current_month date := date_trunc('month', current_date)::date;
begin
  -- The month still being traded in cannot be closed.
  denied := false;
  begin perform close_accounting_period(current_month, 'Closing the current month');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'The current month was closed'; end if;

  -- Nor half a month.
  denied := false;
  begin perform close_accounting_period(closed + 10, 'Mid-month close');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A partial month was closed'; end if;

  -- Nor without saying why.
  denied := false;
  begin perform close_accounting_period(closed, '   ');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A period was closed with no note'; end if;

  perform close_accounting_period(closed, 'Period test close');
  if not period_is_locked(closed + 5) then raise exception 'A date inside the closed month reads as open'; end if;
  if period_is_locked(current_date) then raise exception 'The current month reads as closed'; end if;

  -- Closing twice is not an error; it is already closed.
  perform close_accounting_period(closed, 'Period test close again');
  if (select count(*) from accounting_period_lock where "periodStart" = closed) <> 1 then
    raise exception 'Closing twice created two locks';
  end if;
end $$;
reset role;

-- --------------------------------------- a closed month refuses financial writes
select set_config('request.jwt.claim.sub', (select id::text from per_fixture where k='approver'), true);
set local role authenticated;
do $$
declare denied boolean;
  acct uuid := (select id from per_fixture where k='account');
  closed date := date_trunc('month', current_date - interval '2 months')::date;
  inv uuid := (select id from per_fixture where k='closed_invoice');
  pay uuid := (select id from per_fixture where k='payment');
begin
  denied := false;
  begin
    insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
      "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
    values (inv, 'PERTEST-CLOSED', acct, closed + 5, closed + 35, 'DRAFT',
      'PKR', 1000, 0, 0, 1000, 0, 1000, now());
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'An invoice was raised into a closed month'; end if;

  denied := false;
  begin
    insert into payment(id, "paymentNumber", "accountId", "paymentDate", amount, "currencyCode", "paymentMethod", "updatedAt")
    values (pay, 'PERTEST-CLOSEDPAY', acct, closed + 5, 500, 'PKR', 'BANK', now());
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'A payment was recorded into a closed month'; end if;
end $$;
reset role;

-- ------------------------- an invoice already in a closed month stops being editable
-- Raised before the close, the way a real one would have been.
select set_config('request.jwt.claim.sub', '', true);
insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
  "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
select id, 'PERTEST-PRIOR', (select id from per_fixture where k='account'),
  date_trunc('month', current_date - interval '3 months')::date + 5,
  date_trunc('month', current_date - interval '3 months')::date + 35,
  'SENT', 'PKR', 2000, 0, 0, 2000, 0, 2000, now()
from per_fixture where k='prior_invoice';
insert into invoice_line(id, "invoiceId", description, quantity, "unitPrice", "lineTotal", "updatedAt")
select id, (select id from per_fixture where k='prior_invoice'), 'Period test line', 1, 2000, 2000, now()
from per_fixture where k='line';

select set_config('request.jwt.claim.sub', (select id::text from per_fixture where k='approver'), true);
set local role authenticated;
do $$
declare denied boolean;
  prior date := date_trunc('month', current_date - interval '3 months')::date;
  inv uuid := (select id from per_fixture where k='prior_invoice');
  line uuid := (select id from per_fixture where k='line');
begin
  perform close_accounting_period(prior, 'Period test close of the earlier month');

  begin update invoice set "totalAmount" = 5000, "updatedAt" = now() where id = inv;
  exception when check_violation or insufficient_privilege then null; end;
  if exists (select 1 from invoice where id = inv and "totalAmount" = 5000) then
    raise exception 'An invoice in a closed month was edited';
  end if;

  -- Nor can it be dragged out of the closed month.
  begin update invoice set "invoiceDate" = current_date, "updatedAt" = now() where id = inv;
  exception when check_violation or insufficient_privilege then null; end;
  if exists (select 1 from invoice where id = inv and "invoiceDate" = current_date) then
    raise exception 'An invoice was moved out of a closed month';
  end if;

  -- Nor rewritten one line at a time. This invoice is already issued, so the
  -- write policy may reject the row silently before the period trigger is
  -- reached; either way the line must not move.
  begin update invoice_line set "unitPrice" = 1, "lineTotal" = 1, "updatedAt" = now() where id = line;
  exception when check_violation or insufficient_privilege then null; end;
  if exists (select 1 from invoice_line where id = line and "unitPrice" = 1) then
    raise exception 'A line of a closed invoice was edited';
  end if;

  begin delete from invoice_line where id = line;
  exception when check_violation or insufficient_privilege then null; end;
  if not exists (select 1 from invoice_line where id = line) then
    raise exception 'A line of a closed invoice was deleted';
  end if;

  -- Reopening restores ordinary editing, and leaves a record behind.
  perform reopen_accounting_period(prior, 'Period test reopen');
  if period_is_locked(prior + 5) then raise exception 'The month is still closed after reopening'; end if;
  if not exists (select 1 from accounting_period_lock
    where "periodStart" = prior and "reopenedAt" is not null and "reopenNote" = 'Period test reopen') then
    raise exception 'Reopening was not recorded';
  end if;
  -- With the month open again the period guard no longer objects. (This
  -- invoice is issued, so editing its figures is still an approval matter -
  -- that is the previous migration's rule, not this one's.)
  if period_is_locked(prior + 5) then raise exception 'Reopening did not clear the lock'; end if;
end $$;
reset role;

select 'period locks verified' as result;
