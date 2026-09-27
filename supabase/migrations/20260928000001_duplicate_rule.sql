-- One person, one record.
--
-- A new lead whose email address, phone number or WhatsApp number is already on
-- a lead or a contact is refused, and so is a new contact whose details are
-- already on a contact. Whoever is creating it is told who it is - unless they
-- are a partner, who is told only that the person is already known, because the
-- record may be ours or another partner's.
--
-- Until now duplicates were allowed on purpose and merged afterwards: somebody
-- at a webinar and then a trade show became two leads, and an agent merged
-- them. That is reversed. Converting a campaign member who is already a lead
-- now links the member to that lead, which keeps both campaigns credited on one
-- record without making a second.
--
-- How two people are matched:
--   - Email, ignoring case and surrounding spaces.
--   - Phone numbers on their last nine digits, so +92 300 7654321 and
--     03007654321 are one number (see 20260920000009), and ACROSS fields: a
--     number given as somebody's WhatsApp matches the same number given as
--     another record's phone or mobile. People put their one mobile number in
--     whichever box is in front of them.
--   - Not website: colleagues share one.
--
-- Enforced by triggers, so it holds for every way a lead or contact is made -
-- the forms, the import, member conversion, lead conversion, the partner portal
-- - rather than only for the paths that remember to check first. The paths that
-- can do something better than fail - linking, reusing, skipping - look first.

-- ---------------------------------------------------------------------------
-- 1. The keys
-- ---------------------------------------------------------------------------

create or replace function email_key(p_email text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '')
$$;

comment on function email_key(text) is
  'An email address as the duplicate rule compares it: trimmed and lower-cased, null when empty.';

-- Nine digits identifies a number and survives a country code or a trunk zero on
-- either side. Fewer is not distinctive enough to refuse somebody over.
create or replace function phone_key(p_phone text)
returns text
language sql
immutable
parallel safe
as $$
  select case when length(d.digits) >= 9 then right(d.digits, 9) end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits) d
$$;

comment on function phone_key(text) is
  'A phone number as the duplicate rule compares it: its last nine digits, null when it has fewer.';

