-- The deal a partner adds, credited to them and closer to the internal form.
--
-- Two changes to partner_add_opportunity: it stamps attribution the way the
-- other partner-facing functions now do, and it takes the two fields the
-- internal deal form has that a partner is better placed to answer than we are
-- - how likely they think it is, and where the customer came from.
--
-- Still deliberately absent: stage and owner (our process, our people),
-- campaign (our attribution), and product, price book and discount (our
-- pricing, and partners hold no product:read).

create or replace function partner_add_opportunity(
  p_account_id  uuid,
  p_name        text,
  p_amount      numeric default 0,
  p_close_date  date default null,
  p_currency    text default 'PKR',
  p_contact_id  uuid default null,
  p_notes       text default null,
  p_deal_type   text default null,
  p_next_step   text default null,
  p_competitor  text default null,
  p_new_first   text default null,
  p_new_last    text default null,
  p_new_title   text default null,
  p_new_email   text default null,
  p_new_phone   text default null,
  p_street      text default null,
  p_city        text default null,
  p_state       text default null,
  p_postal_code text default null,
  p_country     text default null,
  -- New: the partner's own read of the deal.
  p_probability numeric default null,
  p_lead_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_user    uuid := app_current_user_id();
  v_id      uuid := gen_random_uuid();
  v_number  text;
  v_owner   uuid;
  v_status  text;
  v_contact uuid := p_contact_id;
  v_address jsonb;
  v_has_address boolean;
begin
  if v_partner is null then
    raise exception 'Only a partner may add a deal here.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'The deal needs a name.';
  end if;

  select a."ownerUserId",
         a."billingAddress" is not null and a."billingAddress" <> '{}'::jsonb
    into v_owner, v_has_address
  from account a
  where a.id = p_account_id
    and a."deletedAt" is null
    and a."sourcePartnerId" = v_partner;

  if v_owner is null then
    raise exception 'That customer is not one of yours.';
  end if;

  select status into v_status from partner where id = v_partner;
  if v_status <> 'ACTIVE' then
    raise exception 'Only an active partnership can add deals. Please speak to your partner manager.';
  end if;

  if coalesce(btrim(coalesce(p_new_first, '')), '') <> ''
     and coalesce(btrim(coalesce(p_new_last, '')), '') <> '' then
    v_contact := gen_random_uuid();
    insert into contact (
      id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
      "isPrimary", active, "sourcePartnerId", "sourcePartnerUserId",
      "createdAt", "updatedAt"
    ) values (
      v_contact, p_account_id, btrim(p_new_first), btrim(p_new_last),
      nullif(btrim(coalesce(p_new_title, '')), ''),
      nullif(btrim(coalesce(p_new_email, '')), ''),
      nullif(btrim(coalesce(p_new_phone, '')), ''),
      false, true, v_partner, v_user, now(), now()
    );
  elsif v_contact is not null
        and not exists (
          select 1 from contact
          where id = v_contact and "accountId" = p_account_id and "deletedAt" is null
        ) then
    raise exception 'That contact does not work at this customer.';
  end if;

  v_address := jsonb_strip_nulls(jsonb_build_object(
    'street',     nullif(btrim(coalesce(p_street, '')), ''),
    'city',       nullif(btrim(coalesce(p_city, '')), ''),
    'state',      nullif(btrim(coalesce(p_state, '')), ''),
    'postalCode', nullif(btrim(coalesce(p_postal_code, '')), ''),
    'country',    nullif(btrim(coalesce(p_country, '')), '')
  ));

  if not v_has_address and v_address <> '{}'::jsonb then
    update account
       set "billingAddress" = v_address, "updatedAt" = now()
     where id = p_account_id;
  end if;

  v_number := next_sequence_number('Opportunity');

  insert into opportunity (
    id, "opportunityNumber", name, "accountId", "primaryContactId",
    "ownerUserId", stage, amount, "currencyCode", "expectedCloseDate",
    "opportunityType", "leadSource", "nextStep", "competitorName",
    "probabilityPercent", "sourcePartnerId", "sourcePartnerUserId",
    description, "createdAt", "updatedAt"
  ) values (
    v_id, v_number, btrim(p_name), p_account_id, v_contact,
    v_owner, 'DISCOVERY', coalesce(p_amount, 0),
    coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'PKR'),
    coalesce(p_close_date, current_date + 30),
    case
      when p_deal_type is null then 'NEW'::"OpportunityType"
      when exists (
        select 1 from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'OpportunityType' and e.enumlabel = p_deal_type
      ) then p_deal_type::"OpportunityType"
      else 'NEW'::"OpportunityType"
    end,
    -- Where the customer came from, in the partner's words. Defaults to
    -- Partner, which is true whatever else they say.
    coalesce(nullif(btrim(coalesce(p_lead_source, '')), ''), 'Partner'),
    left(nullif(btrim(coalesce(p_next_step, '')), ''), 500),
    left(nullif(btrim(coalesce(p_competitor, '')), ''), 200),
    -- Out of range is treated as unanswered rather than rejected: the deal
    -- matters more than a percentage somebody guessed at.
    case when p_probability between 0 and 100 then p_probability else 10 end,
    v_partner, v_user,
    nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into opportunity_partner (
    id, "opportunityId", "partnerId", "partnerUserId", role,
    "revenueSharePercent", "registeredAt", "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), v_id, v_partner, v_user, 'SOURCED', 100, now(), now(), now()
  );

  return jsonb_build_object(
    'opportunityId', v_id, 'opportunityNumber', v_number, 'contactId', v_contact
  );
end;
$$;

-- The twenty-argument version is replaced by this one; drop it so a stale call
-- cannot resolve to a signature that ignores the new fields.
drop function if exists partner_add_opportunity(uuid, text, numeric, date, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text);

revoke all on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, text) from public;
grant execute on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, text) to authenticated;
