-- Partners work their own leads, from the portal.
--
-- A partner is a sales team for its own business: it finds leads, works them -
-- calls, meetings, follow-ups, email - and converts the good ones into a
-- customer, a contact and a deal. Everything here is that, limited to the
-- partner's own records.
--
-- A partner's lead is one credited to them: referredByPartnerId. Everybody at
-- the partner company shares that company's leads. Each lead keeps an internal
-- owner - the partner's manager - so our own visibility rules keep working and
-- our team sees every partner's leads; a partner cannot change it.
--
-- As with customers (20260920000008), partners hold no INSERT or UPDATE policy
-- on these tables. Every write is one SECURITY DEFINER function that checks the
-- record is the partner's, so what a partner can do is the functions'
-- arguments rather than the tables' columns.
--
-- Activities stay what they have always been: our record of what WE did. A
-- partner sees the ones logged by people at their own company, never our
-- team's notes on the same lead.

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- Everybody who signs in for the current partner. Security definer because a
-- partner may read only their own app_user row, and "my company's activities"
-- needs the colleagues' ids as well.
create or replace function app_partner_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from app_user u
  where app_current_partner_id() is not null
    and u."partnerId" = app_current_partner_id()
$$;

revoke all on function app_partner_user_ids() from public, anon;
grant execute on function app_partner_user_ids() to authenticated;

-- The internal owner a partner's records get: their partner manager, or failing
-- that the first administrator - the rule partner_create_customer has used.
create or replace function partner_record_owner(p_partner uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select "partnerManagerId" from partner where id = p_partner),
    (select u.id
       from app_user u
       join security_role r on r.id = u."roleId"
      where u."deletedAt" is null
        and u.status = 'ACTIVE'
        and u."userType" = 'INTERNAL'
        and r.permissions @> array['*']
      order by u."createdAt"
      limit 1)
  )
$$;

revoke all on function partner_record_owner(uuid) from public, anon, authenticated;

-- The partner doing this, refusing anybody who is not an active partnership
-- within its agreement - the same gate partner_create_customer applies.
create or replace function partner_assert_active()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_row     record;
begin
  if v_partner is null then
    raise exception 'Only a partner can do this here.' using errcode = '42501';
  end if;
  select status, "agreementExpiryDate" into v_row from partner where id = v_partner;
  if v_row.status::text <> 'ACTIVE' then
    raise exception 'Only an active partnership can do this. Please speak to your partner manager.'
      using errcode = '42501';
  end if;
  if v_row."agreementExpiryDate" is not null and v_row."agreementExpiryDate" < current_date then
    raise exception 'Your partner agreement has expired. Please speak to your partner manager.'
      using errcode = '42501';
  end if;
  return v_partner;
end $$;

revoke all on function partner_assert_active() from public, anon, authenticated;