create or replace function person_field_label(p_field text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_field
    when 'email'    then 'email address'
    when 'phone'    then 'phone number'
    when 'whatsapp' then 'WhatsApp number'
    when 'mobile'   then 'mobile number'
    else 'details'
  end
$$;

create index if not exists lead_email_key_idx
  on lead (email_key(email)) where "deletedAt" is null;
create index if not exists lead_phone_key_idx
  on lead (phone_key(phone)) where "deletedAt" is null;
create index if not exists lead_whatsapp_key_idx
  on lead (phone_key(whatsapp)) where "deletedAt" is null;

create index if not exists contact_email_key_idx
  on contact (email_key(email)) where "deletedAt" is null;
create index if not exists contact_phone_key_idx
  on contact (phone_key(phone)) where "deletedAt" is null;
create index if not exists contact_mobile_key_idx
  on contact (phone_key(mobile)) where "deletedAt" is null;
create index if not exists contact_whatsapp_key_idx
  on contact (phone_key(whatsapp)) where "deletedAt" is null;

-- ---------------------------------------------------------------------------
-- 2. Finding the person
-- ---------------------------------------------------------------------------
--
-- The first existing record that shares an address or a number, or null.
-- p_scope 'lead' looks at leads and then contacts; 'contact' at contacts only,
-- because converting a lead makes a contact out of it and would otherwise
-- always find the lead it came from.
--
-- 'field' names which of the NEW record's details matched, so the person can
-- be told which box to look at.
--
-- Sees every record regardless of who is asking - a duplicate is a duplicate
-- whether or not the asker may open it - so it is never exposed directly.
-- What the asker may be told is decided by person_match_visible().

create or replace function person_match(
  p_scope       text,
  p_email       text,
  p_phone       text,
  p_whatsapp    text,
  p_mobile      text,
  p_not_lead    uuid default null,
  p_not_contact uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := email_key(p_email);
  v_phone text := phone_key(p_phone);
  v_wa    text := phone_key(p_whatsapp);
  v_keys  text[] := array_remove(
    array[phone_key(p_phone), phone_key(p_whatsapp), phone_key(p_mobile)], null);
  v_hit   jsonb;
begin
  if p_scope not in ('lead', 'contact') then
    raise exception 'person_match: unknown scope %', p_scope;
  end if;
  if v_email is null and cardinality(v_keys) = 0 then
    return null;
  end if;

  -- An address is the stronger match, so it is looked for first.
  if v_email is not null then
    if p_scope = 'lead' then
      select jsonb_build_object(
               'entity', 'lead', 'id', l.id, 'number', l."leadNumber",
               'name', btrim(l."firstName" || ' ' || coalesce(nullif(l."lastName", '-'), '')),
               'company', l."companyName", 'partnerId', l."referredByPartnerId",
               'field', 'email')
        into v_hit
      from lead l
      where email_key(l.email) = v_email
        and l."deletedAt" is null
        and l."mergedIntoId" is null
        and l.id is distinct from p_not_lead
      order by l."createdAt"
      limit 1;

      if v_hit is not null then
        return v_hit;
      end if;
    end if;

    select jsonb_build_object(
             'entity', 'contact', 'id', c.id, 'number', null,
             'name', btrim(c."firstName" || ' ' || coalesce(c."lastName", '')),
             'company', a.name, 'accountId', c."accountId",
             'partnerId', coalesce(c."sourcePartnerId", a."sourcePartnerId"),
             'field', 'email')
      into v_hit
    from contact c
    left join account a on a.id = c."accountId"
    where email_key(c.email) = v_email
      and c."deletedAt" is null
      and c.id is distinct from p_not_contact
    order by c."createdAt"
    limit 1;

    if v_hit is not null then
      return v_hit;
    end if;
  end if;

  if cardinality(v_keys) > 0 then
    if p_scope = 'lead' then
      select jsonb_build_object(
               'entity', 'lead', 'id', l.id, 'number', l."leadNumber",
               'name', btrim(l."firstName" || ' ' || coalesce(nullif(l."lastName", '-'), '')),
               'company', l."companyName", 'partnerId', l."referredByPartnerId",
               'field', case
                 when v_phone in (phone_key(l.phone), phone_key(l.whatsapp)) then 'phone'
                 when v_wa in (phone_key(l.phone), phone_key(l.whatsapp)) then 'whatsapp'
                 else 'mobile'
               end)
        into v_hit
      from lead l
      where (phone_key(l.phone) = any(v_keys) or phone_key(l.whatsapp) = any(v_keys))
        and l."deletedAt" is null
        and l."mergedIntoId" is null
        and l.id is distinct from p_not_lead
      order by l."createdAt"
      limit 1;

      if v_hit is not null then
        return v_hit;
      end if;
    end if;

    select jsonb_build_object(
             'entity', 'contact', 'id', c.id, 'number', null,
             'name', btrim(c."firstName" || ' ' || coalesce(c."lastName", '')),
             'company', a.name, 'accountId', c."accountId",
             'partnerId', coalesce(c."sourcePartnerId", a."sourcePartnerId"),
             'field', case
               when v_phone in (phone_key(c.phone), phone_key(c.mobile), phone_key(c.whatsapp)) then 'phone'
               when v_wa in (phone_key(c.phone), phone_key(c.mobile), phone_key(c.whatsapp)) then 'whatsapp'
               else 'mobile'
             end)
      into v_hit
    from contact c
    left join account a on a.id = c."accountId"
    where (phone_key(c.phone) = any(v_keys)
           or phone_key(c.mobile) = any(v_keys)
           or phone_key(c.whatsapp) = any(v_keys))
      and c."deletedAt" is null
      and c.id is distinct from p_not_contact
    order by c."createdAt"
    limit 1;

    if v_hit is not null then
      return v_hit;
    end if;
  end if;

  return null;
end $$;

revoke all on function person_match(text, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;

-- What the asker may be told about a match.
--
-- Staff are told who it is. So is a script or job with no user behind it. A
-- partner is told only when the record is their own; otherwise just which of
-- their own details matched - not the name, not the company, not whose it is.
-- Anybody else (a customer at the support portal) is told nothing more.
create or replace function person_match_visible(p_hit jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
begin
  if p_hit is null then
    return null;
  end if;
  if app_is_internal() or app_current_user_id() is null then
    return p_hit || jsonb_build_object('hidden', false);
  end if;
  if v_partner is not null
     and nullif(p_hit ->> 'partnerId', '') is not null
     and (p_hit ->> 'partnerId')::uuid = v_partner then
    return p_hit || jsonb_build_object('hidden', false, 'mine', true);
  end if;
  return jsonb_build_object('field', p_hit ->> 'field', 'hidden', true);
end $$;

revoke all on function person_match_visible(jsonb) from public, anon, authenticated;

-- The sentence the person is shown. p_creating is what they were making: 'lead'
-- or 'contact'.
create or replace function person_match_message(p_hit jsonb, p_creating text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_seen  jsonb := person_match_visible(p_hit);
  v_field text := person_field_label(p_hit ->> 'field');
  v_who   text;
begin
  if coalesce((v_seen ->> 'hidden')::boolean, true) then
    return format(
      'Someone with this %s is already in our records, so this %s cannot be added again. Your partner manager can tell you more.',
      v_field, p_creating);
  end if;

  v_who := coalesce(nullif(p_hit ->> 'name', ''), 'Someone')
    || case when nullif(p_hit ->> 'number', '') is not null then ' (' || (p_hit ->> 'number') || ')' else '' end
    || case when nullif(p_hit ->> 'company', '') is not null then ' at ' || (p_hit ->> 'company') else '' end;

  if p_hit ->> 'entity' = 'lead' then
    return format('This %s already exists: %s is a lead with the same %s.', p_creating, v_who, v_field);
  end if;
  if p_creating = 'lead' then
    return format('This person is already a contact: %s has the same %s.', v_who, v_field);
  end if;
  return format('This contact already exists: %s has the same %s.', v_who, v_field);
end $$;

revoke all on function person_match_message(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The rule
-- ---------------------------------------------------------------------------
--
-- On an edit, only what changed is checked. Two records that shared a number
-- before this rule existed can still be worked on; they cannot be made to share
-- another. A record brought back from deletion is checked in full, because it
-- is a claim on the person again.
--
-- The error is a unique violation (23505) carrying a sentence to show as it is,
-- the match as JSON in its detail - already cut down to what the asker may see -
-- and the hint 'duplicate_person', which is how the app recognises it.

create or replace function lead_refuse_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full boolean;
  v_hit  jsonb;
begin
  -- A lead being retired - deleted, or merged into another - claims nobody.
  if new."deletedAt" is not null or new."mergedIntoId" is not null then
    return new;
  end if;

  -- An insert that is about to collide with a lead's id or number is an
  -- upsert on it: the row becomes an update of that lead, and is checked as an
  -- edit by the UPDATE half of this trigger. Checked here it would match the
  -- lead's own contact, or itself under its old id.
  if tg_op = 'INSERT' and exists (
    select 1 from lead where id = new.id or "leadNumber" = new."leadNumber"
  ) then
    return new;
  end if;

  v_full := tg_op = 'INSERT' or old."deletedAt" is not null;

  v_hit := person_match(
    'lead',
    case when v_full or email_key(new.email) is distinct from email_key(old.email) then new.email end,
    case when v_full or phone_key(new.phone) is distinct from phone_key(old.phone) then new.phone end,
    case when v_full or phone_key(new.whatsapp) is distinct from phone_key(old.whatsapp) then new.whatsapp end,
    null,
    new.id, null);

  if v_hit is not null then
    raise exception using
      message = person_match_message(v_hit, 'lead'),
      errcode = '23505',
      detail  = person_match_visible(v_hit)::text,
      hint    = 'duplicate_person';
  end if;

  return new;
end $$;

drop trigger if exists lead_refuse_duplicate on lead;
create trigger lead_refuse_duplicate
  before insert or update of email, phone, whatsapp, "deletedAt"
  on lead
  for each row execute function lead_refuse_duplicate();

create or replace function contact_refuse_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full boolean;
  v_hit  jsonb;
begin
  if new."deletedAt" is not null then
    return new;
  end if;

  if tg_op = 'INSERT' and exists (select 1 from contact where id = new.id) then
    return new;
  end if;

  v_full := tg_op = 'INSERT' or old."deletedAt" is not null;

  v_hit := person_match(
    'contact',
    case when v_full or email_key(new.email) is distinct from email_key(old.email) then new.email end,
    case when v_full or phone_key(new.phone) is distinct from phone_key(old.phone) then new.phone end,
    case when v_full or phone_key(new.whatsapp) is distinct from phone_key(old.whatsapp) then new.whatsapp end,
    case when v_full or phone_key(new.mobile) is distinct from phone_key(old.mobile) then new.mobile end,
    null, new.id);

  if v_hit is not null then
    raise exception using
      message = person_match_message(v_hit, 'contact'),
      errcode = '23505',
      detail  = person_match_visible(v_hit)::text,
      hint    = 'duplicate_person';
  end if;

  return new;
end $$;

drop trigger if exists contact_refuse_duplicate on contact;
create trigger contact_refuse_duplicate
  before insert or update of email, phone, mobile, whatsapp, "deletedAt"
  on contact
  for each row execute function contact_refuse_duplicate();

revoke all on function lead_refuse_duplicate() from public, anon, authenticated;
revoke all on function contact_refuse_duplicate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Asking first
-- ---------------------------------------------------------------------------
--
-- For the paths that can do better than fail: an import skips the people it
-- already has, the convert screen offers the contact that already exists. One
-- call for a whole file - p_rows is a list of {email, phone, whatsapp, mobile},
-- optionally with the leadId or contactId being edited - and the answer lists
-- only the rows that matched, by position, each cut down to what the asker may
-- see.

create or replace function find_duplicate_people(p_scope text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_i   integer := 0;
  v_hit jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  -- Staff who work leads or customers, and partners. A customer at the support
  -- portal has no business asking who else we know.
  if app_current_user_id() is not null
     and app_current_partner_id() is null
     and not (app_is_internal()
              and (app_has_permission('lead:read') or app_has_permission('account:read'))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_scope not in ('lead', 'contact') then
    raise exception 'Say whether these are leads or contacts.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Expected a list of people.';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Check up to 5,000 people at a time.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_hit := person_match(
      p_scope,
      v_row ->> 'email', v_row ->> 'phone', v_row ->> 'whatsapp', v_row ->> 'mobile',
      nullif(v_row ->> 'leadId', '')::uuid, nullif(v_row ->> 'contactId', '')::uuid);
    if v_hit is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('row', v_i) || person_match_visible(v_hit));
    end if;
    v_i := v_i + 1;
  end loop;

  return v_out;
end $$;

revoke all on function find_duplicate_people(text, jsonb) from public, anon;
grant execute on function find_duplicate_people(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Duplicates screen's view, on the same keys
-- ---------------------------------------------------------------------------
--
-- What is left to merge is what existed before the rule. WhatsApp joins the
-- keys, matched across fields like everywhere else, and a lead with no address
-- or number now counts 0 others rather than -1.

create or replace view lead_duplicate_group
with (security_invoker = true)
as
with keys as (
  select
    l.id,
    email_key(l.email) as email_key,
    phone_key(l.phone) as phone_key,
    phone_key(l.whatsapp) as whatsapp_key
  from lead l
  where l."deletedAt" is null and l."mergedIntoId" is null
)
select
  k.id,
  k.email_key,
  k.phone_key,
  (
    select count(*) from keys o
    where o.id <> k.id
      and ((k.email_key is not null and o.email_key = k.email_key)
        or (k.phone_key is not null and k.phone_key in (o.phone_key, o.whatsapp_key))
        or (k.whatsapp_key is not null and k.whatsapp_key in (o.phone_key, o.whatsapp_key)))
  ) as duplicate_count,
  k.whatsapp_key
from keys k;

comment on view lead_duplicate_group is
  'How many other live leads share this one''s email address, phone number or WhatsApp number. Numbers are compared on their last nine digits, across both fields.';

-- ---------------------------------------------------------------------------
-- 6. Merging retires the duplicates before the survivor takes their details
-- ---------------------------------------------------------------------------
--
-- Unchanged but for order. The survivor used to take the chosen values while
-- the losers still held them, which the rule above would now refuse - the
-- loser is, after all, a live lead with that address. Retiring first means the
-- survivor takes over details that nobody else holds any more.

create or replace function merge_leads(
  p_survivor uuid,
  p_losers   uuid[],
  p_values   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := app_current_user_id();
  v_loser    uuid;
  v_moved    integer := 0;
  v_n        integer;
  v_merged   integer := 0;
  -- Only these may be chosen from a losing record. Deliberately excludes
  -- ownerUserId, status, leadNumber and everything about conversion: a merge
  -- reconciles what we know about a person, it does not reassign the work or
  -- rewrite where the record had got to.
  v_text_cols text[] := array[
    'firstName', 'lastName', 'companyName', 'jobTitle', 'email', 'phone',
    'whatsapp', 'website', 'industry', 'businessType', 'companySize',
    'street', 'city', 'state', 'postalCode', 'country', 'leadSource',
    'description'
  ];
  v_col text;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'Choose at least one duplicate to merge in.';
  end if;
  if p_survivor = any(p_losers) then
    raise exception 'A lead cannot be merged into itself.';
  end if;

  perform 1 from lead
  where id = p_survivor and "deletedAt" is null and "mergedIntoId" is null
  for update;
  if not found then
    raise exception 'The lead being kept no longer exists.';
  end if;

  -- A converted lead has an account, a contact and possibly a deal behind it.
  -- Merging one away would leave those pointing at a record that has been
  -- soft-deleted, so it is refused on both sides rather than half-handled.
  if exists (
    select 1 from lead
    where id = any(p_losers || p_survivor) and "convertedAt" is not null
  ) then
    raise exception
      'A converted lead cannot be merged - it already has an account and contact behind it. Merge the duplicates before converting.'
      using errcode = '22023';
  end if;

  -- 1. Retire the losers.
  update lead set
    "mergedIntoId" = p_survivor,
    "mergedAt"     = now(),
    "deletedAt"    = now(),
    "updatedAt"    = now()
  where id = any(p_losers) and "deletedAt" is null;
  get diagnostics v_merged = row_count;

  -- 2. Apply the chosen values to the survivor.
  foreach v_col in array v_text_cols loop
    if p_values ? v_col then
      execute format(
        'update lead set %I = $1, "updatedAt" = now() where id = $2',
        v_col
      ) using nullif(btrim(coalesce(p_values ->> v_col, '')), ''), p_survivor;
    end if;
  end loop;

  -- lastName is not nullable, and the screen can send an empty one.
  update lead set "lastName" = '-' where id = p_survivor and coalesce("lastName", '') = '';

  -- estimatedValue is the one number worth carrying: of two guesses at the same
  -- deal, the larger is the one somebody researched.
  update lead s set "estimatedValue" = greatest(
    coalesce(s."estimatedValue", 0),
    coalesce((select max(l."estimatedValue") from lead l where l.id = any(p_losers)), 0)
  ), "updatedAt" = now()
  where s.id = p_survivor
    and coalesce((select max(l."estimatedValue") from lead l where l.id = any(p_losers)), 0) > 0;

  -- A partner referral on any of them is a claim on commission, so it survives
  -- the merge - but only into an empty field, never over another partner.
  update lead s set "referredByPartnerId" = (
    select l."referredByPartnerId" from lead l
    where l.id = any(p_losers) and l."referredByPartnerId" is not null limit 1
  ), "updatedAt" = now()
  where s.id = p_survivor and s."referredByPartnerId" is null;

  -- Same for the campaign, so a merged lead does not become unattributable.
  update lead s set "campaignId" = (
    select l."campaignId" from lead l
    where l.id = any(p_losers) and l."campaignId" is not null limit 1
  ), "updatedAt" = now()
  where s.id = p_survivor and s."campaignId" is null;

  -- 3. Move everything attached to the losers.
  --
  -- These links are polymorphic - ("relatedEntityType", "relatedEntityId") -
  -- so there is no foreign key to cascade and each table is moved by hand.
  -- Missing one would orphan somebody's notes behind a soft-deleted record.
  foreach v_loser in array p_losers loop
    update activity set "relatedEntityId" = p_survivor, "updatedAt" = now()
    where "relatedEntityType" = 'Lead' and "relatedEntityId" = v_loser;
    get diagnostics v_n = row_count; v_moved := v_moved + v_n;

    update email set "relatedEntityId" = p_survivor, "updatedAt" = now()
    where "relatedEntityType" = 'Lead' and "relatedEntityId" = v_loser;
    get diagnostics v_n = row_count; v_moved := v_moved + v_n;

    update note set "relatedEntityId" = p_survivor, "updatedAt" = now()
    where "relatedEntityType" = 'Lead' and "relatedEntityId" = v_loser;
    get diagnostics v_n = row_count; v_moved := v_moved + v_n;

    update document set "relatedEntityId" = p_survivor, "updatedAt" = now()
    where "relatedEntityType" = 'Lead' and "relatedEntityId" = v_loser;
    get diagnostics v_n = row_count; v_moved := v_moved + v_n;

    -- The campaign members that produced the losing leads now point at the
    -- survivor. This is what keeps every campaign credited: the person came
    -- from a webinar AND a trade show, and after the merge both still say so.
    update campaign_member set "leadId" = p_survivor, "updatedAt" = now()
    where "leadId" = v_loser;
    get diagnostics v_n = row_count; v_moved := v_moved + v_n;

    -- The audit trail is deliberately NOT moved. It records what happened to
    -- that row, and rewriting it would make the history of the losing record
    -- unreadable at exactly the moment somebody wants to check the merge.
  end loop;

  -- 4. Say what happened, on both records.
  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  )
  select gen_random_uuid(), 'Lead', l.id, 'mergedIntoId',
         null, p_survivor::text, v_actor, 'manual', now()
  from lead l where l.id = any(p_losers)
  union all
  select gen_random_uuid(), 'Lead', p_survivor, 'mergedFrom',
         null, array_to_string(p_losers, ','), v_actor, 'manual', now();

  return jsonb_build_object(
    'survivorId', p_survivor,
    'mergedCount', v_merged,
    'recordsMoved', v_moved
  );
end $$;

-- ---------------------------------------------------------------------------
-- 7. A member who is already a lead is linked, not converted again
-- ---------------------------------------------------------------------------
--
-- Somebody who came to the webinar and then the trade show is two members, one
-- per campaign. Converting the second no longer makes a second lead: the member
-- is linked to the lead they already are, which is what credits the second
-- campaign. A member who is already a customer's contact is linked to that
-- contact the same way - marketing reached a customer, and the contact now
-- shows it.

create or replace function convert_member_to_lead(
  p_member_id uuid,
  p_owner_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m       campaign_member%rowtype;
  v_lead_id uuid := gen_random_uuid();
  v_number  text;
  v_owner   uuid;
  v_actor   uuid := app_current_user_id();
  v_hit     jsonb;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_m from campaign_member
  where id = p_member_id and "deletedAt" is null
  for update;

  if not found then
    raise exception 'That campaign member no longer exists.';
  end if;
  -- Idempotent rather than an error: a double-click should not make two leads,
  -- and the caller wants the record either way.
  if v_m."leadId" is not null then
    return jsonb_build_object('leadId', v_m."leadId", 'alreadyConverted', true);
  end if;
  if v_m."contactId" is not null and v_m."convertedAt" is not null then
    return jsonb_build_object('contactId', v_m."contactId", 'alreadyConverted', true);
  end if;

  v_hit := person_match('lead', v_m.email, v_m.phone, v_m.whatsapp, null);

  if v_hit is not null then
    if v_hit ->> 'entity' = 'lead' then
      update campaign_member set
        "leadId"      = (v_hit ->> 'id')::uuid,
        "convertedAt" = now(),
        "updatedAt"   = now()
      where id = p_member_id;
    else
      update campaign_member set
        "contactId"   = (v_hit ->> 'id')::uuid,
        "convertedAt" = now(),
        "updatedAt"   = now()
      where id = p_member_id;
    end if;

    insert into audit_history (
      id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
      "changedById", source, "changedAt"
    ) values (
      gen_random_uuid(), 'CampaignMember', p_member_id,
      case when v_hit ->> 'entity' = 'lead' then 'leadId' else 'contactId' end,
      null, v_hit ->> 'id', v_actor, 'manual', now()
    );

    return jsonb_build_object(
      'linked', true,
      'alreadyConverted', false,
      'leadId', case when v_hit ->> 'entity' = 'lead' then v_hit ->> 'id' end,
      'leadNumber', v_hit ->> 'number',
      'contactId', case when v_hit ->> 'entity' = 'contact' then v_hit ->> 'id' end,
      'name', v_hit ->> 'name',
      'company', v_hit ->> 'company',
      'matchedOn', v_hit ->> 'field'
    );
  end if;

  v_owner := coalesce(p_owner_id, v_m."ownerUserId", v_actor);
  v_number := next_sequence_number('Lead');

  insert into lead (
    id, "leadNumber", "firstName", "lastName", "companyName", "jobTitle",
    email, phone, whatsapp, website, "businessType", "companySize",
    street, city, state, "postalCode", country,
    "leadSource", "campaignId", "campaignMemberId", "ownerUserId",
    status, description, "createdAt", "updatedAt"
  ) values (
    v_lead_id, v_number,
    v_m."firstName",
    -- lead."lastName" is not null, and a member's may be. A single-name record
    -- is common on an event list, so it is filled rather than refused.
    coalesce(nullif(btrim(coalesce(v_m."lastName", '')), ''), '-'),
    v_m."companyName", v_m."jobTitle",
    v_m.email, v_m.phone, v_m.whatsapp, v_m.website,
    v_m."businessType", v_m."companySize",
    v_m.street, v_m.city, v_m.state, v_m."postalCode", v_m.country,
    v_m.source, v_m."campaignId", v_m.id, v_owner,
    'NEW', v_m.notes, now(), now()
  );

  update campaign_member set
    "leadId"      = v_lead_id,
    "convertedAt" = now(),
    "updatedAt"   = now()
  where id = p_member_id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'CampaignMember', p_member_id, 'leadId',
    null, v_lead_id::text, v_actor, 'manual', now()
  );

  return jsonb_build_object(
    'leadId', v_lead_id, 'leadNumber', v_number, 'alreadyConverted', false, 'linked', false
  );
end $$;

-- ---------------------------------------------------------------------------
-- 8. Converting a lead uses the contact the person already is
-- ---------------------------------------------------------------------------
--
-- A lead can meet an existing contact at conversion even though the rule
-- stopped it being created as one: the contact may have been added by hand
-- while the lead was being worked, or the lead may predate the rule. Refusing
-- would leave the lead unconvertible, so the conversion uses that contact, on
-- that contact's account. Asking for a different account is refused, since the
-- deal would then name a contact from another company.
--
-- Otherwise unchanged from 20260928000000. SECURITY INVOKER as before; the
-- lookup goes through find_duplicate_people, which sees every contact.

create or replace function convert_lead(
  p_lead_id            uuid,
  p_actor_id           uuid,
  p_account_id         uuid,
  p_create_opportunity boolean,
  p_opportunity_name   text,
  p_amount             numeric,
  p_expected_close     date,
  p_registered_at      timestamp without time zone,
  p_expires_at         timestamp without time zone,
  p_protection_days    integer
)
returns jsonb
language plpgsql
as $$
declare
  v_lead         lead%rowtype;
  v_account_id   uuid := p_account_id;
  v_contact_id   uuid := gen_random_uuid();
  v_reused       boolean := false;
  v_match        jsonb;
  v_opp_id       uuid;
  v_deal_partner uuid;
  v_old_status   text;
begin
  select * into v_lead from lead where id = p_lead_id for update;

  if not found then
    raise exception 'Lead not found.';
  end if;
  if v_lead."convertedAt" is not null then
    raise exception 'That lead has already been converted.';
  end if;

  v_old_status := v_lead.status::text;

  v_match := find_duplicate_people('contact', jsonb_build_array(jsonb_build_object(
    'email', v_lead.email, 'phone', v_lead.phone, 'whatsapp', v_lead.whatsapp))) -> 0;

  if v_match is not null then
    if coalesce((v_match ->> 'hidden')::boolean, false) then
      raise exception using
        message = format(
          'Someone with this lead''s %s is already in our records, so it cannot be converted into a new contact. Your partner manager can tell you more.',
          person_field_label(v_match ->> 'field')),
        errcode = '23505';
    end if;
    if nullif(v_match ->> 'accountId', '') is null then
      raise exception using
        message = format(
          '%s is already a contact with the same %s, and is not on any account, so this lead cannot be converted into a second one.',
          v_match ->> 'name', person_field_label(v_match ->> 'field')),
        errcode = '23505';
    end if;
    if v_account_id is not null and v_account_id <> (v_match ->> 'accountId')::uuid then
      raise exception using
        message = format(
          '%s is already a contact at %s, with the same %s. Convert this lead into that account instead.',
          v_match ->> 'name', coalesce(v_match ->> 'company', 'another account'),
          person_field_label(v_match ->> 'field')),
        errcode = '23505';
    end if;
    v_account_id := (v_match ->> 'accountId')::uuid;
    v_contact_id := (v_match ->> 'id')::uuid;
    v_reused := true;
  end if;

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

  if not v_reused then
    insert into contact (
      id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
      whatsapp, "isPrimary", "communicationConsent", "createdAt", "updatedAt"
    ) values (
      v_contact_id, v_account_id, v_lead."firstName", v_lead."lastName",
      v_lead."jobTitle", v_lead.email, v_lead.phone, v_lead.whatsapp,
      true, true, now(), now()
    );
  end if;

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
    'opportunityId', v_opp_id,
    'reusedContact', v_reused
  );
end $$;

-- ---------------------------------------------------------------------------
-- 9. The partner's conflict check says that, not who
-- ---------------------------------------------------------------------------
--
-- It used to answer a clash with the other company's name, city and status and
-- the name of the partner holding it. A partner sees their own records and
-- nobody else's, so it now says only that the customer is known, and what
-- matched - unless the customer is the partner's own, which they may see.
--
-- The person is looked for first, by email and then by any of their numbers,
-- because the duplicate rule refuses those outright; then the company name,
-- which only flags, since two firms can share a name.

create or replace function partner_find_conflict(
  p_account_name text,
  p_email        text default null,
  p_phone        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_email   text := email_key(p_email);
  v_key     text := phone_key(p_phone);
  v_hit     record;
  v_on      text;
begin
  if v_partner is null then
    raise exception 'Only a partner may check for a conflict.';
  end if;

  if v_email is not null then
    select a.name, a."billingAddress" ->> 'city' as city, a."accountType",
           a."customerStatus", a."createdAt",
           coalesce(c."sourcePartnerId", a."sourcePartnerId") as partner_id
      into v_hit
    from contact c
    left join account a on a.id = c."accountId"
    where email_key(c.email) = v_email
      and c."deletedAt" is null
    order by c."createdAt"
    limit 1;
    if found then
      v_on := 'email';
    end if;
  end if;

  if v_on is null and v_key is not null then
    select a.name, a."billingAddress" ->> 'city' as city, a."accountType",
           a."customerStatus", a."createdAt",
           coalesce(c."sourcePartnerId", a."sourcePartnerId") as partner_id
      into v_hit
    from contact c
    left join account a on a.id = c."accountId"
    where (phone_key(c.phone) = v_key or phone_key(c.mobile) = v_key or phone_key(c.whatsapp) = v_key)
      and c."deletedAt" is null
    order by c."createdAt"
    limit 1;
    if found then
      v_on := 'phone';
    end if;
  end if;

  if v_on is null and nullif(btrim(coalesce(p_account_name, '')), '') is not null then
    select a.name, a."billingAddress" ->> 'city' as city, a."accountType",
           a."customerStatus", a."createdAt", a."sourcePartnerId" as partner_id
      into v_hit
    from account a
    where a."deletedAt" is null
      and lower(btrim(a.name)) = lower(btrim(p_account_name))
    order by a."createdAt"
    limit 1;
    if found then
      v_on := 'name';
    end if;
  end if;

  if v_on is null then
    return jsonb_build_object('conflict', false);
  end if;

  if v_hit.partner_id is not null and v_hit.partner_id = v_partner then
    return jsonb_build_object(
      'conflict', true, 'mine', true, 'matchedOn', v_on,
      'accountName', v_hit.name,
      'city', v_hit.city,
      'accountType', v_hit."accountType",
      'customerStatus', v_hit."customerStatus",
      'registeredOn', to_char(v_hit."createdAt", 'YYYY-MM-DD')
    );
  end if;

  return jsonb_build_object('conflict', true, 'mine', false, 'matchedOn', v_on);
end $$;
