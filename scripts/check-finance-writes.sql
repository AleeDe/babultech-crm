-- All identities and records below are synthetic and rolled back by the runner.
create temp table fin_fixture(k text primary key, id uuid);
grant select on fin_fixture to authenticated;
insert into fin_fixture
select k, gen_random_uuid() from unnest(array[
  'clerk_role','preparer_role','approver_role',
  'clerk','preparer','approver',
  'account','invoice','other_invoice','line','payment'
]) k;

-- A contributor with no finance grant at all, a finance operator who may draft,
-- and an approver who may issue.
insert into security_role(id, name, permissions, "dataScope", "updatedAt") values
((select id from fin_fixture where k='clerk_role'), 'Finance test contributor', array['project:read','expense:write'], 'ALL', now()),
((select id from fin_fixture where k='preparer_role'), 'Finance test preparer', array['invoice:read','invoice:write','payment:write'], 'ALL', now()),
((select id from fin_fixture where k='approver_role'), 'Finance test approver', array['invoice:read','invoice:write','invoice:approve','payment:write'], 'ALL', now());

insert into app_user(id, "fullName", email, "roleId", status, "updatedAt")
select f.id, 'Finance test '||f.k, f.id::text||'@example.invalid',
  (select id from fin_fixture where k = f.k||'_role'), 'ACTIVE', now()
from fin_fixture f where f.k in ('clerk','preparer','approver');

insert into account(id, "accountNumber", name, "ownerUserId", "updatedAt")
select id, 'FINTEST-'||left(id::text,18), 'Finance test account', (select id from fin_fixture where k='approver'), now()
from fin_fixture where k='account';

-- ---------------------------------------------- a contributor cannot do finance
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='clerk'), true);
set local role authenticated;
do $$
declare denied boolean; acct uuid := (select id from fin_fixture where k='account');
begin
  denied := false;
  begin
    insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
      "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
    values (gen_random_uuid(), 'FINTEST-CLERK', acct, current_date, current_date + 30, 'DRAFT',
      'PKR', 1000, 0, 0, 1000, 0, 1000, now());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Contributor without invoice:write raised an invoice'; end if;

  denied := false;
  begin
    insert into payment(id, "paymentNumber", "accountId", "paymentDate", amount, "currencyCode", "paymentMethod", "updatedAt")
    values (gen_random_uuid(), 'FINTEST-CLERKPAY', acct, current_date, 500, 'PKR', 'BANK', now());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Contributor without payment:write recorded a payment'; end if;
end $$;
reset role;

-- The approver raises a second draft, so that the preparer's missing
-- invoice:approve can be tested on an invoice they did not prepare - otherwise
-- the self-approval guard fires first and hides which rule did the work.
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='approver'), true);
set local role authenticated;
insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
  "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
select id, 'FINTEST-OTHER', (select id from fin_fixture where k='account'), current_date, current_date + 30, 'DRAFT',
  'PKR', 500, 0, 0, 500, 0, 500, now()
from fin_fixture where k='other_invoice';
reset role;

-- ------------------------------------------------- a preparer drafts but cannot issue
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='preparer'), true);
set local role authenticated;
do $$
declare denied boolean;
  acct uuid := (select id from fin_fixture where k='account');
  inv uuid := (select id from fin_fixture where k='invoice');
  line uuid := (select id from fin_fixture where k='line');
begin
  insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
  values (inv, 'FINTEST-DRAFT', acct, current_date, current_date + 30, 'DRAFT',
    'PKR', 1000, 0, 0, 1000, 0, 1000, now());

  if not exists (select 1 from invoice where id = inv and "preparedById" = app_current_user_id()) then
    raise exception 'Preparer was not stamped on insert';
  end if;

  -- An invoice may not be born already issued.
  denied := false;
  begin
    insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
      "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
    values (gen_random_uuid(), 'FINTEST-BORNSENT', acct, current_date, current_date + 30, 'SENT',
      'PKR', 1000, 0, 0, 1000, 0, 1000, now());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Invoice inserted directly as SENT'; end if;

  -- Drafting the figures is allowed while it is still a draft.
  insert into invoice_line(id, "invoiceId", description, quantity, "unitPrice", "lineTotal", "updatedAt")
  values (line, inv, 'Finance test line', 1, 1000, 1000, now());
  update invoice set subtotal = 1200, "totalAmount" = 1200, "outstandingAmount" = 1200, "updatedAt" = now() where id = inv;

  -- Issuing is not, even on an invoice someone else prepared. Depending on
  -- which clause rejects it, the row is either skipped or refused outright, so
  -- accept either and then confirm it did not move.
  begin
    update invoice set status = 'SENT', "updatedAt" = now()
    where id = (select id from fin_fixture where k='other_invoice');
  exception when insufficient_privilege then null; end;
  if exists (select 1 from invoice where id = (select id from fin_fixture where k='other_invoice') and status = 'SENT') then
    raise exception 'Preparer issued an invoice without invoice:approve';
  end if;
