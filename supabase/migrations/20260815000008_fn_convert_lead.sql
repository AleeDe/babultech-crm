-- Atomic lead conversion.
--
-- Ports the largest prisma.$transaction in src/server/crm.ts (convertLead).
-- Touches five tables: account, contact, opportunity, opportunity_partner and
-- lead, plus audit_history.
--
-- This is the operation that most needs a transaction. Half-converting a lead
-- leaves an orphaned account with no contact, or a deal with no partner credit
-- attached — and the lead still shows as unconverted, so it gets converted
-- again, duplicating the customer.
--
-- Partner-protection dates are computed by the caller (partner-policy.ts owns
-- the tier rules) and passed in, so the business rule stays in one place.

create or replace function convert_lead(
  p_lead_id            uuid,
  p_actor_id           uuid,
  p_account_id         uuid,    -- reuse an existing account, or null to create
  p_create_opportunity boolean,
  p_opportunity_name   text,
  p_amount             numeric,
  p_expected_close     date,
  p_registered_at      timestamp,
  p_expires_at         timestamp,
  p_protection_days    integer
)
returns jsonb
language plpgsql
as $$
declare
  v_lead        lead%rowtype;
  v_account_id  uuid := p_account_id;
  v_contact_id  uuid := gen_random_uuid();
  v_opp_id      uuid;
  v_plan_id     uuid;
  v_old_status  text;
begin
  select * into v_lead from lead where id = p_lead_id for update;

  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'no_data_found';
  end if;

  if v_lead.status = 'CONVERTED' then
    raise exception 'Lead % has already been converted.', v_lead."leadNumber"
      using errcode = 'raise_exception';
  end if;

  v_old_status := v_lead.status::text;

  if v_account_id is null then
    v_account_id := gen_random_uuid();
    insert into account (
      id, "accountNumber", name, "accountType", "ownerUserId", industry,
      "mainPhone", "createdAt", "updatedAt"
    ) values (
      v_account_id,
      next_sequence_number('Account'),
      coalesce(v_lead."companyName", v_lead."firstName" || ' ' || v_lead."lastName"),
      'PROSPECT', v_lead."ownerUserId", v_lead.industry, v_lead.phone,
      now(), now()
    );
  end if;

  insert into contact (
    id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
    whatsapp, "isPrimary", "communicationConsent", "createdAt", "updatedAt"
  ) values (
    v_contact_id, v_account_id, v_lead."firstName", v_lead."lastName",
    v_lead."jobTitle", v_lead.email, v_lead.phone, v_lead.whatsapp,
    true, true, now(), now()
  );

  if p_create_opportunity then
    v_opp_id := gen_random_uuid();

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", "campaignId", stage, amount, "probabilityPercent",
      "expectedCloseDate", "opportunityType", "leadSource",
      "createdAt", "updatedAt"
    ) values (
      v_opp_id,
      next_sequence_number('Opportunity'),
      coalesce(
        p_opportunity_name,
        coalesce(v_lead."companyName", v_lead."lastName") || ' — new business'
      ),
      v_account_id, v_contact_id, v_lead."ownerUserId", v_lead."campaignId",
      'QUALIFICATION',
      coalesce(p_amount, v_lead."estimatedValue", 0),
      20,
      coalesce(p_expected_close, (current_date + 60)),
      'NEW', v_lead."leadSource",
      now(), now()
    );

    -- Carry the referral credit onto the deal.
    if v_lead."referredByPartnerId" is not null then
      select "commissionPlanId" into v_plan_id
      from partner where id = v_lead."referredByPartnerId";

      insert into opportunity_partner (
        id, "opportunityId", "partnerId", role, "revenueSharePercent",
        "commissionPlanId", "registeredAt", "registrationExpiresAt", notes,
        "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(), v_opp_id, v_lead."referredByPartnerId", 'SOURCED',
        100, v_plan_id, p_registered_at, p_expires_at,
        format(
          'Auto-attached on conversion of lead %s. Registration protected for %s days, until %s.',
          v_lead."leadNumber", p_protection_days, p_expires_at::date
        ),
        now(), now()
      );
    end if;
  end if;

  update lead
  set status = 'CONVERTED',
      "convertedAt" = now(),
      "convertedAccountId" = v_account_id,
      "convertedContactId" = v_contact_id,
      "convertedOpportunityId" = v_opp_id,
      "updatedAt" = now()
  where id = p_lead_id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Lead', p_lead_id, 'status', v_old_status, 'CONVERTED',
    p_actor_id, 'UI', now()
  );

  return jsonb_build_object(
    'accountId', v_account_id,
    'contactId', v_contact_id,
    'opportunityId', v_opp_id
  );
end;
$$;
