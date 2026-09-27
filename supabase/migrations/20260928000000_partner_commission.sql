-- Partner commission: one record per deal.
--
-- Commission used to be a ledger driven by plans. A plan named a trigger - the
-- deal closing, an invoice going out, a payment clearing - and an engine wrote
-- a record when it happened, which then went through approval, a payout batch,
-- payout approval and payment. The partner saw nothing until the trigger fired,
-- and a registration window could cancel the commission without anybody
-- deciding to.
--
-- What replaces it is one record per deal, created with the deal, that the
-- partner can watch from the first day. It shows what the deal is worth after
-- discounts and tax, the partner's percentage, their commission, the tax
-- withheld from it, and what they will actually be paid. The system decides
-- nothing about payment: a record stays In progress until a person marks it
-- Paid or Rejected. While it is in progress it follows the deal - a discount
-- lowers it, an extra line raises it - and it freezes once it is closed.
--
-- A partner may ask for a different percentage, with a reason. The request
-- waits for somebody who approves commission, and the current percentage
-- stands until then. A partner may also mark their own commission Paid once the
-- deal is won, because they are the one who knows the money arrived. Rejecting
-- is ours.
--
-- The old tables hold no rows, so they are dropped rather than converted. The
-- guard below makes sure that is still true at the moment this runs.

-- ---------------------------------------------------------------------------
-- 0. Nothing to lose
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from commission_record)
     or exists (select 1 from commission_payout)
     or exists (select 1 from commission_proposal)
     or exists (select 1 from opportunity_partner) then
    raise exception 'The old commission tables have rows in them. Convert them before running this migration.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------------
--
-- The three amounts are generated from the base, the percentage and the
-- withholding rate, so they can never disagree with the figures they come
-- from. Postgres will not let one generated column read another, which is why
-- the commission is written out again inside the other two.

create table partner_commission (
  id                        uuid primary key default gen_random_uuid(),
  "commissionNumber"        varchar(20) not null unique,
  "partnerId"               uuid not null references partner (id) on delete restrict,
  -- One per deal. A deleted deal takes its commission with it.
  "opportunityId"           uuid not null unique references opportunity (id) on delete cascade,
  "currencyCode"            char(3) not null default 'PKR',
  -- The deal's final amount: every line, after discounts, tax included.
  "baseAmount"              numeric(18, 2) not null default 0,
  "commissionPercent"       numeric(7, 4) not null default 0
                              check ("commissionPercent" between 0 and 100),
  "withholdingTaxPercent"   numeric(7, 4) not null default 0
                              check ("withholdingTaxPercent" between 0 and 100),
  "commissionAmount"        numeric(18, 2) generated always as (
                              round("baseAmount" * "commissionPercent" / 100, 2)
                            ) stored,
  "withholdingAmount"       numeric(18, 2) generated always as (
                              round(round("baseAmount" * "commissionPercent" / 100, 2)
                                    * "withholdingTaxPercent" / 100, 2)
                            ) stored,
  -- What the partner is actually paid.
  "partnerAmount"           numeric(18, 2) generated always as (
                              round("baseAmount" * "commissionPercent" / 100, 2)
                              - round(round("baseAmount" * "commissionPercent" / 100, 2)
                                      * "withholdingTaxPercent" / 100, 2)
                            ) stored,
  status                    varchar(20) not null default 'IN_PROGRESS'
                              check (status in ('IN_PROGRESS', 'PAID', 'REJECTED')),
  -- Empty while the deal is open; the won date plus 90 days once it is won;
  -- the day it was marked paid once it is paid.
  "paymentDate"             date,
  "rejectedReason"          text,
  "closedAt"                timestamp(3),
  -- Null on a closed record means the system closed it (the deal was lost or
  -- deleted), which is what lets a reopened deal bring its commission back.
  "closedById"              uuid references app_user (id) on delete set null,
  -- The latest request from the partner for a different percentage. Earlier
  -- requests live in the audit history.
  "requestedPercent"        numeric(7, 4) check ("requestedPercent" between 0 and 100),
  "requestReason"           text,
  "requestStatus"           varchar(20) check ("requestStatus" in ('PENDING', 'APPROVED', 'DECLINED')),
  "requestedById"           uuid references app_user (id) on delete set null,
  "requestedAt"             timestamp(3),
  "requestDecisionReason"   text,
  "requestDecidedById"      uuid references app_user (id) on delete set null,
  "requestDecidedAt"        timestamp(3),
  "createdAt"               timestamp(3) not null default now(),
  "updatedAt"               timestamp(3) not null default now()
);

comment on table partner_commission is
  'One per deal with a partner. Created with the deal, follows it while In progress, frozen once Paid or Rejected.';

create index partner_commission_partner_idx on partner_commission ("partnerId");
create index partner_commission_status_idx on partner_commission (status);
create index partner_commission_request_idx on partner_commission ("requestStatus")
  where "requestStatus" = 'PENDING';

