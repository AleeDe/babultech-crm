-- All identities and records below are synthetic and rolled back by the runner.
create temp table spl_fixture(k text primary key, id uuid);
grant select on spl_fixture to authenticated;
insert into spl_fixture
select k, gen_random_uuid() from unnest(array[
  'old_role','issuer_role','voider_role','closer_role','drafter_role',
  'old','issuer','voider','closer','drafter',
  'account','inv_issue','inv_void','line'
]) k;

-- The role as it exists today: one coarse invoice:approve.
insert into security_role(id, name, permissions, "dataScope", "updatedAt") values
((select id from spl_fixture where k='old_role'), 'Split test legacy',
  array['invoice:read','invoice:write','invoice:approve','payment:write','account:read'], 'ALL', now()),
-- Narrow roles: each holds exactly one of the new authorities.
((select id from spl_fixture where k='issuer_role'), 'Split test issuer',
  array['invoice:read','invoice:write','invoice:issue','payment:write','account:read'], 'ALL', now()),
((select id from spl_fixture where k='voider_role'), 'Split test voider',
  array['invoice:read','invoice:write','invoice:void','payment:write','account:read'], 'ALL', now()),
((select id from spl_fixture where k='closer_role'), 'Split test closer',
  array['invoice:read','period:close','account:read'], 'ALL', now()),
((select id from spl_fixture where k='drafter_role'), 'Split test drafter',
  array['invoice:read','invoice:write','account:read'], 'ALL', now());

insert into app_user(id, "fullName", email, "roleId", status, "updatedAt")
select f.id, 'Split test '||f.k, f.id::text||'@example.invalid',
  (select id from spl_fixture where k = f.k||'_role'), 'ACTIVE', now()
from spl_fixture f where f.k in ('old','issuer','voider','closer','drafter');

insert into account(id, "accountNumber", name, "ownerUserId", "updatedAt")
select id, 'SPLIT-'||left(id::text,17), 'Split test account', (select id from spl_fixture where k='old'), now()
from spl_fixture where k='account';

-- Two drafts prepared by the drafter, so the separation-of-duties rule from
-- 20260918000009 does not interfere with what is being tested here.
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='drafter'), true);
set local role authenticated;
insert into invoice(id, "invoiceNumber", "accountId", "invoiceDate", "dueDate", status,
  "currencyCode", subtotal, "discountAmount", "taxAmount", "totalAmount", "paidAmount", "outstandingAmount", "updatedAt")
select f.id, 'SPLIT-'||f.k, (select id from spl_fixture where k='account'), current_date, current_date + 30, 'DRAFT',
  'PKR', 1000, 0, 0, 1000, 0, 1000, now()
from spl_fixture f where f.k in ('inv_issue','inv_void');
reset role;

-- ------------------------------------- the coarse grant still does everything
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='old'), true);
set local role authenticated;
do $$
begin
  if not app_can_issue_invoice() then raise exception 'invoice:approve lost the ability to issue'; end if;
  if not app_can_void_invoice() then raise exception 'invoice:approve lost the ability to void'; end if;
  if not app_can_close_period() then raise exception 'invoice:approve lost the ability to close a period'; end if;
end $$;
reset role;

-- ------------------------------------------ a narrow issuer can issue, not void
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='issuer'), true);
set local role authenticated;
do $$
declare inv uuid := (select id from spl_fixture where k='inv_issue');
  other uuid := (select id from spl_fixture where k='inv_void');
