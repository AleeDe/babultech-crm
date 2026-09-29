-- Where people came from, what they did, and which campaigns earned the deal.
--
-- 1. Source tracking. A lead records its first touch - the source, medium,
--    campaign, landing page and referrer that first brought them - and its
--    latest, plus the five UTM tags of the latest visit. The first touch is
--    written once and never changed; the latest moves with every new touch.
--    Contacts carry the same first and latest, copied at conversion.
--
-- 2. Campaign touches. One log of everything a person did with a campaign: a
--    form submitted, an email opened or clicked, an event or webinar attended,
--    a call, a referral. Written automatically by forms and email tracking,
--    and by hand from a lead or campaign page. Each touch moves the lead's
--    latest fields.
--
-- 3. Deal attribution. When a lead becomes a deal, the deal records its first,
--    lead-creation and latest campaigns. The primary campaign is the deal's own
--    campaign field, as before, and can be changed on the deal. Revenue can
--    then be reported by any of the four.
--
-- 4. Referrals. A lead can name the contact who referred them, beside the
--    referring partner that was already there.

alter table lead
  add column if not exists "firstSource" varchar(100),
  add column if not exists "firstMedium" varchar(100),
  add column if not exists "firstCampaignId" uuid references campaign(id) on delete set null,
  add column if not exists "firstLandingPage" varchar(500),
  add column if not exists "firstReferrer" varchar(500),
  add column if not exists "firstTouchAt" timestamp(3),
  add column if not exists "latestSource" varchar(100),
  add column if not exists "latestMedium" varchar(100),
  add column if not exists "latestCampaignId" uuid references campaign(id) on delete set null,
  add column if not exists "latestLandingPage" varchar(500),
  add column if not exists "latestReferrer" varchar(500),
  add column if not exists "latestTouchAt" timestamp(3),
  add column if not exists "utmSource" varchar(200),
  add column if not exists "utmMedium" varchar(200),
  add column if not exists "utmCampaign" varchar(200),
  add column if not exists "utmContent" varchar(200),
  add column if not exists "utmTerm" varchar(200),
  add column if not exists "referredByContactId" uuid references contact(id) on delete set null;

alter table contact
  add column if not exists "firstSource" varchar(100),
  add column if not exists "firstMedium" varchar(100),
  add column if not exists "firstCampaignId" uuid references campaign(id) on delete set null,
  add column if not exists "firstTouchAt" timestamp(3),
  add column if not exists "latestSource" varchar(100),
  add column if not exists "latestMedium" varchar(100),
  add column if not exists "latestCampaignId" uuid references campaign(id) on delete set null,
  add column if not exists "latestTouchAt" timestamp(3);

create index if not exists lead_first_campaign_idx on lead ("firstCampaignId") where "firstCampaignId" is not null;
create index if not exists lead_latest_campaign_idx on lead ("latestCampaignId") where "latestCampaignId" is not null;
create index if not exists lead_referred_by_contact_idx on lead ("referredByContactId") where "referredByContactId" is not null;

-- Leads made before today: their first and latest touch is what they were
-- made from.
update lead set
  "firstSource" = coalesce("firstSource", "leadSource"),
  "firstCampaignId" = coalesce("firstCampaignId", "campaignId"),
  "firstTouchAt" = coalesce("firstTouchAt", "createdAt"),
  "latestSource" = coalesce("latestSource", "leadSource"),
  "latestCampaignId" = coalesce("latestCampaignId", "campaignId"),
  "latestTouchAt" = coalesce("latestTouchAt", "createdAt")
where "firstTouchAt" is null;

