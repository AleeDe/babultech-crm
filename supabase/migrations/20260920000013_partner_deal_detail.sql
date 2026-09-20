-- Let a partner record a deal properly, not just its name and a number.
--
-- The first version captured what was strictly needed to create the row. A
-- partner filling it in has far more in their head at that moment - who the
-- buyer is, where the work happens, what type of deal it is, what happens next
-- - and every field they cannot enter becomes an email to their partner
-- manager, or is simply lost.
--
-- What is deliberately NOT here, from the internal deal form:
--
--   Owner        we decide who works it; a partner choosing our staff is not
--                theirs to choose.
--   Stage        our sales process. A partner deal starts at DISCOVERY and
--                moves when we move it.
--   Probability  derived from stage, which they do not set.
--   Campaign     our marketing attribution.
--   Lead source  always "Partner" here, by definition.
--   Products,
--   price book,
--   discount     pricing is ours to set, and partners hold no product:read.
--
-- The rest is theirs to know better than we do.

create or replace function partner_add_opportunity(
  p_account_id  uuid,
  p_name        text,
  p_amount      numeric default 0,
  p_close_date  date default null,
  p_currency    text default 'PKR',
  p_contact_id  uuid default null,
  p_notes       text default null,
  -- New below this line.
  p_deal_type   text default null,
  p_next_step   text default null,
  p_competitor  text default null,
  -- A buyer who is not yet on file. A partner who has just met someone should
  -- not have to break off, add them as an employee, and come back.
  p_new_first   text default null,
  p_new_last    text default null,
  p_new_title   text default null,
  p_new_email   text default null,
  p_new_phone   text default null,
  -- Where the work happens. Written to the account, because an address belongs
  -- to the customer rather than to one deal, and only ever filled in when the
  -- account does not already have one - a partner should not be able to
  -- overwrite an address our own people have since corrected.
  p_street      text default null,
  p_city        text default null,
  p_state       text default null,
  p_postal_code text default null,
  p_country     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
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

  -- A new buyer, when one was typed in rather than chosen.
  if coalesce(btrim(coalesce(p_new_first, '')), '') <> ''
     and coalesce(btrim(coalesce(p_new_last, '')), '') <> '' then
    v_contact := gen_random_uuid();
    insert into contact (
      id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
      "isPrimary", active, "createdAt", "updatedAt"
    ) values (
      v_contact, p_account_id, btrim(p_new_first), btrim(p_new_last),
      nullif(btrim(coalesce(p_new_title, '')), ''),
      nullif(btrim(coalesce(p_new_email, '')), ''),
      nullif(btrim(coalesce(p_new_phone, '')), ''),
      false, true, now(), now()
    );
  elsif v_contact is not null
        and not exists (
          select 1 from contact
          where id = v_contact and "accountId" = p_account_id and "deletedAt" is null
        ) then
    raise exception 'That contact does not work at this customer.';
  end if;

  -- The address, only where we do not have one already.
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
    description, "createdAt", "updatedAt"
  ) values (
    v_id, v_number, btrim(p_name), p_account_id, v_contact,
    v_owner, 'DISCOVERY', coalesce(p_amount, 0),
    coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'PKR'),
    coalesce(p_close_date, current_date + 30),
    -- Cast guarded: an unrecognised type would abort the whole insert, and the
    -- deal matters more than the label on it.
    case
      when p_deal_type is null then 'NEW'::"OpportunityType"
      when exists (
        select 1 from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = 'OpportunityType' and e.enumlabel = p_deal_type
      ) then p_deal_type::"OpportunityType"
      else 'NEW'::"OpportunityType"
    end,
    'Partner',
    left(nullif(btrim(coalesce(p_next_step, '')), ''), 500),
    left(nullif(btrim(coalesce(p_competitor, '')), ''), 200),
    nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into opportunity_partner (
    id, "opportunityId", "partnerId", role, "revenueSharePercent",
    "registeredAt", "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), v_id, v_partner, 'SOURCED', 100, now(), now(), now()
  );

  return jsonb_build_object(
    'opportunityId', v_id,
    'opportunityNumber', v_number,
    'contactId', v_contact
  );
end;
$$;

-- The old six-argument signature is replaced by this one; drop it so a stale
-- call cannot silently resolve to a version that ignores the new fields.
drop function if exists partner_add_opportunity(uuid, text, numeric, date, text, uuid, text);

revoke all on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
