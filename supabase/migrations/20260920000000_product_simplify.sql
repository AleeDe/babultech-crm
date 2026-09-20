-- The product becomes a catalogue entry, and price books hold the prices.
--
-- A product is now just what the company sells: name, code, type, category,
-- commission % , default tax rate and description. Everything about what it
-- costs moved to price_book, where one product can carry several priced offers
-- (Standard, Premium, this year's rates) and an old book stays with the deals
-- that were sold on it.
--
-- The pricing plans that used to live in product.pricingPlans are carried over
-- into price books first, so nothing that was priced disappears:
--   * each plan becomes a book of the same name, its price going to licenseCost
--   * a product with no plans but a standard price gets one "Standard" book
-- Plans already snapshotted onto quote lines, invoice lines and subscriptions
-- are untouched: those rows carry their own copy and do not read the catalogue.

-- One book per pricing plan.
insert into public.price_book
  ("productId", name, description, "currencyCode", "licenseCost", active, "createdAt", "updatedAt")
select
  p.id,
  -- Two plans could share a name only by way of an older product; keep both by
  -- numbering the later one rather than losing it to the unique index.
  case when count(*) over (partition by p.id, lower(btrim(plan->>'name'))) > 1
         and row_number() over (partition by p.id, lower(btrim(plan->>'name')) order by plan->>'id') > 1
       then left(btrim(plan->>'name'), 90) || ' ' || row_number() over (partition by p.id, lower(btrim(plan->>'name')) order by plan->>'id')
       else left(btrim(plan->>'name'), 100)
  end,
  'Carried over from the product''s pricing plans.',
  'PKR',
  coalesce((plan->>'standardPrice')::numeric, 0),
  p.active,
  now(), now()
from public.product p
cross join lateral jsonb_array_elements(coalesce(p."pricingPlans", '[]'::jsonb)) as plan
where nullif(btrim(plan->>'name'), '') is not null
  and p."deletedAt" is null
on conflict do nothing;

-- Products that were priced without plans.
insert into public.price_book
  ("productId", name, description, "currencyCode", "licenseCost", active, "createdAt", "updatedAt")
select p.id, 'Standard', 'Carried over from the product''s standard price.', 'PKR',
       coalesce(p."standardPrice", 0), p.active, now(), now()
from public.product p
where p."deletedAt" is null
  and coalesce(jsonb_array_length(coalesce(p."pricingPlans", '[]'::jsonb)), 0) = 0
  and p."standardPrice" is not null
  and not exists (select 1 from public.price_book b where b."productId" = p.id)
on conflict do nothing;

-- The catalogue no longer prices anything.
alter table public.product
  drop column if exists "pricingPlans",
  drop column if exists "standardPrice",
  drop column if exists "standardCost",
  drop column if exists "billingType",
  drop column if exists "unitOfMeasure";

-- `active` and `commissionable` stay: they are not pricing, they are whether
-- the product may be sold and whether it earns commission.
