-- A campaign member becomes a person, not a link.
--
-- campaign_member was a join row: a campaign, a lead or contact, and a status.
-- It held nothing about the prospect, so marketing to somebody who was not
-- already a lead meant creating a lead for them first - which put people into
-- the sales pipeline who had merely been sent an email.
--
-- It now holds the prospect's own details, and exists ONCE per person rather
-- than once per campaign. Correcting a phone number is then one edit rather
-- than a hunt through every campaign they were ever in. Which campaigns they
-- took part in comes from the activity junction (the next migration), not from
-- a column here.
--
-- The table is rewritten rather than migrated: it is empty, and carrying a
-- campaignId forward would leave the old model half-present.

drop table if exists campaign_member cascade;

create table campaign_member (
  id uuid primary key,

  -- Who they are ------------------------------------------------------------
  "firstName"   varchar(100) not null,
  "lastName"    varchar(100),
  email         varchar(255),
  phone         varchar(50),
  whatsapp      varchar(50),

  -- Where they work ---------------------------------------------------------
  "companyName" varchar(200),
  website       varchar(255),
  -- Free text against open picklists rather than enums: marketing lists grow
  -- new categories constantly, and an enum means a migration each time.
  "businessType" varchar(100),
  "companySize"  varchar(30),

  -- Where they are ----------------------------------------------------------
  street      varchar(255),
  city        varchar(100),
  state       varchar(100),
  "postalCode" varchar(30),
  country     varchar(100),

  -- What has happened to them -----------------------------------------------
  --
  -- The last time this person was actually contacted by a campaign, written by
  -- the activity that did it. Shown when building the next audience so nobody
  -- gets mailed three weeks running by accident.
  "lastCampaignRunAt" timestamp(3),
  "lastCampaignId"    uuid references campaign (id) on delete set null,
  -- How many activities they have been included in, for the same reason.
  "campaignCount" integer not null default 0,

  -- Marketing consent. An unsubscribe is permanent and applies to every
  -- campaign, so it lives on the person rather than on one send.
  "emailOptOut"      boolean not null default false,
  "emailOptOutAt"    timestamp(3),
  "emailOptOutReason" varchar(255),
  -- Set when mail to this address hard-bounces. Kept separate from an opt-out:
  -- one is their decision, the other is a dead mailbox.
  "emailBounced"     boolean not null default false,

  -- Where they came from, and where they went -------------------------------
  source varchar(100),
  "ownerUserId" uuid references app_user (id) on delete set null,
  -- Set when a member becomes a real prospect, so the campaign that produced
  -- them can still be credited.
  "leadId"        uuid references lead (id) on delete set null,
  "contactId"     uuid references contact (id) on delete set null,
  "opportunityId" uuid references opportunity (id) on delete set null,
  "attributedRevenue" decimal(18,2),

  notes text,
  active boolean not null default true,

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "deletedAt" timestamp(3)
);

-- Email is the dedupe key: importing the same list twice must not create a
-- second copy of everybody. Partial, so several members may have no email at
-- all, and a deleted one does not block re-adding the address.
create unique index "campaign_member_email_key"
  on campaign_member (lower(email))
  where email is not null and "deletedAt" is null;

create index "campaign_member_company_idx" on campaign_member (lower("companyName"));
create index "campaign_member_lastRun_idx" on campaign_member ("lastCampaignRunAt" desc nulls last);
create index "campaign_member_owner_idx" on campaign_member ("ownerUserId");
create index "campaign_member_optout_idx" on campaign_member ("emailOptOut") where "emailOptOut";

-- ---------------------------------------------------------------------------
-- Who may see and change them
-- ---------------------------------------------------------------------------
--
-- Gated on lead:read and lead:write. A campaign member is a prospect who has
-- not become a lead yet, so the people who work leads are the people who should
-- see them; giving it a permission of its own would mean every role needing a
-- second grant to do one job.
alter table campaign_member enable row level security;
alter table campaign_member force row level security;

drop policy if exists campaign_member_read on campaign_member;
create policy campaign_member_read on campaign_member
  for select using (
    app_is_internal()
    and app_current_scope() is not null
    and app_has_permission('lead:read')
  );

drop policy if exists campaign_member_write on campaign_member;
create policy campaign_member_write on campaign_member
  for all using (app_can_write() and app_has_permission('lead:write'))
  with check (app_can_write() and app_has_permission('lead:write'));

grant select, insert, update, delete on campaign_member to authenticated;
grant all on campaign_member to service_role;

-- ---------------------------------------------------------------------------
-- The two new lists
-- ---------------------------------------------------------------------------

insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values
  ('business_type', 'Business type', 'Marketing', null, false,
   'What a campaign member''s company does.', 210),
  ('company_size',  'Company size',  'Marketing', null, false,
   'Rough size of a campaign member''s company.', 220)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values
  ('company_size', 'SMALL',  'Small',  10),
  ('company_size', 'MEDIUM', 'Medium', 20),
  ('company_size', 'LARGE',  'Large',  30),
  -- A starting set, not a ceiling: these are open lists and an administrator
  -- adds to them in Settings, or inline with the + on the field itself.
  ('business_type', 'MANUFACTURING', 'Manufacturing', 10),
  ('business_type', 'RETAIL',        'Retail',        20),
  ('business_type', 'WHOLESALE',     'Wholesale',     30),
  ('business_type', 'SERVICES',      'Services',      40),
  ('business_type', 'TECHNOLOGY',    'Technology',    50),
  ('business_type', 'HEALTHCARE',    'Healthcare',    60),
  ('business_type', 'EDUCATION',     'Education',     70),
  ('business_type', 'GOVERNMENT',    'Government',    80),
  ('business_type', 'NON_PROFIT',    'Non-profit',    90)
on conflict ("picklistKey", value) do nothing;

-- ---------------------------------------------------------------------------
-- Importing a list
-- ---------------------------------------------------------------------------
--
-- A bought or exported list arrives with the same people on it as last time, so
-- the import upserts on email: a row with a known address updates what it can
-- and leaves the rest, and one without an address is always new. It returns
-- what it did so the screen can say "40 added, 12 updated" rather than claiming
-- fifty-two new prospects.
create or replace function import_campaign_members(p_rows jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      jsonb;
  v_email    text;
  v_existing uuid;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    -- A person needs a name at minimum; a row without one is a blank line.
    if coalesce(btrim(v_row ->> 'firstName'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');

    v_existing := null;
    if v_email is not null then
      select id into v_existing
      from campaign_member
      where lower(email) = v_email and "deletedAt" is null
      limit 1;
    end if;

    if v_existing is not null then
      -- coalesce keeps what is already on file where the import is blank: a
      -- thin list must not wipe details somebody entered by hand.
      update campaign_member set
        "firstName"    = coalesce(nullif(btrim(v_row ->> 'firstName'), ''), "firstName"),
        "lastName"     = coalesce(nullif(btrim(coalesce(v_row ->> 'lastName', '')), ''), "lastName"),
        phone          = coalesce(nullif(btrim(coalesce(v_row ->> 'phone', '')), ''), phone),
        whatsapp       = coalesce(nullif(btrim(coalesce(v_row ->> 'whatsapp', '')), ''), whatsapp),
        "companyName"  = coalesce(nullif(btrim(coalesce(v_row ->> 'companyName', '')), ''), "companyName"),
        website        = coalesce(nullif(btrim(coalesce(v_row ->> 'website', '')), ''), website),
        "businessType" = coalesce(nullif(btrim(coalesce(v_row ->> 'businessType', '')), ''), "businessType"),
        "companySize"  = coalesce(nullif(btrim(coalesce(v_row ->> 'companySize', '')), ''), "companySize"),
        street         = coalesce(nullif(btrim(coalesce(v_row ->> 'street', '')), ''), street),
        city           = coalesce(nullif(btrim(coalesce(v_row ->> 'city', '')), ''), city),
        state          = coalesce(nullif(btrim(coalesce(v_row ->> 'state', '')), ''), state),
        "postalCode"   = coalesce(nullif(btrim(coalesce(v_row ->> 'postalCode', '')), ''), "postalCode"),
        country        = coalesce(nullif(btrim(coalesce(v_row ->> 'country', '')), ''), country),
        "updatedAt"    = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into campaign_member (
        id, "firstName", "lastName", email, phone, whatsapp,
        "companyName", website, "businessType", "companySize",
        street, city, state, "postalCode", country,
        source, "ownerUserId", notes, "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(),
        btrim(v_row ->> 'firstName'),
        nullif(btrim(coalesce(v_row ->> 'lastName', '')), ''),
        v_email,
        nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'whatsapp', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'companyName', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'website', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'businessType', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'companySize', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'street', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'city', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'state', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'postalCode', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'country', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'source', '')), ''),
        p_owner,
        nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
        now(), now()
      );
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end $$;

revoke all on function import_campaign_members(jsonb, uuid) from public, anon;
grant execute on function import_campaign_members(jsonb, uuid) to authenticated;
