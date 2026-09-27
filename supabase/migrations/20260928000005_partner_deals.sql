-- Partners edit their customers and deals, and take a deal through to a close.
--
-- Until now a partner could add a customer, a contact and a deal, and change
-- none of them afterwards: every later change went through their partner
-- manager. They now edit their own accounts, their people and their deals, and
-- move a deal through its stages to Closed Won or Closed Lost - by the same
-- rules our team closes one by (opportunities.ts changeStage):
--
--   - Closed Won needs an amount, at least one product or service, and an
--     accepted quotation. Winning starts the delivery project, as it does
--     for us.
--   - Closed Lost needs a reason.
--
-- As with everything else a partner writes, each change is one SECURITY
-- DEFINER function that checks the record is the partner's first
-- (20260928000004 for the pattern and its helpers). Owner and campaign are
-- ours and are never set here.

-- ---------------------------------------------------------------------------
-- 1. The project a win starts, whoever won it
-- ---------------------------------------------------------------------------
--
-- create_project_for_won_opportunity lets only our team call it, which is
-- right for a call from the app. A partner's win must start the same project,
-- so the body is split out and the check stays on the public entry point.

create or replace function make_project_for_won_opportunity(p_opportunity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp opportunity%rowtype;
  v_project jsonb;
  v_first_product uuid;
begin
  select * into v_opp from opportunity where id = p_opportunity and "deletedAt" is null for update;
  if not found or v_opp.stage <> 'CLOSED_WON' then
    return null;
  end if;
  if not exists (select 1 from opportunity_product where "opportunityId" = p_opportunity) then
    return null;
  end if;
  if exists (select 1 from project where "opportunityId" = p_opportunity and "deletedAt" is null) then
    return null;
  end if;

  select "productId" into v_first_product
  from opportunity_product where "opportunityId" = p_opportunity
  order by "sortOrder", "createdAt" limit 1;

  v_project := create_record('project', jsonb_build_object(
    -- Named so a project that came from a sale reads as one in every list.
    'name', 'Project-' || v_opp.name,
    'projectType', 'CUSTOMER',
    'accountId', v_opp."accountId",
    'opportunityId', v_opp.id,
    'productId', v_first_product,
    'projectManagerId', v_opp."ownerUserId",
    'status', 'PLANNING',
    'health', 'GREEN',
    'billingType', 'FIXED',
    'contractValue', v_opp.amount,
    'currencyCode', v_opp."currencyCode",
    'startDate', current_date,
    'updatedAt', now()
  ), 'projectNumber', 'Project');

  insert into project_member(id,"projectId","userId","projectRole","allocationPercent","startDate","billingRate","costRate",active,"createdAt","updatedAt")
  select gen_random_uuid(), (v_project->>'id')::uuid, u.id, 'Project Manager', 50, current_date,
         u."defaultBillingRate", u."costRate", true, now(), now()
  from app_user u where u.id = v_opp."ownerUserId";

  perform add_tasks_from_opportunity_lines((v_project->>'id')::uuid);

  return v_project;
end $$;

revoke all on function make_project_for_won_opportunity(uuid) from public, anon, authenticated;

create or replace function create_project_for_won_opportunity(p_opportunity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (app_is_internal() and app_has_permission('opportunity:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return make_project_for_won_opportunity(p_opportunity);
end $$;

revoke all on function create_project_for_won_opportunity(uuid) from public, anon;
grant execute on function create_project_for_won_opportunity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The partner's accounts
-- ---------------------------------------------------------------------------
--
-- A field sent blank is cleared; a field not sent is left alone.

create or replace function partner_update_account(p_id uuid, p_account jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner  uuid := partner_assert_active();
  v_old      account%rowtype;
  v_row      jsonb;
  v_key      text;
  v_address  jsonb;
  v_conflict jsonb;
begin
  select * into v_old from account where id = p_id and "deletedAt" is null for update;
  if not found or v_old."sourcePartnerId" is distinct from v_partner then
    raise exception 'That account is not one of yours.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_account ->> 'name', '')), '') is null then
    raise exception 'The account needs a name.' using errcode = '23514';
  end if;

  v_row := jsonb_build_object('name', btrim(p_account ->> 'name'));
  foreach v_key in array array['industry', 'website', 'mainPhone', 'description'] loop
    if p_account ? v_key then
      v_row := v_row || jsonb_build_object(v_key, nullif(btrim(coalesce(p_account ->> v_key, '')), ''));
    end if;
  end loop;
  if p_account ? 'employeeCount' then
    v_row := v_row || jsonb_build_object('employeeCount',
      case when nullif(btrim(coalesce(p_account ->> 'employeeCount', '')), '') is null then null
           else (p_account ->> 'employeeCount')::integer end);
  end if;
  if p_account ? 'billingAddress' then
    v_address := jsonb_strip_nulls(jsonb_build_object(
      'street',     nullif(btrim(coalesce(p_account -> 'billingAddress' ->> 'street', '')), ''),
      'city',       nullif(btrim(coalesce(p_account -> 'billingAddress' ->> 'city', '')), ''),
      'state',      nullif(btrim(coalesce(p_account -> 'billingAddress' ->> 'state', '')), ''),
      'postalCode', nullif(btrim(coalesce(p_account -> 'billingAddress' ->> 'postalCode', '')), ''),
      'country',    nullif(btrim(coalesce(p_account -> 'billingAddress' ->> 'country', '')), '')
    ));
    v_row := v_row || jsonb_build_object('billingAddress', case when v_address = '{}'::jsonb then null else v_address end);
  end if;

  -- A new name that is already somebody else's company is flagged for a
  -- person to look at, as it is when a partner first registers a customer.
  -- A flag once raised is ours to clear.
  if lower(btrim(p_account ->> 'name')) <> lower(btrim(v_old.name)) then
    v_conflict := partner_find_conflict(btrim(p_account ->> 'name'), null, null);
    if coalesce((v_conflict ->> 'conflict')::boolean, false)
       and not coalesce((v_conflict ->> 'mine')::boolean, false) then
      v_row := v_row || jsonb_build_object('registrationContested', true);
    end if;
  end if;

  return update_record('account', p_id, v_row, 'Account', app_current_user_id());
end $$;

revoke all on function partner_update_account(uuid, jsonb) from public, anon;
grant execute on function partner_update_account(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The people at those accounts
-- ---------------------------------------------------------------------------
--
-- Creates (p_id null, on one of the partner's accounts) or edits one of the
-- partner's contacts. Making one the primary contact demotes whoever was, as
-- our own contact form does. The duplicate rule applies as everywhere.

create or replace function partner_save_contact(p_id uuid, p_account_id uuid, p_contact jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_actor   uuid := app_current_user_id();
  v_account uuid;
  v_row     jsonb := '{}'::jsonb;
  v_key     text;
  v_primary boolean := case when p_contact ? 'isPrimary' then coalesce((p_contact ->> 'isPrimary')::boolean, false) end;
begin
  if nullif(btrim(coalesce(p_contact ->> 'firstName', '')), '') is null
     or nullif(btrim(coalesce(p_contact ->> 'lastName', '')), '') is null then
    raise exception 'The contact needs a first and last name.' using errcode = '23514';
  end if;

  v_row := jsonb_build_object(
    'firstName', btrim(p_contact ->> 'firstName'),
    'lastName', btrim(p_contact ->> 'lastName'));
  foreach v_key in array array[
    'jobTitle', 'department', 'email', 'phone', 'mobile', 'whatsapp', 'contactRole', 'preferredChannel'
  ] loop
    if p_contact ? v_key then
      v_row := v_row || jsonb_build_object(v_key, nullif(btrim(coalesce(p_contact ->> v_key, '')), ''));
    end if;
  end loop;
  if p_contact ? 'communicationConsent' then
    v_row := v_row || jsonb_build_object('communicationConsent', coalesce((p_contact ->> 'communicationConsent')::boolean, false));
  end if;
  if v_primary is not null then
    v_row := v_row || jsonb_build_object('isPrimary', v_primary);
  end if;

  if p_id is null then
    if not partner_owns_record('Account', p_account_id) then
      raise exception 'That account is not one of yours.' using errcode = '42501';
    end if;
    v_account := p_account_id;
  else
    if not partner_owns_record('Contact', p_id) then
      raise exception 'That contact is not one of yours.' using errcode = '42501';
    end if;
    select "accountId" into v_account from contact where id = p_id;
  end if;

  if coalesce(v_primary, false) and v_account is not null then
    update contact set "isPrimary" = false, "updatedAt" = now()
    where "accountId" = v_account and "isPrimary" and id is distinct from p_id;
  end if;

  if p_id is null then
    return create_record('contact', v_row || jsonb_build_object(
      'accountId', v_account,
      'active', true,
      'isPrimary', coalesce(v_primary, false),
      'sourcePartnerId', v_partner,
      'sourcePartnerUserId', v_actor
    ));
  end if;
  return update_record('contact', p_id, v_row, 'Contact', v_actor);
end $$;

revoke all on function partner_save_contact(uuid, uuid, jsonb) from public, anon;
grant execute on function partner_save_contact(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The partner's deals
-- ---------------------------------------------------------------------------
--
-- Everything our deal form edits except owner and campaign, which are ours,
-- and the stage, which moves only through partner_set_opportunity_stage below.
-- Once a deal is priced by its products and services the amount is their total
-- and cannot be typed over, as on our side.

create or replace function partner_update_opportunity(p_id uuid, p_deal jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_old     opportunity%rowtype;
  v_row     jsonb;
  v_key     text;
  v_contact uuid;
  v_prob    numeric;
begin
  select * into v_old from opportunity where id = p_id and "deletedAt" is null for update;
  if not found or v_old."sourcePartnerId" is distinct from v_partner then
    raise exception 'That deal is not one of yours.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_deal ->> 'name', '')), '') is null then
    raise exception 'The deal needs a name.' using errcode = '23514';
  end if;

  v_row := jsonb_build_object('name', left(btrim(p_deal ->> 'name'), 255));
  foreach v_key in array array['leadSource', 'nextStep', 'competitorName', 'description'] loop
    if p_deal ? v_key then
      v_row := v_row || jsonb_build_object(v_key, nullif(btrim(coalesce(p_deal ->> v_key, '')), ''));
    end if;
  end loop;

  if p_deal ? 'primaryContactId' then
    v_contact := nullif(p_deal ->> 'primaryContactId', '')::uuid;
    if v_contact is not null and not exists (
      select 1 from contact where id = v_contact and "accountId" = v_old."accountId" and "deletedAt" is null
    ) then
      raise exception 'That contact does not work at this customer.' using errcode = '23514';
    end if;
    v_row := v_row || jsonb_build_object('primaryContactId', v_contact);
  end if;

  if nullif(p_deal ->> 'currencyCode', '') is not null then
    v_row := v_row || jsonb_build_object('currencyCode', upper(btrim(p_deal ->> 'currencyCode')));
  end if;
  if nullif(p_deal ->> 'expectedCloseDate', '') is not null then
    v_row := v_row || jsonb_build_object('expectedCloseDate', (p_deal ->> 'expectedCloseDate')::date);
  end if;
  if nullif(p_deal ->> 'probabilityPercent', '') is not null then
    v_prob := (p_deal ->> 'probabilityPercent')::numeric;
    if v_prob < 0 or v_prob > 100 then
      raise exception 'A probability is between 0 and 100.' using errcode = '23514';
    end if;
    v_row := v_row || jsonb_build_object('probabilityPercent', v_prob);
  end if;
  if nullif(p_deal ->> 'opportunityType', '') is not null then
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'OpportunityType' and e.enumlabel = p_deal ->> 'opportunityType'
    ) then
      raise exception 'That is not a type of deal.' using errcode = '23514';
    end if;
    v_row := v_row || jsonb_build_object('opportunityType', p_deal ->> 'opportunityType');
  end if;
  if not v_old."pricedByLines" and nullif(p_deal ->> 'amount', '') is not null then
    if (p_deal ->> 'amount')::numeric < 0 then
      raise exception 'An amount cannot be negative.' using errcode = '23514';
    end if;
    v_row := v_row || jsonb_build_object('amount', (p_deal ->> 'amount')::numeric);
  end if;

  return update_record('opportunity', p_id, v_row, 'Opportunity', app_current_user_id());
end $$;

revoke all on function partner_update_opportunity(uuid, jsonb) from public, anon;
grant execute on function partner_update_opportunity(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Moving a deal through its stages
-- ---------------------------------------------------------------------------

create or replace function partner_set_opportunity_stage(
  p_id          uuid,
  p_stage       text,
  p_loss_reason text default null,
  p_competitor  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner   uuid := partner_assert_active();
  v_old       opportunity%rowtype;
  v_closing   boolean;
  v_project   jsonb;
  v_problem   text;
begin
  select * into v_old from opportunity where id = p_id and "deletedAt" is null for update;
  if not found or v_old."sourcePartnerId" is distinct from v_partner then
    raise exception 'That deal is not one of yours.' using errcode = '42501';
  end if;
  if p_stage not in (
    'DISCOVERY', 'QUALIFICATION', 'REQUIREMENTS', 'SOLUTION_PROPOSED', 'QUOTE_SUBMITTED',
    'NEGOTIATION', 'VERBAL_CONFIRMATION', 'CLOSED_WON', 'CLOSED_LOST', 'ON_HOLD'
  ) then
    raise exception 'That is not a stage a deal can be at.' using errcode = '23514';
  end if;

  if p_stage = 'CLOSED_LOST' and nullif(btrim(coalesce(p_loss_reason, '')), '') is null then
    raise exception 'A loss reason is required to mark a deal Closed Lost.' using errcode = '23514';
  end if;
  if p_stage = 'CLOSED_WON' then
    if coalesce(v_old.amount, 0) <= 0 then
      raise exception 'A won deal needs an amount greater than zero.' using errcode = '23514';
    end if;
    if not exists (select 1 from opportunity_product where "opportunityId" = p_id) then
      raise exception 'A won deal needs at least one product or service. Add what is being sold, then close it - the delivery project and its tasks are created from those lines.'
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from quotation where "opportunityId" = p_id and status = 'ACCEPTED' and "deletedAt" is null
    ) then
      raise exception 'A won deal needs an accepted quotation. Record the customer''s acceptance of your quote first.'
        using errcode = '23514';
    end if;
  end if;

  v_closing := p_stage in ('CLOSED_WON', 'CLOSED_LOST');

  perform update_record('opportunity', p_id, jsonb_build_object(
    'stage', p_stage,
    'probabilityPercent', case p_stage
      when 'DISCOVERY' then 10 when 'QUALIFICATION' then 20 when 'REQUIREMENTS' then 30
      when 'SOLUTION_PROPOSED' then 45 when 'QUOTE_SUBMITTED' then 60 when 'NEGOTIATION' then 75
      when 'VERBAL_CONFIRMATION' then 90 when 'CLOSED_WON' then 100 when 'CLOSED_LOST' then 0
      else 15 end,
    'lossReason', case when p_stage = 'CLOSED_LOST' then left(btrim(p_loss_reason), 255) end,
    'competitorName', coalesce(left(nullif(btrim(coalesce(p_competitor, '')), ''), 200), v_old."competitorName"),
    'actualCloseDate', case when v_closing then current_date end
  ), 'Opportunity', app_current_user_id());

  -- A problem starting the project must not undo a legitimate win, so it is
  -- reported alongside the win rather than failing it - as on our side.
  if p_stage = 'CLOSED_WON' then
    begin
      v_project := make_project_for_won_opportunity(p_id);
    exception when others then
      v_problem := sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'stage', p_stage,
    'projectNumber', v_project ->> 'projectNumber',
    'projectError', v_problem
  );
end $$;

revoke all on function partner_set_opportunity_stage(uuid, text, text, text) from public, anon;
grant execute on function partner_set_opportunity_stage(uuid, text, text, text) to authenticated;
