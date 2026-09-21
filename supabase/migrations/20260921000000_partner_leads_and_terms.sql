-- A partner starts as a lead, and the words we use for partners are ours.
--
-- Two changes that belong together, because both are about a partner being an
-- ordinary relationship that happens to be labelled differently.
--
-- 1. A lead says whether it is a sales lead or a partner lead, and converting a
--    partner lead produces an account of type PARTNER rather than a PROSPECT.
--    Partners arrive the same way customers do - somebody hears about us and
--    gets in touch - and making them a separate intake would mean two ways of
--    recording the same conversation.
--
-- 2. The three partner lists are cut to the values actually used. They were
--    inherited from a generic channel model: REGISTERED tiers, DISTRIBUTOR and
--    TECHNOLOGY types, a PROSPECTIVE status that duplicated INACTIVE.

-- ---------------------------------------------------------------------------
-- 1. Lead type
-- ---------------------------------------------------------------------------
--
-- Text with a check rather than an enum. It decides what conversion produces,
-- so it is read by code rather than only displayed, and a text column with a
-- constraint is far easier to extend later than a Postgres enum - which is the
-- lesson of the three enums being rewritten further down this file.
alter table lead
  add column if not exists "leadType" text not null default 'SALES'
    check ("leadType" in ('SALES', 'PARTNER'));

comment on column lead."leadType" is
  'SALES: a prospective customer. PARTNER: a prospective partner, which converts to an account of type PARTNER.';

create index if not exists "lead_leadType_idx" on lead ("leadType");

-- ---------------------------------------------------------------------------
-- 2. The partner lists
-- ---------------------------------------------------------------------------
--
-- Postgres will add an enum value but not remove one, so each type is rebuilt:
-- a new type beside the old, the column moved across with the mapping applied,
-- then the old type dropped. Defaults are dropped first because a default
-- referencing the old type blocks the ALTER.
--
-- The mappings are judgement calls, recorded here so they can be argued with:
--   RESELLER, DISTRIBUTOR -> ACCOUNT_MANAGEMENT  (both sell and hold the account)
--   TECHNOLOGY            -> IMPLEMENTATION      (the nearest delivery role)
--   REGISTERED            -> SILVER              (the new lowest tier)
--   PROSPECTIVE           -> INACTIVE            (not yet trading, so not active)
--
-- INACTIVE rather than ACTIVE for PROSPECTIVE matters: an active partnership can
-- register deals and create customers, and silently promoting a prospect into
-- one would hand out entitlements nobody granted.

-- Views first. Any view over these columns blocks the retype, and whichever
-- views exist is a question for the database rather than for this file: their
-- definitions are read from the catalogue, kept in a scratch table, and used to
-- rebuild them once the columns have moved.
create table if not exists _partner_viewdefs (
  name text primary key,
  def  text not null
);

insert into _partner_viewdefs (name, def)
select c.relname, pg_get_viewdef(c.oid, true)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and exists (
    select 1
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class t on t.oid = d.refobjid
    where r.ev_class = c.oid
      and d.classid = 'pg_rewrite'::regclass
      and t.relname = 'partner'
  )
on conflict (name) do update set def = excluded.def;

do $$
declare v text;
begin
  for v in select name from _partner_viewdefs loop
    execute format('drop view if exists %I cascade', v);
  end loop;
end $$;

-- Partner type ---------------------------------------------------------------
create type "PartnerType_new" as enum (
  'REFERRAL', 'ACCOUNT_MANAGEMENT', 'IMPLEMENTATION', 'INVESTMENT'
);

alter table partner alter column "partnerType" drop default;

alter table partner
  alter column "partnerType" type "PartnerType_new"
  using (
    case "partnerType"::text
      when 'RESELLER'    then 'ACCOUNT_MANAGEMENT'
      when 'DISTRIBUTOR' then 'ACCOUNT_MANAGEMENT'
      when 'TECHNOLOGY'  then 'IMPLEMENTATION'
      else "partnerType"::text
    end
  )::"PartnerType_new";

drop type "PartnerType";
alter type "PartnerType_new" rename to "PartnerType";

-- Tier -----------------------------------------------------------------------
create type "PartnerTier_new" as enum ('SILVER', 'GOLD', 'PLATINUM');

