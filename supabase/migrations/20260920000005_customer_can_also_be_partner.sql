-- A company can be a customer and a partner at once.
--
-- Until now, making a partner of an existing account rewrote its type to
-- PARTNER, because a trigger insisted a partner record could only hang off a
-- PARTNER account. For a reseller who also buys from you - the common case in
-- this business - that quietly erased the fact that they are a customer, and
-- with it their place on every screen that looks for customers.
--
-- The partner record is itself the proof of partnership; the account type does
-- not need to repeat it. So a partner may now hang off a CUSTOMER account as
-- well, and an existing CUSTOMER is left alone rather than promoted.
--
-- Other types still cannot: a partner record on a VENDOR or a COMPETITOR is a
-- data-entry mistake, and the trigger should keep saying so.

create or replace function assert_partner_account_type() returns trigger as $$
begin
  if new."accountId" is not null then
    if (select "accountType"::text from account where id = new."accountId")
       not in ('PARTNER', 'CUSTOMER') then
      raise exception 'Account % must be a partner or a customer to carry a partner record', new."accountId";
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

-- create_partner promoted the account as part of the same path. Only the
-- promotion block changes: a PROSPECT still becomes a PARTNER, because nothing
-- is lost, and a CUSTOMER keeps being a customer.
create or replace function create_partner(
  p_payload  jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_kind         text := p_payload->>'kind';
  v_account_id   uuid := nullif(p_payload->>'accountId', '')::uuid;
  v_contact_id   uuid := nullif(p_payload->>'contactId', '')::uuid;
  v_display      text;
  v_partner_id   uuid := gen_random_uuid();
  v_number       text;
  v_acct_type    text;
  v_acct_name    text;
  v_first        text;
  v_last         text;
begin
  if v_kind = 'COMPANY' then
    if v_account_id is not null then
      select "accountType"::text, name into v_acct_type, v_acct_name
      from account where id = v_account_id for update;

      if not found then
        raise exception 'That account no longer exists.' using errcode = 'no_data_found';
      end if;

      -- A customer stays a customer: they are now both, and the partner record
      -- is what says so. Anything else becomes a partner account.
      if v_acct_type not in ('PARTNER', 'CUSTOMER') then
        update account set "accountType" = 'PARTNER', "updatedAt" = now()
        where id = v_account_id;

        insert into audit_history (
          id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
          "changedById", source, "changedAt"
        ) values (
          gen_random_uuid(), 'Account', v_account_id, 'accountType', v_acct_type,
          'PARTNER', p_actor_id, 'UI', now()
        );
      end if;

      v_display := v_acct_name;
    else
      if coalesce(p_payload->>'companyName', '') = '' then
        raise exception 'Provide either an existing account or a company name.'
          using errcode = 'raise_exception';
      end if;

      v_account_id := gen_random_uuid();
      v_display := p_payload->>'companyName';

      insert into account (
        id, "accountNumber", name, "accountType", "ownerUserId", industry,
        website, "mainPhone", "taxNumberNtn", "billingAddress",
        "createdAt", "updatedAt"
      ) values (
        v_account_id, next_sequence_number('Account'), v_display, 'PARTNER',
        coalesce(nullif(p_payload->>'partnerManagerId', '')::uuid, p_actor_id),
        p_payload->>'industry', p_payload->>'website', p_payload->>'phone',
        p_payload->>'taxNumber', p_payload->'billingAddress', now(), now()
      );
    end if;

    -- Optional named person at the partner company.
    if coalesce(p_payload->>'primaryContactFirstName', '') <> ''
       and coalesce(p_payload->>'primaryContactLastName', '') <> '' then
      insert into contact (
        id, "accountId", "firstName", "lastName", email, "isPrimary",
        "contactRole", "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(), v_account_id, p_payload->>'primaryContactFirstName',
        p_payload->>'primaryContactLastName',
        nullif(p_payload->>'primaryContactEmail', ''), true, 'Partner Manager',
        now(), now()
      );
    end if;
  else
    -- INDIVIDUAL — a partner who is a person, with no company account.
    if v_contact_id is not null then
      select "firstName", "lastName" into v_first, v_last
      from contact where id = v_contact_id;

      if not found then
        raise exception 'That contact no longer exists.' using errcode = 'no_data_found';
      end if;

      v_display := v_first || ' ' || v_last;
    else
      if coalesce(p_payload->>'firstName', '') = ''
         or coalesce(p_payload->>'lastName', '') = '' then
        raise exception 'Provide either an existing contact or a first and last name.'
          using errcode = 'raise_exception';
      end if;

      v_contact_id := gen_random_uuid();
      v_display := (p_payload->>'firstName') || ' ' || (p_payload->>'lastName');

      insert into contact (
        id, "accountId", "firstName", "lastName", email, phone, mobile,
        whatsapp, "contactRole", "communicationConsent", "createdAt", "updatedAt"
      ) values (
        v_contact_id, null, p_payload->>'firstName', p_payload->>'lastName',
        nullif(p_payload->>'email', ''), p_payload->>'phone',
        p_payload->>'mobile', p_payload->>'whatsapp', 'Partner', true,
        now(), now()
      );
    end if;
  end if;

  v_number := next_sequence_number('Partner');

  insert into partner (
    id, "partnerNumber", "displayName", kind, "accountId", "contactId",
    "partnerType", tier, status, "partnerManagerId", territory, "startDate",
    "agreementExpiryDate", "defaultCommissionPercent", "commissionPlanId",
    "payoutCurrencyCode", "taxNumber", "withholdingTaxPercent", "bankDetails",
    email, phone, website, notes, "createdAt", "updatedAt"
  ) values (
    v_partner_id, v_number, v_display, v_kind::"PartnerKind", v_account_id,
    v_contact_id, (p_payload->>'partnerType')::"PartnerType",
    (p_payload->>'tier')::"PartnerTier", (p_payload->>'status')::"PartnerStatus",
    nullif(p_payload->>'partnerManagerId', '')::uuid, p_payload->>'territory',
    nullif(p_payload->>'startDate', '')::date,
    nullif(p_payload->>'agreementExpiryDate', '')::date,
    nullif(p_payload->>'defaultCommissionPercent', '')::numeric,
    nullif(p_payload->>'commissionPlanId', '')::uuid,
    p_payload->>'payoutCurrencyCode', p_payload->>'taxNumber',
    nullif(p_payload->>'withholdingTaxPercent', '')::numeric,
    p_payload->'bankDetails', nullif(p_payload->>'email', ''),
    p_payload->>'phone', p_payload->>'website', p_payload->>'notes',
    now(), now()
  );

  return jsonb_build_object('id', v_partner_id, 'partnerNumber', v_number);
end;
$$;