-- A lead's fields as a partner may set them, from what was sent. Owner,
-- campaign, type and partner are ours and never come from here. A field sent
-- blank is cleared; a field not sent at all is left as it is, so a screen that
-- shows only some fields cannot wipe the rest.
create or replace function partner_lead_fields(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_key  text;
begin
  foreach v_key in array array[
    'companyName', 'jobTitle', 'email', 'phone', 'whatsapp', 'industry', 'website',
    'businessType', 'companySize', 'street', 'city', 'state', 'postalCode', 'country',
    'leadSource', 'rating', 'description', 'nextFollowUpAt'
  ] loop
    if p ? v_key then
      v_out := v_out || jsonb_build_object(v_key, nullif(btrim(coalesce(p ->> v_key, '')), ''));
    end if;
  end loop;

  if p ? 'estimatedValue' then
    v_out := v_out || jsonb_build_object('estimatedValue', case
      when nullif(btrim(coalesce(p ->> 'estimatedValue', '')), '') is null then null
      else (p ->> 'estimatedValue')::numeric
    end);
  end if;

  return v_out || jsonb_build_object(
    'firstName', btrim(coalesce(p ->> 'firstName', '')),
    'lastName', btrim(coalesce(p ->> 'lastName', ''))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 1. What a partner may read
-- ---------------------------------------------------------------------------

drop policy if exists lead_partner_read on lead;
create policy lead_partner_read on lead
  for select to authenticated
  using (
    app_current_partner_id() is not null
    and "referredByPartnerId" = app_current_partner_id()
  );

drop policy if exists activity_partner_read on activity;
create policy activity_partner_read on activity
  for select to authenticated
  using (
    app_current_partner_id() is not null
    and "ownerUserId" in (select app_partner_user_ids())
  );

-- ---------------------------------------------------------------------------
-- 2. Creating and editing a lead
-- ---------------------------------------------------------------------------

create or replace function partner_save_lead(p_id uuid, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_actor   uuid := app_current_user_id();
  v_owner   uuid;
  v_old     lead%rowtype;
  v_row     jsonb := partner_lead_fields(p_lead);
  v_status  text := nullif(btrim(coalesce(p_lead ->> 'status', '')), '');
begin
  if v_row ->> 'firstName' = '' or v_row ->> 'lastName' = '' then
    raise exception 'A lead needs a first and last name.' using errcode = '23514';
  end if;
  if v_status is not null and v_status not in (
    'NEW', 'ASSIGNED', 'ATTEMPTED_CONTACT', 'CONTACTED', 'DISCOVERY_SCHEDULED',
    'QUALIFIED', 'NURTURING', 'DISQUALIFIED'
  ) then
    raise exception 'That is not a status a lead can be set to.' using errcode = '23514';
  end if;
  if v_status = 'DISQUALIFIED' and nullif(btrim(coalesce(p_lead ->> 'disqualifiedReason', '')), '') is null then
    raise exception 'Say why the lead is disqualified.' using errcode = '23514';
  end if;
  v_row := v_row || jsonb_build_object(
    'disqualifiedReason',
    case when v_status = 'DISQUALIFIED' then btrim(p_lead ->> 'disqualifiedReason') end
  );

  if p_id is null then
    v_owner := partner_record_owner(v_partner);
    if v_owner is null then
      raise exception 'No one here could be found to look after this lead. Please speak to your partner manager.';
    end if;
    return create_record('lead', v_row || jsonb_build_object(
      'referredByPartnerId', v_partner,
      'ownerUserId', v_owner,
      'leadType', 'SALES',
      'status', coalesce(v_status, 'NEW'),
      'leadSource', coalesce(v_row ->> 'leadSource', 'Partner')
    ), 'leadNumber', 'Lead');
  end if;

  select * into v_old from lead where id = p_id and "deletedAt" is null for update;
  if not found or v_old."referredByPartnerId" is distinct from v_partner then
    raise exception 'That lead is not one of yours.' using errcode = '42501';
  end if;
  if v_old."convertedAt" is not null then
    raise exception 'This lead has been converted, so it can no longer be edited.' using errcode = '23514';
  end if;

  if v_status is not null then
    v_row := v_row || jsonb_build_object('status', v_status);
  end if;
  return update_record('lead', p_id, v_row, 'Lead', v_actor);
end $$;

revoke all on function partner_save_lead(uuid, jsonb) from public, anon;
grant execute on function partner_save_lead(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Importing a list
-- ---------------------------------------------------------------------------
--
-- Rows for people already on file - anywhere in our records, or earlier in the
-- same file - are left out and listed, never refused as a whole: a list with a
-- few known people in it is still worth importing. What a partner is told about
-- a person already on file follows the duplicate rule: who, if the record is
-- theirs; only that they exist, if not.

create or replace function partner_import_leads(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_owner   uuid;
  v_row     jsonb;
  v_i       integer := 0;
  v_fields  jsonb;
  v_hit     jsonb;
  v_seen    jsonb;
  v_name    text;
  v_keys    text[];
  v_emails  text[] := '{}';
  v_numbers text[] := '{}';
  v_created integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Expected a list of leads.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import at most 500 leads at a time.' using errcode = '23514';
  end if;
  v_owner := partner_record_owner(v_partner);
  if v_owner is null then
    raise exception 'No one here could be found to look after these leads. Please speak to your partner manager.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_fields := partner_lead_fields(v_row);
    v_name := btrim(coalesce(v_fields ->> 'firstName', '') || ' ' || coalesce(v_fields ->> 'lastName', ''));

    if v_fields ->> 'firstName' = '' or v_fields ->> 'lastName' = '' then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row', v_i, 'name', v_name, 'reason', 'Needs a first and last name'));
      continue;
    end if;

    v_hit := person_match('lead', v_fields ->> 'email', v_fields ->> 'phone', v_fields ->> 'whatsapp', null);
    if v_hit is not null then
      v_seen := person_match_visible(v_hit);
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row', v_i, 'name', v_name,
        'reason', case
          when coalesce((v_seen ->> 'hidden')::boolean, true)
            then format('Already in our records (same %s)', person_field_label(v_hit ->> 'field'))
          when v_hit ->> 'entity' = 'lead'
            then format('Already your lead %s (%s, same %s)', v_hit ->> 'name', v_hit ->> 'number',
                        person_field_label(v_hit ->> 'field'))
          else format('Already your contact %s (same %s)', v_hit ->> 'name', person_field_label(v_hit ->> 'field'))
        end));
      continue;
    end if;

    -- Earlier in this same file. Numbers share one key space, so a WhatsApp
    -- number repeats an earlier row's phone number.
    v_keys := array_remove(array[phone_key(v_fields ->> 'phone'), phone_key(v_fields ->> 'whatsapp')], null);
    if (email_key(v_fields ->> 'email') is not null and email_key(v_fields ->> 'email') = any(v_emails))
       or v_keys && v_numbers then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row', v_i, 'name', v_name, 'reason', 'Same person as an earlier row of this file'));
      continue;
    end if;

    begin
      perform create_record('lead', v_fields || jsonb_build_object(
        'referredByPartnerId', v_partner,
        'ownerUserId', v_owner,
        'leadType', 'SALES',
        'status', 'NEW',
        'leadSource', coalesce(v_fields ->> 'leadSource', 'Partner')
      ), 'leadNumber', 'Lead');
      v_created := v_created + 1;
      if email_key(v_fields ->> 'email') is not null then
        v_emails := v_emails || email_key(v_fields ->> 'email');
      end if;
      v_numbers := v_numbers || v_keys;
    exception when unique_violation then
      -- Somebody added the same person while the list was being imported.
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row', v_i, 'name', v_name, 'reason', 'Already in our records'));
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

revoke all on function partner_import_leads(jsonb) from public, anon;
grant execute on function partner_import_leads(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Converting a lead
-- ---------------------------------------------------------------------------
--
-- As convert_lead does for our team, credited to the partner throughout: the
-- account, the contact and the deal all name the partner and the person who
-- converted it, and are owned by the lead's internal owner. The deal gets its
-- commission record from the database as any partner deal does.
--
-- A person who is already the partner's own contact is used rather than made
-- twice, on that contact's account. Anybody else's contact is refused, and the
-- partner is told only that the person is known.

create or replace function partner_convert_lead(
  p_lead_id            uuid,
  p_create_opportunity boolean,
  p_opportunity_name   text default null,
  p_amount             numeric default null,
  p_expected_close     date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner  uuid := partner_assert_active();
  v_actor    uuid := app_current_user_id();
  v_lead     lead%rowtype;
  v_hit      jsonb;
  v_seen     jsonb;
  v_account  uuid;
  v_contact  uuid;
  v_opp      uuid;
  v_reused   boolean := false;
  v_conflict jsonb;
  v_company  text;
begin
  select * into v_lead from lead where id = p_lead_id and "deletedAt" is null for update;
  if not found or v_lead."referredByPartnerId" is distinct from v_partner then
    raise exception 'That lead is not one of yours.' using errcode = '42501';
  end if;
  if v_lead."convertedAt" is not null then
    raise exception 'That lead has already been converted.' using errcode = '23514';
  end if;

  v_hit := person_match('contact', v_lead.email, v_lead.phone, v_lead.whatsapp, null);
  if v_hit is not null then
    v_seen := person_match_visible(v_hit);
    if coalesce((v_seen ->> 'mine')::boolean, false)
       and exists (
         select 1 from account
         where id = nullif(v_hit ->> 'accountId', '')::uuid
           and "sourcePartnerId" = v_partner and "deletedAt" is null
       ) then
      v_account := (v_hit ->> 'accountId')::uuid;
      v_contact := (v_hit ->> 'id')::uuid;
      v_reused := true;
    else
      raise exception using
        message = person_match_message(v_hit, 'contact'),
        errcode = '23505',
        detail  = v_seen::text,
        hint    = 'duplicate_person';
    end if;
  end if;

  if not v_reused then
    v_company := coalesce(nullif(btrim(coalesce(v_lead."companyName", '')), ''),
                          v_lead."firstName" || ' ' || v_lead."lastName");
    -- A company name already on our books is flagged for a person to look at,
    -- as it is when a partner registers a customer.
    v_conflict := partner_find_conflict(v_company, null, null);

    v_account := gen_random_uuid();
    insert into account (
      id, "accountNumber", name, "accountType", "customerStatus", "ownerUserId",
      industry, website, "mainPhone", "billingAddress",
      "sourcePartnerId", "sourcePartnerUserId", "registrationContested",
      "createdAt", "updatedAt"
    ) values (
      v_account, next_sequence_number('Account'), v_company, 'PROSPECT', 'ONBOARDING', v_lead."ownerUserId",
      v_lead.industry, v_lead.website, v_lead.phone,
      case when coalesce(v_lead.street, v_lead.city, v_lead.state, v_lead."postalCode", v_lead.country) is null then null
           else jsonb_strip_nulls(jsonb_build_object(
             'street', v_lead.street, 'city', v_lead.city, 'state', v_lead.state,
             'postalCode', v_lead."postalCode", 'country', v_lead.country)) end,
      v_partner, v_actor,
      coalesce((v_conflict ->> 'conflict')::boolean, false) and not coalesce((v_conflict ->> 'mine')::boolean, false),
      now(), now()
    );

    v_contact := gen_random_uuid();
    insert into contact (
      id, "accountId", "firstName", "lastName", "jobTitle", email, phone, whatsapp,
      "isPrimary", active, "communicationConsent", "sourcePartnerId", "sourcePartnerUserId",
      "createdAt", "updatedAt"
    ) values (
      v_contact, v_account, v_lead."firstName", v_lead."lastName", v_lead."jobTitle",
      v_lead.email, v_lead.phone, v_lead.whatsapp,
      true, true, true, v_partner, v_actor, now(), now()
    );
  end if;

  if coalesce(p_create_opportunity, false) then
    v_opp := gen_random_uuid();
    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId", "ownerUserId",
      stage, amount, "currencyCode", "expectedCloseDate", "opportunityType", "leadSource",
      "sourcePartnerId", "sourcePartnerUserId", "createdAt", "updatedAt"
    ) values (
      v_opp, next_sequence_number('Opportunity'),
      coalesce(nullif(btrim(coalesce(p_opportunity_name, '')), ''), v_lead."companyName", 'New opportunity'),
      v_account, v_contact, v_lead."ownerUserId",
      'DISCOVERY', coalesce(p_amount, v_lead."estimatedValue", 0), 'PKR',
      coalesce(p_expected_close, current_date + 30), 'NEW', coalesce(v_lead."leadSource", 'Partner'),
      v_partner, v_actor, now(), now()
    );
  end if;

  update lead set
    status                   = 'CONVERTED',
    "convertedAt"            = now(),
    "convertedAccountId"     = v_account,
    "convertedContactId"     = v_contact,
    "convertedOpportunityId" = v_opp,
    "updatedAt"              = now()
  where id = p_lead_id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Lead', p_lead_id, 'status', v_lead.status::text, 'CONVERTED',
    v_actor, 'portal', now()
  );

  return jsonb_build_object(
    'accountId', v_account, 'contactId', v_contact, 'opportunityId', v_opp,
    'reusedContact', v_reused
  );
end $$;

revoke all on function partner_convert_lead(uuid, boolean, text, numeric, date) from public, anon;
grant execute on function partner_convert_lead(uuid, boolean, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Logging what was done
-- ---------------------------------------------------------------------------
--
-- A call made, a meeting held, a note, or a follow-up to do - against one of
-- the partner's leads, customers, their people, or deals.

create or replace function partner_owns_record(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
begin
  if v_partner is null or p_id is null then
    return false;
  end if;
  return case p_type
    when 'Lead' then exists (
      select 1 from lead where id = p_id and "referredByPartnerId" = v_partner and "deletedAt" is null)
    when 'Account' then exists (
      select 1 from account where id = p_id and "sourcePartnerId" = v_partner and "deletedAt" is null)
    when 'Contact' then exists (
      select 1 from contact c
      where c.id = p_id and c."deletedAt" is null
        and (c."sourcePartnerId" = v_partner
             or c."accountId" in (select a.id from account a where a."sourcePartnerId" = v_partner)))
    when 'Opportunity' then exists (
      select 1 from opportunity where id = p_id and "sourcePartnerId" = v_partner and "deletedAt" is null)
    else false
  end;
end $$;

revoke all on function partner_owns_record(text, uuid) from public, anon, authenticated;

create or replace function partner_log_activity(p_entity_type text, p_entity_id uuid, p_activity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := partner_assert_active();
  v_type    text := upper(btrim(coalesce(p_activity ->> 'activityType', '')));
  v_subject text := btrim(coalesce(p_activity ->> 'subject', ''));
  v_due     timestamp := nullif(btrim(coalesce(p_activity ->> 'dueAt', '')), '')::timestamp;
  v_status  text;
  v_id      uuid := gen_random_uuid();
begin
  if not partner_owns_record(p_entity_type, p_entity_id) then
    raise exception 'That is not one of your records.' using errcode = '42501';
  end if;
  if v_type not in ('LOG', 'CALL', 'MEETING', 'TASK') then
    raise exception 'Log a call, a meeting, a note or a follow-up.' using errcode = '23514';
  end if;
  if v_subject = '' then
    raise exception 'Say what it was about.' using errcode = '23514';
  end if;

  -- A follow-up is something still to do; everything else is logged after it happened.
  v_status := case when v_type = 'TASK' then 'OPEN' else 'COMPLETED' end;

  insert into activity (
    id, "activityType", subject, description, outcome, "ownerUserId",
    "relatedEntityType", "relatedEntityId", "dueAt", "startAt",
    status, priority, "completedAt", "createdAt", "updatedAt"
  ) values (
    v_id, v_type, left(v_subject, 255),
    nullif(btrim(coalesce(p_activity ->> 'description', '')), ''),
    nullif(btrim(coalesce(p_activity ->> 'outcome', '')), ''),
    app_current_user_id(), p_entity_type, p_entity_id,
    v_due, case when v_type = 'MEETING' then coalesce(v_due, now()::timestamp) end,
    v_status::"ActivityStatus", 'MEDIUM',
    case when v_status = 'COMPLETED' then now() end,
    now(), now()
  );

  return jsonb_build_object('id', v_id);
end $$;

revoke all on function partner_log_activity(text, uuid, jsonb) from public, anon;
grant execute on function partner_log_activity(text, uuid, jsonb) to authenticated;

-- Closing a follow-up: done, or no longer needed. Only one the partner's own
-- company logged.
create or replace function partner_close_activity(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform partner_assert_active();
  if p_status not in ('COMPLETED', 'CANCELLED') then
    raise exception 'A follow-up is either done or no longer needed.' using errcode = '23514';
  end if;
  update activity set
    status        = p_status::"ActivityStatus",
    "completedAt" = case when p_status = 'COMPLETED' then now() end,
    "updatedAt"   = now()
  where id = p_id
    and "deletedAt" is null
    and "ownerUserId" in (select app_partner_user_ids());
  if not found then
    raise exception 'That follow-up is not one of yours.' using errcode = '42501';
  end if;
end $$;

revoke all on function partner_close_activity(uuid, text) from public, anon;
grant execute on function partner_close_activity(uuid, text) to authenticated;
