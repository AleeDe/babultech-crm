-- A quote is priced exactly like its deal, and accepting it makes the deal it.
--
-- Until now a quote line had a product, a quantity, a price, a discount and a
-- tax rate - but not the four costs a deal line carries (licence, maintenance,
-- cloud, AI), nor the deal's price book entry, and it worked its total out a
-- different way. So a quote could not say what the deal said, and accepting it
-- wrote the quote's total over the deal's amount: a number the deal's own
-- lines disagreed with, which the next edit to those lines quietly replaced -
-- and partner commission, paid on that amount, moved with it.
--
-- Now:
--   1. A quote line has everything a deal line has, and the same generated
--      totals: base = qty x unit price + the four costs; net = base less
--      discount %; total = net plus tax %.
--   2. A quote remembers its price book, one per quote, as a deal does.
--   3. The quote's header totals are worked out from its lines in the
--      database, so they cannot disagree with them.
--   4. Accepting a quote replaces the deal's lines with the quote's, in one
--      transaction. The deal's amount follows from its lines as it always
--      does, and commission follows the amount - so the deal, the commission
--      and the project the won deal starts all rest on what the customer
--      accepted.

-- ---------------------------------------------------------------------------
-- 1. Quote lines carry what deal lines carry
-- ---------------------------------------------------------------------------

alter table quote_line
  alter column id set default gen_random_uuid(),
  alter column "updatedAt" set default now();

alter table quote_line
  add column if not exists "priceBookEntryId" uuid
    references price_book_entry (id) on delete set null,
  add column if not exists "licenseCost"     decimal(18,2) not null default 0 check ("licenseCost" >= 0),
  add column if not exists "maintenanceCost" decimal(18,2) not null default 0 check ("maintenanceCost" >= 0),
  add column if not exists "cloudCost"       decimal(18,2) not null default 0 check ("cloudCost" >= 0),
  add column if not exists "aiCost"          decimal(18,2) not null default 0 check ("aiCost" >= 0),
  -- The tax rate AS IT WAS when the line was priced, as on a deal line.
  add column if not exists "taxPercent"      decimal(8,4)  not null default 0 check ("taxPercent" >= 0);

-- Existing lines take their rate now, before their total is recomputed from it.
update quote_line l set "taxPercent" = coalesce(t."ratePercent", 0)
from tax_rate t
where t.id = l."taxRateId";

-- The stored total becomes generated, with the deal line's formula. It used to
-- hold the net figure; every existing line has no costs, so its net is
-- unchanged, and the total now includes tax as a deal line's does.
alter table quote_line drop column if exists "lineTotal";

alter table quote_line
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

create index if not exists quote_line_quotation_idx on quote_line ("quotationId");
create index if not exists quote_line_entry_idx on quote_line ("priceBookEntryId");

-- ---------------------------------------------------------------------------
-- 2. One price book per quote
-- ---------------------------------------------------------------------------

alter table quotation
  add column if not exists "priceBookId" uuid references price_book (id) on delete set null;

-- Existing quotes take their deal's book where their lines are priced from it.
update quotation q set "priceBookId" = o."priceBookId"
from opportunity o
where o.id = q."opportunityId" and q."priceBookId" is null and o."priceBookId" is not null;

create or replace function quote_line_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_book uuid;
begin
  -- Snapshot the rate whenever the tax chosen changes.
  if tg_op = 'INSERT' or new."taxRateId" is distinct from old."taxRateId" then
    select "ratePercent" into new."taxPercent" from tax_rate where id = new."taxRateId";
    new."taxPercent" := coalesce(new."taxPercent", 0);
  end if;

  -- Every priced line on a quote comes from one book, and the quote records
  -- which. Compared with the quote's other lines rather than its header: an
  -- edit replaces all the lines before the header is saved, so a draft moved to
  -- a different book would otherwise be judged against the book it is leaving.
  if new."priceBookEntryId" is not null then
    select "priceBookId" into v_entry_book from price_book_entry where id = new."priceBookEntryId";

    if exists (
      select 1 from quote_line l
      join price_book_entry e on e.id = l."priceBookEntryId"
      where l."quotationId" = new."quotationId"
        and l.id <> new.id
        and e."priceBookId" <> v_entry_book
    ) then
      raise exception
        'This quote is priced from a different price book. One price book per quote.'
        using errcode = '23514';
    end if;

    update quotation set "priceBookId" = v_entry_book, "updatedAt" = now()
    where id = new."quotationId" and "priceBookId" is distinct from v_entry_book;
  end if;

  new."updatedAt" := now();
  return new;
end $$;

revoke all on function quote_line_guard() from public, anon, authenticated;

drop trigger if exists quote_line_guard_trg on quote_line;
create trigger quote_line_guard_trg
  before insert or update on quote_line
  for each row execute function quote_line_guard();

