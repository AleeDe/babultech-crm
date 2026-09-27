-- Partners keep their own items.
--
-- Since 20260928000006 a partner sells BabulTech's Products & Services and
-- their own company's. Until now only our team could create a partner's own
-- item - one owned by the partner's account, added on their behalf. Partners
-- now add and edit theirs from the portal: owned by their company, seen by
-- them and by us, never by another partner. BabulTech's items and the price
-- books stay ours to change.
--
-- A partner's item is priced on each deal line, as any item outside the
-- deal's price book is: the books are ours, and a partner cannot add to them.
--
-- As with everything else a partner writes (20260928000004 for the pattern),
-- this is one SECURITY DEFINER function that checks the item is the partner's
-- first. The product trigger issues the code, keeps a Product from being sold
-- in hours, and locks the type once the item is priced or sold, for partners
-- as for us.

create or replace function partner_save_product(p_id uuid, p_product jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_account uuid := app_partner_account_id();
  v_old     product%rowtype;
  v_type    text := upper(btrim(coalesce(p_product ->> 'productType', '')));
  v_row     jsonb;
begin
  if v_account is null then
    raise exception 'Only a partner company can keep items of its own. Please speak to your partner manager.'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_product ->> 'name', '')), '') is null then
    raise exception 'Give it a name.' using errcode = '23514';
  end if;
  if v_type not in ('PRODUCT', 'SERVICE') then
    raise exception 'Choose Product or Service.' using errcode = '23514';
  end if;

  v_row := jsonb_build_object(
    'name', left(btrim(p_product ->> 'name'), 200),
    'productType', v_type,
    -- Only a service is sold in hours.
    'addInTask', v_type = 'SERVICE' and coalesce(nullif(p_product ->> 'addInTask', '')::boolean, false),
    'active', coalesce(nullif(p_product ->> 'active', '')::boolean, true),
    'description', nullif(btrim(coalesce(p_product ->> 'description', '')), '')
  );

  if p_id is null then
    -- The code is issued by the product trigger whatever is sent.
    return create_record('product', v_row || jsonb_build_object(
      'productCode', 'pending',
      'ownerAccountId', v_account,
      'updatedAt', now()
    ));
  end if;

  select * into v_old from product where id = p_id and "deletedAt" is null for update;
  if not found or v_old."ownerAccountId" is distinct from v_account then
    raise exception 'That item is not one of yours.' using errcode = '42501';
  end if;

  return update_record('product', p_id, v_row, 'Product', app_current_user_id());
end $$;

revoke all on function partner_save_product(uuid, jsonb) from public, anon;
grant execute on function partner_save_product(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