-- A new lead starts with its first touch filled from what it was made with,
-- unless whatever made it said more (a form, with its UTM tags).
create or replace function lead_first_touch()
returns trigger
language plpgsql
as $$
begin
  new."firstSource" := coalesce(new."firstSource", new."utmSource", new."leadSource");
  new."firstMedium" := coalesce(new."firstMedium", new."utmMedium");
  new."firstCampaignId" := coalesce(new."firstCampaignId", new."campaignId");
  new."firstTouchAt" := coalesce(new."firstTouchAt", now());
  new."latestSource" := coalesce(new."latestSource", new."firstSource");
  new."latestMedium" := coalesce(new."latestMedium", new."firstMedium");
  new."latestCampaignId" := coalesce(new."latestCampaignId", new."firstCampaignId");
  new."latestLandingPage" := coalesce(new."latestLandingPage", new."firstLandingPage");
  new."latestReferrer" := coalesce(new."latestReferrer", new."firstReferrer");
  new."latestTouchAt" := coalesce(new."latestTouchAt", new."firstTouchAt");
  return new;
end $$;

drop trigger if exists lead_first_touch on lead;
create trigger lead_first_touch before insert on lead
  for each row execute function lead_first_touch();

-- The first touch is history: once written it does not change.
create or replace function lead_first_touch_fixed()
returns trigger
language plpgsql
as $$
begin
  if old."firstTouchAt" is not null then
    new."firstSource" := old."firstSource";
    new."firstMedium" := old."firstMedium";
    new."firstCampaignId" := old."firstCampaignId";
    new."firstLandingPage" := old."firstLandingPage";
    new."firstReferrer" := old."firstReferrer";
    new."firstTouchAt" := old."firstTouchAt";
  end if;
  return new;
end $$;

drop trigger if exists lead_first_touch_fixed on lead;
create trigger lead_first_touch_fixed before update on lead
  for each row execute function lead_first_touch_fixed();

-- ---------------------------------------------------------------------------
-- Campaign touches
-- ---------------------------------------------------------------------------

