-- Website forms, and campaign members becoming prospects.
--
-- A web form belongs to a campaign. Its page in the CRM gives the code to
-- paste into the website: an ordinary HTML form plus a small script that
-- remembers where the visitor first came from (their UTM tags, landing page and
-- referrer) and sends it with the form. Submissions arrive at
-- /api/forms/<key>, which hands them to web_form_submit() below.
--
-- Somebody already on file is not made twice: a submission from a known lead
-- or contact is logged as a touch on them and moves their latest fields. A new
-- person becomes a Prospect owned by the form's owner, carrying the first and
-- latest touch.
--
-- Spam: the form carries a hidden field people never fill in, and each
-- visitor (identified by a hash of their address, never the address itself)
-- is limited to five submissions a form in ten minutes. Every submission,
-- refused or not, is kept for the form's page.
--
-- Converting a campaign member now makes a Prospect rather than a New lead,
-- so marketing's list stays out of sales' queue until someone qualifies it.

create table if not exists web_form (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  "campaignId" uuid not null references campaign(id) on delete cascade,
  -- Who owns the prospects it makes. The campaign's owner when not set.
  "ownerUserId" uuid references app_user(id) on delete set null,
  -- In the form's address; hard to guess, so a form cannot be found by trying.
  "formKey" varchar(40) not null unique,
  -- [{ "key": "email", "required": true }, ...]
  fields jsonb not null default '[{"key":"firstName","required":true},{"key":"lastName","required":false},{"key":"email","required":true},{"key":"phone","required":false},{"key":"companyName","required":false},{"key":"message","required":false}]'::jsonb,
  -- Websites allowed to post it, e.g. https://babultech.com. Empty is any.
  "allowedOrigins" text[] not null default '{}',
  "thankYouUrl" varchar(500),
  "thankYouMessage" varchar(500) not null default 'Thank you. We will be in touch soon.',
  active boolean not null default true,
  "submissionCount" integer not null default 0,
  "createdById" uuid references app_user(id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

create index if not exists web_form_campaign_idx on web_form ("campaignId");

create table if not exists web_form_submission (
  id uuid primary key default gen_random_uuid(),
  "formId" uuid not null references web_form(id) on delete cascade,
  outcome varchar(20) not null check (outcome in ('CREATED', 'MATCHED_LEAD', 'MATCHED_CONTACT', 'SPAM', 'RATE_LIMITED', 'INVALID')),
  "ipHash" varchar(64),
  "leadId" uuid references lead(id) on delete set null,
  "contactId" uuid references contact(id) on delete set null,
  summary varchar(300),
  "createdAt" timestamp(3) not null default now()
);

create index if not exists web_form_submission_form_idx on web_form_submission ("formId", "createdAt" desc);
create index if not exists web_form_submission_rate_idx on web_form_submission ("formId", "ipHash", "createdAt");

alter table web_form enable row level security;
alter table web_form_submission enable row level security;

drop policy if exists web_form_read on web_form;
create policy web_form_read on web_form for select to authenticated
  using (app_is_internal() and app_has_permission('lead:read'));
drop policy if exists web_form_write on web_form;
create policy web_form_write on web_form for all to authenticated
  using (app_is_internal() and app_has_permission('lead:write'))
  with check (app_is_internal() and app_has_permission('lead:write'));

drop policy if exists web_form_submission_read on web_form_submission;
create policy web_form_submission_read on web_form_submission for select to authenticated
  using (app_is_internal() and app_has_permission('lead:read'));

drop trigger if exists view_as_read_only on web_form;
create trigger view_as_read_only before insert or update or delete on web_form
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists view_as_read_only on web_form_submission;
create trigger view_as_read_only before insert or update or delete on web_form_submission
  for each statement execute function app_refuse_view_as_writes();

create or replace function web_form_submit(p_form_key text, p_data jsonb, p_touch jsonb, p_ip_hash text, p_spam boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form web_form%rowtype;
  v_campaign campaign%rowtype;
  v_hit jsonb;
  v_lead uuid;
  v_outcome text;
  v_first text := left(nullif(btrim(coalesce(p_data ->> 'firstName', '')), ''), 100);
  v_last text := left(nullif(btrim(coalesce(p_data ->> 'lastName', '')), ''), 100);
  v_email text := left(nullif(lower(btrim(coalesce(p_data ->> 'email', ''))), ''), 255);
  v_phone text := left(nullif(btrim(coalesce(p_data ->> 'phone', '')), ''), 50);
  v_first_touch jsonb := coalesce(p_touch -> 'first', '{}'::jsonb);
  v_now jsonb := coalesce(p_touch -> 'latest', '{}'::jsonb);
  v_field jsonb;
  v_summary text;
  v_touch jsonb;
begin
  select * into v_form from web_form where "formKey" = p_form_key;
  if not found or not v_form.active then
    return jsonb_build_object('outcome', 'NOT_FOUND');
  end if;
  select * into v_campaign from campaign where id = v_form."campaignId";

  v_summary := left(btrim(concat_ws(' ', v_first, v_last, '<' || v_email || '>', v_phone)), 300);

  if p_spam then
    insert into web_form_submission ("formId", outcome, "ipHash", summary) values (v_form.id, 'SPAM', p_ip_hash, v_summary);
    return jsonb_build_object('outcome', 'SPAM');
  end if;

  if p_ip_hash is not null and (
    select count(*) from web_form_submission
     where "formId" = v_form.id and "ipHash" = p_ip_hash and "createdAt" > now() - interval '10 minutes'
  ) >= 5 then
    insert into web_form_submission ("formId", outcome, "ipHash", summary) values (v_form.id, 'RATE_LIMITED', p_ip_hash, v_summary);
    return jsonb_build_object('outcome', 'RATE_LIMITED');
  end if;

  -- The form's own required fields, and something to reach them by.
  for v_field in select * from jsonb_array_elements(v_form.fields) loop
    if coalesce((v_field ->> 'required')::boolean, false)
       and nullif(btrim(coalesce(p_data ->> (v_field ->> 'key'), '')), '') is null then
      insert into web_form_submission ("formId", outcome, "ipHash", summary) values (v_form.id, 'INVALID', p_ip_hash, v_summary);
      return jsonb_build_object('outcome', 'INVALID', 'field', v_field ->> 'key');
    end if;
  end loop;
  if v_email is null and v_phone is null then
    insert into web_form_submission ("formId", outcome, "ipHash", summary) values (v_form.id, 'INVALID', p_ip_hash, v_summary);
    return jsonb_build_object('outcome', 'INVALID', 'field', 'email');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into web_form_submission ("formId", outcome, "ipHash", summary) values (v_form.id, 'INVALID', p_ip_hash, v_summary);
    return jsonb_build_object('outcome', 'INVALID', 'field', 'email');
  end if;

  v_touch := jsonb_build_object(
    'campaignId', v_form."campaignId", 'interactionType', 'FORM_SUBMIT',
    'source', coalesce(v_now ->> 'utmSource', 'Website'), 'medium', coalesce(v_now ->> 'utmMedium', 'web form'),
    'utmSource', v_now ->> 'utmSource', 'utmMedium', v_now ->> 'utmMedium', 'utmCampaign', v_now ->> 'utmCampaign',
    'utmContent', v_now ->> 'utmContent', 'utmTerm', v_now ->> 'utmTerm',
    'landingPage', v_now ->> 'landingPage', 'referrer', v_now ->> 'referrer',
    'details', left(concat('Form: ', v_form.name, coalesce(E'\n' || nullif(btrim(coalesce(p_data ->> 'message', '')), ''), '')), 4000)
  );

  v_hit := person_match('lead', v_email, v_phone, null, null);

  if v_hit is not null and v_hit ->> 'entity' = 'lead' then
    v_lead := (v_hit ->> 'id')::uuid;
    perform record_campaign_interaction(v_touch || jsonb_build_object('leadId', v_lead));
    v_outcome := 'MATCHED_LEAD';
    insert into web_form_submission ("formId", outcome, "ipHash", "leadId", summary) values (v_form.id, v_outcome, p_ip_hash, v_lead, v_summary);
  elsif v_hit is not null then
    perform record_campaign_interaction(v_touch || jsonb_build_object('contactId', (v_hit ->> 'id')::uuid));
    v_outcome := 'MATCHED_CONTACT';
    insert into web_form_submission ("formId", outcome, "ipHash", "contactId", summary) values (v_form.id, v_outcome, p_ip_hash, (v_hit ->> 'id')::uuid, v_summary);
  else
    v_lead := gen_random_uuid();
    insert into lead (
      id, "leadNumber", "firstName", "lastName", "companyName", "jobTitle", email, phone, website, city, country,
      "leadSource", "campaignId", "ownerUserId", status, description,
      "firstSource", "firstMedium", "firstCampaignId", "firstLandingPage", "firstReferrer", "firstTouchAt",
      "latestSource", "latestMedium", "latestCampaignId", "latestLandingPage", "latestReferrer", "latestTouchAt",
      "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
      "createdAt", "updatedAt"
    ) values (
      v_lead, next_sequence_number('Lead'),
      coalesce(v_first, split_part(coalesce(v_email, 'Website visitor'), '@', 1)),
      coalesce(v_last, '-'),
      left(nullif(btrim(coalesce(p_data ->> 'companyName', '')), ''), 200),
      left(nullif(btrim(coalesce(p_data ->> 'jobTitle', '')), ''), 150),
      v_email, v_phone,
      left(nullif(btrim(coalesce(p_data ->> 'website', '')), ''), 255),
      left(nullif(btrim(coalesce(p_data ->> 'city', '')), ''), 100),
      left(nullif(btrim(coalesce(p_data ->> 'country', '')), ''), 100),
      'Website', v_form."campaignId", coalesce(v_form."ownerUserId", v_campaign."ownerUserId"), 'PROSPECT',
      left(nullif(btrim(coalesce(p_data ->> 'message', '')), ''), 4000),
      coalesce(left(v_first_touch ->> 'utmSource', 100), left(v_now ->> 'utmSource', 100), 'Website'),
      coalesce(left(v_first_touch ->> 'utmMedium', 100), left(v_now ->> 'utmMedium', 100), 'web form'),
      v_form."campaignId",
      left(coalesce(v_first_touch ->> 'landingPage', v_now ->> 'landingPage'), 500),
      left(coalesce(v_first_touch ->> 'referrer', v_now ->> 'referrer'), 500),
      coalesce((v_first_touch ->> 'at')::timestamptz, now()),
      coalesce(left(v_now ->> 'utmSource', 100), 'Website'), coalesce(left(v_now ->> 'utmMedium', 100), 'web form'),
      v_form."campaignId", left(v_now ->> 'landingPage', 500), left(v_now ->> 'referrer', 500), now(),
      left(v_now ->> 'utmSource', 200), left(v_now ->> 'utmMedium', 200), left(v_now ->> 'utmCampaign', 200),
      left(v_now ->> 'utmContent', 200), left(v_now ->> 'utmTerm', 200),
      now(), now()
    );
    perform record_campaign_interaction(v_touch || jsonb_build_object('leadId', v_lead));
    v_outcome := 'CREATED';
    insert into web_form_submission ("formId", outcome, "ipHash", "leadId", summary) values (v_form.id, v_outcome, p_ip_hash, v_lead, v_summary);
  end if;

  update web_form set "submissionCount" = "submissionCount" + 1 where id = v_form.id;
  return jsonb_build_object('outcome', v_outcome);
end $$;

revoke all on function web_form_submit(text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function web_form_submit(text, jsonb, jsonb, text, boolean) to service_role;

-- Converting a campaign member makes a Prospect. Otherwise unchanged from
-- 20260928000001.
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
    'PROSPECT', v_m.notes, now(), now()
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

notify pgrst, 'reload schema';