alter table partner alter column tier drop default;

alter table partner
  alter column tier type "PartnerTier_new"
  using (
    case tier::text
      when 'REGISTERED' then 'SILVER'
      else tier::text
    end
  )::"PartnerTier_new";

drop type "PartnerTier";
alter type "PartnerTier_new" rename to "PartnerTier";

alter table partner alter column tier set default 'SILVER';

-- Status ---------------------------------------------------------------------
create type "PartnerStatus_new" as enum ('ACTIVE', 'INACTIVE', 'TERMINATED');

alter table partner alter column status drop default;

alter table partner
  alter column status type "PartnerStatus_new"
  using (
    case status::text
      when 'PROSPECTIVE' then 'INACTIVE'
      else status::text
    end
  )::"PartnerStatus_new";

drop type "PartnerStatus";
alter type "PartnerStatus_new" rename to "PartnerStatus";

alter table partner alter column status set default 'INACTIVE';

-- Views back, exactly as they were, and security_invoker restored: without it
-- a view bypasses row-level security, which is the whole reason these were made
-- invoker-run in the first place.
do $$
declare
  v_name text;
  v_def  text;
begin
  for v_name, v_def in select name, def from _partner_viewdefs loop
    execute format('create view %I as %s', v_name, v_def);
    execute format('alter view %I set (security_invoker = true)', v_name);
    execute format('grant select on %I to authenticated', v_name);
  end loop;
end $$;

drop table _partner_viewdefs;

-- ---------------------------------------------------------------------------
-- 3. Converting a partner lead
-- ---------------------------------------------------------------------------
--
-- Only the account type changes. Everything else convert_lead does - the
-- contact, the optional opportunity, the partner registration window, the
-- audit trail - is the same whichever kind of lead it is, which is the point of
-- putting partners through the same door.
create or replace function convert_lead(
  p_lead_id            uuid,
  p_actor_id           uuid,
  p_account_id         uuid,
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
    raise exception 'Lead not found.';
  end if;
  if v_lead."convertedAt" is not null then
    raise exception 'That lead has already been converted.';
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
      -- The one difference a partner lead makes.
      case when v_lead."leadType" = 'PARTNER' then 'PARTNER' else 'PROSPECT' end::"AccountType",
      v_lead."ownerUserId", v_lead.industry, v_lead.phone,
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

  -- A partner lead does not open a pipeline deal by default: what follows it is
  -- a partnership, not a sale. The caller may still ask for one.
  if coalesce(p_create_opportunity, false) and v_lead."leadType" <> 'PARTNER' then
    v_opp_id := gen_random_uuid();

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", "campaignId", stage, amount, "currencyCode",
      "expectedCloseDate", "opportunityType", "leadSource",
      "createdAt", "updatedAt"
    ) values (
      v_opp_id,
      next_sequence_number('Opportunity'),
      coalesce(p_opportunity_name, v_lead."companyName", 'New opportunity'),
      v_account_id, v_contact_id, v_lead."ownerUserId", v_lead."campaignId",
      'DISCOVERY', coalesce(p_amount, v_lead."estimatedValue", 0), 'PKR',
      coalesce(p_expected_close, current_date + 30), 'NEW', v_lead."leadSource",
      now(), now()
    );

    -- A partner-referred lead keeps its registration when it becomes a deal.
    if v_lead."referredByPartnerId" is not null then
      select "commissionPlanId" into v_plan_id
      from partner where id = v_lead."referredByPartnerId";

      insert into opportunity_partner (
        id, "opportunityId", "partnerId", role, "revenueSharePercent",
        "commissionPlanId", "registeredAt", "registrationExpiresAt",
        "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(), v_opp_id, v_lead."referredByPartnerId", 'SOURCED', 100,
        v_plan_id,
        coalesce(p_registered_at, now()),
        coalesce(p_expires_at, now() + make_interval(days => coalesce(p_protection_days, 90))),
        now(), now()
      );
    end if;
  end if;

  update lead set
    status = 'CONVERTED',
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
    p_actor_id, 'manual', now()
  );

  return jsonb_build_object(
    'accountId', v_account_id,
    'contactId', v_contact_id,
    'opportunityId', v_opp_id
  );
end;
$$;