create table if not exists campaign_interaction (
  id uuid primary key default gen_random_uuid(),
  "campaignId" uuid references campaign(id) on delete set null,
  "interactionType" varchar(30) not null check ("interactionType" in (
    'FORM_SUBMIT', 'EMAIL_OPEN', 'EMAIL_CLICK', 'EVENT_ATTENDED', 'WEBINAR_ATTENDED',
    'CALL', 'MEETING', 'REFERRAL', 'WEBSITE_VISIT', 'SOCIAL', 'DOWNLOAD', 'OTHER'
  )),
  "leadId" uuid references lead(id) on delete cascade,
  "contactId" uuid references contact(id) on delete cascade,
  "campaignMemberId" uuid references campaign_member(id) on delete set null,
  "occurredAt" timestamp(3) not null default now(),
  source varchar(100),
  medium varchar(100),
  "utmSource" varchar(200),
  "utmMedium" varchar(200),
  "utmCampaign" varchar(200),
  "utmContent" varchar(200),
  "utmTerm" varchar(200),
  "landingPage" varchar(500),
  referrer varchar(500),
  details text,
  -- Where it came from, so one email open is logged once however often the
  -- provider reports it.
  "sourceKey" varchar(200),
  "createdById" uuid references app_user(id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  constraint campaign_interaction_has_person check ("leadId" is not null or "contactId" is not null)
);

create index if not exists campaign_interaction_campaign_idx on campaign_interaction ("campaignId", "occurredAt" desc);
create index if not exists campaign_interaction_lead_idx on campaign_interaction ("leadId", "occurredAt" desc);
create index if not exists campaign_interaction_contact_idx on campaign_interaction ("contactId", "occurredAt" desc);
create unique index if not exists campaign_interaction_source_key_idx on campaign_interaction ("sourceKey") where "sourceKey" is not null;

alter table campaign_interaction enable row level security;

-- Seen by employees who can see the person it is about. The subqueries run
-- under the lead's and contact's own row security.
drop policy if exists campaign_interaction_read on campaign_interaction;
create policy campaign_interaction_read on campaign_interaction for select to authenticated
  using (
    app_is_internal()
    and (
      ("leadId" is not null and exists (select 1 from lead l where l.id = "leadId"))
      or ("contactId" is not null and exists (select 1 from contact c where c.id = "contactId"))
    )
  );

-- Logged by hand: your own name, on a person you can see and may work on.
-- Automatic touches (forms, email tracking) are written by the service role
-- and by database functions, through record_campaign_interaction().
drop policy if exists campaign_interaction_insert on campaign_interaction;
create policy campaign_interaction_insert on campaign_interaction for insert to authenticated
  with check (
    app_is_internal()
    and "createdById" = app_current_user_id()
    and (
      ("leadId" is not null and app_has_permission('lead:write') and exists (select 1 from lead l where l.id = "leadId"))
      or ("leadId" is null and "contactId" is not null and app_has_permission('account:write')
          and exists (select 1 from contact c where c.id = "contactId"))
    )
  );

-- Each touch moves the person's latest fields, whoever logged it.
create or replace function campaign_interaction_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := coalesce(new."utmSource", new.source);
  v_medium text := coalesce(new."utmMedium", new.medium);
begin
  if new."leadId" is not null then
    update lead set
      "latestSource" = coalesce(v_source, "latestSource"),
      "latestMedium" = coalesce(v_medium, "latestMedium"),
      "latestCampaignId" = coalesce(new."campaignId", "latestCampaignId"),
      "latestLandingPage" = coalesce(new."landingPage", "latestLandingPage"),
      "latestReferrer" = coalesce(new.referrer, "latestReferrer"),
      "latestTouchAt" = new."occurredAt",
      "utmSource" = coalesce(new."utmSource", "utmSource"),
      "utmMedium" = coalesce(new."utmMedium", "utmMedium"),
      "utmCampaign" = coalesce(new."utmCampaign", "utmCampaign"),
      "utmContent" = coalesce(new."utmContent", "utmContent"),
      "utmTerm" = coalesce(new."utmTerm", "utmTerm"),
      "updatedAt" = now()
    where id = new."leadId" and new."occurredAt" >= coalesce("latestTouchAt", new."occurredAt");
  end if;

  if new."contactId" is not null then
    update contact set
      "firstSource" = coalesce("firstSource", v_source),
      "firstMedium" = coalesce("firstMedium", v_medium),
      "firstCampaignId" = coalesce("firstCampaignId", new."campaignId"),
      "firstTouchAt" = coalesce("firstTouchAt", new."occurredAt"),
      "latestSource" = coalesce(v_source, "latestSource"),
      "latestMedium" = coalesce(v_medium, "latestMedium"),
      "latestCampaignId" = coalesce(new."campaignId", "latestCampaignId"),
      "latestTouchAt" = greatest(coalesce("latestTouchAt", new."occurredAt"), new."occurredAt"),
      "updatedAt" = now()
    where id = new."contactId";
  end if;
  return new;
end $$;

drop trigger if exists campaign_interaction_touch on campaign_interaction;
create trigger campaign_interaction_touch after insert on campaign_interaction
  for each row execute function campaign_interaction_touch();

-- The automatic way in: forms, email tracking. Idempotent on sourceKey.
create or replace function record_campaign_interaction(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into campaign_interaction (
    "campaignId", "interactionType", "leadId", "contactId", "campaignMemberId", "occurredAt",
    source, medium, "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
    "landingPage", referrer, details, "sourceKey", "createdById"
  ) values (
    nullif(p ->> 'campaignId', '')::uuid, p ->> 'interactionType',
    nullif(p ->> 'leadId', '')::uuid, nullif(p ->> 'contactId', '')::uuid, nullif(p ->> 'campaignMemberId', '')::uuid,
    coalesce((p ->> 'occurredAt')::timestamptz, now()),
    left(nullif(p ->> 'source', ''), 100), left(nullif(p ->> 'medium', ''), 100),
    left(nullif(p ->> 'utmSource', ''), 200), left(nullif(p ->> 'utmMedium', ''), 200), left(nullif(p ->> 'utmCampaign', ''), 200),
    left(nullif(p ->> 'utmContent', ''), 200), left(nullif(p ->> 'utmTerm', ''), 200),
    left(nullif(p ->> 'landingPage', ''), 500), left(nullif(p ->> 'referrer', ''), 500),
    p ->> 'details', nullif(p ->> 'sourceKey', ''), nullif(p ->> 'createdById', '')::uuid
  )
  on conflict ("sourceKey") where "sourceKey" is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function record_campaign_interaction(jsonb) from public, anon, authenticated;
grant execute on function record_campaign_interaction(jsonb) to service_role;

drop trigger if exists view_as_read_only on campaign_interaction;
create trigger view_as_read_only before insert or update or delete on campaign_interaction
  for each statement execute function app_refuse_view_as_writes();

-- ---------------------------------------------------------------------------
-- Deal attribution
-- ---------------------------------------------------------------------------

create table if not exists opportunity_campaign (
  "opportunityId" uuid not null references opportunity(id) on delete cascade,
  "campaignId" uuid not null references campaign(id) on delete cascade,
  role varchar(20) not null check (role in ('FIRST', 'LEAD_CREATION', 'LATEST')),
  "createdAt" timestamp(3) not null default now(),
  primary key ("opportunityId", role)
);

create index if not exists opportunity_campaign_campaign_idx on opportunity_campaign ("campaignId");

alter table opportunity_campaign enable row level security;

drop policy if exists opportunity_campaign_read on opportunity_campaign;
create policy opportunity_campaign_read on opportunity_campaign for select to authenticated
  using (app_is_internal() and exists (select 1 from opportunity o where o.id = "opportunityId"));

drop trigger if exists view_as_read_only on opportunity_campaign;
create trigger view_as_read_only before insert or update or delete on opportunity_campaign
  for each statement execute function app_refuse_view_as_writes();

-- When a lead becomes a deal: the deal keeps the lead's campaigns, and the
-- contact keeps the lead's first and latest touch.
create or replace function lead_converted_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."convertedOpportunityId" is not null and old."convertedOpportunityId" is null then
    insert into opportunity_campaign ("opportunityId", "campaignId", role)
    select new."convertedOpportunityId", c, r
      from (values (new."firstCampaignId", 'FIRST'), (new."campaignId", 'LEAD_CREATION'), (new."latestCampaignId", 'LATEST')) v(c, r)
     where c is not null
    on conflict do nothing;
  end if;

  if new."convertedContactId" is not null and old."convertedContactId" is null then
    update contact set
      "firstSource" = coalesce("firstSource", new."firstSource"),
      "firstMedium" = coalesce("firstMedium", new."firstMedium"),
      "firstCampaignId" = coalesce("firstCampaignId", new."firstCampaignId"),
      "firstTouchAt" = coalesce("firstTouchAt", new."firstTouchAt"),
      "latestSource" = coalesce(new."latestSource", "latestSource"),
      "latestMedium" = coalesce(new."latestMedium", "latestMedium"),
      "latestCampaignId" = coalesce(new."latestCampaignId", "latestCampaignId"),
      "latestTouchAt" = greatest(coalesce("latestTouchAt", new."latestTouchAt"), coalesce(new."latestTouchAt", "latestTouchAt"))
    where id = new."convertedContactId";
    -- The lead's touches belong to the contact now too.
    update campaign_interaction set "contactId" = new."convertedContactId"
     where "leadId" = new.id and "contactId" is null;
  end if;
  return new;
end $$;

drop trigger if exists lead_converted_attribution on lead;
create trigger lead_converted_attribution after update of "convertedOpportunityId", "convertedContactId" on lead
  for each row execute function lead_converted_attribution();

-- Deals converted before today.
insert into opportunity_campaign ("opportunityId", "campaignId", role)
select l."convertedOpportunityId", v.c, v.r
  from lead l
  cross join lateral (values (l."firstCampaignId", 'FIRST'), (l."campaignId", 'LEAD_CREATION'), (l."latestCampaignId", 'LATEST')) v(c, r)
  join opportunity o on o.id = l."convertedOpportunityId"
 where l."convertedOpportunityId" is not null and v.c is not null
on conflict do nothing;

notify pgrst, 'reload schema';
