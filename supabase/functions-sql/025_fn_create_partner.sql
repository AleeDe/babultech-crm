-- Atomic partner creation.
--
-- Ports the prisma.$transaction in src/server/partners.ts (createPartner).
-- Depending on the shape it touches up to four tables: account (created or
-- promoted to PARTNER), contact, partner, and audit_history.
--
-- This has to be one transaction because partner_identity_check
-- (prisma/sql/01_constraints.sql) requires a COMPANY partner to have an
-- accountId and an INDIVIDUAL to have a contactId. Creating the partner row
-- before its account or contact lands would violate the constraint; creating
-- the account and then failing on the partner would leave an orphaned account
-- silently promoted to PARTNER type.
--
-- The branching stays here rather than in TypeScript so the whole decision runs
-- under one lock: promoting an existing account and inserting the partner that
-- depends on it must not be two separate requests.

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

      -- The DB trigger enforces this too; promote here so the common
      -- "this existing customer is now also a reseller" path works.
      if v_acct_type <> 'PARTNER' then
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

/**
 * Attach a partner to a deal, guarding the 100% revenue-share total.
 *
 * The check must hold under a lock: two concurrent attaches each reading 60%
 * used would both see room for 40% and jointly allocate 140%. Aggregating and
 * inserting in one transaction is what makes the guard real rather than
 * advisory.
 *
 * The commission plan is snapshotted from the partner here so later plan edits
 * cannot rewrite what this deal pays.
 */
create or replace function attach_partner_to_deal(
  p_opportunity_id  uuid,
  p_partner_id      uuid,
  p_role            text,
  p_share_percent   numeric,
  p_override_percent numeric,
  p_expires_at      timestamp,
  p_default_days    integer,
  p_notes           text
)
returns jsonb
language plpgsql
as $$
declare
  v_used     numeric(8,4);
  v_plan_id  uuid;
  v_id       uuid := gen_random_uuid();
  v_expires  timestamp;
begin
  -- Lock the parent deal rather than the links: FOR UPDATE cannot be combined
  -- with an aggregate, and locking the opportunity serialises concurrent
  -- attaches on the same deal, which is what the 100% guard needs.
  perform 1 from opportunity where id = p_opportunity_id for update;

  select coalesce(sum("revenueSharePercent"), 0) into v_used
  from opportunity_partner
  where "opportunityId" = p_opportunity_id;

  if v_used + p_share_percent > 100 then
    raise exception 'Revenue share would total %. Only % is unallocated on this deal.',
      (v_used + p_share_percent) || '%', (100 - v_used) || '%'
      using errcode = 'raise_exception';
  end if;

  select "commissionPlanId" into v_plan_id from partner where id = p_partner_id;

  if not found then
    raise exception 'That partner no longer exists.' using errcode = 'no_data_found';
  end if;

  -- A null expiry would mean "protected forever", which nobody intends to set
  -- by leaving a field blank, so the standard window applies instead.
  v_expires := coalesce(p_expires_at, now() + (p_default_days || ' days')::interval);

  insert into opportunity_partner (
    id, "opportunityId", "partnerId", role, "revenueSharePercent",
    "commissionPercentOverride", "commissionPlanId", "registeredAt",
    "registrationExpiresAt", notes, "createdAt", "updatedAt"
  ) values (
    v_id, p_opportunity_id, p_partner_id, p_role::"PartnerRole",
    p_share_percent, p_override_percent, v_plan_id, now(), v_expires,
    p_notes, now(), now()
  );

  return jsonb_build_object('id', v_id);
end;
$$;
