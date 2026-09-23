-- The partner on an account is the partner on its deals.
--
-- Attribution and commission were two separate things that never met.
-- account."sourcePartnerId" said who brought a customer; opportunity_partner
-- said who gets paid. Only the partner portal wrote both, so a deal raised in
-- the CRM on a partner's account earned that partner nothing, silently.
--
-- Three changes, which together make the chain continuous:
--
--   1. Converting a lead carries its referred partner onto the account.
--   2. Any new deal on an account with a partner gets that partner attached -
--      whoever creates it, through whichever route.
--   3. A deal cannot be won without a product, so it always has a project,
--      which is how an invoice later finds its way back to the deal.

-- ---------------------------------------------------------------------------
-- 1. opportunity_partner inserts become idempotent
-- ---------------------------------------------------------------------------
--
-- Change 2 adds a trigger that attaches the partner on insert. The portal's
-- partner_add_opportunity already inserts its own row straight afterwards, and
-- would now collide with the unique index on (opportunityId, partnerId, role).
--
-- Rather than rewrite that function - and every other caller that might one day
-- do the same - the collision is absorbed here: a conflicting insert becomes an
-- update of the row that already exists, keeping whichever values the later
-- caller actually supplied. The portal knows which PERSON at the partner raised
-- the deal and the trigger does not, so this is how partnerUserId arrives.
create or replace function opportunity_partner_merge()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_existing opportunity_partner%rowtype;
begin
  select * into v_existing from opportunity_partner
  where "opportunityId" = new."opportunityId"
    and "partnerId" = new."partnerId"
    and role = new.role
  for update;

  if not found then return new; end if;

  update opportunity_partner set
    "partnerUserId"             = coalesce(new."partnerUserId", "partnerUserId"),
    "commissionPlanId"          = coalesce(new."commissionPlanId", "commissionPlanId"),
    "commissionPercentOverride" = coalesce(new."commissionPercentOverride", "commissionPercentOverride"),
    "registeredAt"              = coalesce("registeredAt", new."registeredAt"),
    "registrationExpiresAt"     = coalesce("registrationExpiresAt", new."registrationExpiresAt"),
    notes                       = coalesce(new.notes, notes),
    "updatedAt"                 = now()
  where id = v_existing.id;

  return null;  -- the insert is swallowed; the row above is the survivor
end $$;

revoke all on function opportunity_partner_merge() from public, anon, authenticated;

drop trigger if exists opportunity_partner_merge_trg on opportunity_partner;
create trigger opportunity_partner_merge_trg
  before insert on opportunity_partner
  for each row execute function opportunity_partner_merge();

-- ---------------------------------------------------------------------------
-- 2. A new deal inherits its account's partner
-- ---------------------------------------------------------------------------
--
-- Security definer because the person raising a deal is usually in sales and
-- holds no partner:write - the commission link must exist regardless of who
-- they are. Registration runs from today for the partner's protection window,
-- matching what the portal stamps.
create or replace function attach_account_partner_to_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_person  uuid;
  v_plan    uuid;
  v_days    integer;
begin
  select a."sourcePartnerId", a."sourcePartnerUserId"
    into v_partner, v_person
  from account a where a.id = new."accountId";

  if v_partner is null then return new; end if;

  -- An inactive or terminated partnership earns nothing, and attaching it would
  -- only produce a link the commission engine skips with a puzzled audit note.
  if not exists (select 1 from partner where id = v_partner and status = 'ACTIVE') then
    return new;
  end if;

  select "commissionPlanId" into v_plan from partner where id = v_partner;
  select coalesce(p."registrationProtectionDays", 90) into v_days from partner p where p.id = v_partner;

  insert into opportunity_partner (
    id, "opportunityId", "partnerId", "partnerUserId", role,
    "revenueSharePercent", "commissionPlanId",
    "registeredAt", "registrationExpiresAt", "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), new.id, v_partner, v_person, 'SOURCED', 100, v_plan,
    now(), now() + make_interval(days => v_days), now(), now()
  );

  return new;
