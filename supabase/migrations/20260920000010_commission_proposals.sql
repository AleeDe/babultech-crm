-- Let a partner ask for a different rate on a deal, and let us answer.
--
-- The rate a partner is on is ours to set: their default, or an override we
-- agreed for one deal. That is right - it is our money - but it left the
-- partner with no way to make the case for a deal that took more work than the
-- default assumes, except by email to whoever they happen to know. Those
-- conversations already happen. This puts them against the deal, in writing,
-- with an answer attached.
--
-- A proposal is a request, never a rate. Nothing a partner does here changes
-- what they are paid; approving it is what writes
-- opportunity_partner.commissionPercentOverride, and only somebody holding
-- commission:approve can do that. The partner's number sits in the proposal
-- until then, which is also what makes the history readable later: what they
-- asked for, what we gave, and why.

create table if not exists commission_proposal (
  id uuid primary key,

  "partnerId"     uuid not null references partner (id) on delete cascade,
  "opportunityId" uuid not null references opportunity (id) on delete cascade,
  -- The link that actually carries the rate. Nullable because a deal can lose
  -- its partner link while a proposal against it is still open, and losing the
  -- proposal's history with it would be worse than an orphan.
  "opportunityPartnerId" uuid references opportunity_partner (id) on delete set null,

  -- What they are asking for, and what they were on when they asked. The
  -- second is a snapshot on purpose: read months later, "they asked for 15"
  -- means nothing without knowing it was 10 at the time.
  "proposedPercent" decimal(8,4) not null
    check ("proposedPercent" >= 0 and "proposedPercent" <= 100),
  "currentPercent"  decimal(8,4),

  "reason" text not null,

  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),

  "raisedById" uuid references app_user (id) on delete set null,

  "decidedById"   uuid references app_user (id) on delete set null,
  "decidedAt"     timestamp(3),
  -- What we told them. Required on a rejection by the function below: a
  -- partner told only "no" will ask again, by email, and we are back where we
  -- started.
  "decisionNote"  text,
  -- What was actually granted, which need not be what was asked for. A
  -- counter-offer is the common case and deserves recording as one.
  "approvedPercent" decimal(8,4)
    check ("approvedPercent" >= 0 and "approvedPercent" <= 100),

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

create index if not exists "commission_proposal_partnerId_idx"
  on commission_proposal ("partnerId");
create index if not exists "commission_proposal_status_idx"
  on commission_proposal (status);
-- One open proposal per partner per deal. Without this a partner can raise
-- five and we answer them one at a time, each answer stale before it is given.
create unique index if not exists "commission_proposal_one_open_idx"
  on commission_proposal ("partnerId", "opportunityId")
  where status = 'PENDING';

alter table commission_proposal enable row level security;
alter table commission_proposal force row level security;

drop policy if exists commission_proposal_internal_read on commission_proposal;
create policy commission_proposal_internal_read on commission_proposal
  for select using (app_is_internal());

drop policy if exists commission_proposal_partner_read on commission_proposal;
create policy commission_proposal_partner_read on commission_proposal
  for select using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- No write policy on either side. Both ends go through the functions below,
-- for the same reason partner creation does: the rules about who may decide
-- what live in one place rather than spread across column grants.

-- ---------------------------------------------------------------------------
-- The partner asks
-- ---------------------------------------------------------------------------

