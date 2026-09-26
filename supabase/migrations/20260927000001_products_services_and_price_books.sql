-- Products & Services, and price books that hold many of them.
--
-- Two changes that have to land together, because the second depends on the
-- first and the type lock below reads both.
--
-- 1. A product becomes a PRODUCT or a SERVICE, with a system-issued code
--    (P-000001 / S-000001), an owning account, and an "Add in Task" flag.
--    A SERVICE flagged Add in Task is sold in HOURS, and those hours become a
--    project task when the deal is won. Nothing else is: a BabulPOS licence is
--    not effort, and Hosting is recurring, not project work.
--
-- 2. A price book stops belonging to one product. It becomes a catalogue -
--    "2026 Standard Rates" - with an entry per product or service it prices.
--    That is what lets an opportunity choose ONE book and then pick its
--    products from it. Under the old shape every product had its own books, so
--    there was no single book to choose.

-- ---------------------------------------------------------------------------
-- 1. Type: Product or Service
-- ---------------------------------------------------------------------------
--
-- SUBSCRIPTION goes. It was a third answer to a two-way question, and the one
-- product that exists is already PRODUCT.
--
-- Text against a check rather than the enum, for the reason the newer tables
-- here use it: the enum would need rewriting, with its dependants rebuilt, to
-- lose a value.

update product set "productType" = 'PRODUCT' where "productType"::text = 'SUBSCRIPTION';

alter table product
  alter column "productType" type varchar(20) using "productType"::text;

alter table product drop constraint if exists product_type_check;
alter table product add constraint product_type_check
  check ("productType" in ('PRODUCT', 'SERVICE'));

-- ---------------------------------------------------------------------------
-- 2. Add in Task, and the owner
-- ---------------------------------------------------------------------------

alter table product
  add column if not exists "addInTask" boolean not null default false,
  add column if not exists "ownerAccountId" uuid references account (id) on delete set null;

comment on column product."addInTask" is
  'A SERVICE sold in hours. Its quantity on an opportunity line is a number of hours, and becomes a project task when the deal is won. Never true for a PRODUCT.';

comment on column product."ownerAccountId" is
  'Whose product or service this is. Defaults to our own account; a partner''s offering names the partner.';

-- Hours only make sense for work. A product flagged Add in Task would turn a
-- licence count into a task budget.
alter table product drop constraint if exists product_add_in_task_is_service;
alter table product add constraint product_add_in_task_is_service
  check (not "addInTask" or "productType" = 'SERVICE');

create index if not exists product_owner_idx on product ("ownerAccountId");

-- ---------------------------------------------------------------------------
-- 3. Codes: P-000001 and S-000001
-- ---------------------------------------------------------------------------
--
-- Issued by the database, never typed. A typed code is a code two people can
-- both choose, and the one already on file is the one the other person meant.

insert into number_sequence (id, "entityType", prefix, "nextValue", "paddingLength", "includeYear", "updatedAt")
values
  (gen_random_uuid(), 'ProductCode', 'P', 1, 6, false, now()),
  (gen_random_uuid(), 'ServiceCode', 'S', 1, 6, false, now())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Price book entries
-- ---------------------------------------------------------------------------

create table if not exists price_book_entry (
  id uuid primary key default gen_random_uuid(),
  "priceBookId" uuid not null references price_book (id) on delete cascade,
  -- RESTRICT: a product priced in a book cannot be deleted out from under it.
  "productId"   uuid not null references product (id) on delete restrict,

  -- Hours for a service sold by the hour, users for a licence, 1 otherwise.
  quantity  decimal(18,4) not null default 1 check (quantity >= 0),
  -- Per hour, or per user.
  rate      decimal(18,2) not null default 0 check (rate >= 0),

  "licenseCost"     decimal(18,2) not null default 0 check ("licenseCost" >= 0),
  "maintenanceCost" decimal(18,2) not null default 0 check ("maintenanceCost" >= 0),
  "cloudCost"       decimal(18,2) not null default 0 check ("cloudCost" >= 0),
  "aiCost"          decimal(18,2) not null default 0 check ("aiCost" >= 0),

  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "deletedAt" timestamptz
);

-- One price per product per book. Two would make "the price in this book" a
-- question with two answers.
create unique index if not exists price_book_entry_book_product_key
  on price_book_entry ("priceBookId", "productId") where "deletedAt" is null;
create index if not exists price_book_entry_product_idx on price_book_entry ("productId");

alter table price_book_entry enable row level security;
alter table price_book_entry force row level security;

drop policy if exists price_book_entry_read on price_book_entry;
create policy price_book_entry_read on price_book_entry
  for select to authenticated using (app_is_internal());

drop policy if exists price_book_entry_write on price_book_entry;
create policy price_book_entry_write on price_book_entry
  for all to authenticated
  using (app_can_write() and app_has_permission('opportunity:write'))
  with check (app_can_write() and app_has_permission('opportunity:write'));

grant select, insert, update, delete on price_book_entry to authenticated;
grant all on price_book_entry to service_role;

-- Every existing per-product book keeps its prices, as that product's entry in
-- the same book. Nothing that was priced disappears.
insert into price_book_entry
  ("priceBookId", "productId", quantity, rate,
   "licenseCost", "maintenanceCost", "cloudCost", "aiCost", active, "createdAt", "updatedAt")
select
  b.id, b."productId", 1, 0,
  b."licenseCost", b."maintenanceCost", b."cloudCost", b."aiCost",
  b.active, now(), now()
