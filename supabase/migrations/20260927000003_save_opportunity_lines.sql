-- Saving a deal's products and services, all at once.
--
-- The Add Product & Service screen edits several lines together and saves them
-- as one. Done as separate calls, a failure part-way would leave some lines
-- saved and others not, and the deal's amount - which commission pays on -
-- summing a set nobody chose.
--
-- Security definer with its own checks, rather than leaning on the line table's
-- policies: those allow any internal writer to touch any line on any deal. This
-- requires opportunity:write AND that the deal is within the caller's scope,
-- which is the rule for editing the deal itself.
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
  v_opp    opportunity%rowtype;
  v_line   jsonb;
  v_keep   uuid[];
  v_id     uuid;
  v_order  integer := 0;
begin
  if not (app_is_internal() and app_can_write() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_opp from opportunity
  where id = p_opportunity and "deletedAt" is null
  for update;

  if not found then
    raise exception 'That opportunity no longer exists.';
  end if;
  -- The same scope rule the opportunity's own policies use.
  if v_opp."ownerUserId" not in (select app_visible_owner_ids()) then
    raise exception 'Not permitted.' using errcode = '42501';
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

revoke all on function save_opportunity_lines(uuid, uuid, jsonb) from public, anon;
grant execute on function save_opportunity_lines(uuid, uuid, jsonb) to authenticated;