create trigger set_updated_at
  before update on partner_commission
  for each row execute function set_updated_at();

insert into number_sequence (id, "entityType", prefix, "nextValue", "paddingLength", "includeYear", "updatedAt")
values (gen_random_uuid(), 'PartnerCommission', 'PC', 1, 6, false, now())
on conflict do nothing;

-- Reads only. Every change goes through the functions in section 3, which
-- decide who may do what.
alter table partner_commission enable row level security;

create policy partner_commission_staff_read on partner_commission
  for select to authenticated
  using (app_is_internal() and app_has_permission('commission:read'));

create policy partner_commission_partner_read on partner_commission
  for select to authenticated
  using ("partnerId" = app_current_partner_id());

revoke all on partner_commission from anon;
revoke insert, update, delete on partner_commission from authenticated;
grant select on partner_commission to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Keeping it in step with the deal
-- ---------------------------------------------------------------------------
--
-- A trigger rather than application code, because a deal changes through many
-- routes - the deal form, the line editor, a quote being accepted, the partner
-- portal, lead conversion - and every one of them must move the commission the
-- same way.

create or replace function sync_partner_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc        partner_commission%rowtype;
  v_partner   partner%rowtype;
  v_old_stage text;
  v_gone      boolean;
  v_reason    text;
  v_won_date  date;
begin
  if tg_op = 'UPDATE' then
    v_old_stage := old.stage::text;
  end if;
  -- Lost or deleted: nothing will be paid on it.
  v_gone := new.stage::text = 'CLOSED_LOST' or new."deletedAt" is not null;
  v_reason := case when new."deletedAt" is not null then 'Deal deleted' else 'Deal lost' end;
  v_won_date := coalesce(new."actualCloseDate", current_date);

  select * into v_pc from partner_commission where "opportunityId" = new.id for update;

  if not found then
    -- Only a deal with a partner we still work with gets a record.
    if new."sourcePartnerId" is null or new."deletedAt" is not null then
      return null;
    end if;
    select * into v_partner from partner where id = new."sourcePartnerId";
    if not found or v_partner.status::text <> 'ACTIVE' or v_partner."deletedAt" is not null then
      return null;
    end if;

    insert into partner_commission (
      id, "commissionNumber", "partnerId", "opportunityId", "currencyCode", "baseAmount",
      "commissionPercent", "withholdingTaxPercent", status, "paymentDate",
      "rejectedReason", "closedAt", "createdAt", "updatedAt"
    ) values (
      gen_random_uuid(), next_sequence_number('PartnerCommission'), v_partner.id, new.id,
      coalesce(new."currencyCode", 'PKR'), coalesce(new.amount, 0),
      coalesce(v_partner."defaultCommissionPercent", 0),
      coalesce(v_partner."withholdingTaxPercent", 0),
      case when v_gone then 'REJECTED' else 'IN_PROGRESS' end,
      case when new.stage::text = 'CLOSED_WON' and not v_gone then v_won_date + 90 end,
      case when v_gone then v_reason end,
      case when v_gone then now() end,
      now(), now()
    );
    return null;
  end if;

  if v_pc.status = 'PAID' then
    -- Paid is final. Reopening the deal would leave a paid commission on a
    -- deal that is no longer won.
    if tg_op = 'UPDATE' and v_old_stage = 'CLOSED_WON' and new.stage::text <> 'CLOSED_WON' then
      raise exception
        'Commission on this deal has already been paid to the partner, so the deal cannot be reopened.'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_pc.status = 'REJECTED' then
    -- Rejected by a person stays rejected. Rejected by the system because the
    -- deal was lost or deleted comes back when the deal does.
    if v_pc."closedById" is null and not v_gone then
      update partner_commission set
        status           = 'IN_PROGRESS',
        "rejectedReason" = null,
        "closedAt"       = null,
        "baseAmount"     = coalesce(new.amount, 0),
        "currencyCode"   = coalesce(new."currencyCode", "currencyCode"),
        "paymentDate"    = case when new.stage::text = 'CLOSED_WON' then v_won_date + 90 end,
        "updatedAt"      = now()
      where id = v_pc.id;
    end if;
    return null;
  end if;

  -- In progress: follow the deal.
  update partner_commission set
    "baseAmount"   = coalesce(new.amount, 0),
    "currencyCode" = coalesce(new."currencyCode", "currencyCode"),
    "paymentDate"  = case
      when v_gone then "paymentDate"
      when new.stage::text = 'CLOSED_WON' and coalesce(v_old_stage, '') <> 'CLOSED_WON' then v_won_date + 90
      when new.stage::text <> 'CLOSED_WON' and v_old_stage = 'CLOSED_WON' then null
      else "paymentDate"
    end,
    status           = case when v_gone then 'REJECTED' else status end,
    "rejectedReason" = case when v_gone then v_reason else "rejectedReason" end,
    "closedAt"       = case when v_gone then now() else "closedAt" end,
    -- A request still waiting when the deal goes is closed with it.
    "requestStatus"  = case when v_gone and "requestStatus" = 'PENDING' then 'DECLINED' else "requestStatus" end,
    "requestDecisionReason" = case
      when v_gone and "requestStatus" = 'PENDING' then v_reason
      else "requestDecisionReason"
    end,
    "requestDecidedAt" = case when v_gone and "requestStatus" = 'PENDING' then now() else "requestDecidedAt" end,
    "updatedAt"      = now()
  where id = v_pc.id;
  return null;