from price_book b
where b."productId" is not null and b."deletedAt" is null
on conflict do nothing;

-- The book becomes a header: name, validity, active. Its prices now live in
-- its entries.
drop index if exists price_book_product_name_key;
drop index if exists price_book_product_idx;

alter table price_book
  drop column if exists "productId",
  drop column if exists "licenseCost",
  drop column if exists "maintenanceCost",
  drop column if exists "cloudCost",
  drop column if exists "aiCost";

create unique index if not exists price_book_name_key
  on price_book (lower(name)) where "deletedAt" is null;

-- ---------------------------------------------------------------------------
-- 5. Existing products: re-code, and give them an owner
-- ---------------------------------------------------------------------------
--
-- Done BEFORE the trigger below exists. The trigger keeps the old code on any
-- update that does not change the type - which is right for everyday edits, and
-- would silently undo this re-code if it were already in place.

do $$
declare r record;
begin
  for r in select id, "productType" from product where "deletedAt" is null order by "createdAt" loop
    update product set
      "productCode" = next_sequence_number(
        case when r."productType" = 'SERVICE' then 'ServiceCode' else 'ProductCode' end
      ),
      "ownerAccountId" = coalesce("ownerAccountId", (select "accountId" from company_setting limit 1)),
      "updatedAt" = now()
    where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Issuing codes, defaulting the owner, and locking the type
-- ---------------------------------------------------------------------------
--
-- On insert the code is always issued here, whatever the caller sent.
--
-- On update the type is LOCKED once the item is in use - priced in a book, or
-- sold on an opportunity. Changing it then would re-classify history: last
-- year's deal would start generating tasks, or stop. Before it is used, a type
-- change is allowed and re-issues the code, so the prefix never lies.
create or replace function product_code_and_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new."productCode" := next_sequence_number(
      case when new."productType" = 'SERVICE' then 'ServiceCode' else 'ProductCode' end
    );
    if new."ownerAccountId" is null then
      select "accountId" into new."ownerAccountId" from company_setting limit 1;
    end if;
    return new;
  end if;

  -- UPDATE
  if new."productType" is distinct from old."productType" then
    if exists (select 1 from price_book_entry where "productId" = old.id and "deletedAt" is null)
       or exists (select 1 from opportunity_product where "productId" = old.id) then
      raise exception
        'This is already priced or sold, so it cannot change between Product and Service. Create a new one instead.'
        using errcode = '23514';
    end if;
    new."productCode" := next_sequence_number(
      case when new."productType" = 'SERVICE' then 'ServiceCode' else 'ProductCode' end
    );
  else
    -- The code is the system's, not something to edit.
    new."productCode" := old."productCode";
  end if;

  -- A product can never carry the flag. Cleared rather than refused, so
  -- switching a draft from Service to Product does not fail on a leftover tick.
  if new."productType" = 'PRODUCT' then
    new."addInTask" := false;
  end if;

  return new;
end $$;

revoke all on function product_code_and_type() from public, anon, authenticated;

drop trigger if exists product_code_and_type_trg on product;
create trigger product_code_and_type_trg
  before insert or update on product
  for each row execute function product_code_and_type();

-- ---------------------------------------------------------------------------
-- 7. The catalogue
-- ---------------------------------------------------------------------------
--
-- Add in Task is set for work that is delivered as project effort. It is left
-- off for what is recurring (Hosting, Support) or is not project work at all
-- (Marketing, Sales, Finance, Others). All of it is editable afterwards.

insert into product ("id", "productCode", name, "productType", "addInTask", active, "createdAt", "updatedAt")
select gen_random_uuid(), 'pending', v.name, v.kind, v.task, true, now(), now()
from (values
  ('SmartEMS', 'PRODUCT', false, 1),
  ('Jancho', 'PRODUCT', false, 2),
  ('ShiftDeploy', 'PRODUCT', false, 3),
  ('ReviewSystem', 'PRODUCT', false, 4),
  ('Installation', 'SERVICE', true, 5),
  ('Deployment', 'SERVICE', true, 6),
  ('Training', 'SERVICE', true, 7),
  ('App Development', 'SERVICE', true, 8),
  ('Web Development', 'SERVICE', true, 9),
  ('AI', 'SERVICE', true, 10),
  ('Data Science', 'SERVICE', true, 11),
  ('Data Import/Export', 'SERVICE', true, 12),
  ('QA', 'SERVICE', true, 13),
  ('DevOps', 'SERVICE', true, 14),
  ('IT Services', 'SERVICE', true, 15),
  ('Hosting', 'SERVICE', false, 16),
  ('Support', 'SERVICE', false, 17),
  ('Marketing', 'SERVICE', false, 18),
  ('Sales', 'SERVICE', false, 19),
  ('Finance', 'SERVICE', false, 20),
  ('Others', 'SERVICE', false, 21)
) as v(name, kind, task, ord)
where not exists (
  select 1 from product p where lower(p.name) = lower(v.name) and p."deletedAt" is null
)
-- In the order listed, so the codes read in a sensible order rather than
-- whatever order the planner happened to produce.
order by v.ord;

-- The yearly book, empty, for the rates to be filled in.
insert into price_book (id, name, description, "currencyCode", "validFrom", "validTo", active, "createdAt", "updatedAt")
select gen_random_uuid(), '2026 Standard Rates',
       'Our standard prices for 2026. Revised each year.',
       'PKR', date '2026-01-01', date '2026-12-31', true, now(), now()
where not exists (select 1 from price_book where lower(name) = '2026 standard rates' and "deletedAt" is null);