end $$;
reset role;

-- --------------------------------------- the preparer may not issue their own invoice
-- Grant the preparer approval rights too: holding both must still not be enough.
update security_role set permissions = permissions || array['invoice:approve']
where id = (select id from fin_fixture where k='preparer_role');

select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='preparer'), true);
set local role authenticated;
do $$
declare denied boolean; inv uuid := (select id from fin_fixture where k='invoice');
begin
  denied := false;
  begin
    update invoice set status = 'SENT', "updatedAt" = now() where id = inv;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'Preparer issued the invoice they prepared'; end if;
end $$;
reset role;

-- ------------------------------------------------- a second person may issue it
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='approver'), true);
set local role authenticated;
do $$
declare denied boolean;
  inv uuid := (select id from fin_fixture where k='invoice');
  line uuid := (select id from fin_fixture where k='line');
  pay uuid := (select id from fin_fixture where k='payment');
begin
  update invoice set status = 'SENT', "sentAt" = now(), "updatedAt" = now() where id = inv;
  if not exists (select 1 from invoice where id = inv and status = 'SENT' and "issuedById" = app_current_user_id()) then
    raise exception 'Issue was not recorded against the approver';
  end if;

  -- Once issued, the figures are the ledger. invoice:write no longer reaches
  -- them. A row the USING clause rejects is skipped silently rather than
  -- raising, so these are checked by effect.
  update invoice_line set "unitPrice" = 9999, "lineTotal" = 9999, "updatedAt" = now() where id = line;
  if exists (select 1 from invoice_line where id = line and "unitPrice" = 9999) then
    raise exception 'Line of an issued invoice was edited';
  end if;

  delete from invoice_line where id = line;
  if not exists (select 1 from invoice_line where id = line) then
    raise exception 'Line of an issued invoice was deleted';
  end if;

  delete from invoice where id = inv;
  if not exists (select 1 from invoice where id = inv) then
    raise exception 'Issued invoice was deleted';
  end if;

  -- Recording receipts is still available to a finance user who holds payment:write.
  insert into payment(id, "paymentNumber", "accountId", "paymentDate", amount, "currencyCode", "paymentMethod", "updatedAt")
  values (pay, 'FINTEST-PAY', (select id from fin_fixture where k='account'), current_date, 600, 'PKR', 'BANK', now());
end $$;
reset role;

-- ------------------------------------ a contributor cannot delete a receipt either
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='clerk'), true);
set local role authenticated;
do $$
declare denied boolean; pay uuid := (select id from fin_fixture where k='payment');
begin
  delete from payment where id = pay;
  if not exists (select 1 from payment where id = pay) then
    raise exception 'Contributor deleted a recorded payment';
  end if;

  update payment set amount = 1 where id = pay;
  if exists (select 1 from payment where id = pay and amount = 1) then
    raise exception 'Contributor altered a recorded payment';
  end if;
end $$;
reset role;

select 'finance write boundaries verified' as result;

-- ------------------------------- cancelling your own draft is not issuing it
-- Added after 20260918000011: the issue guard must not catch a cancellation.
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='preparer'), true);
set local role authenticated;
do $$
declare acct uuid := (select id from fin_fixture where k='account'); own uuid := gen_random_uuid();
begin
  insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
  values (own, 'FINTEST-CANCEL', acct, current_date, current_date + 30, 'DRAFT',
    'PKR', 100, 0, 0, 100, 0, 100, now());
  -- The preparer cancels their own draft. Nobody is billed by this.
  update invoice set status = 'CANCELLED', "updatedAt" = now() where id = own;
  if not exists (select 1 from invoice where id = own and status = 'CANCELLED') then
    raise exception 'A preparer could not cancel their own draft';
  end if;
end $$;
reset role;

select 'cancellation is not issuing' as result;

-- ------------------------- but invoice:write still cannot bill the customer
select set_config('request.jwt.claim.sub', (select id::text from fin_fixture where k='preparer'), true);
set local role authenticated;
do $$
declare acct uuid := (select id from fin_fixture where k='account'); own uuid := gen_random_uuid();
begin
  insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
    "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
  values (own, 'FINTEST-NOBILL', acct, current_date, current_date + 30, 'DRAFT',
    'PKR', 100, 0, 0, 100, 0, 100, now());
  -- Allowing CANCELLED must not have opened a route to PAID.
  -- Either the policy or the issue guard may reject it; what matters is that
  -- the status did not move.
  begin
    update invoice set status = 'PAID', "updatedAt" = now() where id = own;
  exception when insufficient_privilege or check_violation then null; end;
  if exists (select 1 from invoice where id = own and status = 'PAID') then
    raise exception 'invoice:write reached a billing status';
  end if;
end $$;
reset role;

select 'cancellation allowed, billing still refused' as result;