-- ---------------------------------------------------------------------------
-- 3. The header is the sum of the lines
-- ---------------------------------------------------------------------------
--
--   subtotal       = the lines before discount (base)
--   discountAmount = what the discounts take off
--   taxAmount      = the tax on what is left
--   totalAmount    = the lines' totals, tax included

create or replace function recalc_quotation_totals(p_quotation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  numeric;
  v_net   numeric;
  v_total numeric;
begin
  if p_quotation is null then return; end if;

  select
    coalesce(sum(round(quantity * "unitPrice" + "licenseCost" + "maintenanceCost" + "cloudCost" + "aiCost", 2)), 0),
    coalesce(sum("netTotal"), 0),
    coalesce(sum("lineTotal"), 0)
    into v_base, v_net, v_total
  from quote_line where "quotationId" = p_quotation;

  update quotation set
    subtotal         = v_base,
    "discountAmount" = v_base - v_net,
    "taxAmount"      = v_total - v_net,
    "totalAmount"    = v_total,
    "updatedAt"      = now()
  where id = p_quotation;
end $$;

revoke all on function recalc_quotation_totals(uuid) from public, anon, authenticated;

create or replace function quote_line_totals_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform recalc_quotation_totals(old."quotationId");
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new."quotationId" is distinct from old."quotationId") then
    perform recalc_quotation_totals(new."quotationId");
  end if;
  return null;
end $$;

revoke all on function quote_line_totals_trigger() from public, anon, authenticated;

drop trigger if exists quote_line_totals on quote_line;
create trigger quote_line_totals
  after insert or update or delete on quote_line
  for each row execute function quote_line_totals_trigger();