end $$;

revoke all on function attach_account_partner_to_deal() from public, anon, authenticated;

drop trigger if exists opportunity_attach_partner on opportunity;
create trigger opportunity_attach_partner
  after insert on opportunity
  for each row execute function attach_account_partner_to_deal();

-- The matching attribution stamp, so the deal itself records who brought it.
-- Separate from the link above because this one is a column on the row and has
-- to happen before it is written, not after.
create or replace function stamp_deal_source_partner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new."sourcePartnerId" is null then
    select a."sourcePartnerId", a."sourcePartnerUserId"
      into new."sourcePartnerId", new."sourcePartnerUserId"
    from account a where a.id = new."accountId";
  end if;
  return new;
end $$;

revoke all on function stamp_deal_source_partner() from public, anon, authenticated;

drop trigger if exists opportunity_stamp_source_partner on opportunity;
create trigger opportunity_stamp_source_partner
  before insert on opportunity
  for each row execute function stamp_deal_source_partner();

-- ---------------------------------------------------------------------------
-- 3. A won deal needs a product
-- ---------------------------------------------------------------------------
--
-- create_project_for_won_opportunity() returns null when a deal has no product,
-- so a deal won without one gets no delivery project - and with no project, an
-- invoice raised against it has nothing to name, which is how commission finds
-- the deal. The failure is silent at every step. Requiring the product at the
-- point of winning closes all of it at once.
create or replace function guard_won_deal_has_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.stage = 'CLOSED_WON'
     and coalesce(old.stage::text, '') <> 'CLOSED_WON'
     and new."productId" is null then
    raise exception
      'A won deal needs a product. Pick the product being sold, then close it - the delivery project and any partner commission are both created from it.'
      using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function guard_won_deal_has_product() from public, anon, authenticated;

drop trigger if exists opportunity_won_needs_product on opportunity;
create trigger opportunity_won_needs_product
  before insert or update on opportunity
  for each row execute function guard_won_deal_has_product();

-- ---------------------------------------------------------------------------
-- 4. Converting a lead carries its partner onto the account
-- ---------------------------------------------------------------------------
--
-- The lead already records referredByPartnerId, and conversion already used it
-- to register the partner on the opportunity it creates. What it never did was
-- put it on the ACCOUNT - so the referral was forgotten the moment conversion
-- finished, and the second deal on that customer earned the partner nothing.
--
-- When the lead converts into an account that already exists and already has a
-- partner, the existing one wins. Credit decides who is paid, and a later lead
-- must not be able to move it; guard_attribution_immutable() would refuse the
-- change anyway, and refusing it here means conversion succeeds instead of
-- failing on a rule the person converting knows nothing about.
create or replace function carry_lead_partner_to_account(
  p_lead_id    uuid,
  p_account_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_partner uuid;
begin
  select "referredByPartnerId" into v_partner from lead where id = p_lead_id;
  if v_partner is null then return; end if;

  update account
     set "sourcePartnerId" = v_partner,
         "updatedAt" = now()
   where id = p_account_id
     and "sourcePartnerId" is null;
end $$;

revoke all on function carry_lead_partner_to_account(uuid, uuid) from public, anon, authenticated;

-- Hung off the lead rather than written into convert_lead, so that any route
-- which converts a lead - the RPC, an import, a correction made by hand - all
-- carry the referral the same way.
create or replace function lead_conversion_carries_partner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new."convertedAccountId" is not null
     and old."convertedAccountId" is distinct from new."convertedAccountId" then
    perform carry_lead_partner_to_account(new.id, new."convertedAccountId");
  end if;
  return new;
end $$;

revoke all on function lead_conversion_carries_partner() from public, anon, authenticated;

drop trigger if exists lead_carries_partner on lead;
create trigger lead_carries_partner
  after update on lead
  for each row execute function lead_conversion_carries_partner();