create or replace function partner_propose_commission(
  p_opportunity_id uuid,
  p_percent        numeric,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_link    record;
  v_current numeric;
  v_id      uuid := gen_random_uuid();
begin
  if v_partner is null then
    raise exception 'Only a partner may propose a rate.';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'A rate must be between 0 and 100 percent.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this deal deserves a different rate.';
  end if;

  select id, "commissionPercentOverride" into v_link
  from opportunity_partner
  where "opportunityId" = p_opportunity_id
    and "partnerId" = v_partner
  limit 1;

  if v_link.id is null then
    raise exception 'You are not registered on that deal.';
  end if;

  -- What they are on today: the deal's own override where one was agreed,
  -- otherwise the partner default. A null check rather than coalesce, because
  -- an override of 0 is a real decision and must not read as absent.
  if v_link."commissionPercentOverride" is not null then
    v_current := v_link."commissionPercentOverride";
  else
    select "defaultCommissionPercent" into v_current from partner where id = v_partner;
  end if;

  if exists (
    select 1 from commission_proposal
    where "partnerId" = v_partner
      and "opportunityId" = p_opportunity_id
      and status = 'PENDING'
  ) then
    raise exception 'You already have a request open on this deal. We will come back to you on it.';
  end if;

  insert into commission_proposal (
    id, "partnerId", "opportunityId", "opportunityPartnerId",
    "proposedPercent", "currentPercent", reason, status, "raisedById",
    "createdAt", "updatedAt"
  ) values (
    v_id, v_partner, p_opportunity_id, v_link.id,
    p_percent, v_current, btrim(p_reason), 'PENDING', app_current_user_id(),
    now(), now()
  );

  return jsonb_build_object('id', v_id, 'currentPercent', v_current);
end;
$$;

-- A partner may take back a request they have not had an answer to yet.
create or replace function partner_withdraw_proposal(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_rows    integer;
begin
  if v_partner is null then
    raise exception 'Only a partner may withdraw a request.';
  end if;

  update commission_proposal
     set status = 'WITHDRAWN', "updatedAt" = now()
   where id = p_id
     and "partnerId" = v_partner
     and status = 'PENDING';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'That request is not open, or is not yours.';
  end if;

  return jsonb_build_object('id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- We answer
-- ---------------------------------------------------------------------------
--
-- Approving writes the rate. That is the whole point of the mechanism: the
-- proposal and the rate cannot drift apart, because granting one sets the
-- other in the same transaction.
create or replace function decide_commission_proposal(
  p_id       uuid,
  p_approve  boolean,
  p_percent  numeric,
  p_note     text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_granted  numeric;
begin
  select * into v_proposal from commission_proposal where id = p_id;
  if v_proposal.id is null then
    raise exception 'That request no longer exists.';
  end if;
  if v_proposal.status <> 'PENDING' then
    raise exception 'That request has already been answered.';
  end if;

  if not p_approve then
    -- A rejection without a reason is the thing that sends the partner back to
    -- email, which is what this table exists to stop.
    if coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception 'Tell the partner why the rate was not agreed.';
    end if;

    update commission_proposal
       set status = 'REJECTED', "decidedById" = p_actor_id, "decidedAt" = now(),
           "decisionNote" = btrim(p_note), "updatedAt" = now()
     where id = p_id;

    return jsonb_build_object('id', p_id, 'status', 'REJECTED');
  end if;

  -- A counter-offer is ordinary: granting a different number from the one
  -- asked for is approval of the request, not a rejection of it.
  v_granted := coalesce(p_percent, v_proposal."proposedPercent");
  if v_granted < 0 or v_granted > 100 then
    raise exception 'A rate must be between 0 and 100 percent.';
  end if;

  update commission_proposal
     set status = 'APPROVED', "decidedById" = p_actor_id, "decidedAt" = now(),
         "decisionNote" = nullif(btrim(coalesce(p_note, '')), ''),
         "approvedPercent" = v_granted, "updatedAt" = now()
   where id = p_id;

  -- The rate itself. Written to the deal link, where the engine reads it.
  if v_proposal."opportunityPartnerId" is not null then
    update opportunity_partner
       set "commissionPercentOverride" = v_granted, "updatedAt" = now()
     where id = v_proposal."opportunityPartnerId";
  else
    update opportunity_partner
       set "commissionPercentOverride" = v_granted, "updatedAt" = now()
     where "opportunityId" = v_proposal."opportunityId"
       and "partnerId" = v_proposal."partnerId";
  end if;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Opportunity', v_proposal."opportunityId",
    'commissionPercentOverride',
    coalesce(v_proposal."currentPercent"::text, 'partner default'),
    v_granted::text, p_actor_id, 'manual', now()
  );

  return jsonb_build_object('id', p_id, 'status', 'APPROVED', 'percent', v_granted);
end;
$$;

revoke all on function partner_propose_commission(uuid, numeric, text) from public;
revoke all on function partner_withdraw_proposal(uuid) from public;
revoke all on function decide_commission_proposal(uuid, boolean, numeric, text, uuid) from public;

grant execute on function partner_propose_commission(uuid, numeric, text) to authenticated;
grant execute on function partner_withdraw_proposal(uuid) to authenticated;
grant execute on function decide_commission_proposal(uuid, boolean, numeric, text, uuid) to authenticated;
