-- Merging duplicate leads.
--
-- Allowing a member row per campaign means the same person can arrive twice,
-- and converting both produces two leads. That is the accepted trade: keeping
-- the fact that somebody came from both a webinar and a trade show is worth
-- more than a clean lead list, and the person best placed to judge whether two
-- records are one human is the agent working them.
--
-- So merging is a deliberate act with a screen behind it, not an import-time
-- guess. The agent picks the survivor, then picks which value to keep field by
-- field, because the newer record is not reliably the better one - a trade-show
-- scan may have the mobile number while the web form has the job title.
--
-- Losers are soft-deleted and stamped with "mergedIntoId" rather than removed.
-- A merge is a judgement, judgements are sometimes wrong, and a deleted row
-- cannot be argued with.
--
-- Leads only, for now. Contacts and accounts are reached through a lead, so
-- duplicates enter at the lead and are cheapest to fix there.

alter table lead
  add column if not exists "mergedIntoId" uuid
    references lead (id) on delete set null,
  add column if not exists "mergedAt" timestamp(3);

comment on column lead."mergedIntoId" is
  'Set when this lead was merged into another. The row is kept, soft-deleted, so a mistaken merge can be seen and argued with.';

create index if not exists "lead_mergedInto_idx"
  on lead ("mergedIntoId") where "mergedIntoId" is not null;

-- ---------------------------------------------------------------------------
-- Finding the duplicates
-- ---------------------------------------------------------------------------
--
-- Email, or phone on its last nine digits - the same rule the partner conflict
-- check uses, because +92 300 7654321 and 03007654321 are one number written
-- two ways and a match that misses that is not a match.
--
-- A view rather than a function: the lead list needs to flag duplicates while
-- listing, and a function per row would be a query per row.
create or replace view lead_duplicate_group
with (security_invoker = true)
as
with keys as (
  select
    l.id,
    nullif(lower(btrim(l.email)), '') as email_key,
    -- Nine digits is enough to identify a number without the country code, and
    -- short enough that a landline written with an area code still matches.
    case
      when length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 9
      then right(regexp_replace(l.phone, '\D', '', 'g'), 9)
    end as phone_key
  from lead l
  where l."deletedAt" is null and l."mergedIntoId" is null
)
select
  k.id,
  k.email_key,
  k.phone_key,
  (
    select count(*) - 1 from keys o
    where (k.email_key is not null and o.email_key = k.email_key)
       or (k.phone_key is not null and o.phone_key = k.phone_key)
  ) as duplicate_count
from keys k;

comment on view lead_duplicate_group is
  'How many other live leads share this one''s email address or phone number. Phone is compared on its last nine digits.';

grant select on lead_duplicate_group to authenticated;

-- ---------------------------------------------------------------------------
-- The merge
-- ---------------------------------------------------------------------------
--
-- p_values carries the field values the agent chose to keep. Every column is
-- named explicitly below rather than built into dynamic SQL from the keys of
-- the jsonb: a caller could otherwise name any column in the table, including
-- the ones that decide who owns the record.
--
-- Anything a key does not appear for is left as the survivor already has it,
-- so the screen only has to send the fields somebody actually changed.
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

  -- 1. Apply the chosen values to the survivor.
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

  -- 2. Move everything attached to the losers.
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

  -- 3. Retire the losers.
  update lead set
    "mergedIntoId" = p_survivor,
    "mergedAt"     = now(),
    "deletedAt"    = now(),
    "updatedAt"    = now()
  where id = any(p_losers) and "deletedAt" is null;
  get diagnostics v_merged = row_count;

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

revoke all on function merge_leads(uuid, uuid[], jsonb) from public, anon;
grant execute on function merge_leads(uuid, uuid[], jsonb) to authenticated;