end $$;

revoke all on function sync_partner_commission() from public, anon, authenticated;

drop trigger if exists opportunity_partner_commission on opportunity;
create trigger opportunity_partner_commission
  after insert or update of amount, "currencyCode", stage, "sourcePartnerId", "actualCloseDate", "deletedAt"
  on opportunity
  for each row execute function sync_partner_commission();

-- ---------------------------------------------------------------------------
-- 3. What people can do with a record
-- ---------------------------------------------------------------------------
--
-- Staff here means an internal user holding commission:approve. The partner
-- means a login at the partner the record belongs to. Every change is written
-- to the audit history, so the record's page can show who changed what.

create or replace function partner_commission_audit(
  p_id uuid, p_field text, p_old text, p_new text, p_actor uuid, p_portal boolean
) returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'PartnerCommission', p_id, p_field, p_old, p_new,
    p_actor, case when p_portal then 'portal' else 'manual' end, now()
  );
$$;

revoke all on function partner_commission_audit(uuid, text, text, text, uuid, boolean)
  from public, anon, authenticated;

-- Mark Paid (staff, or the partner once the deal is won) or Rejected (staff).
create or replace function partner_commission_mark(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc      partner_commission%rowtype;
  v_actor   uuid := app_current_user_id();
  v_staff   boolean := app_is_internal() and app_has_permission('commission:approve');
  v_partner boolean;
  v_stage   text;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_pc from partner_commission where id = p_id for update;
  if not found then
    raise exception 'That commission record was not found.' using errcode = 'P0002';
  end if;
  v_partner := app_current_partner_id() is not null and v_pc."partnerId" = app_current_partner_id();
  if not (v_staff or v_partner) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_pc.status <> 'IN_PROGRESS' then
    raise exception 'This commission is already %, so it cannot be changed.',
      case v_pc.status when 'PAID' then 'paid' else 'rejected' end
      using errcode = '23514';
  end if;

  if p_status = 'PAID' then
    select stage::text into v_stage from opportunity where id = v_pc."opportunityId";
    if v_stage is distinct from 'CLOSED_WON' then
      raise exception 'Commission can be marked paid only once the deal is won.' using errcode = '23514';
    end if;
  elsif p_status = 'REJECTED' then
    if not v_staff then
      raise exception 'Only BabulTech can reject a commission.' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Give a reason for rejecting it. The partner will see it.' using errcode = '23514';
    end if;
  else
    raise exception 'A commission can be marked Paid or Rejected.' using errcode = '22023';
  end if;

  update partner_commission set
    status           = p_status,
    "paymentDate"    = case when p_status = 'PAID' then current_date else "paymentDate" end,
    "rejectedReason" = case when p_status = 'REJECTED' then v_reason else null end,
    "closedAt"       = now(),
    "closedById"     = v_actor,
    "requestStatus"  = case when "requestStatus" = 'PENDING' then 'DECLINED' else "requestStatus" end,
    "requestDecisionReason" = case
      when "requestStatus" = 'PENDING' then 'The commission was closed before the request was decided.'
      else "requestDecisionReason"
    end,
    "requestDecidedAt" = case when "requestStatus" = 'PENDING' then now() else "requestDecidedAt" end
  where id = p_id;

  perform partner_commission_audit(
    p_id, 'status', 'IN_PROGRESS',
    p_status || coalesce(': ' || v_reason, ''),
    v_actor, v_partner and not v_staff
  );
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- Staff set when the partner should be paid.
create or replace function partner_commission_set_payment_date(p_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc    partner_commission%rowtype;
  v_actor uuid := app_current_user_id();
begin
  if not (app_is_internal() and app_has_permission('commission:approve')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Choose a payment date.' using errcode = '23514';
  end if;
  select * into v_pc from partner_commission where id = p_id for update;
  if not found then
    raise exception 'That commission record was not found.' using errcode = 'P0002';
  end if;
  if v_pc.status <> 'IN_PROGRESS' then
    raise exception 'This commission is closed, so its payment date cannot change.' using errcode = '23514';
  end if;
  update partner_commission set "paymentDate" = p_date where id = p_id;
  perform partner_commission_audit(p_id, 'paymentDate', v_pc."paymentDate"::text, p_date::text, v_actor, false);
end $$;

-- Staff change the percentage directly. Refused while the partner is waiting
-- on an answer, so a request is always answered rather than overtaken.
create or replace function partner_commission_change_percent(p_id uuid, p_percent numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc     partner_commission%rowtype;
  v_actor  uuid := app_current_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not (app_is_internal() and app_has_permission('commission:approve')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'The percentage must be between 0 and 100.' using errcode = '23514';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the change. The partner will see it in the history.' using errcode = '23514';
  end if;
  select * into v_pc from partner_commission where id = p_id for update;
  if not found then
    raise exception 'That commission record was not found.' using errcode = 'P0002';
  end if;
  if v_pc.status <> 'IN_PROGRESS' then
    raise exception 'This commission is closed, so its percentage cannot change.' using errcode = '23514';
  end if;
  if v_pc."requestStatus" = 'PENDING' then
    raise exception 'The partner has asked for a different percentage. Approve or decline that request first.'
      using errcode = '23514';
  end if;
  if p_percent = v_pc."commissionPercent" then
    return;
  end if;
  update partner_commission set "commissionPercent" = p_percent where id = p_id;
  perform partner_commission_audit(
    p_id, 'commissionPercent', v_pc."commissionPercent"::text,
    p_percent::text || ': ' || v_reason, v_actor, false
  );
end $$;

-- The partner asks for a different percentage. Nothing changes until it is
-- approved.
create or replace function partner_commission_request_percent(p_id uuid, p_percent numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc     partner_commission%rowtype;
  v_actor  uuid := app_current_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_pc from partner_commission where id = p_id for update;
  if not found
     or app_current_partner_id() is null
     or v_pc."partnerId" <> app_current_partner_id() then
    raise exception 'That commission record was not found.' using errcode = 'P0002';
  end if;
  if v_pc.status <> 'IN_PROGRESS' then
    raise exception 'This commission is closed, so its percentage cannot change.' using errcode = '23514';
  end if;
  if v_pc."requestStatus" = 'PENDING' then
    raise exception 'You already have a request waiting on this deal. We will answer it first.'
      using errcode = '23514';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'The percentage must be between 0 and 100.' using errcode = '23514';
  end if;
  if p_percent = v_pc."commissionPercent" then
    raise exception 'That is already your percentage on this deal.' using errcode = '23514';
  end if;
  if v_reason is null then
    raise exception 'Tell us why, so we can decide.' using errcode = '23514';
  end if;
  update partner_commission set
    "requestedPercent"      = p_percent,
    "requestReason"         = v_reason,
    "requestStatus"         = 'PENDING',
    "requestedById"         = v_actor,
    "requestedAt"           = now(),
    "requestDecisionReason" = null,
    "requestDecidedById"    = null,
    "requestDecidedAt"      = null
  where id = p_id;
  perform partner_commission_audit(
    p_id, 'requestedPercent', v_pc."commissionPercent"::text,
    p_percent::text || ': ' || v_reason, v_actor, true
  );
end $$;

-- Staff answer the partner's request. Approving applies the requested
-- percentage; declining needs a reason and leaves the percentage as it was.
create or replace function partner_commission_decide_request(p_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc     partner_commission%rowtype;
  v_actor  uuid := app_current_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not (app_is_internal() and app_has_permission('commission:approve')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  select * into v_pc from partner_commission where id = p_id for update;
  if not found then
    raise exception 'That commission record was not found.' using errcode = 'P0002';
  end if;
  if v_pc."requestStatus" is distinct from 'PENDING' then
    raise exception 'There is no request waiting on this commission.' using errcode = '23514';
  end if;
  if not coalesce(p_approve, false) and v_reason is null then
    raise exception 'Give a reason for declining. The partner will see it.' using errcode = '23514';
  end if;
  update partner_commission set
    "commissionPercent"     = case when p_approve then "requestedPercent" else "commissionPercent" end,
    "requestStatus"         = case when p_approve then 'APPROVED' else 'DECLINED' end,
    "requestDecisionReason" = v_reason,
    "requestDecidedById"    = v_actor,
    "requestDecidedAt"      = now()
  where id = p_id;
  perform partner_commission_audit(
    p_id, 'requestStatus', 'PENDING',
    case when p_approve then 'APPROVED: ' || v_pc."requestedPercent"::text || '%' else 'DECLINED' end
      || coalesce(' - ' || v_reason, ''),
    v_actor, false
  );
end $$;

-- A deal raised before its account had a partner can be given one by hand.
-- Only where it has none: credit decides who is paid, so it is never moved.
create or replace function set_opportunity_partner(p_opportunity uuid, p_partner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp opportunity%rowtype;
begin
  if not (app_is_internal() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or not app_can_write_owned(v_opp."ownerUserId") then
    raise exception 'That deal was not found.' using errcode = 'P0002';
  end if;
  if v_opp."sourcePartnerId" is not null then
    raise exception 'This deal already has a partner. Credit decides who is paid, so it cannot be moved.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from partner where id = p_partner and status::text = 'ACTIVE' and "deletedAt" is null) then
    raise exception 'Choose an active partner.' using errcode = '23514';
  end if;
  update opportunity set "sourcePartnerId" = p_partner, "updatedAt" = now() where id = p_opportunity;
end $$;

revoke all on function partner_commission_mark(uuid, text, text) from public, anon;
revoke all on function partner_commission_set_payment_date(uuid, date) from public, anon;
revoke all on function partner_commission_change_percent(uuid, numeric, text) from public, anon;
revoke all on function partner_commission_request_percent(uuid, numeric, text) from public, anon;
revoke all on function partner_commission_decide_request(uuid, boolean, text) from public, anon;
revoke all on function set_opportunity_partner(uuid, uuid) from public, anon;
grant execute on function partner_commission_mark(uuid, text, text) to authenticated;
grant execute on function partner_commission_set_payment_date(uuid, date) to authenticated;
grant execute on function partner_commission_change_percent(uuid, numeric, text) to authenticated;
grant execute on function partner_commission_request_percent(uuid, numeric, text) to authenticated;
grant execute on function partner_commission_decide_request(uuid, boolean, text) to authenticated;
grant execute on function set_opportunity_partner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A partner's deals are the deals credited to them
-- ---------------------------------------------------------------------------
--
-- Every partner read policy on deals asks this function. It used to read the
-- link rows, which are going; the deal's own partner is the same answer.

create or replace function app_partner_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from opportunity o
  where app_current_partner_id() is not null
    and o."sourcePartnerId" = app_current_partner_id();
$$;

-- ---------------------------------------------------------------------------
-- 5. Deals get their partner from the account, not from a link row
-- ---------------------------------------------------------------------------
--
-- The four functions below are the live definitions with only the old link
-- taken out. Lead conversion now puts the partner on the deal itself; the two
-- portal functions already did, and wrote a link row besides; creating a
-- partner no longer names a plan.

CREATE OR REPLACE FUNCTION public.convert_lead(p_lead_id uuid, p_actor_id uuid, p_account_id uuid, p_create_opportunity boolean, p_opportunity_name text, p_amount numeric, p_expected_close date, p_registered_at timestamp without time zone, p_expires_at timestamp without time zone, p_protection_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_lead        lead%rowtype;
  v_account_id  uuid := p_account_id;
  v_contact_id  uuid := gen_random_uuid();
  v_opp_id      uuid;
  v_deal_partner uuid;
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
    -- The deal's partner: the account's if it has one (the first partner to
    -- bring a customer keeps them), otherwise the partner who referred the lead.
    -- Set on the deal directly because the account only receives the lead's
    -- partner after this function finishes, from lead_conversion_carries_partner.
    select a."sourcePartnerId" into v_deal_partner from account a where a.id = v_account_id;
    v_deal_partner := coalesce(v_deal_partner, v_lead."referredByPartnerId");

    v_opp_id := gen_random_uuid();

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", "campaignId", stage, amount, "currencyCode",
      "expectedCloseDate", "opportunityType", "leadSource",
      "sourcePartnerId", "createdAt", "updatedAt"
    ) values (
      v_opp_id,
      next_sequence_number('Opportunity'),
      coalesce(p_opportunity_name, v_lead."companyName", 'New opportunity'),
      v_account_id, v_contact_id, v_lead."ownerUserId", v_lead."campaignId",
      'DISCOVERY', coalesce(p_amount, v_lead."estimatedValue", 0), 'PKR',
      coalesce(p_expected_close, current_date + 30), 'NEW', v_lead."leadSource",
      v_deal_partner, now(), now()
    );

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
$function$;

CREATE OR REPLACE FUNCTION public.partner_add_opportunity(p_account_id uuid, p_name text, p_amount numeric DEFAULT 0, p_close_date date DEFAULT NULL::date, p_currency text DEFAULT 'PKR'::text, p_contact_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_deal_type text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_competitor text DEFAULT NULL::text, p_new_first text DEFAULT NULL::text, p_new_last text DEFAULT NULL::text, p_new_title text DEFAULT NULL::text, p_new_email text DEFAULT NULL::text, p_new_phone text DEFAULT NULL::text, p_street text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_probability numeric DEFAULT NULL::numeric, p_lead_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


  return jsonb_build_object(
    'opportunityId', v_id, 'opportunityNumber', v_number, 'contactId', v_contact
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.partner_create_customer(p_account_name text, p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_industry text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_deal_name text DEFAULT NULL::text, p_deal_amount numeric DEFAULT NULL::numeric, p_deal_close date DEFAULT NULL::date, p_deal_currency text DEFAULT 'PKR'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner    uuid := app_current_partner_id();
  v_user       uuid := app_current_user_id();
  v_partner_row record;
  v_owner      uuid;
  v_account    uuid := gen_random_uuid();
  v_contact    uuid := gen_random_uuid();
  v_opp        uuid;
  v_link       uuid;
  v_acct_no    text;
  v_opp_no     text;
  v_conflict   jsonb;
  v_contested  boolean := false;
begin
  if v_partner is null then
    raise exception 'Only a partner may create a customer here.';
  end if;
  if coalesce(btrim(p_account_name), '') = '' then
    raise exception 'The company needs a name.';
  end if;
  if coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'The contact needs a first and last name.';
  end if;

  select id, "displayName", status, "partnerManagerId", "agreementExpiryDate"
    into v_partner_row
  from partner where id = v_partner;

  if v_partner_row.status <> 'ACTIVE' then
    raise exception 'Only an active partnership can add customers. Please speak to your partner manager.';
  end if;
  if v_partner_row."agreementExpiryDate" is not null
     and v_partner_row."agreementExpiryDate" < current_date then
    raise exception 'Your partner agreement has expired, so new customers cannot be added. Please speak to your partner manager.';
  end if;

  v_conflict := partner_find_conflict(p_account_name, p_email, p_phone);
  v_contested := coalesce((v_conflict ->> 'conflict')::boolean, false)
                 and not coalesce((v_conflict ->> 'mine')::boolean, false);

  v_owner := v_partner_row."partnerManagerId";
  if v_owner is null then
    select u.id into v_owner
    from app_user u
    join security_role r on r.id = u."roleId"
    where u."deletedAt" is null
      and u.status = 'ACTIVE'
      and u."userType" = 'INTERNAL'
      and r.permissions @> array['*']
    order by u."createdAt"
    limit 1;
  end if;
  if v_owner is null then
    raise exception 'No internal owner could be found for this customer. Please speak to your partner manager.';
  end if;

  v_acct_no := next_sequence_number('Account');

  insert into account (
    id, "accountNumber", name, "accountType", "customerStatus", "ownerUserId",
    industry, website, "billingAddress", "sourcePartnerId", "sourcePartnerUserId",
    "registrationContested", description, "createdAt", "updatedAt"
  ) values (
    v_account, v_acct_no, btrim(p_account_name), 'PROSPECT', 'ONBOARDING', v_owner,
    nullif(btrim(coalesce(p_industry, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    case when nullif(btrim(coalesce(p_city, '')), '') is null then null
         else jsonb_build_object('city', btrim(p_city)) end,
    v_partner, v_user, v_contested,
    nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into contact (
    id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
    "isPrimary", active, "sourcePartnerId", "sourcePartnerUserId", "createdAt", "updatedAt"
  ) values (
    v_contact, v_account, btrim(p_first_name), btrim(p_last_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    true, true, v_partner, v_user, now(), now()
  );

  if coalesce(btrim(coalesce(p_deal_name, '')), '') <> '' then
    v_opp := gen_random_uuid();
    v_link := gen_random_uuid();
    v_opp_no := next_sequence_number('Opportunity');

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", stage, amount, "currencyCode", "expectedCloseDate",
      "opportunityType", "leadSource", "sourcePartnerId", "sourcePartnerUserId",
      description, "createdAt", "updatedAt"
    ) values (
      v_opp, v_opp_no, btrim(p_deal_name), v_account, v_contact,
      v_owner, 'DISCOVERY', coalesce(p_deal_amount, 0),
      coalesce(nullif(btrim(coalesce(p_deal_currency, '')), ''), 'PKR'),
      coalesce(p_deal_close, current_date + 30),
      'NEW', 'Partner', v_partner, v_user,
      nullif(btrim(coalesce(p_notes, '')), ''),
      now(), now()
    );

  end if;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Account', v_account, 'created', null,
    'Created in the partner portal by ' || v_partner_row."displayName"
      || case when v_contested then ' (contested)' else '' end,
    v_user, 'portal', now()
  );

  return jsonb_build_object(
    'accountId', v_account, 'accountNumber', v_acct_no, 'contactId', v_contact,
    'opportunityId', v_opp, 'opportunityNumber', v_opp_no,
    'contested', v_contested, 'conflict', v_conflict
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_partner(p_payload jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    "agreementExpiryDate", "defaultCommissionPercent",
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
    p_payload->>'payoutCurrencyCode', p_payload->>'taxNumber',
    nullif(p_payload->>'withholdingTaxPercent', '')::numeric,
    p_payload->'bankDetails', nullif(p_payload->>'email', ''),
    p_payload->>'phone', p_payload->>'website', p_payload->>'notes',
    now(), now()
  );

  return jsonb_build_object('id', v_partner_id, 'partnerNumber', v_number);
end;
$function$;

-- A partner's rate and withholding are now audited: they decide what the
-- partner is paid on every new deal.
CREATE OR REPLACE FUNCTION public.audited_fields()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array[
    -- Original list.
    'status','stage','priority','amount','totalAmount','contractValue',
    'commissionAmount','ownerUserId','assignedUserId',
    'projectManagerId','approvalStatus','expectedCloseDate','dueDate',
    'startDate','endDate','paidAmount','outstandingAmount','accountType',
    'partnerType','tier',

    -- What a partner is paid: their rate, the tax withheld, and who is credited.
    'defaultCommissionPercent','withholdingTaxPercent','sourcePartnerId',

    -- What a record is and what it says. "description" is the field most often
    -- corrected after the fact, and until now that correction left no trace.
    'name','description','subject','notes','scope','acceptanceCriteria',

    -- Expenses. These are the fields the expense edit form exposes, and the
    -- reason this migration exists: an expense can be re-dated, re-categorised,
    -- moved to another project or made billable, and each of those changes who
    -- ends up paying for it.
    'expenseDate','categoryId','projectId','employeeUserId','vendorAccountId',
    'billableToCustomer','reimbursable','taxAmount','currencyCode',
    'paymentStatus','receiptDocumentId',

    -- Projects and tasks.
    'projectType','health','billingType','approvedHours','plannedEndDate',
    'actualEndDate','estimatedHours','billable','phaseId','milestoneId',

    -- People and access. A role change is the single most security-relevant
    -- edit in the system and was previously invisible here.
    'roleId','departmentId','managerUserId','jobTitle','costRate',
    'defaultBillingRate','employeeNumber','email',

    -- Contact and account details people ring or invoice.
    'phone','accountId','contactId','partnerId','contractId','opportunityId',
    'billingAmount','invoicedAt','quantity','unitPrice','discountPercent'
  ];
$function$;

-- ---------------------------------------------------------------------------
-- 6. The old system goes
-- ---------------------------------------------------------------------------
--
-- Views first, because they read the tables. Then every function of the old
-- ledger, by name whatever its arguments - CASCADE takes the triggers that ran
-- them. Then the tables, then the enums only they used. Dropping an enum that
-- something else still uses fails, which is the check that nothing else does.

drop view if exists v_commission_liability;
drop view if exists v_partner_performance;
drop view if exists v_project_profitability;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in (
      'accrue_commission', 'adjust_commission', 'approve_commissions', 'transition_commissions',
      'claw_back_commission', 'create_commission_payout', 'mark_payout_paid',
      'decide_commission_proposal', 'partner_propose_commission', 'partner_withdraw_proposal',
      'attach_partner_to_deal', 'attach_account_partner_to_deal',
      'opportunity_partner_merge', 'assert_revenue_share_total'
    )
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

drop table if exists commission_proposal;
drop table if exists commission_record;
drop table if exists commission_payout;
drop table if exists commission_tier;
drop table if exists opportunity_partner;
alter table partner drop column if exists "commissionPlanId";
drop table if exists commission_plan;
-- Deal protection only ever fed the registration window, which is gone.
alter table partner drop column if exists "registrationProtectionDays";

drop type if exists "CommissionBasis";
drop type if exists "CommissionRateType";
drop type if exists "CommissionStatus";
drop type if exists "CommissionTrigger";
drop type if exists "PartnerRole";
drop type if exists "PayoutStatus";

-- Two permissions only the old ledger used.
update security_role
   set permissions = array_remove(array_remove(permissions, 'commission:write'), 'payout:approve'),
       "updatedAt" = now()
 where permissions && array['commission:write', 'payout:approve']::text[];

-- ---------------------------------------------------------------------------
-- 7. The reports read the new record
-- ---------------------------------------------------------------------------
--
-- v_partner_performance keeps its column names so nothing reading it has to
-- change, with the meanings carried across: accrued is commission on deals
-- still open, payable is commission on won deals not yet paid, paid is paid.
-- Amounts are what the partner receives, after withholding. Revenue share is
-- gone, so a deal counts at its full amount.

create view v_partner_performance with (security_invoker = true) as
with deals as (
  select o."sourcePartnerId" as partner_id,
         count(*) as deals_total,
         count(*) filter (where o.stage = 'CLOSED_WON') as deals_won,
         count(*) filter (where o.stage = 'CLOSED_LOST') as deals_lost,
         count(*) filter (where o.stage not in ('CLOSED_WON', 'CLOSED_LOST')) as deals_open,
         sum(o.amount) as sourced_pipeline,
         sum(o.amount) filter (where o.stage = 'CLOSED_WON') as sourced_won_value
  from opportunity o
  where o."sourcePartnerId" is not null and o."deletedAt" is null
  group by o."sourcePartnerId"
), comm as (
  select pc."partnerId" as partner_id,
         sum(pc."partnerAmount") filter (where pc.status <> 'REJECTED') as commission_total,
         sum(pc."partnerAmount") filter (where pc.status = 'IN_PROGRESS' and o.stage <> 'CLOSED_WON') as commission_accrued,
         sum(pc."partnerAmount") filter (where pc.status = 'IN_PROGRESS' and o.stage = 'CLOSED_WON') as commission_payable,
         sum(pc."partnerAmount") filter (where pc.status = 'PAID') as commission_paid
  from partner_commission pc
  join opportunity o on o.id = pc."opportunityId"
  group by pc."partnerId"
), refs as (
  select l."referredByPartnerId" as partner_id, count(*) as referred_leads
  from lead l
  where l."referredByPartnerId" is not null and l."deletedAt" is null
  group by l."referredByPartnerId"
)
select p.id as partner_id,
       p."partnerNumber" as partner_number,
       p."displayName" as partner_name,
       p.kind,
       p."partnerType" as partner_type,
       p.tier,
       p.status,
       coalesce(r.referred_leads, 0) as referred_leads,
       coalesce(d.deals_total, 0) as deals_total,
       coalesce(d.deals_open, 0) as deals_open,
       coalesce(d.deals_won, 0) as deals_won,
       coalesce(d.deals_lost, 0) as deals_lost,
       coalesce(d.sourced_pipeline, 0) as sourced_pipeline,
       coalesce(d.sourced_won_value, 0) as sourced_won_value,
       case
         when coalesce(d.deals_won, 0) + coalesce(d.deals_lost, 0) = 0 then null
         else round(d.deals_won::numeric / (d.deals_won + d.deals_lost) * 100, 2)
       end as win_rate_percent,
       coalesce(c.commission_total, 0) as commission_total,
       coalesce(c.commission_accrued, 0) as commission_accrued,
       coalesce(c.commission_payable, 0) as commission_payable,
       coalesce(c.commission_paid, 0) as commission_paid
from partner p
left join deals d on d.partner_id = p.id
left join comm c on c.partner_id = p.id
left join refs r on r.partner_id = p.id
where p."deletedAt" is null;

-- Project margin counts the whole commission as a cost: the part withheld is
-- still paid, to the tax authority rather than the partner.
create view v_project_profitability with (security_invoker = true) as
WITH revenue AS (
         SELECT il."projectId" AS project_id,
            sum(il."lineTotal") AS amount
           FROM invoice_line il
             JOIN invoice i ON i.id = il."invoiceId"
          WHERE (i.status <> ALL (ARRAY['DRAFT'::"InvoiceStatus", 'CANCELLED'::"InvoiceStatus"])) AND i."deletedAt" IS NULL
          GROUP BY il."projectId"
        ), labour AS (
         SELECT time_log."projectId" AS project_id,
            sum(time_log.hours * COALESCE(time_log."costRate", 0::numeric)) AS amount,
            sum(time_log.hours) AS hours
           FROM time_log
          WHERE time_log."approvalStatus" = 'APPROVED'::"TimeApprovalStatus"
          GROUP BY time_log."projectId"
        ), expenses AS (
         SELECT expense."projectId" AS project_id,
            sum(expense.amount) AS amount
           FROM expense
          WHERE expense."approvalStatus" = 'APPROVED'::"ExpenseApprovalStatus" AND expense."deletedAt" IS NULL
          GROUP BY expense."projectId"
        ), supplier AS (
         SELECT vbl."projectId" AS project_id,
            sum(vbl."lineTotal") AS amount
           FROM vendor_bill_line vbl
             JOIN vendor_bill vb ON vb.id = vbl."vendorBillId"
          WHERE (vb.status <> ALL (ARRAY['DRAFT'::"VendorBillStatus", 'CANCELLED'::"VendorBillStatus"])) AND vb."deletedAt" IS NULL
          GROUP BY vbl."projectId"
        ), commissions AS (
         SELECT p.id AS project_id,
            sum(pc."commissionAmount") AS amount
           FROM partner_commission pc
             JOIN project p ON p."opportunityId" = pc."opportunityId"
          WHERE pc.status <> 'REJECTED'
          GROUP BY p.id
        )
 SELECT pr.id AS project_id,
    pr."projectNumber" AS project_number,
    pr.name AS project_name,
    pr."accountId" AS account_id,
    pr.status,
    pr."currencyCode" AS currency_code,
    COALESCE(r.amount, 0::numeric) AS revenue,
    COALESCE(l.amount, 0::numeric) AS labour_cost,
    COALESCE(l.hours, 0::numeric) AS logged_hours,
    COALESCE(e.amount, 0::numeric) + COALESCE(s.amount, 0::numeric) AS external_cost,
    COALESCE(c.amount, 0::numeric) AS commission_cost,
    COALESCE(r.amount, 0::numeric) - COALESCE(l.amount, 0::numeric) - COALESCE(e.amount, 0::numeric) - COALESCE(s.amount, 0::numeric) - COALESCE(c.amount, 0::numeric) AS gross_margin,
        CASE
            WHEN COALESCE(r.amount, 0::numeric) = 0::numeric THEN NULL::numeric
            ELSE round((COALESCE(r.amount, 0::numeric) - COALESCE(l.amount, 0::numeric) - COALESCE(e.amount, 0::numeric) - COALESCE(s.amount, 0::numeric) - COALESCE(c.amount, 0::numeric)) / r.amount * 100::numeric, 2)
        END AS margin_percent
   FROM project pr
     LEFT JOIN revenue r ON r.project_id = pr.id
     LEFT JOIN labour l ON l.project_id = pr.id
     LEFT JOIN expenses e ON e.project_id = pr.id
     LEFT JOIN supplier s ON s.project_id = pr.id
     LEFT JOIN commissions c ON c.project_id = pr.id
  WHERE pr."deletedAt" IS NULL;