-- Existing quotes, on the one formula.
do $$
declare r record;
begin
  for r in select id from quotation loop
    perform recalc_quotation_totals(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Revising copies everything
-- ---------------------------------------------------------------------------
--
-- As before, but the copy carries the costs, the book entry and the book, and
-- its totals are worked out from its lines rather than copied.

create or replace function revise_quotation(p_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_orig    quotation%rowtype;
  v_last    integer;
  v_new_id  uuid := gen_random_uuid();
  v_number  text;
begin
  select * into v_orig from quotation where id = p_id for update;

  if not found then
    raise exception 'Quote % not found', p_id using errcode = 'no_data_found';
  end if;

  if v_orig.status = 'ACCEPTED' then
    raise exception 'An accepted quote cannot be revised — it is the basis of the deal.'
      using errcode = 'raise_exception';
  end if;

  select coalesce(max("versionNumber"), 0) into v_last
  from quotation where "opportunityId" = v_orig."opportunityId";

  v_number := next_sequence_number('Quotation');

  insert into quotation (
    id, "quoteNumber", "opportunityId", "accountId", "contactId",
    "versionNumber", status, "quoteDate", "expiryDate", "currencyCode", "priceBookId",
    "paymentTerms", notes, "termsAndConditions", "createdAt", "updatedAt"
  ) values (
    v_new_id, v_number, v_orig."opportunityId", v_orig."accountId",
    v_orig."contactId", v_last + 1, 'DRAFT', current_date, current_date + 30,
    v_orig."currencyCode", v_orig."priceBookId", v_orig."paymentTerms",
    v_orig.notes, v_orig."termsAndConditions", now(), now()
  );

  insert into quote_line (
    id, "quotationId", "productId", "productPlan", "priceBookEntryId", description,
    quantity, "unitPrice", "licenseCost", "maintenanceCost", "cloudCost", "aiCost",
    "discountPercent", "taxRateId", "sortOrder", "createdAt", "updatedAt"
  )
  select gen_random_uuid(), v_new_id, l."productId", l."productPlan", l."priceBookEntryId",
         l.description, l.quantity, l."unitPrice", l."licenseCost", l."maintenanceCost",
         l."cloudCost", l."aiCost", l."discountPercent", l."taxRateId",
         (row_number() over (order by l."sortOrder"))::int - 1,
         now(), now()
  from quote_line l
  where l."quotationId" = p_id;

  update quotation
  set status = 'REVISED', "updatedAt" = now()
  where id = p_id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Quotation', p_id, 'status', v_orig.status::text,
    'REVISED', p_actor_id, 'UI', now()
  );

  return jsonb_build_object('id', v_new_id, 'quoteNumber', v_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Copying an accepted quote's lines onto its deal
-- ---------------------------------------------------------------------------
--
-- The deal's line guard re-reads the tax rate on every new line and refuses a
-- product that is no longer active. Both are right for a line somebody is
-- adding, and wrong for a line the customer has already accepted: the rate
-- they accepted is the rate, and a product retired since is still what they
-- bought. While an accepted quote is being copied the guard keeps both as they
-- are. The flag is a transaction-local setting only this function sets.

create or replace function opportunity_line_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book       uuid;
  v_entry_book uuid;
  v_copying    boolean := coalesce(current_setting('app.copying_accepted_quote', true), '') = 'on';
begin
  -- Snapshot the rate whenever the tax chosen changes.
  if not v_copying and (tg_op = 'INSERT' or new."taxRateId" is distinct from old."taxRateId") then
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
  if not v_copying
     and (tg_op = 'INSERT' or new."productId" is distinct from old."productId")
     and not exists (select 1 from product where id = new."productId" and active and "deletedAt" is null) then
    raise exception 'That product or service is not active.' using errcode = '23514';
  end if;

  new."updatedAt" := now();
  return new;
end $$;

revoke all on function opportunity_line_guard() from public, anon, authenticated;

create or replace function accept_quotation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q        quotation%rowtype;
  v_opp      opportunity%rowtype;
  v_other    text;
  v_actor    uuid := app_current_user_id();
  v_lines    integer;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_q from quotation where id = p_id and "deletedAt" is null for update;
  if not found then
    raise exception 'Quote not found.';
  end if;

  select * into v_opp from opportunity where id = v_q."opportunityId" and "deletedAt" is null for update;
  if not found then
    raise exception 'The deal this quote is for no longer exists.';
  end if;
  -- The deal's own write rule, as saving its lines uses.
  if not app_can_write_owned(v_opp."ownerUserId") then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_q.status <> 'SENT' then
    raise exception 'Only a quote that has been sent to the customer can be accepted.' using errcode = '23514';
  end if;
  select "quoteNumber" into v_other from quotation
  where "opportunityId" = v_q."opportunityId" and status = 'ACCEPTED'
    and "deletedAt" is null and id <> p_id
  limit 1;
  if v_other is not null then
    raise exception '% is already the accepted quote on this deal. Only one quote per opportunity can be accepted.', v_other
      using errcode = '23514';
  end if;
  if v_opp.stage = 'CLOSED_LOST' then
    raise exception 'This deal was lost. Reopen it before accepting a quote on it.' using errcode = '23514';
  end if;

  select count(*) into v_lines from quote_line where "quotationId" = p_id;
  if v_lines = 0 then
    raise exception 'A quote with no lines cannot be accepted.' using errcode = '23514';
  end if;
  if exists (select 1 from quote_line where "quotationId" = p_id and "productId" is null) then
    raise exception 'Every line on the quote must be a product or service before it can be accepted, because the deal is priced by them.'
      using errcode = '23514';
  end if;

  -- The deal becomes exactly what was accepted: its lines, its book, its currency.
  perform set_config('app.copying_accepted_quote', 'on', true);

  delete from opportunity_product where "opportunityId" = v_opp.id;

  update opportunity set
    "priceBookId"  = v_q."priceBookId",
    "currencyCode" = v_q."currencyCode",
    "updatedAt"    = now()
  where id = v_opp.id;

  insert into opportunity_product (
    "opportunityId", "productId", "priceBookEntryId", description,
    quantity, "unitPrice", "licenseCost", "maintenanceCost", "cloudCost", "aiCost",
    "discountPercent", "taxRateId", "taxPercent", "sortOrder"
  )
  select v_opp.id, l."productId", l."priceBookEntryId", l.description,
         l.quantity, l."unitPrice", l."licenseCost", l."maintenanceCost", l."cloudCost", l."aiCost",
         coalesce(l."discountPercent", 0), l."taxRateId", l."taxPercent",
         (row_number() over (order by l."sortOrder"))::int
  from quote_line l
  where l."quotationId" = p_id;

  perform set_config('app.copying_accepted_quote', 'off', true);

  update quotation set status = 'ACCEPTED', "acceptedAt" = now(), "updatedAt" = now()
  where id = p_id;

  -- The customer's commitment moves the deal to its last open stage.
  update opportunity set
    stage                = 'VERBAL_CONFIRMATION',
    "probabilityPercent" = 90,
    "updatedAt"          = now()
  where id = v_opp.id and stage <> 'CLOSED_WON';

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  )
  select gen_random_uuid(), 'Quotation', p_id, 'status', v_q.status::text, 'ACCEPTED', v_actor, 'manual', now()
  union all
  select gen_random_uuid(), 'Opportunity', v_opp.id, 'productsAndServices',
         v_opp.amount::text, o.amount::text, v_actor, 'manual', now()
  from opportunity o where o.id = v_opp.id
  union all
  select gen_random_uuid(), 'Opportunity', v_opp.id, 'stage',
         v_opp.stage::text, o.stage::text, v_actor, 'manual', now()
  from opportunity o where o.id = v_opp.id and o.stage::text is distinct from v_opp.stage::text;

  return (
    select jsonb_build_object(
      'opportunityId', o.id, 'amount', o.amount, 'stage', o.stage,
      'lines', (select count(*) from opportunity_product where "opportunityId" = o.id)
    )
    from opportunity o where o.id = v_opp.id
  );
end $$;

revoke all on function accept_quotation(uuid) from public, anon;
grant execute on function accept_quotation(uuid) to authenticated;
