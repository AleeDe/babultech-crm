-- A campaign member belongs to a campaign, and can become a lead.
--
-- Two changes that belong together.
--
-- 1. A member now names the campaign that produced them. Previously membership
--    was derived from the activity junction: a person was "in" a campaign
--    because something had been sent to them. That junction is going, and
--    without it there would be nothing at all connecting a member to a
--    campaign - so the link becomes a column on the member.
--
--    The consequence is duplicate people: somebody at a webinar and a trade
--    show is two member rows, and two leads after conversion. That is accepted
--    deliberately, and handled where the work happens - a sales agent merges
--    duplicate leads - rather than by refusing the second row at import time,
--    which loses the fact that they came from two places.
--
--    What must NOT depend on the merge is consent. A later migration adds a
--    suppression list keyed on the address itself, so one unsubscribe stops
--    mail to every copy of a person immediately, whether or not anyone has got
--    round to merging them.
--
-- 2. Lead gains the fields a member has and it did not, so converting a member
--    into a lead loses nothing.

-- ---------------------------------------------------------------------------
-- 1. The member's campaign, and how we came by them
-- ---------------------------------------------------------------------------

alter table campaign_member
  add column if not exists "campaignId" uuid references campaign (id) on delete set null,
  -- Event attendees have job titles, and Lead has had one all along.
  add column if not exists "jobTitle" varchar(150),
  -- Set when the member has been turned into a lead, so the list can show
  -- what is still to be worked without a join.
  add column if not exists "convertedAt" timestamp(3);

comment on column campaign_member."campaignId" is
  'The campaign that produced this person - the webinar they attended, the form they filled in. One member row per campaign, so the same human may appear more than once.';

comment on column campaign_member.source is
  'How we came by them: a value from the member_source picklist.';

create index if not exists "campaign_member_campaign_idx"
  on campaign_member ("campaignId");
create index if not exists "campaign_member_converted_idx"
  on campaign_member ("convertedAt") where "convertedAt" is null;

-- The email key stops being global and becomes per campaign.
--
-- It has to: one row per person per campaign is the whole point of the change
-- above, and a global unique index on the address would reject the second
-- campaign's copy. Within ONE campaign a repeated address is still a duplicate
-- import line rather than a second person, so the constraint keeps working
-- where it is still true.
drop index if exists "campaign_member_email_key";
create unique index "campaign_member_campaign_email_key"
  on campaign_member ("campaignId", lower(email))
  where email is not null and "deletedAt" is null;

-- A member with no campaign yet - entered by hand as future audience - still
-- must not be duplicated on address, and the index above does not cover them
-- because null is never equal to null.
create unique index "campaign_member_email_no_campaign_key"
  on campaign_member (lower(email))
  where email is not null and "campaignId" is null and "deletedAt" is null;

-- ---------------------------------------------------------------------------
-- 2. Where a member came from
-- ---------------------------------------------------------------------------
--
-- An open picklist rather than an enum, for the same reason the other marketing
-- lists are: a new channel should not need a migration.

insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values
  ('member_source', 'Member source', 'Marketing', null, false,
   'How a campaign member came to us - the event, form or referral that produced them.', 205)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values
  ('member_source', 'WEBSITE_FORM',   'Website contact form', 10),
  ('member_source', 'WEBINAR',        'Webinar',              20),
  ('member_source', 'ONLINE_SESSION', 'Online session',       30),
  ('member_source', 'EVENT',          'Event',                40),
  ('member_source', 'TRADESHOW',      'Trade show',           50),
  ('member_source', 'REFERRAL',       'Referral',             60),
  ('member_source', 'PURCHASED_LIST', 'Purchased list',       70),
  ('member_source', 'RESEARCH',       'Our own research',     80),
  ('member_source', 'WALK_IN',        'Walk-in or enquiry',   90)
on conflict ("picklistKey", value) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Lead gains what a member has
-- ---------------------------------------------------------------------------
--
-- Without these, Convert to Lead would silently drop the company details and
-- the whole address - the part of a trade-show record that is often the only
-- useful thing on it.

alter table lead
  add column if not exists website        varchar(255),
  add column if not exists "businessType" varchar(100),
  add column if not exists "companySize"  varchar(30),
  add column if not exists street         varchar(255),
  add column if not exists city           varchar(100),
  add column if not exists state          varchar(100),
  add column if not exists "postalCode"   varchar(30),
  add column if not exists country        varchar(100),
  -- Which member row produced this lead. The reverse of campaign_member.leadId,
  -- kept on both sides because each direction is asked for on its own: the
  -- member list needs "has this been converted", the lead needs "where did
  -- this come from".
  add column if not exists "campaignMemberId" uuid
    references campaign_member (id) on delete set null;

create index if not exists "lead_campaignMember_idx"
  on lead ("campaignMemberId") where "campaignMemberId" is not null;

-- ---------------------------------------------------------------------------
-- 4. Converting a member into a lead
-- ---------------------------------------------------------------------------
--
-- Every field is carried across, including the campaign - which is the point of
-- the exercise, because a lead that cannot say which campaign produced it makes
-- the campaign unmeasurable.
--
-- Security definer so it can allocate a lead number, which needs the sequence
-- table. Guarded on lead:write, the same permission that lets somebody create a
-- lead by hand - which is all this is, with the typing done for them.
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
  -- and the caller wants the lead id either way.
  if v_m."leadId" is not null then
    return jsonb_build_object('leadId', v_m."leadId", 'alreadyConverted', true);
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
    'leadId', v_lead_id, 'leadNumber', v_number, 'alreadyConverted', false
  );
end $$;

revoke all on function convert_member_to_lead(uuid, uuid) from public, anon;
grant execute on function convert_member_to_lead(uuid, uuid) to authenticated;
