-- Company information: who we are, and the currencies we deal in.
--
-- There was nowhere to record the organisation itself. Its name, the currency
-- its books are kept in and the one it reports in were assumptions scattered
-- through the code ('PKR' as a default in a dozen places) rather than a setting
-- somebody could read and change.
--
-- One row, enforced. A second "company" row would be a question with two
-- answers, and every reader would have to decide which to believe.

-- ---------------------------------------------------------------------------
-- 1. More currencies
-- ---------------------------------------------------------------------------
--
-- Rates are against PKR: "exchangeRate" is how many PKR one unit buys, so
-- USD 278 means USD 1 = PKR 278. Converting between any two currencies goes
-- through PKR, which is why one rate per currency is enough.
--
-- These rates are STARTING VALUES, close to the market in September 2026, and
-- must be checked and set in Setup Currency before anybody relies on them.
-- AED is derived from the USD rate at its 3.6725 peg, so the two agree.

insert into currency (code, name, symbol, "exchangeRate", "isBase", active, "createdAt", "updatedAt")
values
  ('CAD', 'Canadian Dollar',   'C$',  203.000000, false, true, now(), now()),
  ('AUD', 'Australian Dollar', 'A$',  183.500000, false, true, now(), now()),
  ('AED', 'UAE Dirham',        'AED',  75.698000, false, true, now(), now())
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The organisation's own account
-- ---------------------------------------------------------------------------
--
-- Products and services have an owner, and it defaults to us. That needs us to
-- exist as an account. OTHER rather than CUSTOMER or PARTNER: we are neither,
-- and either would put us into the customer or partner totals.

insert into account (id, "accountNumber", name, "accountType", "ownerUserId", "createdAt", "updatedAt")
select
  gen_random_uuid(),
  next_sequence_number('Account'),
  'BabulTech',
  'OTHER',
  (select id from app_user where status = 'ACTIVE' and "partnerId" is null order by "createdAt" limit 1),
  now(), now()
where not exists (
  select 1 from account where lower(name) = 'babultech' and "deletedAt" is null
);

-- ---------------------------------------------------------------------------
-- 3. The setting itself
-- ---------------------------------------------------------------------------

create table if not exists company_setting (
  -- Always true, and the primary key: the table can hold one row and no more.
  id boolean primary key default true check (id),

  "companyName" varchar(200) not null,

  -- en-PK formats numbers and dates the way they are written in Pakistan.
  locale   varchar(20) not null default 'en-PK',
  timezone varchar(64) not null default 'Asia/Karachi',
  language varchar(20) not null default 'en',

  -- The currency the books are kept in. Every calculation happens in this one.
  "defaultCurrency" char(3) not null default 'PKR' references currency (code),
  -- The currency the business reports in. Shown alongside, never calculated in.
  "corporateCurrency" char(3) not null default 'USD' references currency (code),

  -- Us, as an account. What a product or service owner defaults to.
  "accountId" uuid references account (id) on delete set null,

  "updatedAt"   timestamp(3) not null default current_timestamp,
  "updatedById" uuid references app_user (id) on delete set null
);

comment on table company_setting is
  'The organisation itself. Exactly one row.';
comment on column company_setting."defaultCurrency" is
  'The currency every amount is calculated in.';
comment on column company_setting."corporateCurrency" is
  'The currency amounts are also SHOWN in, converted at the current rate, for reference only. Nothing is calculated in it.';

insert into company_setting ("companyName", "accountId")
select 'BabulTech', (select id from account where lower(name) = 'babultech' and "deletedAt" is null limit 1)
where not exists (select 1 from company_setting);

alter table company_setting enable row level security;
alter table company_setting force row level security;

-- Everybody internal reads it: the currencies decide how every amount on every
-- screen is shown.
drop policy if exists company_setting_read on company_setting;
create policy company_setting_read on company_setting
  for select using (app_is_internal());

drop policy if exists company_setting_write on company_setting;
create policy company_setting_write on company_setting
  for update using (app_can_write() and app_has_permission('admin:*'))
  with check (app_can_write() and app_has_permission('admin:*'));

grant select, update on company_setting to authenticated;
grant all on company_setting to service_role;

-- ---------------------------------------------------------------------------
-- 4. Currencies are managed by administrators
-- ---------------------------------------------------------------------------
--
-- A rate decides every converted figure in the system, so changing one is an
-- administrator's job. Read access stays as it was.

drop policy if exists currency_admin_write on currency;
create policy currency_admin_write on currency
  for all using (app_is_internal() and app_can_write() and app_has_permission('admin:*'))
  with check (app_is_internal() and app_can_write() and app_has_permission('admin:*'));

-- The base currency is the pivot every conversion goes through, so its rate is
-- 1 by definition. A base rate of anything else would silently scale every
-- converted amount in the system.
alter table currency drop constraint if exists currency_base_rate_is_one;
alter table currency add constraint currency_base_rate_is_one
  check (not "isBase" or "exchangeRate" = 1);

alter table currency drop constraint if exists currency_rate_positive;
alter table currency add constraint currency_rate_positive
  check ("exchangeRate" > 0);

-- ---------------------------------------------------------------------------
-- 5. The totals
-- ---------------------------------------------------------------------------
--
-- Counts run with the definer's rights so they are the organisation's totals,
-- not "the ones this person is allowed to see" - which is what Company
-- Information is for. Gated on admin:* for that reason.
--
-- Storage comes from the catalogue: the database's size, and the sum of the
-- file sizes Storage has recorded. Neither is visible to an ordinary role.
create or replace function company_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_files bigint;
begin
  if not (app_is_internal() and app_has_permission('admin:*')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select coalesce(sum((metadata ->> 'size')::bigint), 0) into v_files
  from storage.objects;

  return jsonb_build_object(
    'users',        (select count(*) from app_user where status = 'ACTIVE' and "partnerId" is null and "contactId" is null),
    'customers',    (select count(*) from account where "accountType" = 'CUSTOMER' and "deletedAt" is null),
    'deals',        (select count(*) from opportunity where "deletedAt" is null),
    'partners',     (select count(*) from partner where "deletedAt" is null),
    'cases',        (select count(*) from support_case where "deletedAt" is null),
    'leads',        (select count(*) from lead where "deletedAt" is null),
    'databaseBytes', pg_database_size(current_database()),
    'fileBytes',     v_files
  );
end $$;

revoke all on function company_overview() from public, anon;
grant execute on function company_overview() to authenticated;