begin
  if not app_can_issue_invoice() then raise exception 'invoice:issue cannot issue'; end if;
  if app_can_void_invoice() then raise exception 'invoice:issue also grants voiding'; end if;
  if app_can_close_period() then raise exception 'invoice:issue also grants closing a period'; end if;

  update invoice set status = 'SENT', "sentAt" = now(), "updatedAt" = now() where id = inv;
  if not exists (select 1 from invoice where id = inv and status = 'SENT') then
    raise exception 'A narrow issuer could not issue an invoice';
  end if;

  -- Writing one off is a different authority. The row is rejected rather than
  -- raising, so this is checked by effect.
  begin
    update invoice set status = 'WRITTEN_OFF', "updatedAt" = now() where id = other;
  exception when insufficient_privilege then null; end;
  if exists (select 1 from invoice where id = other and status = 'WRITTEN_OFF') then
    raise exception 'A narrow issuer wrote off an invoice';
  end if;

  begin perform close_accounting_period(date_trunc('month', current_date - interval '2 months')::date, 'Issuer attempt');
  exception when insufficient_privilege then null; end;
  if exists (select 1 from accounting_period_lock
             where "periodStart" = date_trunc('month', current_date - interval '2 months')::date) then
    raise exception 'A narrow issuer closed a period';
  end if;
end $$;
reset role;

-- ------------------------------------------ a narrow voider can void, not issue
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='voider'), true);
set local role authenticated;
do $$
declare inv uuid := (select id from spl_fixture where k='inv_void');
begin
  if not app_can_void_invoice() then raise exception 'invoice:void cannot void'; end if;
  if app_can_issue_invoice() then raise exception 'invoice:void also grants issuing'; end if;

  update invoice set status = 'CANCELLED', "updatedAt" = now() where id = inv;
  if not exists (select 1 from invoice where id = inv and status = 'CANCELLED') then
    raise exception 'A narrow voider could not cancel an invoice';
  end if;
end $$;
reset role;

-- --------------------------------- a narrow closer can close, and nothing else
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='closer'), true);
set local role authenticated;
do $$
declare closed date := date_trunc('month', current_date - interval '2 months')::date;
begin
  if not app_can_close_period() then raise exception 'period:close cannot close a period'; end if;
  if app_can_issue_invoice() then raise exception 'period:close also grants issuing'; end if;
  if app_can_void_invoice() then raise exception 'period:close also grants voiding'; end if;

  perform close_accounting_period(closed, 'Split test close');
  if not period_is_locked(closed + 5) then raise exception 'A narrow closer could not close a month'; end if;

  perform reopen_accounting_period(closed, 'Split test reopen');
  if period_is_locked(closed + 5) then raise exception 'A narrow closer could not reopen a month'; end if;
end $$;
reset role;

-- ---------------------------------- a drafter has none of the new authorities
select set_config('request.jwt.claim.sub', (select id::text from spl_fixture where k='drafter'), true);
set local role authenticated;
do $$
begin
  if app_can_issue_invoice() then raise exception 'invoice:write grants issuing'; end if;
  if app_can_void_invoice() then raise exception 'invoice:write grants voiding'; end if;
  if app_can_close_period() then raise exception 'invoice:write grants closing a period'; end if;
end $$;
reset role;

-- ------------------------------ existing finance roles were widened, not moved
-- Only roles that existed when the migration ran; the fixture roles above were
-- created afterwards and are deliberately narrow.
do $$
declare n int;
begin
  select count(*) into n from security_role
  where name not like 'Split test%'
    and "permissions" && array['invoice:approve','invoice:*','*']
    and not ("permissions" @> array['invoice:issue','invoice:void','period:close','payable:approve']);
  if n > 0 then raise exception 'An existing approver was not given the explicit grants'; end if;

  -- And nobody lost the coarse grant they had.
  select count(*) into n from security_role
  where name = 'Split test legacy' and not ("permissions" @> array['invoice:approve']);
  if n > 0 then raise exception 'The coarse grant was removed from an existing role'; end if;

  -- The real Finance and Administrator roles must still hold everything.
  select count(*) into n from security_role
  where name in ('Finance', 'Administrator')
    and not ("permissions" @> array['invoice:issue','invoice:void','period:close','payable:approve']);
  if n > 0 then raise exception 'Finance or Administrator did not receive the explicit grants'; end if;
end $$;

select 'invoice authority split verified' as result;
