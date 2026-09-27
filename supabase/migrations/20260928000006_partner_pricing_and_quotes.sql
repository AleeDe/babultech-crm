-- Partners price their deals, and quote them.
--
-- The portal gains what our deal page has: Add Product & Service with the full
-- pricing - a price book, the four costs, discount and tax on every line - and
-- quotations priced the same way, sent to the customer, accepted and revised.
-- The pricing rules are ours (20260928000003). Three rules are the partner's
-- alone:
--
--   1. What they sell is BabulTech's own items and their own company's
--      (Products & Services owned by BabulTech's company account, or by the
--      partner's). They never see another partner's items. Price books are
--      read, never written.
--
--   2. A quote a partner prepares - creates, edits or revises - is approved by
--      one of our managers ("Approve quotations") before it can go to the
--      customer. An approved quote the partner then changes needs approving
--      again. Our team's own quotes are unchanged: none of this applies to them.
--
--   3. Once the customer has accepted a quote, the deal is what they accepted,
--      and a partner can no longer change its products and services - nor
--      those of a closed deal. Commission is paid on the deal's amount, so the
--      amount a partner is paid on is always one a manager approved and the
--      customer accepted.
--
-- As with everything else a partner writes (20260928000004 for the pattern),
-- each change is one SECURITY DEFINER function that checks the record is the
-- partner's first. Row-level security gives them read access to their own
-- deals' lines and quotes, and to the catalogue in rule 1.

-- ---------------------------------------------------------------------------
-- 1. What a partner may read
-- ---------------------------------------------------------------------------

-- The partner's own company, which owns the items they sell. An individual
-- partner has no company, and so no items of their own.
create or replace function app_partner_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p."accountId" from partner p where p.id = app_current_partner_id();
$$;

revoke all on function app_partner_account_id() from public, anon;
grant execute on function app_partner_account_id() to authenticated;

-- What a partner may sell: BabulTech's items and their company's. An item
-- saved with no owner is given BabulTech's own company account
-- (company_setting."accountId") by product_code_and_type, so that account is
-- what marks an item as ours; a blank owner is still read as ours.
create or replace function app_partner_catalogue_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select pr.id
  from product pr
  where app_current_partner_id() is not null
    and pr."deletedAt" is null
    and (
      pr."ownerAccountId" is null
      or pr."ownerAccountId" = (select cs."accountId" from company_setting cs limit 1)
      or pr."ownerAccountId" = app_partner_account_id()
    );
$$;

revoke all on function app_partner_catalogue_ids() from public, anon;
grant execute on function app_partner_catalogue_ids() to authenticated;

create or replace function app_partner_quotation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.id
  from quotation q
  where app_current_partner_id() is not null
    and q."deletedAt" is null
    and q."opportunityId" in (select app_partner_opportunity_ids());
$$;

revoke all on function app_partner_quotation_ids() from public, anon;
grant execute on function app_partner_quotation_ids() to authenticated;

-- What a partner may read: that catalogue, and whatever is already on their
-- own deals and quotes, so a line our team added still says what it is.
create or replace function app_partner_product_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c from app_partner_catalogue_ids() c
  union
  select l."productId" from opportunity_product l
  where l."opportunityId" in (select app_partner_opportunity_ids())
  union
  select l."productId" from quote_line l
  where l."quotationId" in (select app_partner_quotation_ids()) and l."productId" is not null;
$$;

revoke all on function app_partner_product_ids() from public, anon;
grant execute on function app_partner_product_ids() to authenticated;

-- Active books, and any their deals or quotes were priced from.
create or replace function app_partner_price_book_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from price_book b
  where app_current_partner_id() is not null
    and b."deletedAt" is null
    and (
      b.active
      or b.id in (select o."priceBookId" from opportunity o where o.id in (select app_partner_opportunity_ids()))
      or b.id in (select q."priceBookId" from quotation q where q.id in (select app_partner_quotation_ids()))
    );
$$;

revoke all on function app_partner_price_book_ids() from public, anon;
grant execute on function app_partner_price_book_ids() to authenticated;

drop policy if exists product_partner_read on product;
create policy product_partner_read on product
  for select
  using (app_current_partner_id() is not null and id in (select app_partner_product_ids()));

drop policy if exists price_book_partner_read on price_book;
create policy price_book_partner_read on price_book
  for select
  using (app_current_partner_id() is not null and id in (select app_partner_price_book_ids()));

-- A book's prices, for the items the partner may sell.
drop policy if exists price_book_entry_partner_read on price_book_entry;
create policy price_book_entry_partner_read on price_book_entry
  for select
  using (
    app_current_partner_id() is not null
    and "deletedAt" is null
    and "priceBookId" in (select app_partner_price_book_ids())
    and "productId" in (select app_partner_catalogue_ids())
  );

drop policy if exists tax_rate_partner_read on tax_rate;
create policy tax_rate_partner_read on tax_rate
  for select
  using (app_current_partner_id() is not null);

drop policy if exists opportunity_product_partner_read on opportunity_product;
create policy opportunity_product_partner_read on opportunity_product
  for select
  using (app_current_partner_id() is not null and "opportunityId" in (select app_partner_opportunity_ids()));

drop policy if exists quote_line_partner_read on quote_line;
create policy quote_line_partner_read on quote_line
  for select
  using (app_current_partner_id() is not null and "quotationId" in (select app_partner_quotation_ids()));

-- ---------------------------------------------------------------------------
-- 2. A partner's quote waits for approval
-- ---------------------------------------------------------------------------
--
-- status carries where the quote is (DRAFT, UNDER_REVIEW while it waits,
-- APPROVED, then SENT and on); approvalStatus carries the decision (PENDING,
-- APPROVED, or REJECTED when it was sent back, with the reason in
-- approvalNote). The constraint is the rule itself: whatever path a quote takes,
-- one a partner prepared cannot reach the customer unapproved.

alter table quotation
  add column if not exists "preparedByPartnerId" uuid references partner (id) on delete set null,
  add column if not exists "approvalRequestedAt" timestamp(3),
  add column if not exists "approvalDecidedAt"   timestamp(3),
  add column if not exists "approvalDecidedById" uuid references app_user (id) on delete set null,
  add column if not exists "approvalNote"        text;

create index if not exists quotation_prepared_by_partner_idx
  on quotation ("preparedByPartnerId") where "preparedByPartnerId" is not null;
create index if not exists quotation_pending_approval_idx
  on quotation ("approvalRequestedAt") where "approvalStatus" = 'PENDING';

alter table quotation drop constraint if exists quotation_partner_quote_approved;
alter table quotation add constraint quotation_partner_quote_approved check (
  "preparedByPartnerId" is null
  or status in ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REVISED', 'EXPIRED')
  or "approvalStatus" = 'APPROVED'
);

-- ---------------------------------------------------------------------------
-- 3. A deal's lines, whoever saves them
-- ---------------------------------------------------------------------------
--
-- save_opportunity_lines is split, as the project a win starts was in
-- 20260928000005: the body is write_opportunity_lines, which only other
-- functions may call, and each entry point makes its own check first. Ours is
-- unchanged.

create or replace function write_opportunity_lines(
  p_opportunity uuid,
  p_price_book  uuid,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp    opportunity%rowtype;
  v_line   jsonb;
  v_keep   uuid[];
  v_id     uuid;
  v_order  integer := 0;
begin
  select * into v_opp from opportunity
  where id = p_opportunity and "deletedAt" is null
  for update;

  if not found then
    raise exception 'That opportunity no longer exists.';
  end if;
  if v_opp.stage = 'CLOSED_LOST' then
    raise exception 'This deal was lost, so what was on it is kept as it was.' using errcode = '23514';
  end if;

  if p_price_book is not null and not exists (
    select 1 from price_book where id = p_price_book and active and "deletedAt" is null
  ) then
    raise exception 'That price book is not active.' using errcode = '23514';
  end if;

  -- Which existing lines the screen still has. Anything else was removed.
  select coalesce(array_agg((l ->> 'id')::uuid), array[]::uuid[]) into v_keep
  from jsonb_array_elements(p_lines) l
  where nullif(l ->> 'id', '') is not null;

  delete from opportunity_product
  where "opportunityId" = p_opportunity and not (id = any (v_keep));

  -- Only now, with removed lines gone, can the book change: the lock refuses a
  -- change while lines from the old book remain.
  if p_price_book is distinct from v_opp."priceBookId" then
    update opportunity set "priceBookId" = p_price_book, "updatedAt" = now()
    where id = p_opportunity;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    v_id := nullif(v_line ->> 'id', '')::uuid;

    if v_id is not null then
      update opportunity_product set
        "productId"        = (v_line ->> 'productId')::uuid,
        "priceBookEntryId" = nullif(v_line ->> 'priceBookEntryId', '')::uuid,
        description        = nullif(btrim(coalesce(v_line ->> 'description', '')), ''),
        quantity           = coalesce((v_line ->> 'quantity')::numeric, 0),
        "unitPrice"        = coalesce((v_line ->> 'unitPrice')::numeric, 0),
        "licenseCost"      = coalesce((v_line ->> 'licenseCost')::numeric, 0),
        "maintenanceCost"  = coalesce((v_line ->> 'maintenanceCost')::numeric, 0),
        "cloudCost"        = coalesce((v_line ->> 'cloudCost')::numeric, 0),
        "aiCost"           = coalesce((v_line ->> 'aiCost')::numeric, 0),
        "discountPercent"  = coalesce((v_line ->> 'discountPercent')::numeric, 0),
        "taxRateId"        = nullif(v_line ->> 'taxRateId', '')::uuid,
        "sortOrder"        = v_order
      where id = v_id and "opportunityId" = p_opportunity;
    else
      insert into opportunity_product (
        "opportunityId", "productId", "priceBookEntryId", description,
        quantity, "unitPrice", "licenseCost", "maintenanceCost", "cloudCost", "aiCost",
        "discountPercent", "taxRateId", "sortOrder"
      ) values (
        p_opportunity,
        (v_line ->> 'productId')::uuid,
        nullif(v_line ->> 'priceBookEntryId', '')::uuid,
        nullif(btrim(coalesce(v_line ->> 'description', '')), ''),
        coalesce((v_line ->> 'quantity')::numeric, 0),
        coalesce((v_line ->> 'unitPrice')::numeric, 0),
        coalesce((v_line ->> 'licenseCost')::numeric, 0),
        coalesce((v_line ->> 'maintenanceCost')::numeric, 0),
        coalesce((v_line ->> 'cloudCost')::numeric, 0),
        coalesce((v_line ->> 'aiCost')::numeric, 0),
        coalesce((v_line ->> 'discountPercent')::numeric, 0),
        nullif(v_line ->> 'taxRateId', '')::uuid,
        v_order
      );
    end if;
  end loop;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  )
  select gen_random_uuid(), 'Opportunity', p_opportunity, 'productsAndServices',
         v_opp.amount::text, o.amount::text, app_current_user_id(), 'manual', now()
  from opportunity o where o.id = p_opportunity;

  return (
    select jsonb_build_object(
      'amount', amount, 'netAmount', "netAmount", 'taxAmount', "taxAmount",
      'lines', (select count(*) from opportunity_product where "opportunityId" = p_opportunity)
    )
    from opportunity where id = p_opportunity
  );
end $$;

revoke all on function write_opportunity_lines(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function save_opportunity_lines(
  p_opportunity uuid,
  p_price_book  uuid,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select "ownerUserId" into v_owner from opportunity
  where id = p_opportunity and "deletedAt" is null;
  if not found then
    raise exception 'That opportunity no longer exists.';
  end if;
  -- EXACTLY the rule the opportunity's own write policy applies
  -- (20260927000004).
  if not app_can_write_owned(v_owner) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  return write_opportunity_lines(p_opportunity, p_price_book, p_lines);
end $$;

revoke all on function save_opportunity_lines(uuid, uuid, jsonb) from public, anon;
grant execute on function save_opportunity_lines(uuid, uuid, jsonb) to authenticated;

-- Every line a partner sends: an item they may sell, priced from the book it
-- says it is, with no negative amounts. Items already on the deal, or on the
-- quote being edited, may stay even if they are not in the partner's
-- catalogue - our team may have put them there.
create or replace function partner_check_lines(
  p_lines       jsonb,
  p_opportunity uuid,
  p_quotation   uuid,
  p_price_book  uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_line    jsonb;
  v_product uuid;
  v_entry   uuid;
  v_key     text;
  v_disc    numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The products and services are missing.' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product := nullif(v_line ->> 'productId', '')::uuid;
    if v_product is null then
      raise exception 'Choose a product or service on every line.' using errcode = '23514';
    end if;
    if not (
      v_product in (select app_partner_catalogue_ids())
      or v_product in (select "productId" from opportunity_product where "opportunityId" = p_opportunity)
      or (p_quotation is not null
          and v_product in (select "productId" from quote_line where "quotationId" = p_quotation))
    ) then
      raise exception 'One of those products or services is not one you can sell.' using errcode = '42501';
    end if;

    v_entry := nullif(v_line ->> 'priceBookEntryId', '')::uuid;
    if v_entry is not null and not exists (
      select 1 from price_book_entry where id = v_entry and "priceBookId" = p_price_book
    ) then
      raise exception 'A price on one of the lines is not from the price book chosen.' using errcode = '23514';
    end if;

    foreach v_key in array array['quantity', 'unitPrice', 'licenseCost', 'maintenanceCost', 'cloudCost', 'aiCost'] loop
      if coalesce(nullif(v_line ->> v_key, '')::numeric, 0) < 0 then
        raise exception 'Amounts cannot be negative.' using errcode = '23514';
      end if;
    end loop;
    v_disc := coalesce(nullif(v_line ->> 'discountPercent', '')::numeric, 0);
    if v_disc < 0 or v_disc > 100 then
      raise exception 'A discount is between 0 and 100%%.' using errcode = '23514';
    end if;
  end loop;
end $$;

revoke all on function partner_check_lines(jsonb, uuid, uuid, uuid) from public, anon, authenticated;

-- A partner's own deals, while they are open and before the customer has
-- accepted a quote on them.
create or replace function partner_save_opportunity_lines(
  p_opportunity uuid,
  p_price_book  uuid,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner  uuid := partner_assert_active();
  v_opp      opportunity%rowtype;
  v_accepted text;
begin
  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or v_opp."sourcePartnerId" is distinct from v_partner then
    raise exception 'That deal is not one of yours.' using errcode = '42501';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so what was sold on it stays as it is.' using errcode = '23514';
  end if;

  select "quoteNumber" into v_accepted from quotation
  where "opportunityId" = p_opportunity and status = 'ACCEPTED' and "deletedAt" is null
  limit 1;
  if v_accepted is not null then
    raise exception 'The customer accepted %, so this deal is priced as that quote. Ask your partner manager if it needs to change.', v_accepted
      using errcode = '23514';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    if p_price_book is null then
      raise exception 'Choose the price book this deal is priced from.' using errcode = '23514';
    end if;
    if p_price_book not in (select app_partner_price_book_ids()) then
      raise exception 'That price book is not available.' using errcode = '42501';
    end if;
  end if;

  perform partner_check_lines(coalesce(p_lines, '[]'::jsonb), p_opportunity, null, p_price_book);

  return write_opportunity_lines(p_opportunity, p_price_book, coalesce(p_lines, '[]'::jsonb));
end $$;

revoke all on function partner_save_opportunity_lines(uuid, uuid, jsonb) from public, anon;
grant execute on function partner_save_opportunity_lines(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Accepting a quote, whoever records it
-- ---------------------------------------------------------------------------
--
-- accept_quotation split the same way: apply_accepted_quotation is the body,
-- unchanged, and each entry point checks who is asking first.

create or replace function apply_accepted_quotation(p_id uuid)
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
  select * into v_q from quotation where id = p_id and "deletedAt" is null for update;
  if not found then
    raise exception 'Quote not found.';
  end if;

  select * into v_opp from opportunity where id = v_q."opportunityId" and "deletedAt" is null for update;
  if not found then
    raise exception 'The deal this quote is for no longer exists.';
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

revoke all on function apply_accepted_quotation(uuid) from public, anon, authenticated;

create or replace function accept_quotation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select o."ownerUserId" into v_owner
  from quotation q join opportunity o on o.id = q."opportunityId"
  where q.id = p_id and q."deletedAt" is null;
  if not found then
    raise exception 'Quote not found.';
  end if;
  -- The deal's own write rule, as saving its lines uses.
  if not app_can_write_owned(v_owner) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  return apply_accepted_quotation(p_id);
end $$;

revoke all on function accept_quotation(uuid) from public, anon;
grant execute on function accept_quotation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A partner's quotes
-- ---------------------------------------------------------------------------

-- The quote header a partner sends, checked and tidied.
create or replace function partner_quote_header(p_quote jsonb, p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_contact  uuid := nullif(p_quote ->> 'contactId', '')::uuid;
  v_book     uuid := nullif(p_quote ->> 'priceBookId', '')::uuid;
  v_currency text := upper(btrim(coalesce(p_quote ->> 'currencyCode', '')));
  v_issued   date := nullif(p_quote ->> 'quoteDate', '')::date;
  v_expires  date := nullif(p_quote ->> 'expiryDate', '')::date;
begin
  if v_issued is null or v_expires is null then
    raise exception 'A quote needs a date and a valid-until date.' using errcode = '23514';
  end if;
  if v_expires < v_issued then
    raise exception 'A quote cannot expire before it is issued.' using errcode = '23514';
  end if;
  if not exists (select 1 from currency where code = v_currency and active) then
    raise exception 'Choose a currency to quote in.' using errcode = '23514';
  end if;
  if v_book is null then
    raise exception 'Choose the price book this quote is priced from.' using errcode = '23514';
  end if;
  if v_book not in (select app_partner_price_book_ids()) then
    raise exception 'That price book is not available.' using errcode = '42501';
  end if;
  if v_contact is not null and not exists (
    select 1 from contact where id = v_contact and "accountId" = p_account and "deletedAt" is null
  ) then
    raise exception 'That contact does not work at this customer.' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'contactId', v_contact,
    'quoteDate', v_issued,
    'expiryDate', v_expires,
    'currencyCode', v_currency,
    'priceBookId', v_book,
    'paymentTerms', nullif(btrim(coalesce(p_quote ->> 'paymentTerms', '')), ''),
    'notes', nullif(btrim(coalesce(p_quote ->> 'notes', '')), ''),
    'termsAndConditions', nullif(btrim(coalesce(p_quote ->> 'termsAndConditions', '')), '')
  );
end $$;

revoke all on function partner_quote_header(jsonb, uuid) from public, anon, authenticated;

-- A quote's lines replaced with those given. A line with no description of its
-- own reads as its item's name, because the description is what the customer
-- sees - as quotations.ts does for ours.
create or replace function write_quote_lines(p_quotation uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from quote_line where "quotationId" = p_quotation;

  insert into quote_line (
    id, "quotationId", "productId", "priceBookEntryId", description,
    quantity, "unitPrice", "licenseCost", "maintenanceCost", "cloudCost", "aiCost",
    "discountPercent", "taxRateId", "sortOrder", "createdAt", "updatedAt"
  )
  select gen_random_uuid(), p_quotation, (x.l ->> 'productId')::uuid,
         nullif(x.l ->> 'priceBookEntryId', '')::uuid,
         coalesce(nullif(btrim(coalesce(x.l ->> 'description', '')), ''), pr.name, 'Item'),
         coalesce(nullif(x.l ->> 'quantity', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'unitPrice', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'licenseCost', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'maintenanceCost', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'cloudCost', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'aiCost', '')::numeric, 0),
         coalesce(nullif(x.l ->> 'discountPercent', '')::numeric, 0),
         nullif(x.l ->> 'taxRateId', '')::uuid,
         (x.n - 1)::int, now(), now()
  from jsonb_array_elements(p_lines) with ordinality as x(l, n)
  left join product pr on pr.id = (x.l ->> 'productId')::uuid;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function write_quote_lines(uuid, jsonb) from public, anon, authenticated;

-- Locks the quote and its deal once the quote is known to be the partner's,
-- and returns the deal. Each caller then reads both rows it has locked.
create or replace function partner_lock_quote(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_deal    uuid;
  v_source  uuid;
begin
  select "opportunityId" into v_deal from quotation where id = p_id and "deletedAt" is null for update;
  if not found then
    raise exception 'That quote is not one of yours.' using errcode = '42501';
  end if;
  select "sourcePartnerId" into v_source from opportunity where id = v_deal and "deletedAt" is null for update;
  if not found or v_source is distinct from v_partner then
    raise exception 'That quote is not one of yours.' using errcode = '42501';
  end if;
  return v_deal;
end $$;

revoke all on function partner_lock_quote(uuid) from public, anon, authenticated;

create or replace function partner_create_quotation(p_opportunity uuid, p_quote jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_actor   uuid := app_current_user_id();
  v_opp     opportunity%rowtype;
  v_head    jsonb;
  v_id      uuid := gen_random_uuid();
  v_number  text;
  v_version integer;
begin
  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or v_opp."sourcePartnerId" is distinct from v_partner then
    raise exception 'That deal is not one of yours.' using errcode = '42501';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so there is nothing more to quote.' using errcode = '23514';
  end if;

  v_head := partner_quote_header(p_quote, v_opp."accountId");
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'A quote needs at least one product or service.' using errcode = '23514';
  end if;
  perform partner_check_lines(p_lines, p_opportunity, null, (v_head ->> 'priceBookId')::uuid);

  select coalesce(max("versionNumber"), 0) + 1 into v_version
  from quotation where "opportunityId" = p_opportunity;
  v_number := next_sequence_number('Quotation');

  insert into quotation (
    id, "quoteNumber", "opportunityId", "accountId", "contactId", "versionNumber", status,
    "quoteDate", "expiryDate", "currencyCode", "priceBookId", "paymentTerms", notes,
    "termsAndConditions", "approvalStatus", "preparedByPartnerId", "createdAt", "updatedAt"
  ) values (
    v_id, v_number, p_opportunity, v_opp."accountId", (v_head ->> 'contactId')::uuid, v_version, 'DRAFT',
    (v_head ->> 'quoteDate')::date, (v_head ->> 'expiryDate')::date, v_head ->> 'currencyCode',
    (v_head ->> 'priceBookId')::uuid, v_head ->> 'paymentTerms', v_head ->> 'notes',
    v_head ->> 'termsAndConditions', 'NOT_REQUIRED', v_partner, now(), now()
  );

  perform write_quote_lines(v_id, p_lines);

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Quotation', v_id, 'status', null, 'DRAFT', v_actor, 'UI', now()
  );

  return jsonb_build_object('id', v_id, 'quoteNumber', v_number);
end $$;

revoke all on function partner_create_quotation(uuid, jsonb, jsonb) from public, anon;
grant execute on function partner_create_quotation(uuid, jsonb, jsonb) to authenticated;

-- A draft, or an approved quote not yet sent. Changing an approved quote
-- takes it back to a draft that needs approving again; changing one of ours
-- makes it the partner's, with the same rule.
create or replace function partner_update_quotation(p_id uuid, p_quote jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_actor   uuid := app_current_user_id();
  v_q       quotation%rowtype;
  v_opp     opportunity%rowtype;
  v_head    jsonb;
  v_total   numeric;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status = 'UNDER_REVIEW' then
    raise exception '% is waiting for approval. Withdraw the request to change it.', v_q."quoteNumber"
      using errcode = '23514';
  end if;
  if v_q.status not in ('DRAFT', 'APPROVED') then
    raise exception '% has gone to the customer, so it stays as it was sent. Revise it instead.', v_q."quoteNumber"
      using errcode = '23514';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so its quotes stay as they are.' using errcode = '23514';
  end if;

  v_head := partner_quote_header(p_quote, v_opp."accountId");
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'A quote needs at least one product or service.' using errcode = '23514';
  end if;
  perform partner_check_lines(p_lines, v_opp.id, p_id, (v_head ->> 'priceBookId')::uuid);

  v_total := v_q."totalAmount";
  perform write_quote_lines(p_id, p_lines);

  perform update_record('quotation', p_id, jsonb_build_object(
    'contactId', v_head -> 'contactId',
    'quoteDate', v_head -> 'quoteDate',
    'expiryDate', v_head -> 'expiryDate',
    'currencyCode', v_head -> 'currencyCode',
    'priceBookId', v_head -> 'priceBookId',
    'paymentTerms', v_head -> 'paymentTerms',
    'notes', v_head -> 'notes',
    'termsAndConditions', v_head -> 'termsAndConditions',
    'status', 'DRAFT',
    -- A sent-back quote stays sent back, with its reason, until it is asked
    -- for again. Anything else starts over.
    'approvalStatus', case when v_q."approvalStatus" = 'REJECTED' and v_q."preparedByPartnerId" is not null
                           then 'REJECTED' else 'NOT_REQUIRED' end,
    'preparedByPartnerId', v_partner
  ), 'Quotation', v_actor);

  -- The header's total is the lines', worked out by the database; recorded
  -- here, as a deal's is, so the history shows what the edit did to it.
  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  )
  select gen_random_uuid(), 'Quotation', p_id, 'totalAmount', v_total::text, q."totalAmount"::text,
         v_actor, 'UI', now()
  from quotation q where q.id = p_id and q."totalAmount" is distinct from v_total;

  return jsonb_build_object('id', p_id);
end $$;

revoke all on function partner_update_quotation(uuid, jsonb, jsonb) from public, anon;
grant execute on function partner_update_quotation(uuid, jsonb, jsonb) to authenticated;

create or replace function partner_request_quotation_approval(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q   quotation%rowtype;
  v_opp opportunity%rowtype;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status <> 'DRAFT' then
    raise exception '% is not a draft, so there is nothing to approve.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_q."preparedByPartnerId" is null then
    raise exception '% was prepared by BabulTech, so it needs no approval.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so its quotes stay as they are.' using errcode = '23514';
  end if;
  if not exists (select 1 from quote_line where "quotationId" = p_id) then
    raise exception 'A quote with no lines cannot be approved.' using errcode = '23514';
  end if;
  if v_q."expiryDate" < current_date then
    raise exception 'This quote''s valid-until date has passed. Extend it first.' using errcode = '23514';
  end if;

  perform update_record('quotation', p_id, jsonb_build_object(
    'status', 'UNDER_REVIEW',
    'approvalStatus', 'PENDING',
    'approvalRequestedAt', now()
  ), 'Quotation', app_current_user_id());

  return jsonb_build_object('status', 'UNDER_REVIEW');
end $$;

revoke all on function partner_request_quotation_approval(uuid) from public, anon;
grant execute on function partner_request_quotation_approval(uuid) to authenticated;

create or replace function partner_withdraw_quotation_approval(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q   quotation%rowtype;
  v_opp opportunity%rowtype;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status <> 'UNDER_REVIEW' or v_q."approvalStatus" <> 'PENDING' then
    raise exception '% is not waiting for approval.', v_q."quoteNumber" using errcode = '23514';
  end if;

  perform update_record('quotation', p_id, jsonb_build_object(
    'status', 'DRAFT',
    'approvalStatus', 'NOT_REQUIRED',
    'approvalRequestedAt', null
  ), 'Quotation', app_current_user_id());

  return jsonb_build_object('status', 'DRAFT');
end $$;

revoke all on function partner_withdraw_quotation_approval(uuid) from public, anon;
grant execute on function partner_withdraw_quotation_approval(uuid) to authenticated;

-- Our side of the approval. Whoever may approve quotations, and can see the
-- deal, decides; sending one back needs a reason, so the partner knows what
-- to change.
create or replace function decide_quotation_approval(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q     quotation%rowtype;
  v_actor uuid := app_current_user_id();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('quotation:approve')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_q from quotation where id = p_id and "deletedAt" is null for update;
  if not found then
    raise exception 'Quote not found.';
  end if;
  -- The quotation read policy's rule: a quote the approver cannot see is not
  -- theirs to decide.
  if not (app_current_scope() = 'ALL'
          or v_q."opportunityId" in (select app_internal_visible_opportunity_ids())) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_q.status <> 'UNDER_REVIEW' or v_q."approvalStatus" <> 'PENDING' then
    raise exception '% is not waiting for approval.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say why it is being sent back, so the partner knows what to change.' using errcode = '23514';
  end if;

  perform update_record('quotation', p_id, jsonb_build_object(
    'status', case when p_approve then 'APPROVED' else 'DRAFT' end,
    'approvalStatus', case when p_approve then 'APPROVED' else 'REJECTED' end,
    'approvalDecidedAt', now(),
    'approvalDecidedById', v_actor,
    'approvalNote', v_note
  ), 'Quotation', v_actor);

  return jsonb_build_object(
    'status', case when p_approve then 'APPROVED' else 'DRAFT' end,
    'approvalStatus', case when p_approve then 'APPROVED' else 'REJECTED' end
  );
end $$;

revoke all on function decide_quotation_approval(uuid, boolean, text) from public, anon;
grant execute on function decide_quotation_approval(uuid, boolean, text) to authenticated;

-- Into the customer's hands. An approved quote, or a draft our team prepared,
-- which needs no approval. Moves an early deal on to Quote Submitted, as
-- sending one of ours does.
create or replace function partner_send_quotation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := app_current_user_id();
  v_q     quotation%rowtype;
  v_opp   opportunity%rowtype;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status in ('DRAFT', 'UNDER_REVIEW') and v_q."preparedByPartnerId" is not null then
    raise exception '% needs your partner manager''s approval before it goes to the customer.', v_q."quoteNumber"
      using errcode = '23514';
  end if;
  if v_q.status = 'REVISED' then
    raise exception '% has been replaced by a newer version. Send that one.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_q.status not in ('DRAFT', 'APPROVED') then
    raise exception '% has already been sent.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so its quotes stay as they are.' using errcode = '23514';
  end if;
  if not exists (select 1 from quote_line where "quotationId" = p_id) then
    raise exception 'A quote with no lines cannot be sent.' using errcode = '23514';
  end if;
  if v_q."expiryDate" < current_date then
    raise exception 'This quote''s valid-until date has passed. Change its dates before sending it.'
      using errcode = '23514';
  end if;

  perform update_record('quotation', p_id, jsonb_build_object('status', 'SENT', 'sentAt', now()), 'Quotation', v_actor);

  if v_opp.stage in ('DISCOVERY', 'QUALIFICATION', 'REQUIREMENTS', 'SOLUTION_PROPOSED') then
    perform update_record('opportunity', v_opp.id, jsonb_build_object(
      'stage', 'QUOTE_SUBMITTED', 'probabilityPercent', 60
    ), 'Opportunity', v_actor);
  end if;

  return jsonb_build_object(
    'status', 'SENT',
    'dealStage', (select stage from opportunity where id = v_opp.id)
  );
end $$;

revoke all on function partner_send_quotation(uuid) from public, anon;
grant execute on function partner_send_quotation(uuid) to authenticated;

-- The customer's answer. Accepting puts the quote's lines on the deal and
-- moves it to Verbal Confirmation, exactly as it does for us.
create or replace function partner_decide_quotation(p_id uuid, p_accepted boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q   quotation%rowtype;
  v_opp opportunity%rowtype;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status <> 'SENT' then
    raise exception 'Only a quote that has been sent to the customer can be accepted or rejected.' using errcode = '23514';
  end if;

  if p_accepted then
    return apply_accepted_quotation(p_id);
  end if;

  perform update_record('quotation', p_id, jsonb_build_object('status', 'REJECTED', 'acceptedAt', null),
                        'Quotation', app_current_user_id());
  return jsonb_build_object('status', 'REJECTED');
end $$;

revoke all on function partner_decide_quotation(uuid, boolean) from public, anon;
grant execute on function partner_decide_quotation(uuid, boolean) to authenticated;

-- A new version of a quote the customer has seen. It starts as a draft of the
-- partner's, so it is approved before it goes out, like any other.
create or replace function partner_revise_quotation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_q       quotation%rowtype;
  v_opp     opportunity%rowtype;
  v_new     jsonb;
begin
  select * into v_opp from opportunity where id = (select partner_lock_quote(p_id));
  select * into v_q from quotation where id = p_id;

  if v_q.status = 'ACCEPTED' then
    raise exception 'An accepted quote cannot be revised — it is the basis of the deal.' using errcode = '23514';
  end if;
  if v_q.status in ('DRAFT', 'APPROVED') then
    raise exception '% has not gone to the customer yet, so change it instead.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_q.status = 'UNDER_REVIEW' then
    raise exception '% is waiting for approval. Withdraw the request to change it.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_q.status = 'REVISED' then
    raise exception '% has already been revised. Work on its newest version.', v_q."quoteNumber" using errcode = '23514';
  end if;
  if v_opp.stage in ('CLOSED_WON', 'CLOSED_LOST') then
    raise exception 'This deal is closed, so its quotes stay as they are.' using errcode = '23514';
  end if;

  v_new := revise_quotation(p_id, app_current_user_id());
  update quotation set "preparedByPartnerId" = v_partner, "updatedAt" = now()
  where id = (v_new ->> 'id')::uuid;

  return v_new;
end $$;

revoke all on function partner_revise_quotation(uuid) from public, anon;
grant execute on function partner_revise_quotation(uuid) to authenticated;

notify pgrst, 'reload schema';
